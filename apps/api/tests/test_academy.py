"""Academy: coach numbering, batch capacity, enrolment history, attendance."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from httpx import AsyncClient

from tests.conftest import PASSWORD, TenantFixture, auth_headers, login
from tests.test_booking import setup_academy

IST = ZoneInfo("Asia/Kolkata")


def session_at(day: int, hour: int) -> str:
    return datetime(2026, 10, day, hour, 0, tzinfo=IST).isoformat()


async def build_academy(client: AsyncClient, tenant: TenantFixture) -> dict:
    """A coach, a programme and a batch with two places."""
    ctx = await setup_academy(client, tenant)
    h = ctx["headers"]

    coach = await client.post(
        "/api/v1/academy/coaches",
        json={
            "name": "Rahul Sharma",
            "phone": "9876500001",
            "email": "rahul@alpha.example.com",
            "specialization": "Baseline Game & Serve Technique",
            "type": "full-time",
            "experience_years": 8,
            "certifications": ["AITA Level 3"],
            "languages": ["Hindi", "English"],
            "salary": "55000",
            "hourly_rate": "1500",
            "sport_ids": [ctx["sport_id"]],
        },
        headers=h,
    )
    assert coach.status_code == 201, coach.text

    program = await client.post(
        "/api/v1/academy/programs",
        json={
            "name": "Tennis Beginners",
            "sport_id": ctx["sport_id"],
            "level": "Beginner",
            "age_group": "6–14 yrs",
            "max_students": 12,
            "coach_id": coach.json()["id"],
            "fee_1m": "3500",
            "fee_3m": "9500",
            "fee_6m": "17000",
            "fee_12m": "30000",
        },
        headers=h,
    )
    assert program.status_code == 201, program.text

    batch = await client.post(
        "/api/v1/academy/batches",
        json={
            "name": "Tennis A – Morning",
            "program_id": program.json()["id"],
            "sport_id": ctx["sport_id"],
            "coach_id": coach.json()["id"],
            "capacity": 2,
            "schedule": "Mon · Wed · Fri",
            "time_label": "6:30 AM – 7:30 AM",
        },
        headers=h,
    )
    assert batch.status_code == 201, batch.text

    return {
        **ctx,
        "coach_id": coach.json()["id"],
        "program_id": program.json()["id"],
        "batch_id": batch.json()["id"],
    }


async def make_student(client: AsyncClient, ctx: dict, name: str, dob: str | None = None) -> str:
    response = await client.post(
        "/api/v1/academy/students",
        json={
            "name": name,
            "parent_name": f"Parent of {name}",
            "phone": "9811000001",
            "date_of_birth": dob or "2014-05-01",
            "skills": [{"name": "Forehand", "score": 7}, {"name": "Serve", "score": 5}],
        },
        headers=ctx["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


# ── Numbering ───────────────────────────────────────────────────────────────


async def test_coach_and_student_numbers_are_per_tenant_series(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """XC-C-001 and XC-S-001 restart for every academy, like invoices do."""
    ctx_a = await build_academy(client, tenant_a)
    ctx_b = await build_academy(client, tenant_b)

    coaches_a = await client.get("/api/v1/academy/coaches", headers=ctx_a["headers"])
    coaches_b = await client.get("/api/v1/academy/coaches", headers=ctx_b["headers"])
    assert coaches_a.json()["items"][0]["coach_no"] == "XC-C-001"
    assert coaches_b.json()["items"][0]["coach_no"] == "XC-C-001"

    await make_student(client, ctx_a, "Aryan Mehta")
    await make_student(client, ctx_a, "Nisha Kapoor")
    students = await client.get("/api/v1/academy/students", headers=ctx_a["headers"])
    assert sorted(s["student_no"] for s in students.json()["items"]) == ["XC-S-001", "XC-S-002"]

    # And tenant B's first student is still 001.
    await make_student(client, ctx_b, "Beta Student")
    students_b = await client.get("/api/v1/academy/students", headers=ctx_b["headers"])
    assert students_b.json()["items"][0]["student_no"] == "XC-S-001"


# ── Capacity ────────────────────────────────────────────────────────────────


async def test_batch_occupancy_is_counted_not_stored(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)

    batches = await client.get("/api/v1/academy/batches", headers=ctx["headers"])
    assert batches.json()[0]["enrolled"] == 0
    assert batches.json()[0]["is_full"] is False

    student_id = await make_student(client, ctx, "Aryan Mehta")
    await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": ctx["batch_id"], "duration": "3m"},
        headers=ctx["headers"],
    )

    batches = await client.get("/api/v1/academy/batches", headers=ctx["headers"])
    assert batches.json()[0]["enrolled"] == 1


async def test_a_full_batch_refuses_further_enrolment(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Capacity is checked against live enrolments, not a column that can drift."""
    ctx = await build_academy(client, tenant_a)  # capacity 2

    for name in ("Aryan Mehta", "Nisha Kapoor"):
        student_id = await make_student(client, ctx, name)
        response = await client.post(
            "/api/v1/academy/enrollments",
            json={"student_id": student_id, "batch_id": ctx["batch_id"], "duration": "3m"},
            headers=ctx["headers"],
        )
        assert response.status_code == 201, response.text

    third = await make_student(client, ctx, "Rohit Jain")
    refused = await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": third, "batch_id": ctx["batch_id"], "duration": "3m"},
        headers=ctx["headers"],
    )
    assert refused.status_code == 409
    assert refused.json()["error"]["details"]["capacity"] == 2

    batches = await client.get("/api/v1/academy/batches", headers=ctx["headers"])
    assert batches.json()[0]["is_full"] is True


