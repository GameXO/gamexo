"""The externalisation gateway.

Everything a third-party platform can reach. Two rules hold across every endpoint
here, and both are load-bearing:

1. **Availability reflects EVERY booking** — counter, dashboard, and every other
   platform. That is the whole point: if Playo cannot see that a walk-in took Court
   1, it will sell Court 1 again. What partners never see is *whose* booking blocks
   a slot, only that it is blocked.

2. **A partner may only read or touch bookings IT created.** Enforced by filtering
   on `created_by_partner_id`, a foreign key — never on the `source_platform`
   string, which is a denormalised label and not an authorisation fact.

The double-booking guarantee itself is not implemented here. It is the
`booking_no_overlap` exclusion constraint in Postgres, which holds no matter which
client is asking, whether or not this module has a bug.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import select

from app.core.errors import ConflictError, NotFoundError
from app.modules.booking import service
from app.modules.booking.models import Booking, BookingEventKind, BookingStatus, BookingType, Court, Sport
from app.modules.gateway.deps import CurrentPartner
from app.modules.gateway.schemas import (
    PartnerBookingCancel,
    PartnerBookingCreate,
    PartnerBookingOut,
    PartnerCourtAvailability,
    PartnerSlot,
)
from app.tenancy.deps import Db

router = APIRouter(prefix="/gateway", tags=["gateway"])


async def _owned_booking(db: Db, booking_id: uuid.UUID, partner_id: uuid.UUID) -> Booking:
    """Fetch a booking, but only if this partner created it.

    404 rather than 403 on someone else's booking, deliberately. A 403 confirms the
    id exists, which turns this endpoint into an oracle for enumerating our booking
    ids — including walk-ins that have nothing to do with any platform.
    """
    result = await db.execute(
        select(Booking).where(
            Booking.id == booking_id,
            Booking.created_by_partner_id == partner_id,
        )
    )
    booking = result.scalar_one_or_none()
    if booking is None:
        raise NotFoundError("Booking not found.")
    return booking


@router.get(
    "/availability",
    response_model=list[PartnerCourtAvailability],
    summary="Free slots for a day",
    description=(
        "Reflects **every** booking — walk-ins at the counter, the dashboard, and "
        "other platforms — so a slot sold here is immediately unavailable to you.\n\n"
        "A slot marked `available` is not a reservation. Between this call and your "
        "`POST /gateway/bookings`, someone at the counter may take it; the create "
        "then returns **409**. Treat that as authoritative and mark the slot sold "
        "out — it is the database refusing to double-book the court, not a transient "
        "error to retry."
    ),
)
async def availability(
    db: Db,
    partner: CurrentPartner,
    date: Annotated[datetime, Query(description="Any instant on the target day")],
    duration_min: Annotated[int, Query(ge=15, le=1440)] = 60,
    sport_id: uuid.UUID | None = None,
    court_id: uuid.UUID | None = None,
    slot_minutes: Annotated[int, Query(ge=15, le=240)] = 60,
) -> list[PartnerCourtAvailability]:
    del partner  # Authentication only; availability is the same for every partner.

    rows = await service.court_availability(
        db,
        on_date=date,
        duration_min=duration_min,
        sport_id=sport_id,
        court_id=court_id,
        slot_minutes=slot_minutes,
    )

    sport_names = {
        sport_id_: name
        for sport_id_, name in (await db.execute(select(Sport.id, Sport.name))).all()
    }

    # Rebuilt field by field rather than passed through. `court_availability` returns
    # `blocked_by_booking_id` on every slot, and handing that to a third party would
    # let them enumerate our bookings by polling a day at a time.
    return [
        PartnerCourtAvailability(
            court_id=row["court_id"],
            court_name=row["court_name"],
            sport_id=row["sport_id"],
            sport_name=sport_names.get(row["sport_id"], ""),
            is_bookable=row["is_bookable"],
            slots=[
                PartnerSlot(
                    starts_at=slot["starts_at"],
                    ends_at=slot["ends_at"],
                    available=slot["available"],
                    rate=slot["rate"],
                    is_peak=slot["is_peak"],
                )
                for slot in row["slots"]
            ],
        )
        for row in rows
    ]


@router.post(
    "/bookings",
    response_model=PartnerBookingOut,
    status_code=status.HTTP_201_CREATED,
    summary="Claim a slot",
    description=(
        "Returns **409** if the court is already taken for any part of the window — "
        "by another platform or by a walk-in. That check is a Postgres exclusion "
        "constraint, so it holds under concurrency: two platforms claiming the same "
        "slot at the same instant, one wins.\n\n"
        "Send `external_ref` (your own booking id). Repeating a create with the same "
        "`external_ref` returns the booking you already made instead of a second one, "
        "so a timeout on your side is safe to retry."
    ),
)
async def create_booking(
    payload: PartnerBookingCreate, db: Db, partner: CurrentPartner
) -> PartnerBookingOut:
    # Idempotency first, before anything is priced or written: a retry must be a
    # cheap no-op, not a second attempt that races the constraint.
    if payload.external_ref:
        existing = await db.execute(
            select(Booking).where(
                Booking.created_by_partner_id == partner.id,
                Booking.external_ref == payload.external_ref,
            )
        )
        already = existing.scalar_one_or_none()
        if already is not None:
            return PartnerBookingOut.model_validate(already)

    court = await db.get(Court, payload.court_id)
    if court is None:
        raise NotFoundError("Court not found.")
    if not court.is_bookable:
        raise ConflictError(f"{court.name} is under maintenance.")

    ends_at = payload.starts_at + timedelta(minutes=payload.duration_min)
    if ends_at <= datetime.now(UTC):
        raise ConflictError("That slot has already finished.")

    customer_id, name, phone = await service.resolve_customer(
        db,
        customer_id=None,
        customer_name=payload.customer_name,
        customer_phone=payload.customer_phone,
    )

    # No equipment and no discount: kit is issued at the counter against real stock,
    # and a discount is the academy's to give. See PartnerBookingCreate.
    quote_result, lines = await service.price_booking(
        db,
        court=court,
        starts_at=payload.starts_at,
        duration_min=payload.duration_min,
        selections=[],
        discount=0,
    )

    booking = Booking(
        # A booking sold on Playo still gets our reference, and the partner gets it
        # back in the response — it is what the customer will be asked for at the
        # counter, so the platform has to be able to put it on their confirmation.
        reference=await service.next_booking_reference(db),
        customer_id=customer_id,
        customer_name=name,
        customer_phone=phone,
        sport_id=court.sport_id,
        court_id=court.id,
        starts_at=payload.starts_at,
        ends_at=ends_at,
        duration_min=payload.duration_min,
        # ONLINE, not WALKIN: nobody is standing at the counter, so this must not
        # trip the auto check-in that walk-ins get. Arriving is a separate event the
        # desk still confirms.
        booking_type=BookingType.ONLINE,
        status=BookingStatus.UPCOMING,
        open_slot=court.open_slots_enabled,
        created_by_partner_id=partner.id,
        # Taken from the authenticated partner, never from the request body — a
        # platform must not be able to file a booking under a competitor's name.
        source_platform=partner.slug,
        external_ref=payload.external_ref,
    )
    service._apply_quote(booking, quote_result, lines)
    db.add(booking)

    # The exclusion constraint is what actually prevents the double booking; this
    # call is what turns it into a legible 409 instead of a raw IntegrityError.
    #
    # Its details carry `conflicting_booking_id`, which is right for our own UI and
    # wrong here: handing Playo the id of Hudle's booking lets either of them map
    # our schedule by probing. The busy window is kept — availability already
    # reveals it, and a partner needs it to mark the right slot sold out.
    try:
        await service.ensure_slot_free(
            db, court_id=court.id, starts_at=payload.starts_at, ends_at=ends_at
        )
    except ConflictError as exc:
        details = exc.details or {}
        raise ConflictError(
            "That court is already booked for part of this time.",
            details={
                key: details[key]
                for key in ("conflicting_from", "conflicting_to")
                if key in details
            },
        ) from exc

    await db.flush()

    await service.record_event(
        db,
        booking,
        kind=BookingEventKind.CREATED,
        label="Booking Created",
        detail=(
            f"Via {partner.name}"
            + (f" (ref {payload.external_ref})" if payload.external_ref else "")
        ),
        actor_user_id=None,
    )
    await db.flush()
    return PartnerBookingOut.model_validate(booking)


@router.get(
    "/bookings",
    response_model=list[PartnerBookingOut],
    summary="Your bookings",
    description="Only bookings made through your own integration. Never walk-ins, "
    "and never another platform's.",
)
async def list_bookings(
    db: Db,
    partner: CurrentPartner,
    from_date: datetime | None = Query(default=None, description="starts_at >= this"),
    to_date: datetime | None = Query(default=None, description="starts_at < this"),
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[PartnerBookingOut]:
    stmt = select(Booking).where(Booking.created_by_partner_id == partner.id)
    if from_date is not None:
        stmt = stmt.where(Booking.starts_at >= from_date)
    if to_date is not None:
        stmt = stmt.where(Booking.starts_at < to_date)
    rows = (await db.execute(stmt.order_by(Booking.starts_at.desc()).limit(limit))).scalars().all()
    return [PartnerBookingOut.model_validate(row) for row in rows]


@router.get(
    "/bookings/{booking_id}",
    response_model=PartnerBookingOut,
    summary="One of your bookings",
    description="**404** for a booking your integration did not create, including "
    "walk-ins and other platforms' bookings.",
)
async def get_booking(
    booking_id: uuid.UUID, db: Db, partner: CurrentPartner
) -> PartnerBookingOut:
    return PartnerBookingOut.model_validate(await _owned_booking(db, booking_id, partner.id))


@router.post(
    "/bookings/{booking_id}/cancel",
    response_model=PartnerBookingOut,
    summary="Release one of your bookings",
    description=(
        "Frees the slot for everyone — it becomes available to the counter and to "
        "other platforms immediately. Idempotent: cancelling twice is not an error."
    ),
)
async def cancel_booking(
    booking_id: uuid.UUID,
    payload: PartnerBookingCancel,
    db: Db,
    partner: CurrentPartner,
) -> PartnerBookingOut:
    booking = await _owned_booking(db, booking_id, partner.id)
    # actor_user_id is None — no staff member is behind this — so the partner's name
    # goes in the detail, or the timeline would show a cancellation by nobody.
    await service.release_booking(
        db,
        booking,
        reason=payload.reason,
        actor_user_id=None,
        detail_prefix=f"Cancelled via {partner.name}",
    )
    return PartnerBookingOut.model_validate(booking)
