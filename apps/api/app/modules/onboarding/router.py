"""First-run setup: the wizard a turf owner completes from inside the dashboard.

One endpoint, one transaction. The alternative — the wizard PATCHing settings, then
POSTing sports one by one, then flipping a flag — leaves a turf half-configured
whenever a step fails or the tab is closed, and there is no sensible place to resume
from. Here it either all lands or none of it does, and the owner is returned to step
one with nothing to clean up.

The work itself lives in `service.py`, because the self-serve signup on the
marketing site replays exactly these answers the moment a payment clears and must
not be a second implementation of them. See `modules/billing/service.fulfil`.
"""

from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select

from app.audit import write_audit
from app.auth.deps import RequireAdmin
from app.auth.schemas import TenantOut
from app.models.audit import ActorKind
from app.models.tenant import SERVICE_KEYS, Tenant, TenantSettings
from app.modules.onboarding import service
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

    previous_slug, created = await service.apply(
        db,
        tenant_row,
        settings_row,
        business_name=payload.business_name,
        logo_url=payload.logo_url,
        phone=payload.phone,
        city=payload.city,
        address=payload.address,
        sports=[selection.model_dump() for selection in payload.sports],
        services=payload.services,
    )

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
