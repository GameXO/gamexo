"""Playo's contract, and the consistency guarantees underneath it.

Two kinds of test here. The first checks we speak their dialect — camelCase,
`requestStatus`, local wall-clock times. The second is the part that matters: that a
court cannot be sold twice, that a partial order cannot be committed, and that a
hold is invisible to everything except the calendar.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from app.core.security import Role
from app.db.session import tenant_session
from app.models.tenant import TenantSettings
from app.modules.booking.models import Booking, BookingEvent, BookingStatus
from tests.conftest import PASSWORD, TenantFixture, auth_headers, login, make_user
from tests.test_booking import book, setup_academy
from tests.test_gateway import make_partner, one, partner_book

IST = ZoneInfo("Asia/Kolkata")

#: A week out, recomputed every run. The gateway refuses to hold a slot that has
#: already happened — correctly — so a date literal here is a fuse: these tests
#: passed until the wall clock went past 4 September 2026, then began failing with
#: an empty `orderIds` and an IndexError that says nothing about the cause.
#: Nothing below asserts on the date itself, and Playo supplies its own price, so
#: which weekday this lands on does not matter.
DAY = (datetime.now(IST).date() + timedelta(days=7)).isoformat()


def counter_slot(hour: int) -> str:
    """The same slot as `slot(...)` below, in the shape the counter books it.

    Half these tests are about a Playo hold and a walk-in colliding on one court,
    which only works while both name the same instant. `at()` from the booking
    suite is pinned to September 2026 and DAY is not, so mixing the two silently
    puts them on different days and the collision stops happening — the test then
    passes or fails for a reason unrelated to what it is checking.
    """
    return f"{DAY}T{hour:02d}:00:00+05:30"


def slot(court: str, hour: int, order_id: str, price: str = "1200", paid: str = "1200") -> dict:
    return {
        "date": DAY,
        "courtId": court,
        "startTime": f"{hour:02d}:00:00",
        "endTime": f"{hour + 1:02d}:00:00",
        "price": price,
        "paidAtPlayo": paid,
        "playoOrderId": order_id,
    }


async def playo(client: AsyncClient, ctx: dict, tenant: TenantFixture) -> dict:
    return await make_partner(client, ctx, tenant, "Playo", "playo", dialect="playo")


async def post(client: AsyncClient, partner: dict, path: str, body: dict):
    return await client.post(
        f"/api/v1/gateway/playo{path}", json=body, headers=partner["headers"]
    )


# ── The dialect ─────────────────────────────────────────────────────────────


async def test_availability_speaks_playos_shape(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    response = await client.get(
        "/api/v1/gateway/playo/availability", params={"date": DAY}, headers=partner["headers"]
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["requestStatus"] == "1"
    court = body["courts"][0]
    assert set(court) == {"courtId", "courtName", "slots"}
    assert set(court["slots"][0]) == {"startTime", "endTime", "available", "ticketsAvailable"}
    # HH:MM:SS local, per their spec — not an ISO instant.
    assert court["slots"][0]["startTime"].count(":") == 2


async def test_business_failures_are_200_not_4xx(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The convention their client depends on.

    Playo reads a non-2xx as a transport fault and retries. A court that has just
    been sold never becomes available by retrying, so it must not look retryable.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    response = await post(
        client, partner, "/order/create",
        {"userName": "X", "orders": [slot("00000000-0000-0000-0000-000000000000", 9, "P1")]},
    )

    assert response.status_code == 200
    assert response.json()["requestStatus"] == "0"
    assert response.json()["message"]


async def test_a_bad_key_is_still_a_401(client: AsyncClient, tenant_a: TenantFixture) -> None:
    """The one exception. Authentication genuinely is a transport-level failure, and
    Playo should retry it after fixing the credential."""
    await setup_academy(client, tenant_a)
    response = await client.get(
        "/api/v1/gateway/playo/availability",
        params={"date": DAY},
        headers={"X-API-Key": "gx_playo_dead.beef", **tenant_a.headers},
    )
    assert response.status_code == 401


async def test_times_are_read_in_the_academys_timezone(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """18:00 in the request means 18:00 at the venue.

    Reading it as UTC would file an Indian evening booking at 23:30 and, worse, stop
    it colliding with the bookings it should.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    created = await post(
        client, partner, "/booking/create",
        {"userName": "Evening Player", "bookings": [slot(ctx["court_1"], 18, "P-TZ")]},
    )
    reference = created.json()["bookingIds"][0]["externalBookingId"]

    async with tenant_session(tenant_a.id) as session:
        booking = (
            await session.execute(select(Booking).where(Booking.reference == reference))
        ).scalar_one()
        # 18:00 IST is 12:30 UTC.
        assert booking.starts_at.astimezone(UTC).hour == 12
        assert booking.starts_at.astimezone(UTC).minute == 30


