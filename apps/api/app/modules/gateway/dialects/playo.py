"""Playo — External Venue Integration API Specifications v2.0.

A partner who dictates their own contract. Their spec lists the endpoints *the venue*
must host, so this file exists purely to translate: nothing here decides anything
about bookings, and every write goes through `gateway/service.py` on exactly the same
path as our own dialect.

Three things about their format are load-bearing and none match how the rest of this
API works:

1. **camelCase** — `courtId`, `paidAtPlayo`. Explicit aliases rather than a global
   config, so nobody has to remember it applies only here.

2. **`requestStatus` instead of HTTP status.** A slot that has just been taken is a
   `200 OK` carrying `requestStatus: 0`, not a 409. Their client treats a non-2xx as
   a transport fault and retries; a sold court never becomes available by retrying.
   Genuine faults — a bad key, a crash — stay real HTTP errors.

3. **Local wall-clock time, split from the date.** `"2026-09-04"` plus `"18:00:00"`,
   no offset anywhere. That means the *venue's* local time, which is why every
   conversion here goes through the tenant's timezone and never the server's.

`requestStatus` is documented as `0 - failed, 1 - successful` while their sample
payloads type it `"string"`. Integers are what the prose specifies and what the field
means, so integers are what we send. Worth confirming with them before go-live.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date as date_cls, datetime, time, timedelta
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError

from app.modules.booking import service as booking_service
from app.modules.booking.models import Sport
from app.modules.booking.pricing import tenant_zone
from app.modules.gateway import service
from app.modules.gateway.deps import speaking
from app.modules.gateway.dialects.base import Dialect
from app.modules.gateway.models import IntegrationPartner
from app.modules.gateway.service import GatewayError, SlotRequest
from app.tenancy.deps import Db

router = APIRouter(prefix="/playo", tags=["gateway"])

#: This dialect's principal. Same authentication as everywhere else, plus a check
#: that the key was actually issued for 'playo' — see `deps.speaking`.
Partner = Annotated[IntegrationPartner, Depends(speaking("playo"))]

#: Playo's own default when a slot request omits `endTime`, which their spec marks
#: optional. Refusing the booking over a field they document as optional would be
#: our bug, and every court here is sold by the hour.
DEFAULT_SLOT_MINUTES = 60

PLAYO = ConfigDict(populate_by_name=True, serialize_by_alias=True)
SUCCESS = 1
FAILURE = 0


# ── Wire format ─────────────────────────────────────────────────────────────


class PlayoEnvelope(BaseModel):
    model_config = PLAYO
    request_status: int = Field(alias="requestStatus")
    message: str


class PlayoSlot(BaseModel):
    model_config = PLAYO
    start_time: str = Field(alias="startTime")
    end_time: str = Field(alias="endTime")
    available: bool
    #: Ticketed sports only (their example is swimming). We sell whole courts, so a
    #: free slot is one ticket and a taken one is zero — consistent with `available`
    #: rather than a second, contradictory signal.
    tickets_available: int = Field(alias="ticketsAvailable")


class PlayoCourt(BaseModel):
    model_config = PLAYO
    court_id: str = Field(alias="courtId")
    court_name: str = Field(alias="courtName")
    slots: list[PlayoSlot]


class AvailabilityResponse(PlayoEnvelope):
    courts: list[PlayoCourt] = Field(default_factory=list)


class PlayoSlotRequest(BaseModel):
    """One slot. Shared by `/order/create` and `/booking/create` — their spec sends
    the same object under different names (`orders` vs `bookings`), and the only real
    difference is whether the result is a hold or a confirmed booking."""

    model_config = PLAYO

    date: str = Field(description="YYYY-MM-DD, venue local")
    court_id: str = Field(alias="courtId")
    start_time: str = Field(alias="startTime", description="HH:MM:SS, venue local")
    end_time: str | None = Field(default=None, alias="endTime")

    price: Decimal = Field(default=Decimal("0"))
    paid_at_playo: Decimal = Field(default=Decimal("0"), alias="paidAtPlayo")

    #: Their id for this order, and our idempotency key. Typed as a string because
    #: their samples send it both quoted and bare.
    playo_order_id: str = Field(alias="playoOrderId")

    #: Accepted and ignored — we sell whole courts, not tickets.
    num_tickets: int | None = Field(default=None, alias="numTickets")


class OrderCreateRequest(BaseModel):
    model_config = PLAYO
    venue_id: str | None = Field(default=None, alias="venueId")
    user_name: str = Field(default="Playo Customer", alias="userName")
    user_mobile: str | None = Field(default=None, alias="userMobile")
    user_email: str | None = Field(default=None, alias="userEmail")
    orders: list[PlayoSlotRequest] = Field(default_factory=list)


class BookingCreateRequest(BaseModel):
    model_config = PLAYO
    venue_id: str | None = Field(default=None, alias="venueId")
    user_name: str = Field(default="Playo Customer", alias="userName")
    user_mobile: str | None = Field(default=None, alias="userMobile")
    user_email: str | None = Field(default=None, alias="userEmail")
    bookings: list[PlayoSlotRequest] = Field(default_factory=list)


class OrderIdPair(BaseModel):
    model_config = PLAYO
    external_order_id: str = Field(alias="externalOrderId")
    playo_order_id: str = Field(alias="playoOrderId")


class BookingIdPair(BaseModel):
    model_config = PLAYO
    external_booking_id: str = Field(alias="externalBookingId")
    playo_order_id: str = Field(alias="playoOrderId")


class OrderCreateResponse(PlayoEnvelope):
    order_ids: list[OrderIdPair] = Field(default_factory=list, alias="orderIds")


class BookingCreateResponse(PlayoEnvelope):
    """Also the shape of `/order/confirm` — their spec names the field `bookingIds`
    in both, even though the confirm *request* is keyed by `orderIds`."""

    booking_ids: list[BookingIdPair] = Field(default_factory=list, alias="bookingIds")


class OrderIdsRequest(BaseModel):
    model_config = PLAYO
    order_ids: list[str] = Field(default_factory=list, alias="orderIds")


class BookingCancelItem(BaseModel):
    model_config = PLAYO
    playo_order_id: str | None = Field(default=None, alias="playoOrderId")
    external_booking_id: str = Field(alias="externalBookingId")
    #: Recorded on the timeline, not acted on: the refund has already been made on
    #: their side, and issuing a second one here would pay the customer twice.
    price: Decimal = Field(default=Decimal("0"))
    refund_at_playo: Decimal = Field(default=Decimal("0"), alias="refundAtPlayo")


class BookingCancelRequest(BaseModel):
    model_config = PLAYO
    booking_ids: list[BookingCancelItem] = Field(default_factory=list, alias="bookingIds")


class BookingMapItem(BaseModel):
    model_config = PLAYO
    external_booking_id: str = Field(alias="externalBookingId")
    playo_booking_id: str = Field(alias="playoBookingId")


class BookingMapRequest(BaseModel):
    model_config = PLAYO
    booking_ids: list[BookingMapItem] = Field(default_factory=list, alias="bookingIds")


# ── Translation ─────────────────────────────────────────────────────────────


def _parse_local(day: str, clock: str, *, timezone_name: str, label: str) -> datetime:
    """`"2026-09-04"` + `"18:00:00"` → an aware UTC instant.

    Through the *tenant's* timezone, never the server's: reading an 18:00 IST slot as
    18:00 UTC files an evening booking at half past eleven at night, where it quietly
    stops colliding with the bookings it should.
    """
    try:
        parsed_day = date_cls.fromisoformat(day.strip())
    except (ValueError, AttributeError) as exc:
        raise GatewayError(f"{label}: date must be YYYY-MM-DD, got {day!r}") from exc

    raw = (clock or "").strip()
    try:
        # HH:MM:SS per the spec; HH:MM accepted because their examples show both.
        parsed = time.fromisoformat(raw if len(raw) > 5 else f"{raw}:00")
    except ValueError as exc:
        raise GatewayError(f"{label}: time must be HH:MM:SS, got {clock!r}") from exc

    return datetime.combine(parsed_day, parsed, tzinfo=tenant_zone(timezone_name)).astimezone(UTC)


def _to_slot_request(
    item: PlayoSlotRequest, *, timezone_name: str, user_name: str, user_mobile: str | None
) -> SlotRequest:
    starts_at = _parse_local(
        item.date, item.start_time, timezone_name=timezone_name, label="startTime"
    )
    if item.end_time:
        ends_at = _parse_local(
            item.date, item.end_time, timezone_name=timezone_name, label="endTime"
        )
        # Their format cannot express midnight as an end time, so a slot ending at or
        # before it starts is one that crosses into the next day.
        if ends_at <= starts_at:
            ends_at += timedelta(days=1)
    else:
        ends_at = starts_at + timedelta(minutes=DEFAULT_SLOT_MINUTES)

    raw_court = str(item.court_id).strip().strip('"')
    try:
        court_id = uuid.UUID(raw_court)
    except ValueError as exc:
        # Playo echoes back whatever `courtId` we gave them in Fetch Availability, so
        # anything unparseable means their configuration is stale — a court we
        # deleted, or ids copied from another venue.
        raise GatewayError(f"Unknown court {raw_court!r}.") from exc

    return SlotRequest(
        court_id=court_id,
        starts_at=starts_at,
        ends_at=ends_at,
        external_ref=str(item.playo_order_id).strip().strip('"'),
        customer_name=user_name,
        customer_phone=user_mobile,
        price=item.price,
        amount_paid=item.paid_at_playo,
    )


def _fail(model: type, message: str):
    return model(request_status=FAILURE, message=message)


def _check_venue(partner: IntegrationPartner, venue_id: str | None) -> None:
    """Refuse a request aimed at a different venue.

    Redundant with the API key by design. The key already determines the academy, so
    this can only fire when a venue on Playo's side is configured against the wrong
    key — at which point one academy's bookings would land in another's diary.
    Skipped when either side has not recorded a venue id, so an integration mid-setup
    is not refused for being mid-setup.
    """
    expected = (partner.external_venue_id or "").strip()
    got = (venue_id or "").strip().strip('"')
    if expected and got and expected != got:
        raise GatewayError(f"venueId {got!r} is not the venue this API key belongs to.")


# ── Endpoints ───────────────────────────────────────────────────────────────


@router.get(
    "/availability",
    response_model=AvailabilityResponse,
    summary="Playo: fetch availability",
    description=(
        "Reflects **every** booking — the counter, the dashboard, other platforms, "
        "and unconfirmed Playo orders still in checkout. A slot Playo cannot see as "
        "taken is a slot Playo will sell twice.\n\n"
        "Expired holds are released before the read, so a checkout abandoned twenty "
        "minutes ago is not still showing a court as busy."
    ),
)
async def playo_availability(
    db: Db,
    partner: Partner,
    date: Annotated[str, Query(description="YYYY-MM-DD, venue local time")],
    venue_id: Annotated[str | None, Query(alias="venue_id")] = None,
    sport_id: Annotated[str | None, Query(alias="sport_id")] = None,
) -> AvailabilityResponse:
    try:
        _check_venue(partner, venue_id)
        settings = await booking_service.load_settings(db)
        on_date = _parse_local(date, "00:00:00", timezone_name=settings.timezone, label="date")

        sport_uuid = None
        if sport_id and sport_id.strip().strip('"'):
            try:
                sport_uuid = uuid.UUID(sport_id.strip().strip('"'))
            except ValueError as exc:
                raise GatewayError(f"Unknown sport {sport_id!r}.") from exc
            if await db.get(Sport, sport_uuid) is None:
                raise GatewayError(f"Unknown sport {sport_id!r}.")

        rows = await service.availability(
            db, on_date=on_date, duration_min=60, sport_id=sport_uuid, slot_minutes=60
        )
    except GatewayError as exc:
        return _fail(AvailabilityResponse, str(exc))

    zone = tenant_zone(settings.timezone)
    return AvailabilityResponse(
        request_status=SUCCESS,
        message="OK",
        courts=[
            PlayoCourt(
                court_id=str(row["court_id"]),
                court_name=row["court_name"],
                slots=[
                    PlayoSlot(
                        start_time=s["starts_at"].astimezone(zone).strftime("%H:%M:%S"),
                        end_time=s["ends_at"].astimezone(zone).strftime("%H:%M:%S"),
                        available=bool(s["available"]) and row["is_bookable"],
                        tickets_available=1 if s["available"] and row["is_bookable"] else 0,
                    )
                    for s in row["slots"]
                ],
            )
            for row in rows
        ],
    )


async def _create(db, partner, items, payload, *, hold: bool, model):
    if not items:
        return _fail(model, "No slots were supplied.")

    try:
        async with service.atomic(db):
            _check_venue(partner, payload.venue_id)
            settings = await booking_service.load_settings(db)
            slots = [
                _to_slot_request(
                    item,
                    timezone_name=settings.timezone,
                    user_name=payload.user_name,
                    user_mobile=payload.user_mobile,
                )
                for item in items
            ]
            result = await service.claim(db, partner, slots, hold=hold)
            pairs = [
                (b.reference, str(item.playo_order_id))
                for b, item in zip(result.bookings, items, strict=True)
            ]
    except GatewayError as exc:
        return _fail(model, str(exc))
    except IntegrityError:
        # The exclusion constraint firing on the flush rather than the pre-check —
        # two requests raced and Postgres arbitrated. Exactly the outcome we want; it
        # just arrives as an exception instead of a return value.
        return _fail(model, "One of those slots was taken while this order was being placed.")

    if hold:
        return OrderCreateResponse(
            request_status=SUCCESS,
            message="Slots held.",
            order_ids=[OrderIdPair(external_order_id=r, playo_order_id=p) for r, p in pairs],
        )
    return BookingCreateResponse(
        request_status=SUCCESS,
        message="Bookings created.",
        booking_ids=[BookingIdPair(external_booking_id=r, playo_order_id=p) for r, p in pairs],
    )


@router.post(
    "/order/create",
    response_model=OrderCreateResponse,
    summary="Playo: create order (hold slots)",
    description=(
        "Blocks the courts while the customer is still paying on Playo. The hold is a "
        "real row against the same exclusion constraint as every other booking, so "
        "the counter cannot sell the slot underneath them — and it is **not** a "
        "booking: no revenue, no counter entry, nobody expected to arrive.\n\n"
        f"Holds expire after {int(service.HOLD_TTL.total_seconds() // 60)} minutes if "
        "`/order/confirm` never comes.\n\n"
        "**All or nothing**, per their spec: if any slot fails, none are created and "
        "`requestStatus` is 0."
    ),
)
async def playo_order_create(
    payload: OrderCreateRequest, db: Db, partner: Partner
) -> OrderCreateResponse:
    return await _create(db, partner, payload.orders, payload, hold=True, model=OrderCreateResponse)


@router.post(
    "/booking/create",
    response_model=BookingCreateResponse,
    summary="Playo: create booking (non-order flow)",
    description=(
        "The single-phase flow: a confirmed booking straight away, for venues "
        "integrated without the order/confirm handshake.\n\n"
        "Same guarantees as `/order/create` — all-or-nothing, idempotent on "
        "`playoOrderId`, same exclusion constraint."
    ),
)
async def playo_booking_create(
    payload: BookingCreateRequest, db: Db, partner: Partner
) -> BookingCreateResponse:
    return await _create(
        db, partner, payload.bookings, payload, hold=False, model=BookingCreateResponse
    )


@router.post(
    "/order/confirm",
    response_model=BookingCreateResponse,
    summary="Playo: confirm order",
    description=(
        "Turns held slots into real bookings once payment has cleared. Only after "
        "this do they appear in reports, on the counter board and in the takings.\n\n"
        "**All or nothing**, and idempotent — confirming twice is a success, so a "
        "dropped response is safe to retry.\n\n"
        "A lapsed hold still confirms if the court is free; it is refused only once "
        "somebody else has taken the slot."
    ),
)
async def playo_order_confirm(
    payload: OrderIdsRequest, db: Db, partner: Partner
) -> BookingCreateResponse:
    try:
        async with service.atomic(db):
            bookings = await service.confirm(db, partner, payload.order_ids)
            pairs = [
                BookingIdPair(
                    external_booking_id=b.reference,
                    playo_order_id=b.external_ref or "",
                )
                for b in bookings
            ]
    except GatewayError as exc:
        return _fail(BookingCreateResponse, str(exc))

    return BookingCreateResponse(
        request_status=SUCCESS, message="Orders confirmed.", booking_ids=pairs
    )


@router.post(
    "/order/cancel",
    response_model=PlayoEnvelope,
    summary="Playo: cancel order",
    description=(
        "Releases held slots, and confirmed bookings too — their spec requires this "
        "endpoint to cancel a confirmed booking if one exists, so no order is left "
        "open on their side with no counterpart here.\n\n"
        "Idempotent: cancelling an already-cancelled order is a success."
    ),
)
async def playo_order_cancel(
    payload: OrderIdsRequest, db: Db, partner: Partner
) -> PlayoEnvelope:
    try:
        async with service.atomic(db):
            await service.release(db, partner, payload.order_ids, reason="Cancelled on Playo")
    except GatewayError as exc:
        return _fail(PlayoEnvelope, str(exc))
    return PlayoEnvelope(request_status=SUCCESS, message="Orders cancelled.")


@router.post(
    "/booking/cancel",
    response_model=PlayoEnvelope,
    summary="Playo: cancel booking",
    description=(
        "Frees the courts for everyone immediately.\n\n"
        "**All or nothing**, per their spec: *either all bookings should be cancelled "
        "or none of the requested bookings*.\n\n"
        "`price` and `refundAtPlayo` are recorded on the timeline, not acted on — the "
        "refund has already been made on their side."
    ),
)
async def playo_booking_cancel(
    payload: BookingCancelRequest, db: Db, partner: Partner
) -> PlayoEnvelope:
    if not payload.booking_ids:
        return _fail(PlayoEnvelope, "No bookings were supplied.")

    try:
        async with service.atomic(db):
            for item in payload.booking_ids:
                suffix = (
                    f" — refunded {item.refund_at_playo} of {item.price}"
                    if item.refund_at_playo
                    else ""
                )
                await service.release(
                    db,
                    partner,
                    [item.external_booking_id],
                    reason="Cancelled on Playo",
                    detail_suffix=suffix,
                )
    except GatewayError as exc:
        return _fail(PlayoEnvelope, str(exc))
    return PlayoEnvelope(request_status=SUCCESS, message="Bookings cancelled.")


@router.post(
    "/booking/map",
    response_model=PlayoEnvelope,
    summary="Playo: map their booking ids to ours",
    description=(
        "Optional in their spec. Records Playo's own `playoBookingId`, a different "
        "value from the `playoOrderId` we already hold — so reconciliation can match "
        "on whichever id the other side happens to be quoting."
    ),
)
async def playo_booking_map(
    payload: BookingMapRequest, db: Db, partner: Partner
) -> PlayoEnvelope:
    try:
        async with service.atomic(db):
            await service.map_external(
                db,
                partner,
                [(i.external_booking_id, i.playo_booking_id) for i in payload.booking_ids],
            )
    except GatewayError as exc:
        return _fail(PlayoEnvelope, str(exc))
    return PlayoEnvelope(request_status=SUCCESS, message="Bookings mapped.")


class PlayoDriver:
    """Sandbox driver — see `dialects/base.py::SandboxDriver`.

    Note `ok` is derived from `requestStatus`, not the HTTP status: in this dialect a
    refusal is a 200. That mapping is the entire reason the driver exists.
    """

    def __init__(self, call) -> None:
        self._call = call

    @staticmethod
    def _ok(body: dict[str, Any]) -> bool:
        return body.get("requestStatus") == SUCCESS

    async def availability(self, day: str):
        _, body, _ = await self._call("GET", "/gateway/playo/availability", params={"date": day})
        return self._ok(body), body.get("courts", []), body.get("message", "")

    @staticmethod
    def _orders(slots):
        return [
            {
                "date": s["date"],
                "courtId": s["courtId"],
                "startTime": s["startTime"],
                "endTime": s["endTime"],
                "price": s["price"],
                "paidAtPlayo": s["paidAtPlayo"],
                "playoOrderId": s["playoOrderId"],
            }
            for s in slots
        ]

    async def hold(self, slots):
        _, body, _ = await self._call(
            "POST", "/gateway/playo/order/create",
            json={"userName": slots[0]["userName"], "orders": self._orders(slots)},
        )
        refs = [p["externalOrderId"] for p in body.get("orderIds", [])]
        return self._ok(body), refs, body.get("message", "")

    async def create(self, slots):
        _, body, _ = await self._call(
            "POST", "/gateway/playo/booking/create",
            json={"userName": slots[0]["userName"], "bookings": self._orders(slots)},
        )
        refs = [p["externalBookingId"] for p in body.get("bookingIds", [])]
        return self._ok(body), refs, body.get("message", "")

    async def confirm(self, refs):
        _, body, _ = await self._call(
            "POST", "/gateway/playo/order/confirm", json={"orderIds": refs}
        )
        got = [p["externalBookingId"] for p in body.get("bookingIds", [])]
        return self._ok(body), got, body.get("message", "")

    async def cancel(self, refs):
        _, body, _ = await self._call(
            "POST", "/gateway/playo/order/cancel", json={"orderIds": refs}
        )
        return self._ok(body), refs, body.get("message", "")

    async def map_ids(self, refs, external):
        _, body, _ = await self._call(
            "POST", "/gateway/playo/booking/map",
            json={
                "bookingIds": [
                    {"externalBookingId": r, "playoBookingId": external} for r in refs
                ]
            },
        )
        return self._ok(body), refs, body.get("message", "")


DIALECT = Dialect(
    slug="playo",
    label="Playo",
    summary="Playo's External Venue Integration v2.0. They call us; camelCase and a "
    "requestStatus envelope instead of HTTP status codes.",
    router=router,
    driver=PlayoDriver,
)
