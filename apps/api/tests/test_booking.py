"""Booking domain: double-booking prevention, availability, pricing, inventory."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient

from app.modules.booking import service
from app.modules.booking.models import BookingType
from tests.conftest import PASSWORD, TenantFixture, auth_headers, login

IST = ZoneInfo("Asia/Kolkata")


def at(day: int, hour: int, minute: int = 0) -> str:
    """A timezone-aware instant in the academy's own timezone."""
    return datetime(2026, 9, day, hour, minute, tzinfo=IST).isoformat()


async def setup_academy(client: AsyncClient, tenant: TenantFixture) -> dict:
    """A sport, two courts and a piece of equipment. Returns their ids plus a token."""
    token = await login(client, tenant, tenant.admin_email, PASSWORD)
    h = auth_headers(token, tenant)

    sport = await client.post(
        "/api/v1/sports",
        json={
            "name": "Tennis",
            "icon": "🎾",
            "price_base": "800",
            "price_peak": "1200",
            "price_weekend": "1000",
        },
        headers=h,
    )
    assert sport.status_code == 201, sport.text
    sport_id = sport.json()["id"]

    courts = []
    for code, name in (("C1", "Court 1"), ("C2", "Court 2")):
        response = await client.post(
            "/api/v1/courts",
            json={
                "name": name,
                "code": code,
                "sport_id": sport_id,
                "hourly_rate": "800",
                "peak_rate": "1200",
                "operating_hours": {"open": "06:00", "close": "22:00"},
            },
            headers=h,
        )
        assert response.status_code == 201, response.text
        courts.append(response.json()["id"])

    equipment = await client.post(
        "/api/v1/equipment",
        json={
            "name": "Tennis Racket",
            "category": "Tennis",
            "barcode": "TEN-RAC-001",
            "rental_price": "100",
            "deposit": "500",
            "qty_stock": 10,
        },
        headers=h,
    )
    assert equipment.status_code == 201, equipment.text

    return {
        "headers": h,
        "sport_id": sport_id,
        "court_1": courts[0],
        "court_2": courts[1],
        "equipment_id": equipment.json()["id"],
    }


async def book(client: AsyncClient, ctx: dict, *, court: str, starts_at: str, minutes: int = 60, **extra):
    return await client.post(
        "/api/v1/bookings",
        json={
            "court_id": court,
            "starts_at": starts_at,
            "duration_min": minutes,
            "customer_name": "Arjun Mehta",
            "customer_phone": "9876543210",
            **extra,
        },
        headers=ctx["headers"],
    )


# ── Double booking ──────────────────────────────────────────────────────────


async def test_overlapping_booking_on_the_same_court_is_rejected(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)

    first = await book(client, ctx, court=ctx["court_1"], starts_at=at(1, 10), minutes=60)
    assert first.status_code == 201, first.text

    # Starts inside the first booking.
    clash = await book(client, ctx, court=ctx["court_1"], starts_at=at(1, 10, 30), minutes=60)
    assert clash.status_code == 409
    assert clash.json()["error"]["code"] == "conflict"
    assert "conflicting_booking_id" in clash.json()["error"]["details"]