# ── Double booking ──────────────────────────────────────────────────────────


async def test_a_hold_blocks_the_counter(client: AsyncClient, tenant_a: TenantFixture) -> None:
    """The whole point of the two-phase flow.

    A customer is mid-payment on Playo; the court must not be sellable at the desk
    in the meantime, even though no money has moved and no booking exists yet.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    held = await post(
        client, partner, "/order/create",
        {"userName": "Paying Customer", "orders": [slot(ctx["court_1"], 9, "P-HOLD")]},
    )
    assert held.json()["requestStatus"] == "1"

    counter = await book(client, ctx, court=ctx["court_1"], starts_at=counter_slot(9))
    assert counter.status_code == 409


async def test_the_counter_blocks_playo(client: AsyncClient, tenant_a: TenantFixture) -> None:
    """And the other way round, which is the direction that actually loses money —
    a walk-in already on the court when Playo sells it."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    await book(client, ctx, court=ctx["court_1"], starts_at=counter_slot(9))

    response = await post(
        client, partner, "/order/create",
        {"userName": "Too Late", "orders": [slot(ctx["court_1"], 9, "P-LATE")]},
    )
    assert response.json()["requestStatus"] == "0"
    assert "already booked" in response.json()["message"]


# ── Atomicity ───────────────────────────────────────────────────────────────


