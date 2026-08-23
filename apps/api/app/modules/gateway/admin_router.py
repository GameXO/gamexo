"""Managing integrations from the dashboard.

Admin-only. Issuing an API key is handing a third party the ability to book courts
and read the day's availability, which is not a reception-desk decision — and the
kiosk login, which sits below reception, cannot reach any of this.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, status
from sqlalchemy import func, select

from app.api_utils import get_or_404
from app.auth.deps import RequireAdmin
from app.core.errors import ConflictError
from app.modules.booking.models import Booking
from app.modules.gateway.dialects import DIALECTS
from app.modules.gateway.dispatch import invalidate_partner_cache
from app.modules.gateway.models import IntegrationPartner, generate_api_key
from app.modules.gateway.schemas import (
    DialectOut,
    PartnerCreate,
    PartnerOut,
    PartnerUpdate,
    PartnerWithKey,
)
from app.tenancy.deps import Db

router = APIRouter(tags=["gateway"])


def _assert_usable_dialect(slug: str) -> None:
    """Refuse a dialect that cannot actually serve a partner.

    Two failures, one place. The second is the one that matters: Hudle and District
    are in the registry so the dashboard can show them as coming, and a key issued
    against either would authenticate perfectly and then 404 on every call. Greying
    the card out is presentation; this is the rule.
    """
    spec = DIALECTS.get(slug)
    if spec is None:
        raise ConflictError(f"Unknown dialect {slug!r}. Known: {sorted(DIALECTS)}.")
    if not spec.is_ready:
        raise ConflictError(
            f"{spec.label}'s integration is not built yet — we need their API spec "
            "first. Nothing to do here until it arrives.",
            details={"dialect": slug},
        )


@router.get(
    "/partners/dialects",
    response_model=list[DialectOut],
    summary="Wire formats the gateway speaks",
    description=(
        "What to choose when adding an integration.\n\n"
        "`base_path` is the same for every one of them — that is the point. A partner "
        "is handed one URL and one key, and the key tells the gateway which contract "
        "to route them to. `canonical_path` is where it routes to, useful when reading "
        "the reference below or debugging a call, and not something a partner needs.\n\n"
        "`is_platform` marks the named third-party platforms, which are what the "
        "dashboard offers. `is_ready` is false for one whose spec we do not have yet: "
        "listed so it can be shown as coming, and refused by `POST /partners`.\n\n"
        "Every dialect is returned, including the ones not offered — a partner "
        "onboarded before a dialect was retired still needs its label to render.\n\n"
        "Declared above `/partners/{partner_id}` deliberately — routes match in order, "
        "and `dialects` would otherwise be parsed as a malformed UUID."
    ),
)
async def list_dialects(_: RequireAdmin) -> list[DialectOut]:
    return [
        DialectOut(
            slug=d.slug,
            label=d.label,
            summary=d.summary,
            base_path="/api/v1/gateway",
            canonical_path=f"/api/v1/gateway/{d.slug}",
            is_default=d.is_default,
            is_platform=d.is_platform,
            is_ready=d.is_ready,
        )
        for d in DIALECTS.values()
    ]


@router.get("/partners", response_model=list[PartnerOut], summary="List integrations")
async def list_partners(db: Db, _: RequireAdmin) -> list[PartnerOut]:
    rows = (
        (await db.execute(select(IntegrationPartner).order_by(IntegrationPartner.name)))
        .scalars()
        .all()
    )
    return [PartnerOut.model_validate(row) for row in rows]


@router.post(
    "/partners",
    response_model=PartnerWithKey,
    status_code=status.HTTP_201_CREATED,
    summary="Add an integration and mint its key",
    description=(
        "**The key in this response is shown once.** Only its hash is stored, so it "
        "cannot be recovered — a partner who loses it needs a rotation, not a lookup."
    ),
)
async def create_partner(payload: PartnerCreate, db: Db, _: RequireAdmin) -> PartnerWithKey:
    clash = await db.execute(
        select(IntegrationPartner.id).where(
            func.lower(IntegrationPartner.slug) == payload.slug.lower()
        )
    )
    if clash.scalar_one_or_none() is not None:
        raise ConflictError(f"An integration with slug {payload.slug!r} already exists.")

    _assert_usable_dialect(payload.dialect)

    full_key, prefix, key_hash = generate_api_key(payload.slug)
    partner = IntegrationPartner(
        name=payload.name,
        slug=payload.slug.lower(),
        dialect=payload.dialect,
        external_venue_id=payload.external_venue_id,
        key_prefix=prefix,
        key_hash=key_hash,
        is_active=True,
    )
    db.add(partner)
    await db.flush()

    # Not strictly needed — the dispatcher never caches a miss, so a brand-new prefix
    # cannot be masked by a stale "no such key". Done anyway because the invariant
    # worth holding is "every write to this table invalidates", and an exception
    # someone has to re-derive is how the rule gets forgotten.
    invalidate_partner_cache(prefix)

    return PartnerWithKey(**PartnerOut.model_validate(partner).model_dump(), api_key=full_key)


@router.patch(
    "/partners/{partner_id}",
    response_model=PartnerOut,
    summary="Rename, re-point or revoke an integration",
    description=(
        "Setting `is_active: false` revokes access immediately — the next gateway "
        "request with that key is refused. Bookings the partner already made are "
        "untouched and keep their `source_platform`.\n\n"
        "Changing `dialect` re-points the partner at another contract without "
        "reissuing their key, which is the fix when an integration was set up against "
        "the wrong one. Deleting and re-creating is not an alternative: the FK from "
        "`booking` is RESTRICT, so a partner that has booked anything cannot be "
        "deleted at all."
    ),
)
async def update_partner(
    partner_id: uuid.UUID, payload: PartnerUpdate, db: Db, _: RequireAdmin
) -> PartnerOut:
    partner = await get_or_404(db, IntegrationPartner, partner_id, label="Integration")
    updates = payload.model_dump(exclude_unset=True)
    if "dialect" in updates:
        _assert_usable_dialect(updates["dialect"])
    for field, value in updates.items():
        setattr(partner, field, value)
    await db.flush()

    # The dispatcher routes on this value. Without the drop, an admin fixing a wrong
    # choice would watch it keep failing for up to the cache TTL.
    invalidate_partner_cache(partner.key_prefix)

    return PartnerOut.model_validate(partner)


@router.post(
    "/partners/{partner_id}/rotate-key",
    response_model=PartnerWithKey,
    summary="Issue a new key",
    description=(
        "Invalidates the old key the moment this returns — there is no overlap "
        "window, so coordinate with the partner before rotating a live integration."
    ),
)
async def rotate_key(partner_id: uuid.UUID, db: Db, _: RequireAdmin) -> PartnerWithKey:
    partner = await get_or_404(db, IntegrationPartner, partner_id, label="Integration")
    retired = partner.key_prefix
    full_key, prefix, key_hash = generate_api_key(partner.slug)
    partner.key_prefix = prefix
    partner.key_hash = key_hash
    await db.flush()

    # The retired prefix, not the new one: rotation changes the prefix itself, so the
    # old entry would otherwise sit in the dispatcher's cache until it expired.
    invalidate_partner_cache(retired)

    return PartnerWithKey(**PartnerOut.model_validate(partner).model_dump(), api_key=full_key)


@router.delete(
    "/partners/{partner_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an integration",
    description=(
        "Refused with **409** while any booking still references it — the FK is "
        "RESTRICT on purpose. A booking has to keep answering 'where did this come "
        "from?' long after the integration ends, so revoke with `is_active: false` "
        "rather than deleting."
    ),
)
async def delete_partner(partner_id: uuid.UUID, db: Db, _: RequireAdmin) -> None:
    partner = await get_or_404(db, IntegrationPartner, partner_id, label="Integration")
    used = await db.execute(
        select(Booking.id).where(Booking.created_by_partner_id == partner.id).limit(1)
    )
    if used.scalar_one_or_none() is not None:
        raise ConflictError(
            f"{partner.name} has bookings and cannot be deleted. Revoke it instead "
            "by setting is_active to false.",
            details={"partner_id": str(partner.id)},
        )
    prefix = partner.key_prefix
    await db.delete(partner)
    await db.flush()
    invalidate_partner_cache(prefix)
