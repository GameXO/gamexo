"""Our own contract — what a partner uses when they have no spec of their own.

The default dialect, and the one to point anybody at who will accept an API rather
than dictate one. It says what it means in the shapes the rest of this API uses:
ISO instants, snake_case, real HTTP status codes.

Everything here is a thin call into `gateway/service.py`. The domain behaviour —
atomicity, idempotency, holds, expiry, partner scoping — lives there and is shared
with every other dialect, so this file has no rules of its own to get wrong.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select

from app.core.errors import ConflictError, NotFoundError
from app.modules.booking.models import Booking, Sport
from app.modules.gateway import service
from app.modules.gateway.deps import speaking
from app.modules.gateway.dialects.base import Dialect
from app.modules.gateway.models import IntegrationPartner
from app.modules.gateway.schemas import (
    PartnerBookingCancel,
    PartnerBookingOut,
    PartnerCourtAvailability,
    PartnerSlot,
)
from app.modules.gateway.service import GatewayError, SlotRequest
from app.tenancy.deps import Db

router = APIRouter(tags=["gateway"])

#: This dialect's principal. Same authentication as everywhere else, plus a check
#: that the key was actually issued for 'native' — see `deps.speaking`.
Partner = Annotated[IntegrationPartner, Depends(speaking("native"))]


class NativeSlot(BaseModel):
    """One slot in a create or hold request."""

    model_config = ConfigDict(from_attributes=True)

    court_id: uuid.UUID
    starts_at: datetime
    duration_min: int = Field(ge=15, le=1440)

    customer_name: str = Field(min_length=1, max_length=200)
    customer_phone: str | None = Field(default=None, max_length=32)

    #: Your own booking id. Optional but strongly recommended: it is what makes a
    #: retried create idempotent rather than double-selling the court, and what a
    #: reconciliation run matches on.
    external_ref: str | None = Field(default=None, max_length=120)

    #: What you charged the customer. Omit to use our published rate for the slot.
    #: Sending a figure that disagrees with ours by more than ₹1 books at yours and
    #: leaves a note on the booking for the venue to reconcile.
    price: Decimal | None = None

    #: How much you have already collected. Anything short of `price` shows as a
    #: balance the desk collects on arrival.
    amount_paid: Decimal = Decimal(0)

    @field_validator("starts_at")
    @classmethod
    def _require_timezone(cls, v: datetime) -> datetime:
        # A naive datetime is read as UTC by Postgres and silently moves an Indian
        # booking by 5h30m — into a slot it then stops colliding with.
        if v.tzinfo is None:
            raise ValueError(
                "starts_at must include a timezone offset, e.g. 2026-08-21T18:00:00+05:30"
            )
        return v

    def to_request(self) -> SlotRequest:
        return SlotRequest(
            court_id=self.court_id,
            starts_at=self.starts_at,
            ends_at=self.starts_at + timedelta(minutes=self.duration_min),
            # None, not "": without a ref there is nothing to be idempotent *on*,
            # and the column must stay NULL or the partial unique index would treat
            # every ref-less booking as a duplicate of the last.
            external_ref=self.external_ref,
            customer_name=self.customer_name,
            customer_phone=self.customer_phone,
            price=self.price,
            amount_paid=self.amount_paid,
        )


class SlotBatch(BaseModel):
    """One or more slots, taken together or not at all."""

    slots: list[NativeSlot] = Field(min_length=1, max_length=25)


class ConfirmRequest(BaseModel):
    references: list[str] = Field(min_length=1, max_length=25)


class MapRequest(BaseModel):
    """Record your own second identifier against bookings we already hold."""

    pairs: dict[str, str] = Field(
        description="Our reference → your booking id",
        json_schema_extra={"example": {"XCB0042": "YOUR-BOOKING-991"}},
    )


def _conflict(exc: GatewayError) -> ConflictError:
    """A business failure, in the status code this dialect uses.

    409 rather than Playo's 200-with-an-envelope, because this contract speaks HTTP:
    a caller here can tell a refusal from an outage without parsing a body.
    """
    return ConflictError(str(exc))


@router.get(
    "/availability",
    response_model=list[PartnerCourtAvailability],
    summary="Free slots for a day",
    description=(
        "Reflects **every** booking — walk-ins at the counter, the dashboard, other "
        "platforms, and unconfirmed holds still in checkout — so a slot sold here is "
        "immediately unavailable to you.\n\n"
        "A slot marked `available` is not a reservation. Between this call and your "
        "create, someone at the counter may take it; the create then returns **409**. "
        "Treat that as authoritative and mark the slot sold out — it is the database "
        "refusing to double-book the court, not a transient error to retry.\n\n"
        "Use `POST /gateway/bookings/hold` if you need the slot held while a customer "
        "pays."
    ),
)
async def availability(
    db: Db,
    partner: Partner,
    date: Annotated[datetime, Query(description="Any instant on the target day")],
    duration_min: Annotated[int, Query(ge=15, le=1440)] = 60,
    sport_id: uuid.UUID | None = None,
    court_id: uuid.UUID | None = None,
    slot_minutes: Annotated[int, Query(ge=15, le=240)] = 60,
) -> list[PartnerCourtAvailability]:
    del partner  # Authentication only; availability is the same for every partner.

    rows = await service.availability(
        db,
        on_date=date,
        duration_min=duration_min,
        sport_id=sport_id,
        court_id=court_id,
        slot_minutes=slot_minutes,
    )

    sport_names = {
        sid: name for sid, name in (await db.execute(select(Sport.id, Sport.name))).all()
    }

    # Rebuilt field by field rather than passed through: `court_availability` returns
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
                    starts_at=s["starts_at"],
                    ends_at=s["ends_at"],
                    available=s["available"],
                    rate=s["rate"],
                    is_peak=s["is_peak"],
                )
                for s in row["slots"]
            ],
        )
        for row in rows
    ]


@router.post(
    "/bookings",
    response_model=list[PartnerBookingOut],
    status_code=status.HTTP_201_CREATED,
    summary="Claim one or more slots",
    description=(
        "Creates confirmed bookings immediately — for when you take payment before "
        "calling us. Use `/bookings/hold` if the customer is still paying.\n\n"
        "**All or nothing.** If any slot in the request is unavailable, none are "
        "created and the response is **409**. A half-applied booking request is never "
        "what anyone meant.\n\n"
        "Send `external_ref` (your own booking id). Repeating a create with the same "
        "one returns the booking you already made instead of a second, so a timeout "
        "on your side is safe to retry."
    ),
)
async def create_bookings(
    payload: SlotBatch, db: Db, partner: Partner
) -> list[PartnerBookingOut]:
    try:
        async with service.atomic(db):
            result = await service.claim(
                db,
                partner,
                [s.to_request() for s in payload.slots],
                hold=False,
            )
    except GatewayError as exc:
        raise _conflict(exc) from exc
    return [PartnerBookingOut.model_validate(b) for b in result.bookings]


@router.post(
    "/bookings/hold",
    response_model=list[PartnerBookingOut],
    status_code=status.HTTP_201_CREATED,
    summary="Hold slots while a customer pays",
    description=(
        "Blocks the courts without creating bookings. The hold competes for the slot "
        "against the counter exactly as a real booking does, so nobody can sell it "
        "underneath your customer — and it is **not** a booking: no revenue, no entry "
        "on the venue's board, nobody expected to arrive.\n\n"
        f"Holds expire after {int(service.HOLD_TTL.total_seconds() // 60)} minutes if "
        "`/bookings/confirm` never comes, so an abandoned checkout costs the venue at "
        "most one slot rotation. Bookings come back with `status: held`.\n\n"
        "All-or-nothing and idempotent, exactly as `POST /bookings`."
    ),
)
async def hold_slots(
    payload: SlotBatch, db: Db, partner: Partner
) -> list[PartnerBookingOut]:
    try:
        async with service.atomic(db):
            result = await service.claim(
                db,
                partner,
                [s.to_request() for s in payload.slots],
                hold=True,
            )
    except GatewayError as exc:
        raise _conflict(exc) from exc
    return [PartnerBookingOut.model_validate(b) for b in result.bookings]


@router.post(
    "/bookings/confirm",
    response_model=list[PartnerBookingOut],
    summary="Confirm held slots once payment clears",
    description=(
        "Turns holds into real bookings. Only after this do they reach the venue's "
        "reports, its counter board and the day's takings.\n\n"
        "**All or nothing**, and idempotent — confirming an already-confirmed booking "
        "succeeds and returns it, so a dropped response is safe to retry.\n\n"
        "A hold that lapsed still confirms **if the court is free**: your customer "
        "paid, and our timer is not their problem. It is refused with **409** only "
        "when the slot has since been taken — at which point refund them."
    ),
)
async def confirm_bookings(
    payload: ConfirmRequest, db: Db, partner: Partner
) -> list[PartnerBookingOut]:
    try:
        async with service.atomic(db):
            bookings = await service.confirm(db, partner, payload.references)
    except GatewayError as exc:
        raise _conflict(exc) from exc
    return [PartnerBookingOut.model_validate(b) for b in bookings]


@router.post(
    "/bookings/map",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Record your own booking ids against ours",
    description=(
        "For platforms that issue two identifiers — an order id at checkout and a "
        "booking id once your side settles. `external_ref` holds the first; this "
        "records the second, so reconciliation can match on whichever one you quote."
    ),
)
async def map_bookings(payload: MapRequest, db: Db, partner: Partner) -> None:
    try:
        async with service.atomic(db):
            await service.map_external(db, partner, list(payload.pairs.items()))
    except GatewayError as exc:
        raise NotFoundError(str(exc)) from exc


@router.get(
    "/bookings",
    response_model=list[PartnerBookingOut],
    summary="Your bookings",
    description="Only bookings made through your own integration. Never walk-ins, "
    "and never another platform's. Holds are included, with `status: held`.",
)
async def list_bookings(
    db: Db,
    partner: Partner,
    from_date: datetime | None = Query(default=None, description="starts_at >= this"),
    to_date: datetime | None = Query(default=None, description="starts_at < this"),
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[PartnerBookingOut]:
    stmt = select(Booking).where(Booking.created_by_partner_id == partner.id)
    if from_date is not None:
        stmt = stmt.where(Booking.starts_at >= from_date)
    if to_date is not None:
        stmt = stmt.where(Booking.starts_at < to_date)
    rows = (
        (await db.execute(stmt.order_by(Booking.starts_at.desc()).limit(limit)))
        .scalars()
        .all()
    )
    return [PartnerBookingOut.model_validate(r) for r in rows]


@router.get(
    "/bookings/{reference}",
    response_model=PartnerBookingOut,
    summary="One of your bookings",
    description=(
        "By our reference (`XCB0042`) or your own `external_ref`.\n\n"
        "**404** for a booking your integration did not create, including walk-ins "
        "and other platforms' bookings — a 403 would confirm the id exists, turning "
        "this into an oracle for enumerating the venue's bookings."
    ),
)
async def get_booking(
    reference: str, db: Db, partner: Partner
) -> PartnerBookingOut:
    booking = await service.owned(db, partner, reference)
    if booking is None:
        raise NotFoundError("Booking not found.")
    return PartnerBookingOut.model_validate(booking)


@router.post(
    "/bookings/{reference}/cancel",
    response_model=PartnerBookingOut,
    summary="Release one of your bookings",
    description=(
        "Frees the slot for everyone — the counter and every other platform — "
        "immediately. Works on holds as well as confirmed bookings.\n\n"
        "Idempotent: cancelling twice is not an error."
    ),
)
async def cancel_booking(
    reference: str, payload: PartnerBookingCancel, db: Db, partner: Partner
) -> PartnerBookingOut:
    try:
        async with service.atomic(db):
            released = await service.release(
                db, partner, [reference], reason=payload.reason
            )
    except GatewayError as exc:
        raise NotFoundError(str(exc)) from exc
    return PartnerBookingOut.model_validate(released[0])


class NativeDriver:
    """Sandbox driver — see `dialects/base.py::SandboxDriver`."""

    def __init__(self, call) -> None:
        self._call = call

    async def availability(self, day: str):
        ok, body, msg = await self._call("GET", "/gateway/availability", params={"date": day})
        if not ok:
            return False, [], msg
        courts = [
            {
                "courtId": str(c["court_id"]),
                "courtName": c["court_name"],
                "slots": [
                    {
                        "startTime": s["starts_at"][11:19],
                        "available": s["available"] and c["is_bookable"],
                    }
                    for s in c["slots"]
                ],
            }
            for c in body
        ]
        return True, courts, msg

    def _slots(self, slots):
        return {
            "slots": [
                {
                    "court_id": s["courtId"],
                    "starts_at": f"{s['date']}T{s['startTime']}+05:30",
                    "duration_min": 60,
                    "customer_name": s["userName"],
                    "external_ref": s["playoOrderId"],
                    "price": s["price"],
                    "amount_paid": s["paidAtPlayo"],
                }
                for s in slots
            ]
        }

    async def hold(self, slots):
        ok, body, msg = await self._call("POST", "/gateway/bookings/hold", json=self._slots(slots))
        return ok, [b["reference"] for b in body] if ok else [], msg

    async def create(self, slots):
        ok, body, msg = await self._call("POST", "/gateway/bookings", json=self._slots(slots))
        return ok, [b["reference"] for b in body] if ok else [], msg

    async def confirm(self, refs):
        ok, body, msg = await self._call(
            "POST", "/gateway/bookings/confirm", json={"references": refs}
        )
        return ok, [b["reference"] for b in body] if ok else [], msg

    async def cancel(self, refs):
        for ref in refs:
            ok, _, msg = await self._call(
                "POST", f"/gateway/bookings/{ref}/cancel", json={"reason": "sandbox cleanup"}
            )
            if not ok:
                return False, [], msg
        return True, refs, "cancelled"

    async def map_ids(self, refs, external):
        ok, _, msg = await self._call(
            "POST", "/gateway/bookings/map", json={"pairs": {r: external for r in refs}}
        )
        return ok, refs, msg


DIALECT = Dialect(
    slug="native",
    label="gamexo API",
    summary="Our own REST contract. Point any partner here unless they insist on their own.",
    router=router,
    driver=NativeDriver,
    is_default=True,
)
