"""Booking references — the code a customer types at the kiosk to check in.

The property under test throughout is that a reference resolves to *exactly one*
booking, or to nothing. Check-in is the flow where the cost of "close enough" is
handing someone a court that belongs to another customer, so the tests that matter
most here are the ones asserting a lookup does **not** match.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.db.session import tenant_session
from app.modules.booking.service import normalise_reference
from tests.conftest import TenantFixture
from tests.test_booking import at, book, setup_academy


# ── The normaliser, on its own ──────────────────────────────────────────────


@pytest.mark.parametrize(
    "typed",
    ["XC-B-0042", "xc-b-0042", "xc b 0042", "XCB0042", "B-42", "b42", "0042", "42", " 42 "],
)
def test_every_way_someone_might_type_it(typed: str) -> None:
    """One booking, nine spellings.

    This is a touchscreen at a counter, read off a phone held in the other hand.
    Rejecting `42` because the prefix is missing would be refusing an input whose
    meaning is unambiguous — the academy is already fixed by the hostname.
    """
    assert normalise_reference(typed, prefix="XC") == "XC-B-0042"


@pytest.mark.parametrize(
    "typed",
    [
        "9876543210",  # phone number, typed out of habit — the case that matters
        "12345678901",  # too long to be a counter value
        "Priya",  # a name
        "XC-B-",  # prefix with no number
        "",
        "----",
    ],
)
def test_what_is_not_a_reference(typed: str) -> None:
    """None rather than a guess.

    A phone number is the realistic input here, because it is what this field used
    to take. Coercing it into `XC-B-9876543210` would turn a clear "no booking
    found" into a confusing lookup failure further down.
    """
    assert normalise_reference(typed, prefix="XC") is None


def test_the_prefix_follows_the_academy() -> None:
    """White-label: a tenant's own initials lead its references, as with invoices."""
    assert normalise_reference("42", prefix="ACE") == "ACE-B-0042"


def test_numbers_beyond_the_padding_still_work() -> None:
    """Padding is a minimum width, not a ceiling — booking 10,000 is not special."""
    assert normalise_reference("12345", prefix="XC") == "XC-B-12345"


# ── Allocation ──────────────────────────────────────────────────────────────


async def test_bookings_are_numbered_in_sequence(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)

    first = await book(client, ctx, court=ctx["court_1"], starts_at=at(4, 9))
    second = await book(client, ctx, court=ctx["court_1"], starts_at=at(4, 11))

    assert first.json()["reference"] == "XC-B-0001"
    assert second.json()["reference"] == "XC-B-0002"


