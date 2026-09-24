"""Finance: per-tenant numbering, invoicing, payment application, memberships."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from decimal import Decimal

from httpx import AsyncClient

from tests.conftest import PASSWORD, TenantFixture, auth_headers, login
from tests.test_booking import IST, at, book, setup_academy


def future_slot(*, days: int = 3, hour: int = 10) -> str:
    """A slot that is still ahead of us, whenever this suite happens to run.

    `at()` pins its dates to September 2026 because the booking suite asserts on
    specific weekdays and peak-hour windows. That is fine there, and wrong here:
    an invoice takes its due date from the booking, so a fixed date turns every
    unpaid invoice OVERDUE the moment the wall clock passes it — which is exactly
    how the partial-payment test below started failing on 4 September 2026, having
    asserted PENDING since the day it was written.
    """
    when = datetime.now(IST).replace(hour=hour, minute=0, second=0, microsecond=0)
    return (when + timedelta(days=days)).isoformat()


async def make_customer(client: AsyncClient, ctx: dict, name="Arjun Mehta", phone="9876543210"):
    response = await client.post(
        "/api/v1/customers", json={"name": name, "phone": phone}, headers=ctx["headers"]
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def make_plan(client: AsyncClient, ctx: dict, name="Tennis Elite"):
    response = await client.post(
        "/api/v1/membership-plans",
        json={
            "name": name,
            "category": "Tennis",
            "price_1m": "3500",
            "price_3m": "9500",
            "price_6m": "17000",
            "price_12m": "30000",
            "joining_fee": "1000",
            "benefits": ["Unlimited Court Hours", "Priority Booking"],
        },
        headers=ctx["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


# ── Per-tenant invoice numbering ────────────────────────────────────────────


async def test_invoice_numbers_start_at_one_for_every_academy(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """The requirement: numbering must not leak volume across tenants.

    A global sequence would mean the second academy to sign up sees its very first
    invoice numbered XC-2024-0873 and learns exactly how much business the first one
    is doing. Both academies must independently start at 0001.
    """
    ctx_a = await setup_academy(client, tenant_a)
    ctx_b = await setup_academy(client, tenant_b)
    year = date.today().year

    for _ in range(3):
        response = await client.post(
            "/api/v1/invoices",
            json={
                "customer_name": "Alpha Customer",
                "items": [{"description": "Court", "qty": 1, "rate": "800", "amount": "800"}],
            },
            headers=ctx_a["headers"],
        )
        assert response.status_code == 201, response.text

    first_for_b = await client.post(
        "/api/v1/invoices",
        json={
            "customer_name": "Beta Customer",
            "items": [{"description": "Court", "qty": 1, "rate": "500", "amount": "500"}],
        },
        headers=ctx_b["headers"],
    )

    assert first_for_b.json()["invoice_no"] == f"XC-{year}-0001"

    numbers = [
        row["invoice_no"]
        for row in (await client.get("/api/v1/invoices", headers=ctx_a["headers"])).json()["items"]
    ]
    assert sorted(numbers) == [f"XC-{year}-000{n}" for n in (1, 2, 3)]


async def test_concurrent_invoices_never_share_a_number(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The row lock under concurrency.

    Ten invoices raised at once must produce ten distinct numbers. Without
    `SELECT ... FOR UPDATE` on the counter row, several transactions read the same
    `last_value` and issue duplicates — which the unique index then rejects, turning
    a silent corruption into a visible failure either way.
    """
    ctx = await setup_academy(client, tenant_a)

    async def raise_invoice(n: int):
        return await client.post(
            "/api/v1/invoices",
            json={
                "customer_name": f"Customer {n}",
                "items": [{"description": "Court", "qty": 1, "rate": "100", "amount": "100"}],
            },
            headers=ctx["headers"],
        )

    responses = await asyncio.gather(*(raise_invoice(n) for n in range(10)))
    assert all(r.status_code == 201 for r in responses), [r.text for r in responses if r.status_code != 201]

    numbers = [r.json()["invoice_no"] for r in responses]
    assert len(set(numbers)) == 10, f"duplicate invoice numbers issued: {numbers}"


