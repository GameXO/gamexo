"""Coaches: pay models, payroll and payouts, reviews, assigning and removing."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from httpx import AsyncClient

from app.core.security import Role
from app.modules.academy.models import PayModel
from app.modules.academy.payroll import compute_earnings
from tests.conftest import PASSWORD, TenantFixture, auth_headers, login, make_user
from tests.test_academy import build_academy, make_student
from tests.test_academy_insights import enrolled_student

API = "/api/v1/academy"


def terms(model: PayModel, *, salary="0", rate="0", pct="0"):
    return SimpleNamespace(
        id=uuid4(),
        pay_model=model,
        salary=Decimal(salary),
        hourly_rate=Decimal(rate),
        commission_pct=Decimal(pct),
    )


async def patch_coach(client: AsyncClient, ctx: dict, **body) -> dict:
    response = await client.patch(f"{API}/coaches/{ctx['coach_id']}", json=body, headers=ctx["headers"])
    assert response.status_code == 200, response.text
    return response.json()


async def taught(client: AsyncClient, ctx: dict, student_id: str, *, minutes_ago: int, duration: int = 60):
    """A session that started `minutes_ago` minutes ago, register taken — so it is completed."""
    starts = (datetime.now(UTC) - timedelta(minutes=minutes_ago)).replace(microsecond=0)
    created = await client.post(
        f"{API}/sessions",
        json={"batch_id": ctx["batch_id"], "starts_at": starts.isoformat(), "duration_min": duration},
        headers=ctx["headers"],
    )
    assert created.status_code == 201, created.text
    marked = await client.post(
        f"{API}/sessions/{created.json()['id']}/attendance",
        json={"marks": [{"student_id": student_id, "status": "present"}]},
        headers=ctx["headers"],
    )
    assert marked.status_code in (200, 201), marked.text


async def earnings(client: AsyncClient, ctx: dict, month: str | None = None) -> dict:
    response = await client.get(
        f"{API}/coaches/{ctx['coach_id']}/earnings",
        params={"month": month} if month else {},
        headers=ctx["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()


async def this_month(client: AsyncClient, ctx: dict) -> str:
    period = (await client.get(f"{API}/payroll", headers=ctx["headers"])).json()["period"]
    return period[:7]


async def enrol_and_pay(client: AsyncClient, ctx: dict, name: str, amount: str) -> str:
    """Enrol a student and receive `amount` against their fee invoice. Returns the student id."""
    student_id = await make_student(client, ctx, name)
    enrolled = await client.post(
        f"{API}/enrollments",
        json={"student_id": student_id, "batch_id": ctx["batch_id"], "duration": "3m"},
        headers=ctx["headers"],
    )
    assert enrolled.status_code == 201, enrolled.text
    paid = await client.post(
        "/api/v1/payments",
        json={"invoice_id": enrolled.json()["invoice_id"], "amount": amount, "method": "upi"},
        headers=ctx["headers"],
    )
    assert paid.status_code == 201, paid.text
    return student_id


# ── The arithmetic ──────────────────────────────────────────────────────────


def test_fixed_pay_is_the_salary_whatever_was_taught() -> None:
    e = compute_earnings(
        terms(PayModel.FIXED, salary="55000", rate="1500", pct="10"),
        period=date(2026, 9, 1), sessions=3, minutes=180, fees=Decimal("90000"),
    )
    assert e["base_amount"] == Decimal("55000.00")
    assert e["commission_amount"] == 0
    assert e["gross"] == Decimal("55000.00")


def test_hourly_pay_is_rate_times_hours() -> None:
    e = compute_earnings(
        terms(PayModel.HOURLY, salary="55000", rate="1500"),
        period=date(2026, 9, 1), sessions=2, minutes=150, fees=Decimal("0"),
    )
    assert e["hours"] == Decimal("2.50")
    assert e["gross"] == Decimal("3750.00")


def test_commission_is_a_share_of_fees_collected_and_nothing_else() -> None:
    e = compute_earnings(
        terms(PayModel.COMMISSION, salary="55000", pct="12.5"),
        period=date(2026, 9, 1), sessions=9, minutes=540, fees=Decimal("10000"),
    )
    assert e["base_amount"] == 0
    assert e["commission_amount"] == Decimal("1250.00")
    assert e["gross"] == Decimal("1250.00")


def test_hybrid_is_salary_plus_commission() -> None:
    e = compute_earnings(
        terms(PayModel.HYBRID, salary="20000", pct="10"),
        period=date(2026, 9, 1), sessions=0, minutes=0, fees=Decimal("15000"),
    )
    assert e["gross"] == Decimal("21500.00")
    assert [line.label for line in e["lines"]] == ["Fixed salary", "Commission"]


# ── Earnings through the API ────────────────────────────────────────────────


async def test_fixed_coach_is_due_their_salary(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await build_academy(client, tenant_a)
    e = await earnings(client, ctx)
    assert e["pay_model"] == "fixed"
    assert Decimal(e["gross"]) == Decimal("55000")
    assert e["status"] == "due"


async def test_hourly_earnings_count_only_completed_sessions(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")
    await patch_coach(client, ctx, pay_model="hourly")

    await taught(client, ctx, sid, minutes_ago=30, duration=60)
    await taught(client, ctx, sid, minutes_ago=20, duration=90)
    # Scheduled but never run, so no register, so not completed — and not paid for.
    await client.post(
        f"{API}/sessions",
        json={"batch_id": ctx["batch_id"], "starts_at": (datetime.now(UTC) - timedelta(minutes=10)).isoformat()},
        headers=ctx["headers"],
    )

    e = await earnings(client, ctx)
    assert e["sessions"] == 2
    assert Decimal(e["hours"]) == Decimal("2.50")
    assert Decimal(e["gross"]) == Decimal("3750")


async def test_commission_follows_fees_collected_not_fees_invoiced(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    await enrolled_student(client, ctx, "Aryan Mehta")
    await patch_coach(client, ctx, pay_model="commission", commission_pct="10")

    # Invoiced ₹9,500 but nothing received yet.
    assert Decimal((await earnings(client, ctx))["gross"]) == 0

    await enrol_and_pay(client, ctx, "Nisha Kapoor", "5000")
    e = await earnings(client, ctx)
    assert Decimal(e["fees_collected"]) == Decimal("5000")
    assert Decimal(e["commission_amount"]) == Decimal("500")
    assert e["status"] == "due"

    await patch_coach(client, ctx, pay_model="hybrid")
    assert Decimal((await earnings(client, ctx))["gross"]) == Decimal("55500")


# ── Payouts ─────────────────────────────────────────────────────────────────


async def test_a_payout_is_a_snapshot_and_a_month_is_paid_once(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    month = await this_month(client, ctx)

    paid = await client.post(
        f"{API}/coaches/{ctx['coach_id']}/payouts",
        json={"month": month, "method": "upi", "reference": "UTR123"},
        headers=ctx["headers"],
    )
    assert paid.status_code == 201, paid.text
    assert Decimal(paid.json()["total"]) == Decimal("55000")
    assert paid.json()["coach_name"] == "Rahul Sharma"

    # A raise later does not rewrite what was paid.
    await patch_coach(client, ctx, salary="70000")
    e = await earnings(client, ctx)
    assert e["status"] == "paid"
    assert Decimal(e["payout"]["total"]) == Decimal("55000")

    again = await client.post(
        f"{API}/coaches/{ctx['coach_id']}/payouts", json={"month": month}, headers=ctx["headers"]
    )
    assert again.status_code == 409


async def test_a_bonus_or_deduction_needs_a_reason_and_cannot_overdraw(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    month = await this_month(client, ctx)
    url = f"{API}/coaches/{ctx['coach_id']}/payouts"

    assert (await client.post(url, json={"month": month, "adjustment": "2000"}, headers=ctx["headers"])).status_code == 400
    assert (
        await client.post(
            url, json={"month": month, "adjustment": "-60000", "adjustment_note": "advance"}, headers=ctx["headers"]
        )
    ).status_code == 400

    ok = await client.post(
        url, json={"month": month, "adjustment": "-5000", "adjustment_note": "Advance taken"}, headers=ctx["headers"]
    )
    assert ok.status_code == 201, ok.text
    assert Decimal(ok.json()["total"]) == Decimal("50000")
    assert Decimal(ok.json()["adjustment"]) == Decimal("-5000")


async def test_cannot_pay_a_month_that_has_not_started_or_owes_nothing(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    url = f"{API}/coaches/{ctx['coach_id']}/payouts"
    future = (date.today() + timedelta(days=62)).strftime("%Y-%m")
    assert (await client.post(url, json={"month": future}, headers=ctx["headers"])).status_code == 400

    await patch_coach(client, ctx, pay_model="commission", commission_pct="10")
    month = await this_month(client, ctx)
    assert (await client.post(url, json={"month": month}, headers=ctx["headers"])).status_code == 400


async def test_only_an_admin_can_undo_a_payout(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await build_academy(client, tenant_a)
    month = await this_month(client, ctx)
    paid = await client.post(
        f"{API}/coaches/{ctx['coach_id']}/payouts", json={"month": month}, headers=ctx["headers"]
    )
    payout_id = paid.json()["id"]

    manager = await make_user(tenant_a, email="mgr@example.com", role=Role.MANAGER)
    mh = auth_headers(await login(client, tenant_a, manager.username, PASSWORD), tenant_a)
    assert (await client.delete(f"{API}/payouts/{payout_id}", headers=mh)).status_code == 403

    assert (await client.delete(f"{API}/payouts/{payout_id}", headers=ctx["headers"])).status_code == 204
    assert (await earnings(client, ctx, month))["status"] == "due"  # payable again


async def test_payroll_lists_every_coach_with_totals(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await build_academy(client, tenant_a)
    second = await client.post(
        f"{API}/coaches",
        json={"name": "Priya Nair", "pay_model": "fixed", "salary": "30000"},
        headers=ctx["headers"],
    )
    assert second.status_code == 201

    month = await this_month(client, ctx)
    before = (await client.get(f"{API}/payroll", params={"month": month}, headers=ctx["headers"])).json()
    assert {r["name"] for r in before["rows"]} == {"Rahul Sharma", "Priya Nair"}
    assert Decimal(before["total_due"]) == Decimal("85000")
    assert Decimal(before["total_paid"]) == 0

    await client.post(
        f"{API}/coaches/{second.json()['id']}/payouts", json={"month": month}, headers=ctx["headers"]
    )
    after = (await client.get(f"{API}/payroll", params={"month": month}, headers=ctx["headers"])).json()
    assert Decimal(after["total_paid"]) == Decimal("30000")
    assert Decimal(after["total_due"]) == Decimal("55000")
    assert Decimal(after["total_gross"]) == Decimal("85000")


# ── Reviews ─────────────────────────────────────────────────────────────────


async def test_coach_rating_is_the_average_of_their_reviews(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await make_student(client, ctx, "Aryan Mehta")
    url = f"{API}/coaches/{ctx['coach_id']}/reviews"

    five = await client.post(url, json={"rating": 5, "student_id": sid, "comment": "Superb"}, headers=ctx["headers"])
    three = await client.post(url, json={"rating": 3, "reviewer_name": "A parent"}, headers=ctx["headers"])
    assert five.status_code == 201 and three.status_code == 201
    assert five.json()["reviewer_name"] == "Parent of Aryan Mehta"  # defaults from the student

    profile = (await client.get(f"{API}/coaches/{ctx['coach_id']}/profile", headers=ctx["headers"])).json()
    assert Decimal(profile["coach"]["rating"]) == Decimal("4.00")
    assert profile["rating_breakdown"] == [0, 0, 1, 0, 1]
    assert profile["stats"]["review_count"] == 2

    assert (await client.delete(f"{API}/coach-reviews/{three.json()['id']}", headers=ctx["headers"])).status_code == 204
    profile = (await client.get(f"{API}/coaches/{ctx['coach_id']}/profile", headers=ctx["headers"])).json()
    assert Decimal(profile["coach"]["rating"]) == Decimal("5.00")


async def test_reviews_are_validated(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await build_academy(client, tenant_a)
    url = f"{API}/coaches/{ctx['coach_id']}/reviews"
    assert (await client.post(url, json={"rating": 6}, headers=ctx["headers"])).status_code == 422
    assert (await client.post(url, json={"rating": 0}, headers=ctx["headers"])).status_code == 422
    future = (date.today() + timedelta(days=3)).isoformat()
    assert (await client.post(url, json={"rating": 4, "reviewed_on": future}, headers=ctx["headers"])).status_code == 400


# ── The profile ─────────────────────────────────────────────────────────────


async def test_profile_gathers_classes_students_and_outcomes(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")
    await taught(client, ctx, sid, minutes_ago=30)

    profile = (await client.get(f"{API}/coaches/{ctx['coach_id']}/profile", headers=ctx["headers"])).json()

    assert profile["coach"]["name"] == "Rahul Sharma"
    assert [b["name"] for b in profile["batches"]] == ["Tennis A – Morning"]
    assert profile["batches"][0]["enrolled"] == 1
    assert profile["batches"][0]["attendance_pct"] == 100.0
    assert [s["name"] for s in profile["students"]] == ["Aryan Mehta"]
    assert profile["students_total"] == 1
    assert profile["stats"]["sessions_completed_30d"] == 1
    assert profile["stats"]["student_attendance_pct"] == 100.0
    assert len(profile["monthly"]) == 6
    assert profile["recent"][0]["status"] == "completed"
    assert Decimal(profile["pay"]["current"]["gross"]) == Decimal("55000")


async def test_front_desk_sees_the_coach_but_never_the_money(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    desk = await make_user(tenant_a, email="desk@example.com", role=Role.RECEPTION)
    dh = auth_headers(await login(client, tenant_a, desk.username, PASSWORD), tenant_a)

    profile = (await client.get(f"{API}/coaches/{ctx['coach_id']}/profile", headers=dh)).json()
    assert profile["pay"] is None
    assert Decimal(profile["coach"]["salary"]) == 0
    assert Decimal(profile["coach"]["hourly_rate"]) == 0

    listed = (await client.get(f"{API}/coaches", headers=dh)).json()["items"][0]
    assert Decimal(listed["salary"]) == 0

    assert (await client.get(f"{API}/coaches/{ctx['coach_id']}/earnings", headers=dh)).status_code == 403
    assert (await client.get(f"{API}/payroll", headers=dh)).status_code == 403
    assert (await client.delete(f"{API}/coaches/{ctx['coach_id']}", headers=dh)).status_code == 403


async def test_another_academy_cannot_open_a_coach(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    other = auth_headers(await login(client, tenant_b, tenant_b.admin_email, PASSWORD), tenant_b)
    assert (await client.get(f"{API}/coaches/{ctx['coach_id']}/profile", headers=other)).status_code == 404


# ── Assigning ───────────────────────────────────────────────────────────────


async def second_coach(client: AsyncClient, ctx: dict, name: str = "Priya Nair") -> str:
    response = await client.post(f"{API}/coaches", json={"name": name}, headers=ctx["headers"])
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def test_assigning_a_batch_moves_its_students_and_upcoming_sessions(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    await enrolled_student(client, ctx, "Aryan Mehta")
    other = await second_coach(client, ctx)

    future = (datetime.now(UTC) + timedelta(days=2)).replace(microsecond=0).isoformat()
    session = await client.post(
        f"{API}/sessions", json={"batch_id": ctx["batch_id"], "starts_at": future}, headers=ctx["headers"]
    )
    assert session.status_code == 201

    moved = await client.post(
        f"{API}/coaches/{other}/assign", json={"batch_ids": [ctx["batch_id"]]}, headers=ctx["headers"]
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["active_batches"] == 1
    assert moved.json()["total_students"] == 1

    row = (await client.get("/api/v1/academy/roster", headers=ctx["headers"])).json()["items"][0]
    assert row["coach_name"] == "Priya Nair"

    sessions = await client.get(f"{API}/sessions", headers=ctx["headers"])
    upcoming = [s for s in sessions.json() if s["id"] == session.json()["id"]][0]
    assert upcoming["coach_id"] == other

    old = (await client.get(f"{API}/coaches", headers=ctx["headers"])).json()["items"]
    assert {c["name"]: c["total_students"] for c in old}["Rahul Sharma"] == 0


async def test_unassigning_leaves_the_batch_without_a_coach(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    freed = await client.post(
        f"{API}/coaches/{ctx['coach_id']}/unassign",
        json={"batch_ids": [ctx["batch_id"]]},
        headers=ctx["headers"],
    )
    assert freed.status_code == 200
    assert freed.json()["active_batches"] == 0
    batches = (await client.get(f"{API}/batches", headers=ctx["headers"])).json()
    assert batches[0]["coach_id"] is None


async def test_patching_a_batch_coach_also_moves_the_students(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    await enrolled_student(client, ctx, "Aryan Mehta")
    other = await second_coach(client, ctx)

    patched = await client.patch(
        f"{API}/batches/{ctx['batch_id']}", json={"coach_id": other}, headers=ctx["headers"]
    )
    assert patched.status_code == 200
    row = (await client.get("/api/v1/academy/roster", headers=ctx["headers"])).json()["items"][0]
    assert row["coach_name"] == "Priya Nair"


async def test_an_inactive_coach_cannot_be_given_batches(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    other = await second_coach(client, ctx)
    await client.patch(f"{API}/coaches/{other}", json={"status": "inactive"}, headers=ctx["headers"])
    refused = await client.post(
        f"{API}/coaches/{other}/assign", json={"batch_ids": [ctx["batch_id"]]}, headers=ctx["headers"]
    )
    assert refused.status_code == 400


# ── Removing ────────────────────────────────────────────────────────────────


async def test_removing_a_coach_with_history_archives_them_and_hands_over_batches(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")
    await taught(client, ctx, sid, minutes_ago=30)  # they have taught: that is history
    other = await second_coach(client, ctx)

    removed = await client.delete(
        f"{API}/coaches/{ctx['coach_id']}", params={"reassign_to": other}, headers=ctx["headers"]
    )
    assert removed.status_code == 200, removed.text
    assert removed.json() == {"outcome": "archived", "reassigned_batches": 1, "reassigned_programs": 1}

    coaches = {c["name"]: c for c in (await client.get(f"{API}/coaches", headers=ctx["headers"])).json()["items"]}
    assert coaches["Rahul Sharma"]["status"] == "inactive"
    assert coaches["Priya Nair"]["active_batches"] == 1
    assert coaches["Priya Nair"]["total_students"] == 1


async def test_removing_a_coach_with_no_history_deletes_them(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    fresh = await second_coach(client, ctx)
    removed = await client.delete(f"{API}/coaches/{fresh}", headers=ctx["headers"])
    assert removed.json()["outcome"] == "deleted"
    assert (await client.get(f"{API}/coaches/{fresh}/profile", headers=ctx["headers"])).status_code == 404


async def test_a_coach_who_has_been_paid_is_archived_never_deleted(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    fresh = await second_coach(client, ctx)
    await client.patch(f"{API}/coaches/{fresh}", json={"salary": "10000"}, headers=ctx["headers"])
    month = await this_month(client, ctx)
    await client.post(f"{API}/coaches/{fresh}/payouts", json={"month": month}, headers=ctx["headers"])

    removed = await client.delete(f"{API}/coaches/{fresh}", headers=ctx["headers"])
    assert removed.json()["outcome"] == "archived"


async def test_removal_rejects_a_bad_successor(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await build_academy(client, tenant_a)
    other = await second_coach(client, ctx)
    url = f"{API}/coaches/{ctx['coach_id']}"

    assert (await client.delete(url, params={"reassign_to": ctx["coach_id"]}, headers=ctx["headers"])).status_code == 400
    await client.patch(f"{API}/coaches/{other}", json={"status": "inactive"}, headers=ctx["headers"])
    assert (await client.delete(url, params={"reassign_to": other}, headers=ctx["headers"])).status_code == 400
    # Nothing was changed by the refused attempts.
    assert (await client.get(f"{API}/batches", headers=ctx["headers"])).json()[0]["coach_id"] == ctx["coach_id"]


async def test_a_coach_who_never_taught_is_deleted_and_their_batch_is_handed_over(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Once the batch and its students have moved, nothing on record points at them."""
    ctx = await build_academy(client, tenant_a)
    await enrolled_student(client, ctx, "Aryan Mehta")
    other = await second_coach(client, ctx)

    removed = await client.delete(
        f"{API}/coaches/{ctx['coach_id']}", params={"reassign_to": other}, headers=ctx["headers"]
    )
    assert removed.json() == {"outcome": "deleted", "reassigned_batches": 1, "reassigned_programs": 1}

    coaches = {c["name"]: c for c in (await client.get(f"{API}/coaches", headers=ctx["headers"])).json()["items"]}
    assert "Rahul Sharma" not in coaches
    assert coaches["Priya Nair"]["total_students"] == 1