async def test_two_academies_number_independently(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """Each academy starts at 0001.

    The same reason invoices are per-tenant: a shared sequence would tell the second
    academy to sign up exactly how much business the first has done. It also means
    `XC-B-0001` existing in two academies is expected, which is why the unique index
    is on `(tenant_id, reference)` and never on `reference` alone.
    """
    ctx_a = await setup_academy(client, tenant_a)
    ctx_b = await setup_academy(client, tenant_b)

    a = await book(client, ctx_a, court=ctx_a["court_1"], starts_at=at(4, 9))
    b = await book(client, ctx_b, court=ctx_b["court_1"], starts_at=at(4, 9))

    assert a.json()["reference"] == "XC-B-0001"
    assert b.json()["reference"] == "XC-B-0001"


async def test_a_rejected_booking_does_not_burn_a_number(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The series stays gapless when a slot conflict rolls the booking back.

    The number is allocated before the exclusion constraint is checked, inside the
    same transaction — so a 409 takes the allocation with it. A Postgres sequence
    could not do this: `nextval` is deliberately non-transactional.
    """
    ctx = await setup_academy(client, tenant_a)

    first = await book(client, ctx, court=ctx["court_1"], starts_at=at(4, 9))
    assert first.json()["reference"] == "XC-B-0001"

    clash = await book(client, ctx, court=ctx["court_1"], starts_at=at(4, 9))
    assert clash.status_code == 409

    after = await book(client, ctx, court=ctx["court_1"], starts_at=at(4, 11))
    assert after.json()["reference"] == "XC-B-0002"


IST = ZoneInfo("Asia/Kolkata")


def soon() -> str:
    """A slot starting inside the kiosk's ±30 minute check-in window."""
    return (datetime.now(IST) + timedelta(minutes=10)).isoformat()


# ── Lookup ──────────────────────────────────────────────────────────────────


async def test_the_kiosk_finds_a_booking_however_it_is_typed(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    created = (await book(client, ctx, court=ctx["court_1"], starts_at=soon())).json()

    # "B-1"/"1" are not accepted here: the kiosk matcher compares the whole
    # compacted reference, and a bare counter value would collide across bookings.
    for typed in ["XC-B-0001", "xc-b-0001", "xcb0001"]:
        response = await client.get(
            "/api/v1/bookings/checkin-lookup", params={"code": typed}, headers=ctx["headers"]
        )
        assert response.status_code == 200, f"{typed}: {response.text}"
        assert response.json()["id"] == created["id"]


async def test_lookup_returns_the_names_the_result_card_shows(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """BookingDetail, not BookingOut — the kiosk shows the sport and court by name."""
    ctx = await setup_academy(client, tenant_a)
    await book(client, ctx, court=ctx["court_1"], starts_at=soon())

    body = (
        await client.get(
            "/api/v1/bookings/checkin-lookup", params={"code": "XC-B-0001"}, headers=ctx["headers"]
        )
    ).json()

    assert body["sport_name"] == "Tennis"
    assert body["court_name"]


@pytest.mark.parametrize(
    "typed", ["XC-B-9999", "9876543210", "Arjun Mehta"], ids=["unissued", "phone", "name"]
)
async def test_a_miss_is_404(client: AsyncClient, tenant_a: TenantFixture, typed: str) -> None:
    """Including inputs that are not references at all.

    From the screen's point of view "you mistyped it" and "that is not a booking ID"
    are the same event, and both want the same message. A 422 would surface Pydantic
    internals to someone standing at a kiosk.
    """
    ctx = await setup_academy(client, tenant_a)
    await book(client, ctx, court=ctx["court_1"], starts_at=soon())

    response = await client.get(
        "/api/v1/bookings/checkin-lookup", params={"code": typed}, headers=ctx["headers"]
    )
    assert response.status_code == 404


async def test_a_reference_cannot_reach_another_academys_booking(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """`XC-B-0001` exists in both academies. Each may only see its own.

    This is the failure the per-tenant counter makes possible and RLS prevents: two
    real bookings share a reference by design, so the lookup being tenant-scoped is
    what stops a code from one venue checking someone in at another.
    """
    ctx_a = await setup_academy(client, tenant_a)
    ctx_b = await setup_academy(client, tenant_b)

    a_booking = (await book(client, ctx_a, court=ctx_a["court_1"], starts_at=soon())).json()
    b_booking = (await book(client, ctx_b, court=ctx_b["court_1"], starts_at=soon())).json()
    assert a_booking["reference"] == b_booking["reference"] == "XC-B-0001"

    found = await client.get(
        "/api/v1/bookings/checkin-lookup", params={"code": "XC-B-0001"}, headers=ctx_b["headers"]
    )
    assert found.json()["id"] == b_booking["id"]
    assert found.json()["id"] != a_booking["id"]


async def test_the_desk_can_search_by_reference(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """One search box, three ways a booking gets asked about."""
    ctx = await setup_academy(client, tenant_a)
    created = (await book(client, ctx, court=ctx["court_1"], starts_at=at(4, 9))).json()

    for term in [created["reference"], "Arjun", "9876543210"]:
        page = (
            await client.get("/api/v1/bookings", params={"search": term}, headers=ctx["headers"])
        ).json()
        assert [b["id"] for b in page["items"]] == [created["id"]], term


# ── Uniqueness ──────────────────────────────────────────────────────────────


async def test_the_database_refuses_a_duplicate_reference(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The guarantee is the unique index, not the counter.

    Written past the router deliberately. If the allocator is ever changed and stops
    being transactional, this is what turns "two customers hold XC-B-0001" into a
    loud failure instead of a check-in that hands over the wrong court.
    """
    ctx = await setup_academy(client, tenant_a)
    await book(client, ctx, court=ctx["court_1"], starts_at=at(4, 9))
    second = (await book(client, ctx, court=ctx["court_1"], starts_at=at(4, 11))).json()

    with pytest.raises(Exception) as excinfo:
        async with tenant_session(tenant_a.id) as session:
            await session.execute(
                text("update booking set reference = 'XC-B-0001' where id = :id"),
                {"id": second["id"]},
            )
            await session.flush()
    assert "uq_booking_tenant_reference" in str(excinfo.value)


# ── The customer's copy ─────────────────────────────────────────────────────


async def test_the_confirmation_email_carries_the_reference(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """And not the UUID it used to print.

    The email is where most customers get the code they will be asked for, so a
    36-character UUID here made the kiosk flow impossible before it started.
    """
    from sqlalchemy import select

    from app.core.mail_templates import booking_confirmation
    from app.models.tenant import TenantSettings
    from app.modules.booking.models import Booking

    ctx = await setup_academy(client, tenant_a)
    created = (await book(client, ctx, court=ctx["court_1"], starts_at=at(4, 9))).json()

    async with tenant_session(tenant_a.id) as session:
        booking = await session.get(Booking, created["id"])
        settings = (await session.execute(select(TenantSettings))).scalar_one()
        _, body, html = booking_confirmation(
            booking, settings, court_name="Court 1", sport_name="Tennis"
        )

    assert f"Booking ID: {created['reference']}" in body
    assert created["reference"] in html
    assert created["id"] not in body
    assert created["id"] not in html