async def test_a_booking_that_straddles_an_existing_one_is_rejected(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The containing case, which a naive "is the start time free?" check misses."""
    ctx = await setup_academy(client, tenant_a)
    await book(client, ctx, court=ctx["court_1"], starts_at=at(2, 11), minutes=60)

    straddle = await book(client, ctx, court=ctx["court_1"], starts_at=at(2, 10), minutes=180)
    assert straddle.status_code == 409


async def test_back_to_back_bookings_are_allowed(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """10:00–11:00 and 11:00–12:00 do not overlap.

    This is the '[)' half-open range paying off. With inclusive bounds both
    bookings would share the instant 11:00 and the second would be rejected,
    making consecutive slots impossible — and the walk-in flow issues exactly these.

    Two *different* customers on purpose. The same customer back-to-back is merged
    into one session (see below), which would make this pass for the wrong reason.
    """
    ctx = await setup_academy(client, tenant_a)

    first = await book(client, ctx, court=ctx["court_1"], starts_at=at(3, 10), minutes=60)
    second = await book(
        client,
        ctx,
        court=ctx["court_1"],
        starts_at=at(3, 11),
        minutes=60,
        customer_name="Priya Nair",
        customer_phone="9812345678",
    )

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["id"] != second.json()["id"]


async def test_back_to_back_for_the_same_customer_is_merged(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """One continuous stretch of play is one booking, not two.

    Two rows read as two bills: the counter settles one and misses the other, and
    kit issued in the first hour is priced against that hour alone.
    """
    ctx = await setup_academy(client, tenant_a)

    first = await book(client, ctx, court=ctx["court_1"], starts_at=at(7, 10), minutes=60)
    assert first.status_code == 201, first.text
    booking_id = first.json()["id"]
    assert first.json()["duration_min"] == 60

    second = await book(client, ctx, court=ctx["court_1"], starts_at=at(7, 11), minutes=60)
    assert second.status_code == 201, second.text
    body = second.json()

    # The same row came back, now twice as long.
    assert body["id"] == booking_id
    assert body["duration_min"] == 120
    # Priced as one two-hour session, not as two independent quotes.
    assert Decimal(body["court_charge"]) == Decimal("1600.00")

    listed = await client.get("/api/v1/bookings", headers=ctx["headers"])
    assert listed.json()["total"] == 1


async def test_merging_carries_the_kit_across_and_sums_duplicates(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Add-ons from both halves land on the one bill, and the same item stacks."""
    ctx = await setup_academy(client, tenant_a)
    kit = [{"equipment_id": ctx["equipment_id"], "qty": 1}]

    first = await book(
        client, ctx, court=ctx["court_1"], starts_at=at(8, 10), minutes=60, equipment=kit
    )
    assert first.status_code == 201, first.text
    charge_before = Decimal(first.json()["equipment_charge"])
    assert charge_before > 0

    second = await book(
        client, ctx, court=ctx["court_1"], starts_at=at(8, 11), minutes=60, equipment=kit
    )
    assert second.status_code == 201, second.text
    body = second.json()

    # One line, quantity two — not the same racket listed twice.
    assert len(body["equipment"]) == 1
    assert body["equipment"][0]["qty"] == 2
    # Two rackets across a two-hour session: rate × qty × hours = 100 × 2 × 2.
    # Four times the one-hour, one-racket charge, not twice — rentals bill per hour.
    assert Decimal(body["equipment_charge"]) == charge_before * 4


async def _sellable(client: AsyncClient, ctx: dict, **overrides) -> str:
    """A shuttlecock sold loose or by the tube, and rentable too."""
    body = {
        "name": "Shuttlecock",
        "category": "Badminton",
        "barcode": "BAD-SHU-001",
        "rental_price": "30",
        "sale_price": "40",
        "for_rent": True,
        "for_sale": True,
        "pack_size": 3,
        "pack_price": "100",
        "qty_stock": 30,
        **overrides,
    }
    response = await client.post("/api/v1/equipment", json=body, headers=ctx["headers"])
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def test_buying_a_pack_charges_the_pack_price_and_draws_base_units(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Two tubes of three cost 2 × pack price and take six shuttles off the shelf."""
    ctx = await setup_academy(client, tenant_a)
    shuttle = await _sellable(client, ctx)

    response = await book(
        client,
        ctx,
        court=ctx["court_1"],
        starts_at=at(9, 10),
        equipment=[{"equipment_id": shuttle, "qty": 2, "mode": "buy", "unit": "pack"}],
    )
    assert response.status_code == 201, response.text
    assert Decimal(response.json()["equipment_charge"]) == Decimal("200.00")

    item = await client.get(f"/api/v1/equipment?size=50", headers=ctx["headers"])
    row = next(i for i in item.json()["items"] if i["id"] == shuttle)
    assert row["qty_available"] == 24  # 30 - (2 packs × 3)
    assert row["qty_issued"] == 6


async def test_renting_and_buying_the_same_item_are_separate_lines(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Same shuttlecock, two intentions, two prices — they must not collapse."""
    ctx = await setup_academy(client, tenant_a)
    shuttle = await _sellable(client, ctx)

    response = await book(
        client,
        ctx,
        court=ctx["court_1"],
        starts_at=at(10, 10),
        equipment=[
            {"equipment_id": shuttle, "qty": 1, "mode": "rent"},
            {"equipment_id": shuttle, "qty": 1, "mode": "buy"},
        ],
    )
    assert response.status_code == 201, response.text
    lines = response.json()["equipment"]
    assert len(lines) == 2
    assert Decimal(response.json()["equipment_charge"]) == Decimal("70.00")  # 30 rent + 40 buy


async def test_a_mode_the_catalogue_does_not_offer_is_refused(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Rent-only kit cannot be bought by asking nicely."""
    ctx = await setup_academy(client, tenant_a)

    response = await book(
        client,
        ctx,
        court=ctx["court_1"],
        starts_at=at(11, 10),
        equipment=[{"equipment_id": ctx["equipment_id"], "qty": 1, "mode": "buy"}],
    )
    assert response.status_code == 409, response.text
    assert "not for sale" in response.json()["error"]["message"]


async def test_a_quote_echoes_what_was_actually_chosen(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The summary beside the price has to agree with the price.

    The quote used to rebuild its lines from name/qty/rate alone, so Pydantic
    defaulted the rest and every purchase came back labelled as a rental.
    """
    ctx = await setup_academy(client, tenant_a)
    shuttle = await _sellable(client, ctx)

    response = await client.post(
        "/api/v1/bookings/quote",
        json={
            "court_id": ctx["court_1"],
            "starts_at": at(19, 10),
            "duration_min": 60,
            "equipment": [{"equipment_id": shuttle, "qty": 1, "mode": "buy", "unit": "pack"}],
        },
        headers=ctx["headers"],
    )
    assert response.status_code == 200, response.text
    line = response.json()["equipment"][0]
    assert line["mode"] == "buy"
    assert line["unit"] == "pack"
    assert line["equipment_id"] == shuttle


async def test_a_pack_cannot_be_rented(client: AsyncClient, tenant_a: TenantFixture) -> None:
    """Packs have one price and rentals are per unit — the combination is meaningless."""
    ctx = await setup_academy(client, tenant_a)
    shuttle = await _sellable(client, ctx)

    response = await book(
        client,
        ctx,
        court=ctx["court_1"],
        starts_at=at(14, 10),
        equipment=[{"equipment_id": shuttle, "qty": 1, "mode": "rent", "unit": "pack"}],
    )
    assert response.status_code == 422, response.text


async def test_renting_bills_per_hour_of_play(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A racket out for two hours costs twice a racket out for one."""
    ctx = await setup_academy(client, tenant_a)
    kit = [{"equipment_id": ctx["equipment_id"], "qty": 1}]

    one_hour = await book(
        client, ctx, court=ctx["court_1"], starts_at=at(15, 10), minutes=60, equipment=kit
    )
    two_hours = await book(
        client, ctx, court=ctx["court_2"], starts_at=at(15, 10), minutes=120, equipment=kit
    )

    assert Decimal(one_hour.json()["equipment_charge"]) == Decimal("100.00")
    assert Decimal(two_hours.json()["equipment_charge"]) == Decimal("200.00")


async def test_rentals_are_pro_rated_by_the_minute(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """90 minutes bills an hour and a half of kit, matching how the court is charged."""
    ctx = await setup_academy(client, tenant_a)

    response = await book(
        client,
        ctx,
        court=ctx["court_1"],
        starts_at=at(16, 10),
        minutes=90,
        equipment=[{"equipment_id": ctx["equipment_id"], "qty": 1}],
    )
    assert Decimal(response.json()["equipment_charge"]) == Decimal("150.00")


async def test_buying_does_not_scale_with_duration(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A tube of shuttlecocks does not cost more because the game ran long."""
    ctx = await setup_academy(client, tenant_a)
    shuttle = await _sellable(client, ctx)
    bought = [{"equipment_id": shuttle, "qty": 1, "mode": "buy", "unit": "pack"}]

    short = await book(
        client, ctx, court=ctx["court_1"], starts_at=at(17, 10), minutes=60, equipment=bought
    )
    long = await book(
        client, ctx, court=ctx["court_2"], starts_at=at(17, 10), minutes=180, equipment=bought
    )

    assert Decimal(short.json()["equipment_charge"]) == Decimal("100.00")
    assert Decimal(long.json()["equipment_charge"]) == Decimal("100.00")


async def test_extending_re_prices_the_kit_too(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The complaint that started this: kit issued in hour one, billed for one hour.

    Extending used to re-price the court and carry the add-on charge across frozen.
    """
    ctx = await setup_academy(client, tenant_a)

    created = await book(
        client,
        ctx,
        court=ctx["court_1"],
        starts_at=at(18, 10),
        minutes=60,
        equipment=[{"equipment_id": ctx["equipment_id"], "qty": 1}],
    )
    assert created.status_code == 201, created.text
    booking_id = created.json()["id"]
    assert Decimal(created.json()["equipment_charge"]) == Decimal("100.00")

    extended = await client.post(
        f"/api/v1/bookings/{booking_id}/extend",
        json={"additional_minutes": 60},
        headers=ctx["headers"],
    )
    assert extended.status_code == 200, extended.text
    body = extended.json()
    assert body["duration_min"] == 120
    assert Decimal(body["equipment_charge"]) == Decimal("200.00")
    # The kit itself is unchanged — one racket, still one racket.
    assert body["equipment"][0]["qty"] == 1


async def test_a_gap_between_sessions_is_not_merged(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """10:00–11:00 then 12:00–13:00 is two visits, however the same the customer is."""
    ctx = await setup_academy(client, tenant_a)

    first = await book(client, ctx, court=ctx["court_1"], starts_at=at(7, 10), minutes=60)
    second = await book(client, ctx, court=ctx["court_1"], starts_at=at(7, 12), minutes=60)

    assert first.json()["id"] != second.json()["id"]
    assert (await client.get("/api/v1/bookings", headers=ctx["headers"])).json()["total"] == 2


async def test_the_same_slot_on_a_different_court_is_allowed(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    first = await book(client, ctx, court=ctx["court_1"], starts_at=at(4, 10))
    second = await book(client, ctx, court=ctx["court_2"], starts_at=at(4, 10))
    assert first.status_code == 201
    assert second.status_code == 201


async def test_cancelling_frees_the_slot_immediately(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The constraint's `WHERE status <> 'cancelled'` clause.

    Without it a cancelled booking would keep blocking the time it released, and
    the court could never be resold.
    """
    ctx = await setup_academy(client, tenant_a)

    first = await book(client, ctx, court=ctx["court_1"], starts_at=at(5, 10))
    booking_id = first.json()["id"]

    blocked = await book(client, ctx, court=ctx["court_1"], starts_at=at(5, 10))
    assert blocked.status_code == 409

    cancelled = await client.post(
        f"/api/v1/bookings/{booking_id}/cancel",
        json={"reason": "Customer called off"},
        headers=ctx["headers"],
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"

    rebooked = await book(client, ctx, court=ctx["court_1"], starts_at=at(5, 10))
    assert rebooked.status_code == 201, rebooked.text


async def test_two_academies_can_book_the_same_wall_clock_time(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """`tenant_id WITH =` leads the exclusion constraint.

    Two academies booking their own courts at 10:00 on the same day must not
    interfere — and the constraint must never disclose the other's booking.
    """
    ctx_a = await setup_academy(client, tenant_a)
    ctx_b = await setup_academy(client, tenant_b)

    first = await book(client, ctx_a, court=ctx_a["court_1"], starts_at=at(6, 10))
    second = await book(client, ctx_b, court=ctx_b["court_1"], starts_at=at(6, 10))

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]


async def test_bookings_are_not_visible_across_academies(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    ctx_a = await setup_academy(client, tenant_a)
    ctx_b = await setup_academy(client, tenant_b)

    created = await book(client, ctx_a, court=ctx_a["court_1"], starts_at=at(7, 9))
    booking_id = created.json()["id"]

    # Tenant B cannot fetch it even with the exact id.
    fetched = await client.get(f"/api/v1/bookings/{booking_id}", headers=ctx_b["headers"])
    assert fetched.status_code == 404

    listed = await client.get("/api/v1/bookings", headers=ctx_b["headers"])
    assert listed.json()["total"] == 0


# ── Pricing ─────────────────────────────────────────────────────────────────


async def test_off_peak_pricing_with_gst(client: AsyncClient, tenant_a: TenantFixture) -> None:
    """A 1-hour weekday morning slot at ₹800 + 18% GST."""
    ctx = await setup_academy(client, tenant_a)
    # 2026-09-01 is a Tuesday; 10:00 is outside the 17:00–22:00 peak window.
    response = await client.post(
        "/api/v1/bookings/quote",
        json={"court_id": ctx["court_1"], "starts_at": at(1, 10), "duration_min": 60},
        headers=ctx["headers"],
    )
    body = response.json()
    assert Decimal(body["court_charge"]) == Decimal("800.00")
    assert Decimal(body["taxes"]) == Decimal("144.00")
    assert Decimal(body["total"]) == Decimal("944.00")
    assert body["is_peak"] is False


async def test_peak_pricing_applies_in_the_tenants_timezone(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """18:00 IST is peak.

    The same instant is 12:30 UTC, comfortably off-peak if the comparison were done
    in UTC — which is exactly the bug this asserts against.
    """
    ctx = await setup_academy(client, tenant_a)
    response = await client.post(
        "/api/v1/bookings/quote",
        json={"court_id": ctx["court_1"], "starts_at": at(1, 18), "duration_min": 60},
        headers=ctx["headers"],
    )
    body = response.json()
    assert body["is_peak"] is True
    assert Decimal(body["court_charge"]) == Decimal("1200.00")


async def test_weekend_uses_the_peak_rate(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await setup_academy(client, tenant_a)
    # 2026-09-05 is a Saturday.
    response = await client.post(
        "/api/v1/bookings/quote",
        json={"court_id": ctx["court_1"], "starts_at": at(5, 10), "duration_min": 60},
        headers=ctx["headers"],
    )
    assert response.json()["is_weekend"] is True
    assert Decimal(response.json()["court_charge"]) == Decimal("1200.00")


async def test_gst_is_charged_on_the_discounted_subtotal(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Tax follows the discount, not the gross.

    Taxing the pre-discount amount charges GST on money the customer never paid —
    the more expensive direction to be wrong in during an audit.
    """
    ctx = await setup_academy(client, tenant_a)
    response = await client.post(
        "/api/v1/bookings/quote",
        json={
            "court_id": ctx["court_1"],
            "starts_at": at(1, 10),
            "duration_min": 60,
            "discount": "100",
        },
        headers=ctx["headers"],
    )
    body = response.json()
    assert Decimal(body["taxes"]) == Decimal("126.00")  # 18% of (800 - 100)
    assert Decimal(body["total"]) == Decimal("826.00")


async def test_a_discount_cannot_exceed_the_bill(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    response = await client.post(
        "/api/v1/bookings/quote",
        json={
            "court_id": ctx["court_1"],
            "starts_at": at(1, 10),
            "duration_min": 60,
            "discount": "99999",
        },
        headers=ctx["headers"],
    )
    assert Decimal(response.json()["total"]) >= Decimal("0")
    assert Decimal(response.json()["discount"]) == Decimal("800.00")


async def test_duration_is_prorated_by_the_minute(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    response = await client.post(
        "/api/v1/bookings/quote",
        json={"court_id": ctx["court_1"], "starts_at": at(1, 10), "duration_min": 90},
        headers=ctx["headers"],
    )
    assert Decimal(response.json()["court_charge"]) == Decimal("1200.00")


async def test_a_naive_datetime_is_refused(client: AsyncClient, tenant_a: TenantFixture) -> None:
    """No timezone offset means the instant is ambiguous by 5h30m."""
    ctx = await setup_academy(client, tenant_a)
    response = await client.post(
        "/api/v1/bookings",
        json={
            "court_id": ctx["court_1"],
            "starts_at": "2026-09-01T10:00:00",
            "duration_min": 60,
            "customer_name": "Naive",
        },
        headers=ctx["headers"],
    )
    assert response.status_code == 422


# ── Availability ────────────────────────────────────────────────────────────


async def test_availability_marks_the_booked_slot_taken(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    await book(client, ctx, court=ctx["court_1"], starts_at=at(8, 10), minutes=60)

    response = await client.get(
        "/api/v1/courts/availability",
        params={"date": at(8, 12), "duration_min": 60},
        headers=ctx["headers"],
    )
    assert response.status_code == 200, response.text

    court_1 = next(c for c in response.json() if c["court_id"] == ctx["court_1"])
    slots = {s["starts_at"]: s for s in court_1["slots"]}

    taken = slots[at(8, 10)]
    assert taken["available"] is False
    assert taken["blocked_by_booking_id"] is not None

    # The slot starting exactly when the booking ends is free — half-open again.
    assert slots[at(8, 11)]["available"] is True
    assert slots[at(8, 9)]["available"] is True


async def test_availability_reflects_peak_rates(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    response = await client.get(
        "/api/v1/courts/availability",
        params={"date": at(1, 12), "duration_min": 60},
        headers=ctx["headers"],
    )
    slots = {s["starts_at"]: s for s in response.json()[0]["slots"]}
    assert Decimal(slots[at(1, 10)]["rate"]) == Decimal("800.00")
    assert Decimal(slots[at(1, 18)]["rate"]) == Decimal("1200.00")


async def test_a_court_under_maintenance_is_not_bookable(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """`maintenance` is stored; `available`/`occupied` are derived."""
    ctx = await setup_academy(client, tenant_a)

    await client.patch(
        f"/api/v1/courts/{ctx['court_1']}",
        json={"is_bookable": False, "maintenance_note": "Resurfacing"},
        headers=ctx["headers"],
    )

    courts = await client.get("/api/v1/courts", headers=ctx["headers"])
    court_1 = next(c for c in courts.json() if c["id"] == ctx["court_1"])
    assert court_1["status"] == "maintenance"

    attempt = await book(client, ctx, court=ctx["court_1"], starts_at=at(9, 10))
    assert attempt.status_code == 409
    assert "maintenance" in attempt.json()["error"]["message"].lower()


async def test_court_status_is_occupied_during_a_live_booking(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    await book(client, ctx, court=ctx["court_1"], starts_at=at(10, 10), minutes=60)

    response = await client.get(
        "/api/v1/courts", params={"at": at(10, 10, 30)}, headers=ctx["headers"]
    )
    court_1 = next(c for c in response.json() if c["id"] == ctx["court_1"])
    assert court_1["status"] == "occupied"
    assert court_1["current_booking_id"] is not None

    later = await client.get(
        "/api/v1/courts", params={"at": at(10, 15)}, headers=ctx["headers"]
    )
    assert next(c for c in later.json() if c["id"] == ctx["court_1"])["status"] == "available"


# ── Extension ───────────────────────────────────────────────────────────────


async def test_extending_a_booking_reprices_and_moves_the_end(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    created = await book(client, ctx, court=ctx["court_1"], starts_at=at(11, 10), minutes=60)
    booking_id = created.json()["id"]

    extended = await client.post(
        f"/api/v1/bookings/{booking_id}/extend",
        json={"additional_minutes": 30},
        headers=ctx["headers"],
    )
    assert extended.status_code == 200, extended.text
    body = extended.json()
    assert body["duration_min"] == 90
    assert Decimal(body["court_charge"]) == Decimal("1200.00")


async def test_extension_is_blocked_by_the_next_booking_and_suggests_the_maximum(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The frontend asks for the maximum available extension, so the API returns it."""
    ctx = await setup_academy(client, tenant_a)
    first = await book(client, ctx, court=ctx["court_1"], starts_at=at(12, 10), minutes=60)
    await book(client, ctx, court=ctx["court_1"], starts_at=at(12, 12), minutes=60)

    blocked = await client.post(
        f"/api/v1/bookings/{first.json()['id']}/extend",
        json={"additional_minutes": 120},
        headers=ctx["headers"],
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["details"]["max_additional_minutes"] == 60

    fits = await client.post(
        f"/api/v1/bookings/{first.json()['id']}/extend",
        json={"additional_minutes": 60},
        headers=ctx["headers"],
    )
    assert fits.status_code == 200


# ── Equipment ───────────────────────────────────────────────────────────────


async def test_booking_with_equipment_issues_stock_and_prices_it(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    created = await book(
        client,
        ctx,
        court=ctx["court_1"],
        starts_at=at(13, 10),
        equipment=[{"equipment_id": ctx["equipment_id"], "qty": 2}],
    )
    assert created.status_code == 201, created.text
    assert Decimal(created.json()["equipment_charge"]) == Decimal("200.00")

    stock = await client.get("/api/v1/equipment", headers=ctx["headers"])
    item = stock.json()["items"][0]
    assert item["qty_issued"] == 2
    assert item["qty_available"] == 8
    assert item["qty_stock"] == 10


async def test_cancelling_returns_issued_equipment(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    created = await book(
        client,
        ctx,
        court=ctx["court_1"],
        starts_at=at(14, 10),
        equipment=[{"equipment_id": ctx["equipment_id"], "qty": 3}],
    )
    await client.post(
        f"/api/v1/bookings/{created.json()['id']}/cancel", json={}, headers=ctx["headers"]
    )

    stock = await client.get("/api/v1/equipment", headers=ctx["headers"])
    item = stock.json()["items"][0]
    assert item["qty_issued"] == 0
    assert item["qty_available"] == 10


async def test_cannot_issue_more_equipment_than_is_available(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    response = await client.post(
        f"/api/v1/equipment/{ctx['equipment_id']}/movements",
        json={"kind": "issue", "qty": 99},
        headers=ctx["headers"],
    )
    assert response.status_code == 409


async def test_equipment_movements_keep_the_counters_balanced(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A CHECK constraint requires available + issued + maintenance + lost = stock."""
    ctx = await setup_academy(client, tenant_a)
    h = ctx["headers"]
    eq = ctx["equipment_id"]

    for payload in (
        {"kind": "issue", "qty": 4},
        {"kind": "return", "qty": 1},
        {"kind": "to_maintenance", "qty": 2},
        {"kind": "lost", "qty": 1},
        {"kind": "restock", "qty": 5},
    ):
        response = await client.post(f"/api/v1/equipment/{eq}/movements", json=payload, headers=h)
        assert response.status_code == 201, response.text

    item = (await client.get("/api/v1/equipment", headers=h)).json()["items"][0]
    assert (
        item["qty_available"] + item["qty_issued"] + item["qty_maintenance"] + item["qty_lost"]
        == item["qty_stock"]
    )
    assert item["qty_issued"] == 2  # 4 issued, 1 returned, 1 written off
    assert item["qty_lost"] == 1
    assert item["qty_maintenance"] == 2
    assert item["qty_stock"] == 15


async def test_equipment_ledger_is_append_only(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Inventory corrections are new ADJUST rows, never edits to history."""
    from sqlalchemy import text
    from sqlalchemy.exc import ProgrammingError

    from app.db.session import tenant_session

    ctx = await setup_academy(client, tenant_a)
    await client.post(
        f"/api/v1/equipment/{ctx['equipment_id']}/movements",
        json={"kind": "issue", "qty": 1},
        headers=ctx["headers"],
    )

    with pytest.raises(ProgrammingError, match="permission denied"):
        async with tenant_session(tenant_a.id) as session:
            await session.execute(text("DELETE FROM equipment_movement"))


# ── Uniqueness is per tenant ────────────────────────────────────────────────


async def test_two_academies_can_reuse_court_codes_and_barcodes(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """UNIQUE (tenant_id, code), never a bare unique.

    Every academy calls its first court "C1". A global unique would mean the second
    customer to sign up cannot name their courts the way they already do.
    """
    ctx_a = await setup_academy(client, tenant_a)
    ctx_b = await setup_academy(client, tenant_b)
    assert ctx_a["court_1"] != ctx_b["court_1"]

    # And within one academy it is still unique.
    duplicate = await client.post(
        "/api/v1/courts",
        json={
            "name": "Court 1 again",
            "code": "C1",
            "sport_id": ctx_a["sport_id"],
            "hourly_rate": "800",
            "peak_rate": "1200",
        },
        headers=ctx_a["headers"],
    )
    assert duplicate.status_code == 409


async def test_customer_rollups_are_computed(client: AsyncClient, tenant_a: TenantFixture) -> None:
    """total_bookings / total_spent / outstanding_dues are aggregates, not columns."""
    ctx = await setup_academy(client, tenant_a)
    customer = await client.post(
        "/api/v1/customers",
        json={"name": "Kiran Patel", "phone": "9765432109", "member_type": "member"},
        headers=ctx["headers"],
    )
    customer_id = customer.json()["id"]
    assert customer.json()["avatar_initials"] == "KP"

    for day in (15, 16):
        response = await book(
            client, ctx, court=ctx["court_1"], starts_at=at(day, 10), customer_id=customer_id
        )
        assert response.status_code == 201, response.text

    detail = await client.get(f"/api/v1/customers/{customer_id}", headers=ctx["headers"])
    body = detail.json()
    assert body["total_bookings"] == 2
    assert Decimal(body["total_spent"]) == Decimal("0.00")  # nothing paid yet
    assert Decimal(body["outstanding_dues"]) == Decimal("1888.00")  # 2 × 944


async def test_booking_timeline_records_what_happened(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    created = await book(
        client,
        ctx,
        court=ctx["court_1"],
        starts_at=at(17, 10),
        equipment=[{"equipment_id": ctx["equipment_id"], "qty": 1}],
    )
    booking_id = created.json()["id"]
    await client.post(
        f"/api/v1/bookings/{booking_id}/extend",
        json={"additional_minutes": 30},
        headers=ctx["headers"],
    )

    timeline = await client.get(
        f"/api/v1/bookings/{booking_id}/timeline", headers=ctx["headers"]
    )
    kinds = [event["kind"] for event in timeline.json()]
    assert kinds == ["created", "equipment", "extended"]


async def test_reception_can_book_but_not_create_courts(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """RBAC: taking bookings is reception's job; changing the facility is not."""
    from app.core.security import Role
    from tests.conftest import make_user

    ctx = await setup_academy(client, tenant_a)
    await make_user(tenant_a, email="desk@alpha.example.com", role=Role.RECEPTION)
    desk_token = await login(client, tenant_a, "desk@alpha.example.com", PASSWORD)
    desk = auth_headers(desk_token, tenant_a)

    booked = await client.post(
        "/api/v1/bookings",
        json={
            "court_id": ctx["court_1"],
            "starts_at": at(18, 10),
            "duration_min": 60,
            "customer_name": "Walk In",
        },
        headers=desk,
    )
    assert booked.status_code == 201

    refused = await client.post(
        "/api/v1/courts",
        json={
            "name": "Court 3",
            "code": "C3",
            "sport_id": ctx["sport_id"],
            "hourly_rate": "800",
            "peak_rate": "1200",
        },
        headers=desk,
    )
    assert refused.status_code == 403


# ── Editing a booking ───────────────────────────────────────────────────────


async def test_moving_a_booking_keeps_its_equipment(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Rescheduling must not silently strip the kit the customer already has.

    The regression this pins: the handler treated an ABSENT `equipment` field as an
    empty selection, so a PATCH that only moved the start time re-priced the booking
    with no add-ons — deleting the rental from the bill and reducing the total. The
    customer kept the racket; the academy stopped charging for it.
    """
    ctx = await setup_academy(client, tenant_a)
    kit = [{"equipment_id": ctx["equipment_id"], "qty": 1}]

    created = await book(
        client, ctx, court=ctx["court_1"], starts_at=at(2, 10), minutes=60, equipment=kit
    )
    assert created.status_code == 201, created.text
    before = created.json()
    assert Decimal(before["equipment_charge"]) > 0

    moved = await client.patch(
        f"/api/v1/bookings/{before['id']}",
        json={"starts_at": at(2, 14)},  # time only — equipment deliberately absent
        headers=ctx["headers"],
    )
    assert moved.status_code == 200, moved.text
    after = moved.json()

    assert len(after["equipment"]) == 1
    assert after["equipment"][0]["qty"] == 1
    # Same duration, so the kit costs exactly what it did before the move.
    assert Decimal(after["equipment_charge"]) == Decimal(before["equipment_charge"])


async def test_clearing_equipment_is_distinct_from_omitting_it(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """`equipment: []` means "remove the kit"; omitting it means "leave it alone"."""
    ctx = await setup_academy(client, tenant_a)
    kit = [{"equipment_id": ctx["equipment_id"], "qty": 1}]

    created = await book(
        client, ctx, court=ctx["court_1"], starts_at=at(3, 10), minutes=60, equipment=kit
    )
    assert created.status_code == 201, created.text

    cleared = await client.patch(
        f"/api/v1/bookings/{created.json()['id']}",
        json={"equipment": []},
        headers=ctx["headers"],
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["equipment"] == []
    assert Decimal(cleared.json()["equipment_charge"]) == 0


async def test_editing_a_players_details_updates_the_booking_and_the_customer(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    created = await book(client, ctx, court=ctx["court_1"], starts_at=at(4, 10), minutes=60)
    assert created.status_code == 201, created.text
    booking = created.json()

    edited = await client.patch(
        f"/api/v1/bookings/{booking['id']}",
        json={"customer_name": "Arjun Mehtaa", "customer_phone": "9876500000"},
        headers=ctx["headers"],
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["customer_name"] == "Arjun Mehtaa"
    assert edited.json()["customer_phone"] == "9876500000"

    # The correction follows the person to their next visit, not just this booking.
    if booking.get("customer_id"):
        customer = await client.get(
            f"/api/v1/customers/{booking['customer_id']}", headers=ctx["headers"]
        )
        assert customer.status_code == 200, customer.text
        assert customer.json()["name"] == "Arjun Mehtaa"


async def test_a_blank_player_name_is_refused(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Whitespace would clear the name off every receipt this booking prints."""
    ctx = await setup_academy(client, tenant_a)
    created = await book(client, ctx, court=ctx["court_1"], starts_at=at(5, 10), minutes=60)
    assert created.status_code == 201, created.text

    blanked = await client.patch(
        f"/api/v1/bookings/{created.json()['id']}",
        json={"customer_name": "   "},
        headers=ctx["headers"],
    )
    assert blanked.status_code == 422


async def test_cancelling_through_the_edit_endpoint_is_refused(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Cancelling has to release the slot and settle the refund; PATCH does neither."""
    ctx = await setup_academy(client, tenant_a)
    created = await book(client, ctx, court=ctx["court_1"], starts_at=at(6, 10), minutes=60)
    assert created.status_code == 201, created.text

    refused = await client.patch(
        f"/api/v1/bookings/{created.json()['id']}",
        json={"status": "cancelled"},
        headers=ctx["headers"],
    )
    assert refused.status_code == 409
    assert "cancel" in refused.json()["error"]["message"].lower()


async def test_moving_a_booking_onto_an_occupied_slot_is_refused(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    first = await book(client, ctx, court=ctx["court_1"], starts_at=at(7, 10), minutes=60)
    second = await book(client, ctx, court=ctx["court_1"], starts_at=at(7, 12), minutes=60)
    assert first.status_code == 201 and second.status_code == 201

    clash = await client.patch(
        f"/api/v1/bookings/{second.json()['id']}",
        json={"starts_at": at(7, 10, 30)},
        headers=ctx["headers"],
    )
    assert clash.status_code == 409


# ── Auto check-in ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("booking_type", "starts_offset_min", "duration_min", "expected"),
    [
        # The player is at the counter: the session is running, or about to be.
        (BookingType.WALKIN, 0, 60, True),
        (BookingType.WALKIN, -20, 60, True),
        (BookingType.WALKIN, 10, 60, True),
        # Past the lead window this is a reservation, not an arrival. Marking it
        # checked in would light the court up on the board for hours.
        (BookingType.WALKIN, 16, 60, False),
        (BookingType.WALKIN, 360, 60, False),
        # Entered after the fact — a record of a session that already finished.
        (BookingType.WALKIN, -120, 60, False),
        # Booked from elsewhere. Turning up is a separate event the desk confirms.
        (BookingType.ONLINE, 0, 60, False),
    ],
)
def test_auto_check_in_rule(
    booking_type: BookingType, starts_offset_min: int, duration_min: int, expected: bool
) -> None:
    """`now` is an argument precisely so these cases are expressible at all."""
    now = datetime(2026, 9, 1, 18, 0, tzinfo=UTC)
    starts_at = now + timedelta(minutes=starts_offset_min)
    assert (
        service.should_auto_check_in(
            booking_type=booking_type,
            starts_at=starts_at,
            ends_at=starts_at + timedelta(minutes=duration_min),
            now=now,
        )
        is expected
    )


async def test_a_walk_in_starting_now_is_checked_in_on_creation(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The counter takes the booking and the player is on court — one action, not two."""
    ctx = await setup_academy(client, tenant_a)
    starts = datetime.now(UTC).replace(microsecond=0).isoformat()

    created = await book(client, ctx, court=ctx["court_1"], starts_at=starts, minutes=60)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["status"] == "active"
    assert body["booking_type"] == "walkin"

    # Its own timeline entry: "who checked this in, and when" must be answerable.
    timeline = await client.get(f"/api/v1/bookings/{body['id']}/timeline", headers=ctx["headers"])
    assert timeline.status_code == 200, timeline.text
    kinds = [event["kind"] for event in timeline.json()]
    assert "checked_in" in kinds


async def test_a_walk_in_booked_for_later_stays_upcoming(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Taken at the counter at noon for an evening slot — nobody has arrived yet."""
    ctx = await setup_academy(client, tenant_a)
    starts = (datetime.now(UTC) + timedelta(hours=6)).replace(microsecond=0).isoformat()

    created = await book(client, ctx, court=ctx["court_1"], starts_at=starts, minutes=60)
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "upcoming"

    timeline = await client.get(
        f"/api/v1/bookings/{created.json()['id']}/timeline", headers=ctx["headers"]
    )
    assert "checked_in" not in [event["kind"] for event in timeline.json()]


async def test_an_online_booking_is_never_auto_checked_in(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    starts = datetime.now(UTC).replace(microsecond=0).isoformat()

    created = await book(
        client, ctx, court=ctx["court_1"], starts_at=starts, minutes=60, booking_type="online"
    )
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "upcoming"


# ── Check-in by booking id ───────────────────────────────────────────────────


@pytest.mark.parametrize(
    "booking_id, external_ref, code, expected",
    [
        ("a1b2c3d4-e5f6-7890-abcd-ef1234567890", None, "567890", True),
        ("a1b2c3d4-e5f6-7890-abcd-ef1234567890", None, "5-67 890", True),
        ("a1b2c3d4-e5f6-7890-abcd-ef1234567890", None, "aBcDeF", True),
        ("a1b2c3d4-e5f6-7890-abcd-ef1234567890", None, "999999", False),
        ("a1b2c3d4-e5f6-7890-abcd-ef1234567890", None, "890", False),  # under the 4-char floor
        ("a1b2c3d4-e5f6-7890-abcd-ef1234567890", "PLYO-998877", "PLYO-998877", True),
        ("a1b2c3d4-e5f6-7890-abcd-ef1234567890", "PLYO-998877", "plyo-998877", True),
        # No hyphen key on the kiosk keyboard — a customer can only ever type this.
        ("a1b2c3d4-e5f6-7890-abcd-ef1234567890", "PLYO-998877", "PLYO998877", True),
        ("a1b2c3d4-e5f6-7890-abcd-ef1234567890", "PLYO-998877", "998877", False),
    ],
)
def test_matches_booking_code(booking_id, external_ref, code, expected) -> None:
    import uuid as uuid_mod

    assert service.matches_booking_code(uuid_mod.UUID(booking_id), external_ref, code) is expected


async def test_checkin_lookup_finds_a_booking_by_a_shortened_id_within_the_window(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    starts = (datetime.now(UTC) + timedelta(minutes=10)).replace(microsecond=0).isoformat()
    created = await book(client, ctx, court=ctx["court_1"], starts_at=starts, minutes=60)
    assert created.status_code == 201, created.text
    booking_id = created.json()["id"]
    code = booking_id.split("-")[-1][-6:].upper()

    found = await client.get(
        "/api/v1/bookings/checkin-lookup", params={"code": code}, headers=ctx["headers"]
    )
    assert found.status_code == 200, found.text
    assert found.json()["id"] == booking_id


async def test_checkin_lookup_404s_outside_the_thirty_minute_window(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Right id, wrong time — the customer walked in far too early or far too late."""
    ctx = await setup_academy(client, tenant_a)
    starts = (datetime.now(UTC) + timedelta(minutes=45)).replace(microsecond=0).isoformat()
    created = await book(client, ctx, court=ctx["court_1"], starts_at=starts, minutes=60)
    assert created.status_code == 201, created.text
    code = created.json()["id"].split("-")[-1][-6:].upper()

    missed = await client.get(
        "/api/v1/bookings/checkin-lookup", params={"code": code}, headers=ctx["headers"]
    )
    assert missed.status_code == 404, missed.text


async def test_checkin_lookup_404s_for_a_cancelled_booking(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    starts = (datetime.now(UTC) + timedelta(minutes=5)).replace(microsecond=0).isoformat()
    created = await book(client, ctx, court=ctx["court_1"], starts_at=starts, minutes=60)
    assert created.status_code == 201, created.text
    booking_id = created.json()["id"]
    code = booking_id.split("-")[-1][-6:].upper()

    cancelled = await client.post(
        f"/api/v1/bookings/{booking_id}/cancel", json={}, headers=ctx["headers"]
    )
    assert cancelled.status_code == 200, cancelled.text

    missed = await client.get(
        "/api/v1/bookings/checkin-lookup", params={"code": code}, headers=ctx["headers"]
    )
    assert missed.status_code == 404, missed.text


async def test_checkout_lookup_finds_a_session_well_outside_the_checkin_window(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A session running long is exactly what check-in's 30-minute window would
    reject, and exactly what checkout has to still find to settle the bill."""
    ctx = await setup_academy(client, tenant_a)
    starts = (datetime.now(UTC) - timedelta(hours=2)).replace(microsecond=0).isoformat()
    created = await book(client, ctx, court=ctx["court_1"], starts_at=starts, minutes=60)
    assert created.status_code == 201, created.text
    booking_id = created.json()["id"]
    code = booking_id.split("-")[-1][-6:].upper()

    missed_checkin = await client.get(
        "/api/v1/bookings/checkin-lookup", params={"code": code}, headers=ctx["headers"]
    )
    assert missed_checkin.status_code == 404, missed_checkin.text

    found = await client.get(
        "/api/v1/bookings/checkout-lookup", params={"code": code}, headers=ctx["headers"]
    )
    assert found.status_code == 200, found.text
    assert found.json()["id"] == booking_id


async def test_checkout_lookup_404s_beyond_the_lookback_window(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    starts = (datetime.now(UTC) - timedelta(hours=13)).replace(microsecond=0).isoformat()
    created = await book(client, ctx, court=ctx["court_1"], starts_at=starts, minutes=60)
    assert created.status_code == 201, created.text
    code = created.json()["id"].split("-")[-1][-6:].upper()

    missed = await client.get(
        "/api/v1/bookings/checkout-lookup", params={"code": code}, headers=ctx["headers"]
    )
    assert missed.status_code == 404, missed.text


async def test_checkout_lookup_404s_for_a_booking_that_has_not_started_yet(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    starts = (datetime.now(UTC) + timedelta(minutes=10)).replace(microsecond=0).isoformat()
    created = await book(client, ctx, court=ctx["court_1"], starts_at=starts, minutes=60)
    assert created.status_code == 201, created.text
    code = created.json()["id"].split("-")[-1][-6:].upper()

    missed = await client.get(
        "/api/v1/bookings/checkout-lookup", params={"code": code}, headers=ctx["headers"]
    )
    assert missed.status_code == 404, missed.text



async def test_a_sport_carries_its_own_photo_description_and_gallery(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A sport the venue invented has no CDN photo, so the picture and the facility
    description live on the sport itself and survive a round trip."""
    token = await login(client, tenant_a, tenant_a.admin_email, PASSWORD)
    h = auth_headers(token, tenant_a)

    created = await client.post(
        "/api/v1/sports",
        json={
            "name": "Squash",
            "price_base": "0",
            "price_peak": "0",
            "price_weekend": "0",
            "image_url": "https://cdn.example/squash.jpg",
        },
        headers=h,
    )
    assert created.status_code == 201, created.text
    sport = created.json()
    assert sport["image_url"] == "https://cdn.example/squash.jpg"
    assert sport["images"] == []
    assert sport["description"] is None

    patched = await client.patch(
        f"/api/v1/sports/{sport['id']}",
        json={
            "description": "Two glass-backed courts, air conditioned.",
            "images": ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
        },
        headers=h,
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["description"] == "Two glass-backed courts, air conditioned."
    assert len(patched.json()["images"]) == 2

    too_many = await client.patch(
        f"/api/v1/sports/{sport['id']}",
        json={"images": [f"https://cdn.example/{i}.jpg" for i in range(9)]},
        headers=h,
    )
    assert too_many.status_code == 422