async def test_numbering_is_gapless(client: AsyncClient, tenant_a: TenantFixture) -> None:
    """No holes in the series — a statutory requirement for GST invoices.

    This is why the counter is a locked row rather than a Postgres sequence:
    `nextval` does not roll back, so a failed transaction would burn its number.
    """
    ctx = await setup_academy(client, tenant_a)
    year = date.today().year

    for _ in range(5):
        await client.post(
            "/api/v1/invoices",
            json={
                "customer_name": "Serial",
                "items": [{"description": "X", "qty": 1, "rate": "10", "amount": "10"}],
            },
            headers=ctx["headers"],
        )

    # A rejected request must not consume a number.
    rejected = await client.post(
        "/api/v1/invoices", json={"customer_name": "", "items": []}, headers=ctx["headers"]
    )
    assert rejected.status_code == 422

    following = await client.post(
        "/api/v1/invoices",
        json={
            "customer_name": "After failure",
            "items": [{"description": "X", "qty": 1, "rate": "10", "amount": "10"}],
        },
        headers=ctx["headers"],
    )
    assert following.json()["invoice_no"] == f"XC-{year}-0006"


async def test_member_numbers_use_their_own_series(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Four independent series per academy: invoice, member, coach, student."""
    ctx = await setup_academy(client, tenant_a)
    plan_id = await make_plan(client, ctx)
    year = date.today().year

    # An invoice first, so the two series are demonstrably independent.
    await client.post(
        "/api/v1/invoices",
        json={
            "customer_name": "Someone",
            "items": [{"description": "X", "qty": 1, "rate": "10", "amount": "10"}],
        },
        headers=ctx["headers"],
    )

    customer_id = await make_customer(client, ctx)
    response = await client.post(
        "/api/v1/memberships",
        json={"customer_id": customer_id, "plan_id": plan_id, "duration": "12m"},
        headers=ctx["headers"],
    )
    assert response.status_code == 201, response.text
    assert response.json()["subscription"]["member_no"] == "XC-M-0001"
    assert response.json()["invoice"]["invoice_no"] == f"XC-{year}-0002"


async def test_the_number_prefix_is_per_tenant(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """White-label: a customer's invoices carry their own initials, not mine."""
    from sqlalchemy import select

    from app.db.session import tenant_session
    from app.models.tenant import TenantSettings

    ctx = await setup_academy(client, tenant_a)
    async with tenant_session(tenant_a.id) as session:
        settings = (await session.execute(select(TenantSettings))).scalar_one()
        settings.invoice_prefix = "ALPHA"

    response = await client.post(
        "/api/v1/invoices",
        json={
            "customer_name": "Branded",
            "items": [{"description": "X", "qty": 1, "rate": "10", "amount": "10"}],
        },
        headers=ctx["headers"],
    )
    assert response.json()["invoice_no"].startswith("ALPHA-")


# ── Invoicing a booking ─────────────────────────────────────────────────────


async def test_invoicing_a_booking_matches_the_quoted_total(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    created = await book(
        client,
        ctx,
        court=ctx["court_1"],
        starts_at=at(1, 10),
        equipment=[{"equipment_id": ctx["equipment_id"], "qty": 2}],
    )
    booking = created.json()

    invoice = await client.post(
        f"/api/v1/bookings/{booking['id']}/invoice", headers=ctx["headers"]
    )
    assert invoice.status_code == 201, invoice.text
    body = invoice.json()

    assert Decimal(body["total"]) == Decimal(booking["total"])
    assert Decimal(body["gst"]) == Decimal(booking["taxes"])
    assert len(body["items"]) == 2  # court + one equipment line


async def test_invoicing_a_booking_twice_returns_the_same_invoice(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Re-invoicing would issue a second number for the same money."""
    ctx = await setup_academy(client, tenant_a)
    created = await book(client, ctx, court=ctx["court_1"], starts_at=at(2, 10))
    booking_id = created.json()["id"]

    first = await client.post(f"/api/v1/bookings/{booking_id}/invoice", headers=ctx["headers"])
    second = await client.post(f"/api/v1/bookings/{booking_id}/invoice", headers=ctx["headers"])

    assert first.json()["id"] == second.json()["id"]
    assert first.json()["invoice_no"] == second.json()["invoice_no"]

    listed = await client.get("/api/v1/invoices", headers=ctx["headers"])
    assert listed.json()["total"] == 1


# ── Payments ────────────────────────────────────────────────────────────────


async def test_partial_then_full_payment_updates_invoice_and_booking(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    created = await book(client, ctx, court=ctx["court_1"], starts_at=future_slot())
    booking_id = created.json()["id"]
    total = Decimal(created.json()["total"])  # 944.00

    invoice = await client.post(f"/api/v1/bookings/{booking_id}/invoice", headers=ctx["headers"])
    invoice_id = invoice.json()["id"]

    part = await client.post(
        "/api/v1/payments",
        json={"invoice_id": invoice_id, "amount": "400", "method": "cash"},
        headers=ctx["headers"],
    )
    assert part.status_code == 201, part.text

    mid = await client.get(f"/api/v1/invoices/{invoice_id}", headers=ctx["headers"])
    assert mid.json()["status"] == "pending"
    assert Decimal(mid.json()["balance_due"]) == total - Decimal("400")

    booking = await client.get(f"/api/v1/bookings/{booking_id}", headers=ctx["headers"])
    assert booking.json()["payment_status"] == "partial"

    await client.post(
        "/api/v1/payments",
        json={"invoice_id": invoice_id, "amount": str(total - Decimal("400")), "method": "upi"},
        headers=ctx["headers"],
    )

    settled = await client.get(f"/api/v1/invoices/{invoice_id}", headers=ctx["headers"])
    assert settled.json()["status"] == "paid"
    assert Decimal(settled.json()["balance_due"]) == Decimal("0.00")
    # Two methods on one invoice renders as "split", matching the Payments page.
    assert settled.json()["payment_method"] == "split"

    booking = await client.get(f"/api/v1/bookings/{booking_id}", headers=ctx["headers"])
    assert booking.json()["payment_status"] == "paid"


async def test_overpaying_an_invoice_is_refused(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """At a reception desk an over-payment is almost always a typo.

    Absorbing it silently creates a credit nobody tracks and an invoice that
    reconciles to the wrong figure.
    """
    ctx = await setup_academy(client, tenant_a)
    created = await book(client, ctx, court=ctx["court_1"], starts_at=at(4, 10))
    invoice = await client.post(
        f"/api/v1/bookings/{created.json()['id']}/invoice", headers=ctx["headers"]
    )

    response = await client.post(
        "/api/v1/payments",
        json={"invoice_id": invoice.json()["id"], "amount": "99999", "method": "cash"},
        headers=ctx["headers"],
    )
    assert response.status_code == 409
    assert "balance_due" in response.json()["error"]["details"]


async def test_payments_overview_groups_by_method(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    created = await book(client, ctx, court=ctx["court_1"], starts_at=at(5, 10))
    invoice = await client.post(
        f"/api/v1/bookings/{created.json()['id']}/invoice", headers=ctx["headers"]
    )
    invoice_id = invoice.json()["id"]

    for amount, method in (("100", "cash"), ("200", "upi"), ("50", "cash")):
        await client.post(
            "/api/v1/payments",
            json={"invoice_id": invoice_id, "amount": amount, "method": method},
            headers=ctx["headers"],
        )

    overview = await client.get("/api/v1/payments/overview", headers=ctx["headers"])
    body = overview.json()
    assert Decimal(body["total_collected"]) == Decimal("350.00")
    assert body["transaction_count"] == 3

    by_method = {row["method"]: row for row in body["by_method"]}
    assert Decimal(by_method["cash"]["amount"]) == Decimal("150.00")
    assert by_method["cash"]["count"] == 2
    assert Decimal(by_method["upi"]["amount"]) == Decimal("200.00")


async def test_finance_records_do_not_cross_academies(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    ctx_a = await setup_academy(client, tenant_a)
    ctx_b = await setup_academy(client, tenant_b)

    invoice = await client.post(
        "/api/v1/invoices",
        json={
            "customer_name": "Alpha only",
            "items": [{"description": "X", "qty": 1, "rate": "500", "amount": "500"}],
        },
        headers=ctx_a["headers"],
    )
    invoice_id = invoice.json()["id"]

    assert (
        await client.get(f"/api/v1/invoices/{invoice_id}", headers=ctx_b["headers"])
    ).status_code == 404
    assert (await client.get("/api/v1/invoices", headers=ctx_b["headers"])).json()["total"] == 0

    # And B cannot pay A's invoice.
    attempt = await client.post(
        "/api/v1/payments",
        json={"invoice_id": invoice_id, "amount": "100", "method": "cash"},
        headers=ctx_b["headers"],
    )
    assert attempt.status_code == 404


# ── Memberships ─────────────────────────────────────────────────────────────


async def test_membership_creates_a_subscription_and_its_invoice(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    plan_id = await make_plan(client, ctx)
    customer_id = await make_customer(client, ctx)

    response = await client.post(
        "/api/v1/memberships",
        json={
            "customer_id": customer_id,
            "plan_id": plan_id,
            "duration": "12m",
            "start_date": "2026-01-15",
        },
        headers=ctx["headers"],
    )
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["subscription"]["expiry_date"] == "2027-01-15"
    assert body["subscription"]["status"] == "active"
    # 30000 plan + 1000 joining fee, + 18% GST
    assert Decimal(body["invoice"]["subtotal"]) == Decimal("31000.00")
    assert Decimal(body["invoice"]["gst"]) == Decimal("5580.00")
    assert Decimal(body["invoice"]["total"]) == Decimal("36580.00")

    # The customer is now a member.
    customer = await client.get(f"/api/v1/customers/{customer_id}", headers=ctx["headers"])
    assert customer.json()["member_type"] == "member"


async def test_month_arithmetic_clamps_to_short_months(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """31 Jan + 1 month is 28 Feb, not 3 March.

    Adding 30 days instead would drift the renewal date every cycle, and members
    notice when an annual membership expires a few days earlier each year.
    """
    ctx = await setup_academy(client, tenant_a)
    plan_id = await make_plan(client, ctx)
    customer_id = await make_customer(client, ctx)

    response = await client.post(
        "/api/v1/memberships",
        json={
            "customer_id": customer_id,
            "plan_id": plan_id,
            "duration": "1m",
            "start_date": "2027-01-31",
        },
        headers=ctx["headers"],
    )
    assert response.json()["subscription"]["expiry_date"] == "2027-02-28"


async def test_days_left_and_renewal_due_are_computed(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Never stored: mock record mr-4's `daysLeft: 1` is wrong tomorrow."""
    ctx = await setup_academy(client, tenant_a)
    plan_id = await make_plan(client, ctx)
    customer_id = await make_customer(client, ctx)

    start = date.today() - timedelta(days=350)
    response = await client.post(
        "/api/v1/memberships",
        json={
            "customer_id": customer_id,
            "plan_id": plan_id,
            "duration": "12m",
            "start_date": start.isoformat(),
        },
        headers=ctx["headers"],
    )
    subscription = response.json()["subscription"]
    assert 0 < subscription["days_left"] <= 20
    assert subscription["renewal_due"] is True


async def test_early_renewal_extends_from_the_current_expiry(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Renewing early must not forfeit days already paid for."""
    ctx = await setup_academy(client, tenant_a)
    plan_id = await make_plan(client, ctx)
    customer_id = await make_customer(client, ctx)

    start = date.today()
    created = await client.post(
        "/api/v1/memberships",
        json={
            "customer_id": customer_id,
            "plan_id": plan_id,
            "duration": "12m",
            "start_date": start.isoformat(),
        },
        headers=ctx["headers"],
    )
    subscription_id = created.json()["subscription"]["id"]
    original_expiry = date.fromisoformat(created.json()["subscription"]["expiry_date"])

    renewed = await client.post(
        f"/api/v1/memberships/{subscription_id}/renew",
        json={"duration": "12m"},
        headers=ctx["headers"],
    )
    assert renewed.status_code == 200, renewed.text
    new_expiry = date.fromisoformat(renewed.json()["subscription"]["expiry_date"])

    assert new_expiry.year == original_expiry.year + 1
    # A second invoice was raised for the renewal.
    assert renewed.json()["invoice"]["invoice_no"] != created.json()["invoice"]["invoice_no"]


async def test_pause_and_cancel(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await setup_academy(client, tenant_a)
    plan_id = await make_plan(client, ctx)
    customer_id = await make_customer(client, ctx)

    created = await client.post(
        "/api/v1/memberships",
        json={"customer_id": customer_id, "plan_id": plan_id, "duration": "3m"},
        headers=ctx["headers"],
    )
    subscription_id = created.json()["subscription"]["id"]

    paused = await client.post(
        f"/api/v1/memberships/{subscription_id}/pause", headers=ctx["headers"]
    )
    assert paused.json()["status"] == "paused"

    again = await client.post(
        f"/api/v1/memberships/{subscription_id}/pause", headers=ctx["headers"]
    )
    assert again.status_code == 409

    cancelled = await client.post(
        f"/api/v1/memberships/{subscription_id}/cancel", headers=ctx["headers"]
    )
    assert cancelled.json()["status"] == "cancelled"


async def test_plan_active_count_is_derived(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await setup_academy(client, tenant_a)
    plan_id = await make_plan(client, ctx)

    for n in range(3):
        customer_id = await make_customer(client, ctx, name=f"Member {n}", phone=f"90000000{n:02d}")
        await client.post(
            "/api/v1/memberships",
            json={"customer_id": customer_id, "plan_id": plan_id, "duration": "1m"},
            headers=ctx["headers"],
        )

    plans = await client.get("/api/v1/membership-plans", headers=ctx["headers"])
    assert plans.json()[0]["active_count"] == 3

    # Cancelling one drops the count — because it is a query, not a counter.
    memberships = await client.get("/api/v1/memberships", headers=ctx["headers"])
    await client.post(
        f"/api/v1/memberships/{memberships.json()['items'][0]['id']}/cancel",
        headers=ctx["headers"],
    )
    plans = await client.get("/api/v1/membership-plans", headers=ctx["headers"])
    assert plans.json()[0]["active_count"] == 2


async def test_renewal_due_filter(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await setup_academy(client, tenant_a)
    plan_id = await make_plan(client, ctx)

    expiring = await make_customer(client, ctx, name="Expiring Soon", phone="9111111111")
    comfortable = await make_customer(client, ctx, name="Plenty Left", phone="9222222222")

    await client.post(
        "/api/v1/memberships",
        json={
            "customer_id": expiring,
            "plan_id": plan_id,
            "duration": "1m",
            "start_date": (date.today() - timedelta(days=25)).isoformat(),
        },
        headers=ctx["headers"],
    )
    await client.post(
        "/api/v1/memberships",
        json={
            "customer_id": comfortable,
            "plan_id": plan_id,
            "duration": "12m",
            "start_date": date.today().isoformat(),
        },
        headers=ctx["headers"],
    )

    due = await client.get(
        "/api/v1/memberships", params={"renewal_due": True}, headers=ctx["headers"]
    )
    assert due.json()["total"] == 1
    assert due.json()["items"][0]["customer_id"] == expiring


# ── Membership lifecycle ────────────────────────────────────────────────────


async def make_membership(client: AsyncClient, ctx: dict, plan_id: str, duration="12m") -> dict:
    customer_id = await make_customer(client, ctx, name="Priya Nair", phone="9812300099")
    response = await client.post(
        "/api/v1/memberships",
        json={"customer_id": customer_id, "plan_id": plan_id, "duration": duration},
        headers=ctx["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()["subscription"]


async def test_pause_then_resume_gives_the_parked_days_back(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A paid term is a quantity of membership, not a window on the calendar.

    Resuming on the same day banks nothing, which is the honest answer and also the
    only one this test can assert without waiting. The arithmetic itself is covered
    below, where the clock can be moved.
    """
    ctx = await setup_academy(client, tenant_a)
    plan_id = await make_plan(client, ctx)
    membership = await make_membership(client, ctx, plan_id)
    expiry_before = membership["expiry_date"]

    paused = await client.post(
        f"/api/v1/memberships/{membership['id']}/pause", headers=ctx["headers"]
    )
    assert paused.status_code == 200, paused.text
    assert paused.json()["status"] == "paused"

    resumed = await client.post(
        f"/api/v1/memberships/{membership['id']}/resume", headers=ctx["headers"]
    )
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["status"] == "active"
    assert resumed.json()["expiry_date"] == expiry_before
    assert resumed.json()["paused_days_total"] == 0


def test_resume_extends_expiry_by_the_days_parked() -> None:
    """The unit the endpoint delegates to, with the clock under our control.

    Charging a member for six weeks they were told they were not using makes pause
    strictly worse for them than doing nothing — at which point it is a trap, not a
    feature. So the expiry moves out by exactly the days spent parked.
    """
    from datetime import UTC, datetime

    from app.modules.finance.models import MemberSubscription, SubscriptionStatus
    from app.modules.finance.service import resume_subscription

    start = date(2026, 1, 1)
    subscription = MemberSubscription(
        start_date=start,
        joined_on=start,
        expiry_date=date(2026, 12, 31),
        status=SubscriptionStatus.PAUSED,
        paused_at=datetime(2026, 3, 1, tzinfo=UTC),
        paused_days_total=0,
    )

    banked = resume_subscription(
        subscription, today=date(2026, 4, 15), zone=ZoneInfo("Asia/Kolkata")
    )

    assert banked == 45
    assert subscription.expiry_date == date(2027, 2, 14)
    assert subscription.paused_days_total == 45
    assert subscription.status is SubscriptionStatus.ACTIVE
    assert subscription.paused_at is None


def test_pauses_accumulate_across_several_spells() -> None:
    """Two injuries in a year bank both spells, not just the last one."""
    from datetime import UTC, datetime

    from app.modules.finance.models import MemberSubscription, SubscriptionStatus
    from app.modules.finance.service import resume_subscription

    subscription = MemberSubscription(
        start_date=date(2026, 1, 1),
        joined_on=date(2026, 1, 1),
        expiry_date=date(2026, 12, 31),
        status=SubscriptionStatus.PAUSED,
        paused_at=datetime(2026, 3, 1, tzinfo=UTC),
        paused_days_total=10,
    )

    resume_subscription(subscription, today=date(2026, 3, 11), zone=ZoneInfo("Asia/Kolkata"))
    assert subscription.paused_days_total == 20
    assert subscription.expiry_date == date(2027, 1, 10)


async def test_resume_refuses_a_membership_that_is_not_paused(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    plan_id = await make_plan(client, ctx)
    membership = await make_membership(client, ctx, plan_id)

    response = await client.post(
        f"/api/v1/memberships/{membership['id']}/resume", headers=ctx["headers"]
    )
    assert response.status_code == 409, response.text
    assert "not paused" in response.json()["error"]["message"]


async def test_renewal_keeps_the_original_join_date(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Tenure survives a renewal.

    `start_date` is the current term and is meant to move. Before `joined_on`
    existed it was the only date on the row, so a five-year member looked like they
    joined last month the moment they renewed — and every loyalty report read it.
    """
    ctx = await setup_academy(client, tenant_a)
    plan_id = await make_plan(client, ctx)
    membership = await make_membership(client, ctx, plan_id)
    joined = membership["joined_on"]
    assert joined == membership["start_date"]

    renewed = await client.post(
        f"/api/v1/memberships/{membership['id']}/renew",
        json={"duration": "12m"},
        headers=ctx["headers"],
    )
    assert renewed.status_code == 200, renewed.text
    subscription = renewed.json()["subscription"]

    assert subscription["joined_on"] == joined
    assert subscription["start_date"] != joined  # the new term starts at the old expiry


async def test_a_duration_the_plan_does_not_price_cannot_be_sold(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Zero is how a plan says "we don't sell this term length".

    Every price column defaults to 0, so without this rule a plan priced only by
    the year would hand out a free month to anyone who picked the wrong radio
    button — and the invoice would say ₹0 with nothing obviously wrong.
    """
    ctx = await setup_academy(client, tenant_a)
    yearly_only = await client.post(
        "/api/v1/membership-plans",
        json={"name": "Annual Only", "price_12m": "30000"},
        headers=ctx["headers"],
    )
    assert yearly_only.status_code == 201, yearly_only.text
    plan_id = yearly_only.json()["id"]
    customer_id = await make_customer(client, ctx, name="Term Tester", phone="9812300077")

    refused = await client.post(
        "/api/v1/memberships",
        json={"customer_id": customer_id, "plan_id": plan_id, "duration": "1m"},
        headers=ctx["headers"],
    )
    assert refused.status_code == 409, refused.text
    assert "1m" in refused.json()["error"]["message"]

    sold = await client.post(
        "/api/v1/memberships",
        json={"customer_id": customer_id, "plan_id": plan_id, "duration": "12m"},
        headers=ctx["headers"],
    )
    assert sold.status_code == 201, sold.text


async def test_renewing_into_an_unpriced_duration_is_refused_too(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The same rule on the renewal path, which raises its own invoice."""
    ctx = await setup_academy(client, tenant_a)
    plan = await client.post(
        "/api/v1/membership-plans",
        json={"name": "Annual Only", "price_12m": "30000"},
        headers=ctx["headers"],
    )
    membership = await make_membership(client, ctx, plan.json()["id"], duration="12m")

    response = await client.post(
        f"/api/v1/memberships/{membership['id']}/renew",
        json={"duration": "3m"},
        headers=ctx["headers"],
    )
    assert response.status_code == 409, response.text


def test_an_evening_pause_and_resume_banks_nothing() -> None:
    """The timezone trap, pinned.

    `paused_at` is a UTC instant; every date on the row is civil time in the
    venue's zone. At 20:30 UTC it is already tomorrow in Kolkata, so reading the
    UTC date and subtracting it from a local `today` hands the member a free day
    for a pause that lasted minutes. Same calendar day in the venue's own frame
    means nothing banked — that is the whole assertion.
    """
    from datetime import UTC, datetime

    from app.modules.finance.models import MemberSubscription, SubscriptionStatus
    from app.modules.finance.service import resume_subscription

    ist = ZoneInfo("Asia/Kolkata")
    # 2026-03-01 20:30 UTC is 2026-03-02 02:00 in Kolkata.
    paused_at = datetime(2026, 3, 1, 20, 30, tzinfo=UTC)
    assert paused_at.astimezone(ist).date() == date(2026, 3, 2)

    subscription = MemberSubscription(
        start_date=date(2026, 1, 1),
        joined_on=date(2026, 1, 1),
        expiry_date=date(2026, 12, 31),
        status=SubscriptionStatus.PAUSED,
        paused_at=paused_at,
        paused_days_total=0,
    )

    banked = resume_subscription(subscription, today=date(2026, 3, 2), zone=ist)

    assert banked == 0
    assert subscription.expiry_date == date(2026, 12, 31)


# ── What the counter tablet may learn about a membership ────────────────────


async def test_the_tablet_can_check_membership_but_not_read_money(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """"Is this person a member?" is the counter's question, and its whole answer.

    Status and expiry, never what they paid, and never a list. Selling stays with
    a login that names a person — the shared tablet credential is the most
    exposed one in the venue.
    """
    from app.core.security import Role

    from tests.conftest import make_user

    ctx = await setup_academy(client, tenant_a)
    plan_id = await make_plan(client, ctx)
    membership = await make_membership(client, ctx, plan_id)

    kiosk = await make_user(tenant_a, email="counter3@example.com", role=Role.KIOSK)
    tablet = auth_headers(await login(client, tenant_a, kiosk.username, PASSWORD), tenant_a)

    found = await client.get(
        "/api/v1/memberships/check", params={"code": membership["member_no"]}, headers=tablet
    )
    assert found.status_code == 200, found.text
    body = found.json()
    assert body["status"] == "active"
    assert body["member_no"] == membership["member_no"]
    assert "total_paid" not in body

    by_phone = await client.get(
        "/api/v1/memberships/check", params={"code": "9812300099"}, headers=tablet
    )
    assert by_phone.status_code == 200, by_phone.text

    missing = await client.get(
        "/api/v1/memberships/check", params={"code": "XC-M-9999"}, headers=tablet
    )
    assert missing.status_code == 404

    # And the things it must not reach.
    assert (await client.get("/api/v1/memberships", headers=tablet)).status_code == 403
    assert (
        await client.post(
            f"/api/v1/memberships/{membership['id']}/renew",
            json={"duration": "12m"},
            headers=tablet,
        )
    ).status_code == 403