# ── Enrolment and fees ──────────────────────────────────────────────────────


async def test_enrolment_raises_a_fee_invoice(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The academy fee becomes a real invoice, in the same numbering series."""
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Aryan Mehta")

    response = await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": ctx["batch_id"], "duration": "3m"},
        headers=ctx["headers"],
    )
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["enrollment"]["total_fee"] == "9500.00"
    assert body["invoice_no"].startswith("XC-")
    # 9500 + 18% GST
    assert Decimal(body["invoice_total"]) == Decimal("11210.00")

    invoice = await client.get(
        f"/api/v1/invoices/{body['invoice_id']}", headers=ctx["headers"]
    )
    assert invoice.json()["student_enrollment_id"] == body["enrollment"]["id"]
    assert invoice.json()["booking_id"] is None


async def test_pending_fee_falls_as_payments_arrive(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """`Student.pendingFee` is derived. Stored, it would go stale on every payment."""
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Kavya Reddy")

    enrolled = await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": ctx["batch_id"], "duration": "3m"},
        headers=ctx["headers"],
    )
    invoice_id = enrolled.json()["invoice_id"]

    detail = await client.get(f"/api/v1/academy/students/{student_id}", headers=ctx["headers"])
    assert Decimal(detail.json()["pending_fee"]) == Decimal("9500.00")

    await client.post(
        "/api/v1/payments",
        json={"invoice_id": invoice_id, "amount": "5000", "method": "upi"},
        headers=ctx["headers"],
    )

    detail = await client.get(f"/api/v1/academy/students/{student_id}", headers=ctx["headers"])
    assert Decimal(detail.json()["pending_fee"]) == Decimal("4500.00")


async def test_enrolment_history_survives_a_second_term(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The history the frontend's flat Student interface would have overwritten.

    A student re-enrolling in the same batch next term keeps both rows, which is
    what makes fee history and batch transfers auditable.
    """
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Dev Sharma")

    first = await client.post(
        "/api/v1/academy/enrollments",
        json={
            "student_id": student_id,
            "batch_id": ctx["batch_id"],
            "duration": "3m",
            "start_date": "2026-01-01",
        },
        headers=ctx["headers"],
    )
    assert first.status_code == 201

    # Close the first term, then enrol again — the partial unique index allows it.
    from sqlalchemy import select

    from app.db.session import tenant_session
    from app.modules.academy.models import EnrollmentStatus, StudentEnrollment

    async with tenant_session(tenant_a.id) as session:
        row = (await session.execute(select(StudentEnrollment))).scalar_one()
        row.status = EnrollmentStatus.COMPLETED

    second = await client.post(
        "/api/v1/academy/enrollments",
        json={
            "student_id": student_id,
            "batch_id": ctx["batch_id"],
            "duration": "6m",
            "start_date": "2026-04-01",
        },
        headers=ctx["headers"],
    )
    assert second.status_code == 201, second.text

    history = await client.get(
        f"/api/v1/academy/students/{student_id}/enrollments", headers=ctx["headers"]
    )
    assert len(history.json()) == 2
    assert {row["duration"] for row in history.json()} == {"3m", "6m"}

    # The student detail flattens to the *current* term.
    detail = await client.get(f"/api/v1/academy/students/{student_id}", headers=ctx["headers"])
    assert detail.json()["renewal_date"] == "2026-10-01"
    assert Decimal(detail.json()["total_fee"]) == Decimal("17000.00")


async def test_renewal_date_uses_calendar_months(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Tanvi Singh")

    response = await client.post(
        "/api/v1/academy/enrollments",
        json={
            "student_id": student_id,
            "batch_id": ctx["batch_id"],
            "duration": "1m",
            "start_date": "2027-01-31",
        },
        headers=ctx["headers"],
    )
    assert response.json()["enrollment"]["renewal_date"] == "2027-02-28"


# ── Students ────────────────────────────────────────────────────────────────


async def test_age_is_derived_from_date_of_birth(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """An age column is wrong within a year of being written."""
    ctx = await build_academy(client, tenant_a)
    born = date.today().replace(year=date.today().year - 12)
    student_id = await make_student(client, ctx, "Aryan Mehta", dob=born.isoformat())

    detail = await client.get(f"/api/v1/academy/students/{student_id}", headers=ctx["headers"])
    assert detail.json()["age"] == 12
    assert detail.json()["date_of_birth"] == born.isoformat()


async def test_skills_round_trip_as_jsonb(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Nisha Kapoor")

    detail = await client.get(f"/api/v1/academy/students/{student_id}", headers=ctx["headers"])
    assert detail.json()["skills"] == [
        {"name": "Forehand", "score": 7},
        {"name": "Serve", "score": 5},
    ]

    updated = await client.patch(
        f"/api/v1/academy/students/{student_id}",
        json={"skills": [{"name": "Forehand", "score": 9}], "achievements": ["Best Newcomer"]},
        headers=ctx["headers"],
    )
    assert updated.json()["skills"] == [{"name": "Forehand", "score": 9}]
    assert updated.json()["achievements"] == ["Best Newcomer"]


# ── Sessions and attendance ─────────────────────────────────────────────────


async def test_marking_attendance_is_idempotent_per_student(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Re-marking updates the existing row.

    A second row for the same student would double-count them in every attendance
    percentage on the dashboard.
    """
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Aryan Mehta")
    await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": ctx["batch_id"], "duration": "3m"},
        headers=ctx["headers"],
    )

    created = await client.post(
        "/api/v1/academy/sessions",
        json={"batch_id": ctx["batch_id"], "starts_at": session_at(1, 6), "duration_min": 60},
        headers=ctx["headers"],
    )
    assert created.status_code == 201, created.text
    session_id = created.json()["id"]

    await client.post(
        f"/api/v1/academy/sessions/{session_id}/attendance",
        json={"marks": [{"student_id": student_id, "status": "absent"}]},
        headers=ctx["headers"],
    )
    corrected = await client.post(
        f"/api/v1/academy/sessions/{session_id}/attendance",
        json={"marks": [{"student_id": student_id, "status": "present"}]},
        headers=ctx["headers"],
    )
    assert corrected.status_code == 200

    register = await client.get(
        f"/api/v1/academy/sessions/{session_id}/attendance", headers=ctx["headers"]
    )
    assert len(register.json()) == 1
    assert register.json()[0]["status"] == "present"


async def test_session_counters_are_derived_from_the_register(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    first = await make_student(client, ctx, "Aryan Mehta")
    second = await make_student(client, ctx, "Nisha Kapoor")
    for student_id in (first, second):
        await client.post(
            "/api/v1/academy/enrollments",
            json={"student_id": student_id, "batch_id": ctx["batch_id"], "duration": "3m"},
            headers=ctx["headers"],
        )

    created = await client.post(
        "/api/v1/academy/sessions",
        json={"batch_id": ctx["batch_id"], "starts_at": session_at(2, 6)},
        headers=ctx["headers"],
    )
    session_id = created.json()["id"]
    assert created.json()["students_enrolled"] == 2
    assert created.json()["present"] == 0

    await client.post(
        f"/api/v1/academy/sessions/{session_id}/attendance",
        json={
            "marks": [
                {"student_id": first, "status": "present"},
                {"student_id": second, "status": "absent"},
            ]
        },
        headers=ctx["headers"],
    )

    sessions = await client.get("/api/v1/academy/sessions", headers=ctx["headers"])
    row = sessions.json()[0]
    assert row["present"] == 1
    assert row["absent"] == 1
    assert row["students_enrolled"] == 2
    # Taking the register completes the session.
    assert row["status"] == "completed"


async def test_attendance_percentage_ignores_unmarked_sessions(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A batch whose register has not been taken must not drag percentages down."""
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Aryan Mehta")
    await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": ctx["batch_id"], "duration": "3m"},
        headers=ctx["headers"],
    )

    for day, mark in ((3, "present"), (4, "present"), (5, "absent")):
        created = await client.post(
            "/api/v1/academy/sessions",
            json={"batch_id": ctx["batch_id"], "starts_at": session_at(day, 6)},
            headers=ctx["headers"],
        )
        await client.post(
            f"/api/v1/academy/sessions/{created.json()['id']}/attendance",
            json={"marks": [{"student_id": student_id, "status": mark}]},
            headers=ctx["headers"],
        )

    # A fourth session with no register taken at all.
    await client.post(
        "/api/v1/academy/sessions",
        json={"batch_id": ctx["batch_id"], "starts_at": session_at(6, 6)},
        headers=ctx["headers"],
    )

    detail = await client.get(f"/api/v1/academy/students/{student_id}", headers=ctx["headers"])
    assert detail.json()["attendance_pct"] == 66.7  # 2 of 3 marked, not 2 of 4


async def test_coach_workload_is_derived(client: AsyncClient, tenant_a: TenantFixture) -> None:
    """`activeBatches` and `totalStudents` are counts, not stored columns."""
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Aryan Mehta")
    await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": ctx["batch_id"], "duration": "3m"},
        headers=ctx["headers"],
    )

    coaches = await client.get("/api/v1/academy/coaches", headers=ctx["headers"])
    coach = coaches.json()["items"][0]
    assert coach["active_batches"] == 1
    assert coach["total_students"] == 1
    assert coach["sport_ids"] == [ctx["sport_id"]]


async def test_academy_overview(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Aryan Mehta")
    enrolled = await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": ctx["batch_id"], "duration": "3m"},
        headers=ctx["headers"],
    )
    await client.post(
        "/api/v1/payments",
        json={"invoice_id": enrolled.json()["invoice_id"], "amount": "2000", "method": "cash"},
        headers=ctx["headers"],
    )

    overview = await client.get("/api/v1/academy/overview", headers=ctx["headers"])
    body = overview.json()
    assert body["total_coaches"] == 1
    assert body["active_coaches"] == 1
    assert body["active_students"] == 1
    assert body["sports_offered"] == 1
    assert body["new_admissions_this_month"] == 1
    assert Decimal(body["fee_collected"]) == Decimal("2000.00")
    assert Decimal(body["fee_pending"]) > Decimal("0")


async def test_academy_data_does_not_cross_tenants(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    ctx_a = await build_academy(client, tenant_a)
    ctx_b = await build_academy(client, tenant_b)

    student_id = await make_student(client, ctx_a, "Alpha Student")

    assert (
        await client.get(f"/api/v1/academy/students/{student_id}", headers=ctx_b["headers"])
    ).status_code == 404
    assert (await client.get("/api/v1/academy/students", headers=ctx_b["headers"])).json()["total"] == 0

    # B cannot enrol A's student into B's batch either.
    attempt = await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": ctx_b["batch_id"], "duration": "3m"},
        headers=ctx_b["headers"],
    )
    assert attempt.status_code == 404


# ── Age bands ───────────────────────────────────────────────────────────────
#
# The rule staff rely on: a child cannot be filed into an adults' programme by a
# mis-click, and the refusal says why in words a parent can be shown.


def years_ago(years: int) -> str:
    """A date of birth that means exactly `years` old, whenever the suite runs.

    1 January, so the birthday has already passed on every day the suite could run
    — including 1 January itself, where the age still comes out exact. Picking a
    day later in the month would make the answer depend on what today is, which is
    the bug this helper exists to avoid.
    """
    return date(date.today().year - years, 1, 1).isoformat()


async def band_program(client: AsyncClient, ctx: dict, *, band: str, name: str, **extra) -> str:
    response = await client.post(
        "/api/v1/academy/programs",
        json={
            "name": name,
            "sport_id": ctx["sport_id"],
            "age_band": band,
            "max_students": 12,
            "fee_3m": "9000",
            **extra,
        },
        headers=ctx["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def batch_for(client: AsyncClient, ctx: dict, program_id: str, name: str) -> str:
    response = await client.post(
        "/api/v1/academy/batches",
        json={
            "name": name,
            "program_id": program_id,
            "sport_id": ctx["sport_id"],
            "capacity": 10,
        },
        headers=ctx["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def test_a_child_cannot_be_enrolled_in_an_adults_programme(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The mis-click this whole feature exists to stop.

    The message has to carry the numbers, because the person reading it is at a
    counter with a parent in front of them and needs to say what to do instead.
    """
    ctx = await build_academy(client, tenant_a)
    program_id = await band_program(client, ctx, band="adults", name="Adults Tennis")
    batch_id = await batch_for(client, ctx, program_id, "Adults – Evening")
    student_id = await make_student(client, ctx, "Aryan Mehta", dob=years_ago(9))

    response = await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": batch_id, "duration": "3m"},
        headers=ctx["headers"],
    )
    assert response.status_code == 400, response.text
    body = response.json()["error"]
    assert body["details"]["student_age"] == 9
    assert body["details"]["age_band"] == "adults"
    assert "17" in body["message"]


async def test_an_adult_cannot_be_enrolled_in_a_kids_programme(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The band has a ceiling as well as a floor — it is a band, not a minimum."""
    ctx = await build_academy(client, tenant_a)
    program_id = await band_program(client, ctx, band="kids", name="Kids Tennis")
    batch_id = await batch_for(client, ctx, program_id, "Kids – Morning")
    student_id = await make_student(client, ctx, "Ravi Chandran", dob=years_ago(34))

    response = await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": batch_id, "duration": "3m"},
        headers=ctx["headers"],
    )
    assert response.status_code == 400, response.text
    assert response.json()["error"]["details"]["student_age"] == 34


async def test_age_is_judged_at_the_start_of_the_term_not_today(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A sixteen-year-old signing up for a term that begins after their birthday.

    They will be seventeen on the first day of class, so the kids' batch is the
    wrong answer for them even though they are sixteen at the counter today.
    """
    ctx = await build_academy(client, tenant_a)
    program_id = await band_program(client, ctx, band="kids", name="Kids Tennis")
    batch_id = await batch_for(client, ctx, program_id, "Kids – Morning")

    # Sixteen today; seventeen in a month.
    turning_17 = date.today().replace(year=date.today().year - 17) + timedelta(days=30)
    student_id = await make_student(client, ctx, "Ishaan Roy", dob=turning_17.isoformat())

    today_ok = await client.post(
        "/api/v1/academy/enrollments",
        json={
            "student_id": student_id,
            "batch_id": batch_id,
            "duration": "3m",
            "start_date": date.today().isoformat(),
        },
        headers=ctx["headers"],
    )
    assert today_ok.status_code == 201, today_ok.text

    later = await client.post(
        "/api/v1/academy/enrollments",
        json={
            "student_id": student_id,
            "batch_id": batch_id,
            "duration": "3m",
            "start_date": (date.today() + timedelta(days=60)).isoformat(),
        },
        headers=ctx["headers"],
    )
    assert later.status_code == 400, later.text
    assert later.json()["error"]["details"]["student_age"] == 17


async def test_an_age_banded_programme_needs_a_date_of_birth(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Refused rather than waved through.

    `date_of_birth` is nullable, so the alternative is a missing field silently
    defeating the rule — which is worse than an error, because nobody finds out.
    """
    ctx = await build_academy(client, tenant_a)
    program_id = await band_program(client, ctx, band="kids", name="Kids Tennis")
    batch_id = await batch_for(client, ctx, program_id, "Kids – Morning")

    created = await client.post(
        "/api/v1/academy/students",
        json={"name": "No Birthday", "phone": "9811000009"},
        headers=ctx["headers"],
    )
    assert created.status_code == 201, created.text

    response = await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": created.json()["id"], "batch_id": batch_id, "duration": "3m"},
        headers=ctx["headers"],
    )
    assert response.status_code == 400, response.text
    assert response.json()["error"]["details"]["field"] == "date_of_birth"


async def test_a_programme_with_no_band_admits_any_age(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Every programme that existed before age bands keeps working.

    This is what makes the migration safe: NULL means unrestricted, so nothing that
    enrolled yesterday starts being refused today — including a student with no
    date of birth on file.
    """
    ctx = await build_academy(client, tenant_a)  # its programme has no band
    created = await client.post(
        "/api/v1/academy/students",
        json={"name": "Unbanded", "phone": "9811000010"},
        headers=ctx["headers"],
    )

    response = await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": created.json()["id"], "batch_id": ctx["batch_id"], "duration": "3m"},
        headers=ctx["headers"],
    )
    assert response.status_code == 201, response.text


async def test_explicit_bounds_beat_the_bands_defaults(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """An academy that runs its kids' football to 14, not 16, says so once."""
    ctx = await build_academy(client, tenant_a)
    program_id = await band_program(
        client, ctx, band="kids", name="Kids U-14", age_min=6, age_max=14
    )
    batch_id = await batch_for(client, ctx, program_id, "U-14 Squad")
    student_id = await make_student(client, ctx, "Kabir Singh", dob=years_ago(15))

    response = await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": batch_id, "duration": "3m"},
        headers=ctx["headers"],
    )
    # 15 would pass the kids default of 5–16, and fails the academy's own 6–14.
    assert response.status_code == 400, response.text
    assert response.json()["error"]["details"]["age_max"] == 14


async def test_a_refused_enrolment_leaves_no_invoice_behind(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The age check runs before the fee is raised.

    Getting this backwards bills a parent for a place their child was never given.
    """
    ctx = await build_academy(client, tenant_a)
    program_id = await band_program(client, ctx, band="adults", name="Adults Tennis")
    batch_id = await batch_for(client, ctx, program_id, "Adults – Evening")
    student_id = await make_student(client, ctx, "Aryan Mehta", dob=years_ago(9))

    before = (await client.get("/api/v1/invoices", headers=ctx["headers"])).json()["total"]
    await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": batch_id, "duration": "3m"},
        headers=ctx["headers"],
    )
    after = (await client.get("/api/v1/invoices", headers=ctx["headers"])).json()["total"]
    assert after == before


# ── The progression ladder ──────────────────────────────────────────────────


async def test_a_student_holds_a_level_per_sport(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Advanced at tennis and a beginner at football is a normal child.

    One level per student would force one of those to be a lie, which is the whole
    reason the standing is keyed on the sport.
    """
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Aryan Mehta")

    football = await client.post(
        "/api/v1/sports",
        json={
            "name": "Football",
            "icon": "⚽",
            "price_base": "2500",
            "price_peak": "3500",
            "price_weekend": "3000",
        },
        headers=ctx["headers"],
    )
    assert football.status_code == 201, football.text

    for sport_id, level in ((ctx["sport_id"], "advanced"), (football.json()["id"], "beginner")):
        response = await client.post(
            f"/api/v1/academy/students/{student_id}/promotions",
            json={"sport_id": sport_id, "to_level": level},
            headers=ctx["headers"],
        )
        assert response.status_code == 201, response.text

    levels = await client.get(
        f"/api/v1/academy/students/{student_id}/levels", headers=ctx["headers"]
    )
    by_sport = {row["sport_id"]: row["level"] for row in levels.json()}
    assert by_sport[ctx["sport_id"]] == "advanced"
    assert by_sport[football.json()["id"]] == "beginner"


async def test_a_first_assessment_has_no_from_level(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Arriving at a level is a different event from moving to one."""
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Aryan Mehta")

    first = await client.post(
        f"/api/v1/academy/students/{student_id}/promotions",
        json={"sport_id": ctx["sport_id"], "to_level": "beginner"},
        headers=ctx["headers"],
    )
    assert first.json()["from_level"] is None

    second = await client.post(
        f"/api/v1/academy/students/{student_id}/promotions",
        json={"sport_id": ctx["sport_id"], "to_level": "intermediate"},
        headers=ctx["headers"],
    )
    assert second.json()["from_level"] == "beginner"
    assert second.json()["to_level"] == "intermediate"


async def test_the_ladder_records_demotions_and_standstills_too(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A review that confirms the status quo is still a review worth keeping.

    Dropping it would make a carefully-tended ladder look untended.
    """
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Aryan Mehta")

    for level in ("intermediate", "intermediate", "beginner"):
        response = await client.post(
            f"/api/v1/academy/students/{student_id}/promotions",
            json={"sport_id": ctx["sport_id"], "to_level": level},
            headers=ctx["headers"],
        )
        assert response.status_code == 201, response.text

    history = await client.get(
        f"/api/v1/academy/students/{student_id}/promotions", headers=ctx["headers"]
    )
    assert len(history.json()) == 3

    levels = await client.get(
        f"/api/v1/academy/students/{student_id}/levels", headers=ctx["headers"]
    )
    # One standing, not three — the history accumulates, the standing does not.
    assert len(levels.json()) == 1
    assert levels.json()[0]["level"] == "beginner"


async def test_a_batch_above_the_students_level_warns_but_enrols(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Level is coaching judgment, not a gate — unlike age.

    Stretching a strong beginner into an intermediate batch is how anyone ever
    improves, so this reports and gets out of the way.
    """
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Aryan Mehta")
    await client.post(
        f"/api/v1/academy/students/{student_id}/promotions",
        json={"sport_id": ctx["sport_id"], "to_level": "beginner"},
        headers=ctx["headers"],
    )

    program_id = await band_program(
        client, ctx, band="kids", name="Advanced Kids", skill_level="advanced"
    )
    batch_id = await batch_for(client, ctx, program_id, "Advanced Squad")

    response = await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": batch_id, "duration": "3m"},
        headers=ctx["headers"],
    )
    assert response.status_code == 201, response.text
    assert "beginner" in response.json()["level_warning"]
    assert "2 levels above" in response.json()["level_warning"]


async def test_enrolling_at_or_below_the_students_level_says_nothing(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """No warning where there is nothing to warn about — noise trains people to ignore it."""
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Aryan Mehta")
    await client.post(
        f"/api/v1/academy/students/{student_id}/promotions",
        json={"sport_id": ctx["sport_id"], "to_level": "advanced"},
        headers=ctx["headers"],
    )

    program_id = await band_program(
        client, ctx, band="kids", name="Intermediate Kids", skill_level="intermediate"
    )
    batch_id = await batch_for(client, ctx, program_id, "Intermediate Squad")

    response = await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": batch_id, "duration": "3m"},
        headers=ctx["headers"],
    )
    assert response.status_code == 201, response.text
    assert response.json()["level_warning"] is None


# ── What the counter tablet may touch ───────────────────────────────────────


async def kiosk_headers(client: AsyncClient, tenant: TenantFixture) -> dict[str, str]:
    from app.core.security import Role

    from tests.conftest import make_user

    kiosk = await make_user(tenant, email="counter@academy.example.com", role=Role.KIOSK)
    return auth_headers(await login(client, tenant, kiosk.username, PASSWORD), tenant)


async def test_the_tablet_can_take_a_register(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Attendance is the one academy action that belongs on a shared device.

    A register is taken at the door, on whatever is at the door. The worst a
    leaked kiosk credential does here is mark a child present who was not.
    """
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Aryan Mehta")
    await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": ctx["batch_id"], "duration": "3m"},
        headers=ctx["headers"],
    )
    created = await client.post(
        "/api/v1/academy/sessions",
        json={
            "batch_id": ctx["batch_id"],
            "starts_at": session_at(4, 7),
            "ends_at": session_at(4, 8),
        },
        headers=ctx["headers"],
    )
    assert created.status_code == 201, created.text
    session_id = created.json()["id"]

    tablet = await kiosk_headers(client, tenant_a)

    listed = await client.get("/api/v1/academy/sessions", headers=tablet)
    assert listed.status_code == 200, listed.text

    # The roster, not the attendance rows: nobody is marked yet, so a register
    # built from attendance would be empty and there would be nothing to tick.
    roster = await client.get(f"/api/v1/academy/sessions/{session_id}/roster", headers=tablet)
    assert roster.status_code == 200, roster.text
    assert [r["student_name"] for r in roster.json()] == ["Aryan Mehta"]
    assert roster.json()[0]["status"] is None

    marked = await client.post(
        f"/api/v1/academy/sessions/{session_id}/attendance",
        json={"marks": [{"student_id": student_id, "status": "present"}]},
        headers=tablet,
    )
    assert marked.status_code == 200, marked.text
    assert marked.json()[0]["status"] == "present"

    register = await client.get(
        f"/api/v1/academy/sessions/{session_id}/attendance", headers=tablet
    )
    assert register.status_code == 200, register.text

    # And the roster now carries the mark, so re-opening a half-taken register
    # resumes where the coach left off rather than starting again.
    resumed = await client.get(f"/api/v1/academy/sessions/{session_id}/roster", headers=tablet)
    assert resumed.json()[0]["status"] == "present"


async def test_the_tablet_cannot_enrol_promote_or_price(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The register, and nothing else.

    This is the whole of the kiosk's academy blast radius, written down. The
    shared counter login is the most exposed credential in the venue, so
    anything that takes money, moves a child between groups, or changes what
    the academy charges stays with a login that names a person.
    """
    ctx = await build_academy(client, tenant_a)
    student_id = await make_student(client, ctx, "Aryan Mehta")
    tablet = await kiosk_headers(client, tenant_a)

    refused = {
        "enrol": await client.post(
            "/api/v1/academy/enrollments",
            json={"student_id": student_id, "batch_id": ctx["batch_id"], "duration": "3m"},
            headers=tablet,
        ),
        "promote": await client.post(
            f"/api/v1/academy/students/{student_id}/promotions",
            json={"sport_id": ctx["sport_id"], "to_level": "advanced"},
            headers=tablet,
        ),
        "reprice": await client.patch(
            f"/api/v1/academy/programs/{ctx['program_id']}",
            json={"fee_3m": "1"},
            headers=tablet,
        ),
        "read students": await client.get("/api/v1/academy/students", headers=tablet),
    }

    for action, response in refused.items():
        assert response.status_code == 403, f"{action} should be refused: {response.text}"
