"""First-run setup: the wizard a freshly signed-up turf owner completes.

One endpoint, one transaction. The alternative — the wizard PATCHing settings, then
POSTing sports one by one, then flipping a flag — leaves a turf half-configured
whenever a step fails or the tab is closed, and there is no sensible place to resume
from. Here it either all lands or none of it does, and the owner is returned to step
one with nothing to clean up.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict
from datetime import UTC, datetime

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from app.audit import write_audit
from app.auth.deps import RequireAdmin
from app.auth.schemas import TenantOut
from app.models.audit import ActorKind
from app.models.tenant import RESERVED_SLUGS, SERVICE_KEYS, Tenant, TenantSettings
from app.modules.booking import catalogue, service
from app.modules.booking.models import Sport
from app.tenancy.deps import Db, TenantCtx
from app.tenancy.resolver import invalidate_tenant_cache

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


class SportSelection(BaseModel):
    """A sport the turf offers: a catalogue slug, or a name for one we don't list."""

    slug: str = Field(min_length=1, max_length=100)
    name: str | None = Field(default=None, max_length=100)


class OnboardingRequest(BaseModel):
    business_name: str = Field(min_length=1, max_length=200)
    logo_url: str | None = None
    phone: str | None = Field(default=None, max_length=32)
    city: str | None = Field(default=None, max_length=120)
    address: str | None = None
    sports: list[SportSelection] = Field(default_factory=list)
    services: dict[str, bool] = Field(default_factory=dict)

    @field_validator("services")
    @classmethod
    def _known_services(cls, v: dict[str, bool]) -> dict[str, bool]:
        # Unknown keys are dropped rather than rejected. A frontend deployed against
        # a newer API sending a service this build has never heard of should not fail
        # the whole of onboarding over a checkbox.
        return {key: bool(value) for key, value in v.items() if key in SERVICE_KEYS}


class OnboardingResponse(BaseModel):
    tenant: TenantOut
    sports_created: int


async def _claim_slug(db: Db, desired: str, *, tenant_id: uuid.UUID) -> str:
    """A free DNS label derived from the turf's name.

    The slug is globally unique because it may become a public subdomain, so a
    second "Arena Sports" has to become `arena-sports-2`. Suffixes rather than
    random noise: the owner will eventually see this in a URL, and `arena-sports-2`
    is a readable address in a way that `arena-sports-9f3a` is not.
    """
    base = service.slugify(desired)[:56] or "turf"
    if base in RESERVED_SLUGS:
        base = f"{base}-turf"

    candidate = base
    for suffix in range(2, 100):
        taken = await db.execute(
            select(Tenant.id).where(Tenant.slug == candidate, Tenant.id != tenant_id)
        )
        if taken.scalar_one_or_none() is None:
            return candidate
        candidate = f"{base}-{suffix}"

    # 98 turfs with the same name is not a case worth a cleverer algorithm.
    return f"{base}-{uuid.uuid4().hex[:6]}"


@router.post(
    "/complete",
    response_model=OnboardingResponse,
    summary="Finish first-run setup",
    description=(
        "Names the turf, sets its logo and services, and creates the sports it "
        "offers — atomically. Deliberately creates **no courts**: a new turf has "
        "none until the owner adds them, and the empty state on the dashboard is "
        "what points them at Sports & Courts to do it.\n\n"
        "Safe to re-run. Sports that already exist are skipped rather than "
        "duplicated, so a retry after a dropped connection does the right thing."
    ),
)
async def complete_onboarding(
    payload: OnboardingRequest,
    db: Db,
    tenant: TenantCtx,
    principal: RequireAdmin,
    request: Request,
) -> OnboardingResponse:
    tenant_row = (await db.execute(select(Tenant).where(Tenant.id == tenant.id))).scalar_one()
    settings_row = (await db.execute(select(TenantSettings))).scalar_one()

    previous_slug = tenant_row.slug

    # ── Identity ─────────────────────────────────────────────────────────────
    settings_row.business_name = payload.business_name.strip()
    if payload.logo_url is not None:
        settings_row.logo_url = payload.logo_url
    if payload.phone is not None:
        settings_row.phone = payload.phone
    if payload.city is not None:
        settings_row.city = payload.city
    if payload.address is not None:
        settings_row.address = payload.address
    if payload.services:
        # Merged, not replaced: the wizard shows the services it knows about, and a
        # key it never rendered should keep its default rather than vanish.
        settings_row.enabled_services = {**settings_row.enabled_services, **payload.services}

    tenant_row.name = payload.business_name.strip()
    tenant_row.slug = await _claim_slug(db, payload.business_name, tenant_id=tenant_row.id)

    # ── Sports ───────────────────────────────────────────────────────────────
    existing = set(
        (await db.execute(select(Sport.slug))).scalars().all()
    )
    created = 0
    for order, selection in enumerate(payload.sports):
        entry = catalogue.BY_SLUG.get(selection.slug)
        slug = entry.slug if entry else service.slugify(selection.name or selection.slug)
        if slug in existing:
            continue
        existing.add(slug)

        if entry is not None:
            db.add(Sport(**asdict(entry), display_order=order))
        else:
            # A sport we don't stock. Priced at zero on purpose — a made-up number
            # here would be charged to a real customer before anyone noticed.
            db.add(
                Sport(
                    name=(selection.name or selection.slug).strip()[:100],
                    slug=slug,
                    icon="🏅",
                    default_duration_min=60,
                    price_base=0,
                    price_peak=0,
                    price_weekend=0,
                    display_order=order,
                )
            )
        created += 1

    tenant_row.onboarding_completed_at = datetime.now(UTC)
    await db.flush()

    await write_audit(
        db,
        tenant_id=tenant.id,
        action="tenant.onboarded",
        actor_kind=ActorKind.USER,
        actor_id=principal.id,
        actor_label=principal.email,
        entity_type="tenant",
        entity_id=tenant.id,
        changes={
            "after": {
                "name": tenant_row.name,
                "slug": tenant_row.slug,
                "sports_created": created,
            }
        },
        request=request,
    )

    # The resolver caches tenants by slug and by id for five minutes. Without this
    # the old placeholder slug keeps resolving until the TTL expires, and — worse —
    # a later turf that legitimately claims it would be served this tenant's id.
    invalidate_tenant_cache(previous_slug, tenant_row.slug, str(tenant_row.id))

    return OnboardingResponse(
        tenant=TenantOut.model_validate(tenant_row), sports_created=created
    )