async def test_a_partial_order_is_not_committed(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Their spec: *if any order fails then no order should be created*.

    The subtle failure this guards: the request-scoped session commits when a
    handler returns normally, and returning 200 with `requestStatus: 0` *is* a
    normal return. Without the savepoint the first slot would be committed while
    Playo is told nothing was created — a court blocked with no counterpart on
    their side and no record of why.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    await post(
        client, partner, "/order/create",
        {"userName": "Blocker", "orders": [slot(ctx["court_1"], 10, "P-BLOCK")]},
    )

    response = await post(
        client, partner, "/order/create",
        {
            "userName": "Atomic Customer",
            "orders": [slot(ctx["court_1"], 9, "P-A1"), slot(ctx["court_1"], 10, "P-A2")],
        },
    )
    assert response.json()["requestStatus"] == "0"
    assert response.json()["orderIds"] == []

    # The 9am slot was free and must have stayed that way.
    async with tenant_session(tenant_a.id) as session:
        leaked = (
            await session.execute(select(Booking).where(Booking.external_ref == "P-A1"))
        ).scalars().all()
    assert leaked == []

    free = await book(client, ctx, court=ctx["court_1"], starts_at=counter_slot(9))
    assert free.status_code == 201


async def test_cancel_is_all_or_nothing(client: AsyncClient, tenant_a: TenantFixture) -> None:
    """*Either all bookings should be cancelled or none of the requested bookings.*"""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    created = await post(
        client, partner, "/booking/create",
        {"userName": "Real Customer", "bookings": [slot(ctx["court_1"], 9, "P-C1")]},
    )
    reference = created.json()["bookingIds"][0]["externalBookingId"]

    response = await post(
        client, partner, "/booking/cancel",
        {
            "bookingIds": [
                {"externalBookingId": reference, "price": "1200", "refundAtPlayo": "1200"},
                {"externalBookingId": "XCB999999", "price": "0", "refundAtPlayo": "0"},
            ]
        },
    )
    assert response.json()["requestStatus"] == "0"

    async with tenant_session(tenant_a.id) as session:
        booking = (
            await session.execute(select(Booking).where(Booking.reference == reference))
        ).scalar_one()
        assert booking.status is not BookingStatus.CANCELLED


# ── Idempotency ─────────────────────────────────────────────────────────────


async def test_a_retried_order_returns_the_same_booking(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A timeout on their side must be safe to retry."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)
    payload = {"userName": "Retry Customer", "orders": [slot(ctx["court_1"], 9, "P-SAME")]}

    first = await post(client, partner, "/order/create", payload)
    again = await post(client, partner, "/order/create", payload)

    assert first.json()["requestStatus"] == again.json()["requestStatus"] == "1"
    assert (
        first.json()["orderIds"][0]["externalOrderId"]
        == again.json()["orderIds"][0]["externalOrderId"]
    )

    async with tenant_session(tenant_a.id) as session:
        rows = (
            await session.execute(select(Booking).where(Booking.external_ref == "P-SAME"))
        ).scalars().all()
    assert len(rows) == 1


# ── Holds are invisible to the business ─────────────────────────────────────


async def test_a_hold_is_not_a_booking(client: AsyncClient, tenant_a: TenantFixture) -> None:
    """It blocks the calendar and nothing else.

    A held slot appearing in the bookings list or the day's takings would have staff
    chasing a customer who never bought anything.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    await post(
        client, partner, "/order/create",
        {"userName": "Mid Checkout", "orders": [slot(ctx["court_1"], 9, "P-HELD")]},
    )

    listed = await client.get("/api/v1/bookings", headers=ctx["headers"])
    assert listed.json()["items"] == []

    # Still reachable deliberately, for anyone diagnosing a stuck court.
    explicit = await client.get(
        "/api/v1/bookings", params={"status": "held"}, headers=ctx["headers"]
    )
    assert len(explicit.json()["items"]) == 1


async def test_a_hold_cannot_be_checked_in(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    # Local to the academy, not UTC — the endpoint reads wall-clock time as IST, so
    # sending a UTC clock here puts the slot five and a half hours in the past.
    soon = datetime.now(IST) + timedelta(minutes=5)
    created = await post(
        client, partner, "/order/create",
        {
            "userName": "Mid Checkout",
            "orders": [
                {
                    "date": soon.date().isoformat(),
                    "courtId": ctx["court_1"],
                    "startTime": soon.strftime("%H:%M:%S"),
                    "price": "1200",
                    "paidAtPlayo": "1200",
                    "playoOrderId": "P-SOON",
                }
            ],
        },
    )
    assert created.json()["requestStatus"] == "1", created.text
    reference = created.json()["orderIds"][0]["externalOrderId"]

    response = await client.get(
        "/api/v1/bookings/checkin-lookup", params={"code": reference}, headers=ctx["headers"]
    )
    assert response.status_code == 404


async def test_confirming_turns_it_into_a_real_booking(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    created = await post(
        client, partner, "/order/create",
        {"userName": "Paying Customer", "orders": [slot(ctx["court_1"], 9, "P-CONF")]},
    )
    reference = created.json()["orderIds"][0]["externalOrderId"]

    confirmed = await post(client, partner, "/order/confirm", {"orderIds": [reference]})
    assert confirmed.json()["requestStatus"] == "1"
    assert confirmed.json()["bookingIds"][0]["externalBookingId"] == reference

    listed = await client.get("/api/v1/bookings", headers=ctx["headers"])
    assert len(listed.json()["items"]) == 1
    assert listed.json()["items"][0]["source_platform"] == "playo"


# ── Expiry ──────────────────────────────────────────────────────────────────


async def _expire(tenant: TenantFixture, reference: str) -> None:
    async with tenant_session(tenant.id) as session:
        await session.execute(
            update(Booking)
            .where(Booking.reference == reference)
            .values(hold_expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )


async def test_an_expired_hold_stops_blocking_the_court(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """An abandoned checkout must not take a prime slot off the market forever.

    Nothing in Postgres would notice: `booking_no_overlap` has no notion of a TTL.
    `release_expired_holds` is what makes the slot sellable again.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    created = await post(
        client, partner, "/order/create",
        {"userName": "Abandoned", "orders": [slot(ctx["court_1"], 9, "P-EXP")]},
    )
    await _expire(tenant_a, created.json()["orderIds"][0]["externalOrderId"])

    counter = await book(client, ctx, court=ctx["court_1"], starts_at=counter_slot(9))
    assert counter.status_code == 201


async def test_a_lapsed_hold_still_confirms_if_the_court_is_free(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The customer paid. Our fifteen-minute timer is not their problem."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    created = await post(
        client, partner, "/order/create",
        {"userName": "Slow Payer", "orders": [slot(ctx["court_1"], 9, "P-SLOW")]},
    )
    reference = created.json()["orderIds"][0]["externalOrderId"]
    await _expire(tenant_a, reference)

    confirmed = await post(client, partner, "/order/confirm", {"orderIds": [reference]})
    assert confirmed.json()["requestStatus"] == "1", confirmed.text


async def test_a_lapsed_hold_cannot_be_confirmed_once_the_court_is_gone(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The case that would double-book.

    Found by the sandbox: before `release_expired_holds` was called on confirm, an
    expired-but-unswept hold was still `HELD` and confirmed happily — putting two
    customers on one court.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    created = await post(
        client, partner, "/order/create",
        {"userName": "Slow Payer", "orders": [slot(ctx["court_1"], 9, "P-LOST")]},
    )
    reference = created.json()["orderIds"][0]["externalOrderId"]
    await _expire(tenant_a, reference)

    walkin = await book(client, ctx, court=ctx["court_1"], starts_at=counter_slot(9))
    assert walkin.status_code == 201

    confirmed = await post(client, partner, "/order/confirm", {"orderIds": [reference]})
    assert confirmed.json()["requestStatus"] == "0"
    assert "someone else" in confirmed.json()["message"]


# ── Isolation ───────────────────────────────────────────────────────────────


async def test_playo_cannot_cancel_a_walk_in(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Every lookup is scoped to `created_by_partner_id`.

    A partner quoting a real reference for a booking it did not make must get
    nothing — otherwise the reference printed on every customer's ticket becomes a
    cancellation key for anyone with an API key.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    walkin = (await book(client, ctx, court=ctx["court_1"], starts_at=counter_slot(9))).json()

    response = await post(
        client, partner, "/booking/cancel",
        {"bookingIds": [{"externalBookingId": walkin["reference"], "price": "0",
                         "refundAtPlayo": "0"}]},
    )
    assert response.json()["requestStatus"] == "0"

    async with tenant_session(tenant_a.id) as session:
        booking = await session.get(Booking, walkin["id"])
        assert booking.status is not BookingStatus.CANCELLED


async def test_one_platform_cannot_touch_anothers_booking(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    playo_partner = await playo(client, ctx, tenant_a)
    hudle = await make_partner(client, ctx, tenant_a, "Hudle", "hudle", dialect="playo")

    created = await post(
        client, playo_partner, "/booking/create",
        {"userName": "Playo Customer", "bookings": [slot(ctx["court_1"], 9, "P-MINE")]},
    )
    reference = created.json()["bookingIds"][0]["externalBookingId"]

    response = await post(
        client, hudle, "/booking/cancel",
        {"bookingIds": [{"externalBookingId": reference, "price": "0", "refundAtPlayo": "0"}]},
    )
    assert response.json()["requestStatus"] == "0"


async def test_source_platform_comes_from_the_key_not_the_body(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A platform must not be able to file a booking under a competitor's name."""
    ctx = await setup_academy(client, tenant_a)
    hudle = await make_partner(client, ctx, tenant_a, "Hudle", "hudle", dialect="playo")

    created = await post(
        client, hudle, "/booking/create",
        {"venueId": "playo", "userName": "X", "bookings": [slot(ctx["court_1"], 9, "H-1")]},
    )
    reference = created.json()["bookingIds"][0]["externalBookingId"]

    async with tenant_session(tenant_a.id) as session:
        booking = (
            await session.execute(select(Booking).where(Booking.reference == reference))
        ).scalar_one()
    assert booking.source_platform == "hudle"


# ── Money ───────────────────────────────────────────────────────────────────


async def test_playos_price_is_what_gets_booked(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Not our rate card.

    The customer has seen a price and paid it. Booking them in at ours would mean
    the counter asking for money they were never told about.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    created = await post(
        client, partner, "/booking/create",
        {"userName": "Discounted Customer",
         "bookings": [slot(ctx["court_1"], 9, "P-PRICE", price="999", paid="999")]},
    )
    reference = created.json()["bookingIds"][0]["externalBookingId"]

    async with tenant_session(tenant_a.id) as session:
        booking = (
            await session.execute(select(Booking).where(Booking.reference == reference))
        ).scalar_one()

    assert booking.total == 999
    assert booking.amount_paid == 999
    # Gross split into base + GST so the invoice adds up to its own lines.
    assert booking.court_charge + booking.taxes == booking.total


async def test_a_part_paid_booking_leaves_a_balance(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """`paidAtPlayo` short of `price` is money the desk collects on arrival."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    created = await post(
        client, partner, "/booking/create",
        {"userName": "Part Payer",
         "bookings": [slot(ctx["court_1"], 9, "P-PART", price="1200", paid="500")]},
    )
    reference = created.json()["bookingIds"][0]["externalBookingId"]

    async with tenant_session(tenant_a.id) as session:
        booking = (
            await session.execute(select(Booking).where(Booking.reference == reference))
        ).scalar_one()

    assert booking.amount_paid == 500
    assert booking.total == 1200
    assert booking.payment_status.value == "partial"


# ── Mapping ─────────────────────────────────────────────────────────────────


async def test_booking_map_records_their_second_id(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """`playoBookingId` is a different value from `playoOrderId`, and reconciliation
    matches on whichever the other side is quoting."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    created = await post(
        client, partner, "/booking/create",
        {"userName": "Mapped Customer", "bookings": [slot(ctx["court_1"], 9, "P-ORDER")]},
    )
    reference = created.json()["bookingIds"][0]["externalBookingId"]

    mapped = await post(
        client, partner, "/booking/map",
        {"bookingIds": [{"externalBookingId": reference, "playoBookingId": "PB-777"}]},
    )
    assert mapped.json()["requestStatus"] == "1"

    async with tenant_session(tenant_a.id) as session:
        booking = (
            await session.execute(select(Booking).where(Booking.reference == reference))
        ).scalar_one()
    assert booking.partner_booking_ref == "PB-777"
    assert booking.external_ref == "P-ORDER"


# ── v2.0 wire details ───────────────────────────────────────────────────────


async def test_request_status_is_a_string(client: AsyncClient, tenant_a: TenantFixture) -> None:
    """v2.0: *Use string requestStatus values*. Their client compares against "1",
    so an integer 1 reads as a failure on their side."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    ok = await client.get(
        "/api/v1/gateway/playo/availability", params={"date": DAY}, headers=partner["headers"]
    )
    refused = await post(client, partner, "/order/confirm", {"orderIds": ["XCB999999"]})

    assert ok.json()["requestStatus"] == "1"
    assert refused.json()["requestStatus"] == "0"


async def test_booking_create_accepts_an_integer_order_id(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Their generic `/booking/create` client sends `playoOrderId: 100003`, bare.
    Pydantic v2 refuses an int for a `str` field by default, which made the whole
    direct-booking flow a 422."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    body = slot(ctx["court_1"], 9, "unused")
    body["playoOrderId"] = 100003
    body["clubDiscount"] = 0.0

    created = await post(client, partner, "/booking/create",
                         {"userName": "Demo Customer", "bookings": [body]})

    assert created.status_code == 200, created.text
    assert created.json()["requestStatus"] == "1", created.text
    # Echoed back as a string, per their response schema.
    assert created.json()["bookingIds"][0]["playoOrderId"] == "100003"

    async with tenant_session(tenant_a.id) as session:
        booking = (
            await session.execute(select(Booking).where(Booking.external_ref == "100003"))
        ).scalar_one()
    assert booking.status is BookingStatus.UPCOMING


async def test_placeholder_contact_is_not_stored(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """9999999999 is Playo's stand-in when user-info sharing is off — not a number
    the desk should ever try to ring."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    created = await post(
        client, partner, "/booking/create",
        {"userName": "Hidden User", "userMobile": "9999999999", "userEmail": "playo@playo.co",
         "bookings": [slot(ctx["court_1"], 9, "P-ANON")]},
    )
    shared = await post(
        client, partner, "/booking/create",
        {"userName": "Shared User", "userMobile": "+919000011111",
         "bookings": [slot(ctx["court_1"], 10, "P-SHARED")]},
    )
    assert created.json()["requestStatus"] == shared.json()["requestStatus"] == "1"

    async with tenant_session(tenant_a.id) as session:
        anon = (
            await session.execute(select(Booking).where(Booking.external_ref == "P-ANON"))
        ).scalar_one()
        real = (
            await session.execute(select(Booking).where(Booking.external_ref == "P-SHARED"))
        ).scalar_one()
    assert anon.customer_phone is None
    assert real.customer_phone == "+919000011111"


async def test_club_discount_lands_on_the_timeline(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Recorded, not applied — its meaning is still to be confirmed with Playo."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    body = slot(ctx["court_1"], 9, "P-CLUB", price="1000", paid="1000")
    body["clubDiscount"] = 150
    created = await post(client, partner, "/booking/create",
                         {"userName": "Member", "bookings": [body]})
    reference = created.json()["bookingIds"][0]["externalBookingId"]

    async with tenant_session(tenant_a.id) as session:
        booking = (
            await session.execute(select(Booking).where(Booking.reference == reference))
        ).scalar_one()
        details = (
            await session.execute(
                select(BookingEvent.detail).where(BookingEvent.booking_id == booking.id)
            )
        ).scalars().all()

    assert booking.total == 1000
    assert any("clubDiscount 150" in (d or "") for d in details)


async def test_availability_uses_the_venues_slot_length(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A venue selling half-hour slots must show Playo half-hour slots."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    async with tenant_session(tenant_a.id) as session:
        settings = (await session.execute(select(TenantSettings))).scalar_one()
        settings.booking_rules = {**settings.booking_rules, "min_duration_minutes": 30}

    response = await client.get(
        "/api/v1/gateway/playo/availability", params={"date": DAY}, headers=partner["headers"]
    )
    first = response.json()["courts"][0]["slots"][0]
    start_h, start_m, _ = map(int, first["startTime"].split(":"))
    end_h, end_m, _ = map(int, first["endTime"].split(":"))
    assert (end_h * 60 + end_m) - (start_h * 60 + start_m) == 30


async def test_availability_for_a_sport_with_no_courts_is_a_failure(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Their success schema requires at least one court."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    empty_sport = await client.post(
        "/api/v1/sports",
        json={"name": "Squash", "icon": "🟢", "price_base": "500",
              "price_peak": "700", "price_weekend": "600"},
        headers=ctx["headers"],
    )
    assert empty_sport.status_code == 201, empty_sport.text

    response = await client.get(
        "/api/v1/gateway/playo/availability",
        params={"date": DAY, "sport_id": empty_sport.json()["id"]},
        headers=partner["headers"],
    )
    assert response.status_code == 200
    assert response.json()["requestStatus"] == "0"
    assert "No courts" in response.json()["message"]


# ── Venue-side changes to a Playo booking ───────────────────────────────────
#
# Playo's contract has no call for the venue to tell them anything. Moving a booking
# is still safe — they read availability from us — but cancelling one here would
# resell a court the customer holds a paid Playo ticket for.


async def _playo_booking(
    client: AsyncClient, ctx: dict, partner: dict, tenant: TenantFixture,
    hour: int, order_id: str, price: str = "1200",
) -> tuple[str, str]:
    created = await post(
        client, partner, "/booking/create",
        {"userName": "Playo Customer",
         "bookings": [slot(ctx["court_1"], hour, order_id, price=price, paid=price)]},
    )
    assert created.json()["requestStatus"] == "1", created.text
    reference = created.json()["bookingIds"][0]["externalBookingId"]
    async with tenant_session(tenant.id) as session:
        booking = (
            await session.execute(select(Booking).where(Booking.reference == reference))
        ).scalar_one()
    return reference, str(booking.id)


def _slot_state(availability: dict, court: str, clock: str) -> bool:
    row = next(c for c in availability["courts"] if c["courtId"] == court)
    return next(s for s in row["slots"] if s["startTime"] == clock)["available"]


async def test_a_moved_playo_booking_keeps_its_price_and_stays_in_sync(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The reschedule workaround, end to end.

    Moved in GameXO: Playo sees the old slot free and the new one taken, the
    customer is not suddenly charged our rate card, and Playo's later cancel still
    finds the booking by the id it was given.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)
    reference, booking_id = await _playo_booking(
        client, ctx, partner, tenant_a, 9, "P-MOVE", price="999"
    )

    moved = await client.patch(
        f"/api/v1/bookings/{booking_id}",
        json={"starts_at": counter_slot(11)},
        headers=ctx["headers"],
    )
    assert moved.status_code == 200, moved.text
    assert Decimal(moved.json()["total"]) == 999
    assert Decimal(moved.json()["balance_due"]) == 0

    availability = (
        await client.get(
            "/api/v1/gateway/playo/availability",
            params={"date": DAY},
            headers=partner["headers"],
        )
    ).json()
    assert _slot_state(availability, ctx["court_1"], "09:00:00") is True
    assert _slot_state(availability, ctx["court_1"], "11:00:00") is False

    timeline = await client.get(
        f"/api/v1/bookings/{booking_id}/timeline", headers=ctx["headers"]
    )
    assert any(e["label"] == "Moved by venue" for e in timeline.json())

    cancelled = await post(
        client, partner, "/booking/cancel",
        {"bookingIds": [{"externalBookingId": reference, "playoOrderId": "P-MOVE",
                         "price": "999", "refundAtPlayo": "999"}]},
    )
    assert cancelled.json()["requestStatus"] == "1"
    free = await book(client, ctx, court=ctx["court_1"], starts_at=counter_slot(11))
    assert free.status_code == 201


async def test_staff_cannot_silently_cancel_a_playo_booking(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Cancelling here would put the court back on sale while the customer still
    holds a paid Playo ticket — and Playo would still pay the venue for it."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)
    _, booking_id = await _playo_booking(client, ctx, partner, tenant_a, 9, "P-GUARD")

    response = await client.post(
        f"/api/v1/bookings/{booking_id}/cancel", json={"reason": "Rain"},
        headers=ctx["headers"],
    )

    assert response.status_code == 409
    assert "Playo" in response.json()["error"]["message"]
    blocked = await book(client, ctx, court=ctx["court_1"], starts_at=counter_slot(9))
    assert blocked.status_code == 409


async def test_a_cancel_request_holds_the_court_until_playo_cancels(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The cancellation workaround: ask, keep the court blocked, and let Playo's own
    cancel call close the loop."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)
    reference, booking_id = await _playo_booking(client, ctx, partner, tenant_a, 9, "P-ASK")

    asked = await client.post(
        f"/api/v1/bookings/{booking_id}/request-partner-cancel",
        json={"reason": "Court flooded"},
        headers=ctx["headers"],
    )
    assert asked.status_code == 200, asked.text
    assert asked.json()["status"] == "upcoming"
    requested_at = asked.json()["partner_cancel_requested_at"]
    assert requested_at

    again = await client.post(
        f"/api/v1/bookings/{booking_id}/request-partner-cancel", json={},
        headers=ctx["headers"],
    )
    assert again.json()["partner_cancel_requested_at"] == requested_at

    still_blocked = await book(client, ctx, court=ctx["court_1"], starts_at=counter_slot(9))
    assert still_blocked.status_code == 409

    waiting = await client.get(
        "/api/v1/bookings", params={"awaiting_partner_cancel": True}, headers=ctx["headers"]
    )
    assert [b["id"] for b in waiting.json()["items"]] == [booking_id]

    cancelled = await post(
        client, partner, "/booking/cancel",
        {"bookingIds": [{"externalBookingId": reference, "playoOrderId": "P-ASK",
                         "price": "1200", "refundAtPlayo": "1200"}]},
    )
    assert cancelled.json()["requestStatus"] == "1"

    waiting = await client.get(
        "/api/v1/bookings", params={"awaiting_partner_cancel": True}, headers=ctx["headers"]
    )
    assert waiting.json()["items"] == []
    free = await book(client, ctx, court=ctx["court_1"], starts_at=counter_slot(9))
    assert free.status_code == 201


async def test_only_a_manager_can_force_cancel_and_it_is_logged(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)
    _, booking_id = await _playo_booking(client, ctx, partner, tenant_a, 9, "P-FORCE")

    await make_user(tenant_a, email="desk@alpha.example.com", role=Role.RECEPTION)
    desk = auth_headers(
        await login(client, tenant_a, "desk@alpha.example.com", PASSWORD), tenant_a
    )
    refused = await client.post(
        f"/api/v1/bookings/{booking_id}/cancel", json={"force": True}, headers=desk
    )
    assert refused.status_code == 403

    forced = await client.post(
        f"/api/v1/bookings/{booking_id}/cancel",
        json={"force": True, "reason": "Playo confirmed by phone"},
        headers=ctx["headers"],
    )
    assert forced.status_code == 200, forced.text
    assert forced.json()["status"] == "cancelled"

    timeline = await client.get(
        f"/api/v1/bookings/{booking_id}/timeline", headers=ctx["headers"]
    )
    assert any("NOT notified" in (e["detail"] or "") for e in timeline.json())


async def test_the_venues_own_website_is_not_a_platform(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A `native` partner — the venue's own site — sets `source_platform` too, but
    the venue owns those customers and cancels their bookings like any other."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)
    website = await make_partner(client, ctx, tenant_a, "Our Website", "website")
    _, playo_id = await _playo_booking(client, ctx, partner, tenant_a, 9, "P-LIST")
    own = await partner_book(client, website, court=ctx["court_1"], starts_at=counter_slot(10))
    assert own.status_code == 201, own.text
    own_id = one(own)["id"]

    listed = await client.get("/api/v1/bookings", headers=ctx["headers"])
    flags = {b["id"]: b["sold_on_platform"] for b in listed.json()["items"]}
    assert flags == {playo_id: True, own_id: False}

    cancelled = await client.post(
        f"/api/v1/bookings/{own_id}/cancel", json={"reason": "Customer called"},
        headers=ctx["headers"],
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["sold_on_platform"] is False


async def test_a_walk_in_cannot_be_sent_to_a_platform(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    walkin = (await book(client, ctx, court=ctx["court_1"], starts_at=counter_slot(9))).json()

    response = await client.post(
        f"/api/v1/bookings/{walkin['id']}/request-partner-cancel", json={},
        headers=ctx["headers"],
    )
    assert response.status_code == 409


async def test_onboarding_sheet_lists_the_ids_playo_needs(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """`scripts/playo_onboarding.py` — the only place our court and sport UUIDs are
    shown to a person, so it had better show the right ones."""
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parent.parent / "scripts" / "playo_onboarding.py"
    spec = importlib.util.spec_from_file_location("playo_onboarding", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    text = await module.sheet(tenant_a.slug, "https://api.example.com/")

    assert "https://api.example.com/api/v1/gateway" in text
    assert ctx["court_1"] in text and ctx["court_2"] in text
    assert ctx["sport_id"] in text
    assert partner["api_key"] not in text


@pytest.mark.parametrize(
    "path,body",
    [
        ("/order/create", {"orders": []}),
        ("/booking/create", {"bookings": []}),
        ("/order/confirm", {"orderIds": []}),
        ("/order/cancel", {"orderIds": []}),
        ("/booking/cancel", {"bookingIds": []}),
        ("/booking/map", {"bookingIds": []}),
    ],
)
async def test_an_empty_request_is_refused_politely(
    client: AsyncClient, tenant_a: TenantFixture, path: str, body: dict
) -> None:
    """Still a 200 — consistency matters more than pedantry here, and their client
    only ever reads `requestStatus`."""
    ctx = await setup_academy(client, tenant_a)
    partner = await playo(client, ctx, tenant_a)

    response = await post(client, partner, path, {"userName": "X", **body})
    assert response.status_code == 200
    assert response.json()["requestStatus"] == "0"