# ── When a salary is owed ───────────────────────────────────────────────────


def previous_month_of(month: str) -> str:
    year, mon = map(int, month.split("-"))
    return f"{year - 1}-12" if mon == 1 else f"{year}-{mon - 1:02d}"


async def test_no_salary_accrues_for_months_before_the_coach_started(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    month = await this_month(client, ctx)
    last = previous_month_of(month)

    # Added today, so last month is before they existed.
    before = await earnings(client, ctx, last)
    assert Decimal(before["gross"]) == 0 and before["status"] == "nothing"
    assert Decimal((await earnings(client, ctx, month))["gross"]) == Decimal("55000")

    # Backdate the joining date and last month is owed.
    await patch_coach(client, ctx, joining_date=f"{last}-01")
    assert Decimal((await earnings(client, ctx, last))["gross"]) == Decimal("55000")


async def test_an_inactive_coach_stops_accruing_salary_and_leaves_the_payroll(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    await patch_coach(client, ctx, status="inactive")

    assert Decimal((await earnings(client, ctx))["gross"]) == 0
    payroll = (await client.get(f"{API}/payroll", headers=ctx["headers"])).json()
    assert payroll["rows"] == []


async def test_payroll_says_which_month_is_current(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await build_academy(client, tenant_a)
    current = (await client.get(f"{API}/payroll", headers=ctx["headers"])).json()["current_period"]
    older = previous_month_of(current[:7])
    body = (await client.get(f"{API}/payroll", params={"month": older}, headers=ctx["headers"])).json()
    assert body["period"] == f"{older}-01"
    assert body["current_period"] == current  # unchanged by which month is being viewed
