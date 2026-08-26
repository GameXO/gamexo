"""Turning the wizard's answers into a configured academy.

Extracted from the router because there are now two callers and only one of them is
a request:

  * `POST /onboarding/complete` — an owner who already has an account, finishing
    first-run setup from inside the dashboard.
  * `modules/billing/service.fulfil` — the self-serve path, where the same answers
    were collected on the marketing site *before* the tenant existed and are
    replayed the moment a payment clears.

Keeping this in the router would mean the paid path re-implemented slug claiming,
sport creation and the service merge — three things that are subtly easy to get
wrong in the same three ways twice. There is one implementation, and both paths get
the same idempotency.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service as auth_service
from app.models.tenant import RESERVED_SLUGS, SERVICE_KEYS, Tenant, TenantSettings
from app.modules.booking import catalogue, service
from app.modules.booking.models import Sport


async def claim_slug(db: AsyncSession, desired: str, *, tenant_id: uuid.UUID) -> str:
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


def clean_services(raw: dict[str, Any] | None) -> dict[str, bool]:
    """Keep only the switches we know about.

    Unknown keys are dropped rather than rejected. A frontend deployed against a
    newer API sending a service this build has never heard of should not fail the
    whole of onboarding over a checkbox.
    """
    return {key: bool(value) for key, value in (raw or {}).items() if key in SERVICE_KEYS}


async def create_sports(db: AsyncSession, selections: list[dict[str, Any]]) -> int:
    """Create the sports this turf offers, skipping any it already has.

    The skip is what makes onboarding safe to re-run: a retry after a dropped
    connection re-sends the same list and creates nothing the second time.
    """
    existing = set((await db.execute(select(Sport.slug))).scalars().all())
    created = 0

    for order, selection in enumerate(selections):
        requested = str(selection.get("slug") or "").strip()
        name = selection.get("name")
        entry = catalogue.BY_SLUG.get(requested)
        slug = entry.slug if entry else service.slugify(str(name or requested))
        if not slug or slug in existing:
            continue
        existing.add(slug)

        if entry is not None:
            db.add(Sport(**asdict(entry), display_order=order))
        else:
            # A sport we don't stock. Priced at zero on purpose — a made-up number
            # here would be charged to a real customer before anyone noticed.
            db.add(
                Sport(
                    name=str(name or requested).strip()[:100],
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

    return created


async def apply(
    db: AsyncSession,
    tenant_row: Tenant,
    settings_row: TenantSettings,
    *,
    business_name: str,
    logo_url: str | None = None,
    phone: str | None = None,
    city: str | None = None,
    address: str | None = None,
    email: str | None = None,
    sports: list[dict[str, Any]] | None = None,
    services: dict[str, Any] | None = None,
) -> tuple[str, int]:
    """Name the turf, set its identity and services, create its sports.

    Returns `(previous_slug, sports_created)` — the old slug because the caller has
    to invalidate the resolver's cache with it, and it is gone by the time this
    returns.

    Deliberately creates **no courts**: a new turf has none until the owner adds
    them, and the empty state on the dashboard is what points them at Sports &
    Courts to do it.

    Does not commit. Both callers have more to write in the same transaction.
    """
    previous_slug = tenant_row.slug
    name = business_name.strip()

    settings_row.business_name = name
    if logo_url is not None:
        settings_row.logo_url = logo_url
    if phone is not None:
        settings_row.phone = phone
    if city is not None:
        settings_row.city = city
    if address is not None:
        settings_row.address = address
    if email is not None:
        settings_row.email = email

    cleaned = clean_services(services)
    if cleaned:
        # Merged, not replaced: the wizard shows the services it knows about, and a
        # key it never rendered should keep its default rather than vanish.
        settings_row.enabled_services = {**settings_row.enabled_services, **cleaned}

    tenant_row.name = name
    new_slug = await claim_slug(db, name, tenant_id=tenant_row.id)
    tenant_row.slug = new_slug

    # Usernames embed the slug, so renaming the academy has to carry its logins with
    # it. `/auth/signup` provisions under a random placeholder and arrives here to be
    # named, which without this would leave the owner signing in as
    # `admin@turf-9f3a2b` permanently. A no-op when the slug did not change.
    await auth_service.rebase_usernames(
        db, tenant_id=tenant_row.id, old_slug=previous_slug, new_slug=new_slug
    )

    created = await create_sports(db, sports or [])

    tenant_row.onboarding_completed_at = datetime.now(UTC)
    await db.flush()

    return previous_slug, created
