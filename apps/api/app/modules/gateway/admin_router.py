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


@router.get(
    "/partners/dialects",
    response_model=list[DialectOut],
    summary="Wire formats the gateway speaks",
    description=(
        "What to choose when adding an integration, and the base path to hand the "
        "partner.\n\n"
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
            base_path=f"/api/v1/gateway/{d.slug}" if not d.is_default else "/api/v1/gateway",
            is_default=d.is_default,
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

    if payload.dialect not in DIALECTS:
        raise ConflictError(
            f"Unknown dialect {payload.dialect!r}. Known: {sorted(DIALECTS)}."
        )

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

    return PartnerWithKey(**PartnerOut.model_validate(partner).model_dump(), api_key=full_key)


@router.patch(
    "/partners/{partner_id}",
    response_model=PartnerOut,
    summary="Rename or revoke an integration",
    description=(
        "Setting `is_active: false` revokes access immediately — the next gateway "
        "request with that key is refused. Bookings the partner already made are "
        "untouched and keep their `source_platform`."
    ),
)
async def update_partner(
    partner_id: uuid.UUID, payload: PartnerUpdate, db: Db, _: RequireAdmin
) -> PartnerOut:
    partner = await get_or_404(db, IntegrationPartner, partner_id, label="Integration")
    updates = payload.model_dump(exclude_unset=True)
    if "dialect" in updates and updates["dialect"] not in DIALECTS:
        raise ConflictError(
            f"Unknown dialect {updates['dialect']!r}. Known: {sorted(DIALECTS)}."
        )
    for field, value in updates.items():
        setattr(partner, field, value)
    await db.flush()
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
    full_key, prefix, key_hash = generate_api_key(partner.slug)
    partner.key_prefix = prefix
    partner.key_hash = key_hash
    await db.flush()
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
    await db.delete(partner)
    await db.flush()
