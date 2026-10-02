"""Academy insights: the students table, the profile, reviews, and who needs attention."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from httpx import AsyncClient

from app.core.security import Role
from tests.conftest import PASSWORD, TenantFixture, auth_headers, login, make_user
from tests.test_academy import build_academy, make_student

ROSTER = "/api/v1/academy/roster"
ATTENTION = "/api/v1/academy/attention"


async def enrol(client: AsyncClient, ctx: dict, student_id: str) -> None:
    response = await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": student_id, "batch_id": ctx["batch_id"], "duration": "3m"},
        headers=ctx["headers"],
    )
    assert response.status_code == 201, response.text


async def enrolled_student(client: AsyncClient, ctx: dict, name: str) -> str:
    student_id = await make_student(client, ctx, name)
    await enrol(client, ctx, student_id)
    return student_id


async def run_session(
    client: AsyncClient, ctx: dict, *, days_ago: int, marks: dict[str, str]
) -> None:
    """A session `days_ago` days back, with the register taken."""
    starts = (datetime.now(UTC) - timedelta(days=days_ago)).replace(microsecond=0)
    created = await client.post(
        "/api/v1/academy/sessions",
        json={"batch_id": ctx["batch_id"], "starts_at": starts.isoformat()},
        headers=ctx["headers"],
    )
    assert created.status_code == 201, created.text
    marked = await client.post(
        f"/api/v1/academy/sessions/{created.json()['id']}/attendance",
        json={"marks": [{"student_id": sid, "status": st} for sid, st in marks.items()]},
        headers=ctx["headers"],
    )
    assert marked.status_code in (200, 201), marked.text


async def roster(client: AsyncClient, ctx: dict, **params) -> dict:
    response = await client.get(ROSTER, params=params, headers=ctx["headers"])
    assert response.status_code == 200, response.text
    return response.json()


async def review(client: AsyncClient, ctx: dict, student_id: str, **body) -> dict:
    response = await client.post(
        f"/api/v1/academy/students/{student_id}/assessments", json=body, headers=ctx["headers"]
    )
    assert response.status_code == 201, response.text
    return response.json()


# ── The students table ──────────────────────────────────────────────────────


async def test_roster_derives_attendance_fees_and_where_they_train(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")
    for days_ago, mark in ((3, "present"), (2, "present"), (1, "absent")):
        await run_session(client, ctx, days_ago=days_ago, marks={sid: mark})

    row = (await roster(client, ctx))["items"][0]

    assert row["name"] == "Aryan Mehta"
    assert row["student_no"] == "XC-S-001"
    assert row["batch_name"] == "Tennis A – Morning"
    assert row["coach_name"] == "Rahul Sharma"
    assert row["sport_id"] == ctx["sport_id"]
    assert row["attendance_pct"] == 66.7
    assert row["sessions_marked_30d"] == 3
    # Enrolled, invoiced, nothing paid yet.
    assert row["fee_status"] == "due"
    assert float(row["pending_fee"]) > 0
    assert row["renewal_state"] == "ok"


async def test_a_new_joiner_has_no_attendance_rather_than_zero(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    await enrolled_student(client, ctx, "Aryan Mehta")

    row = (await roster(client, ctx))["items"][0]
    assert row["attendance_pct"] is None
    assert row["flags"] == []  # "no data" is not "absent"


async def test_sorting_by_attendance_puts_students_with_no_data_last(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    missing = await enrolled_student(client, ctx, "Aryan Mehta")  # never marked
    keen = await enrolled_student(client, ctx, "Nisha Kapoor")
    await run_session(client, ctx, days_ago=1, marks={keen: "present"})

    items = (await roster(client, ctx, sort="attendance"))["items"]
    assert [r["id"] for r in items] == [keen, missing]


async def test_roster_filters_by_batch_coach_sport_status_and_search(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    aryan = await enrolled_student(client, ctx, "Aryan Mehta")
    unenrolled = await make_student(client, ctx, "Nisha Kapoor")

    by_batch = await roster(client, ctx, batch_id=ctx["batch_id"])
    assert [r["id"] for r in by_batch["items"]] == [aryan]
    assert (await roster(client, ctx, coach_id=ctx["coach_id"]))["total"] == 1
    assert (await roster(client, ctx, sport_id=ctx["sport_id"]))["total"] == 1

    # The unenrolled student exists, just not under any sport, batch or coach.
    assert (await roster(client, ctx))["total"] == 2
    assert [r["id"] for r in (await roster(client, ctx, search="XC-S-002"))["items"]] == [unenrolled]
    assert (await roster(client, ctx, search="kapoor"))["total"] == 1

    await client.patch(
        f"/api/v1/academy/students/{aryan}", json={"status": "paused"}, headers=ctx["headers"]
    )
    assert (await roster(client, ctx, status="paused"))["total"] == 1
    assert (await roster(client, ctx, status="active"))["total"] == 1


async def test_roster_filters_by_fee_status(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await build_academy(client, tenant_a)
    await enrolled_student(client, ctx, "Aryan Mehta")
    await make_student(client, ctx, "Nisha Kapoor")  # not enrolled: no fee at all

    assert (await roster(client, ctx, fee_status="due"))["total"] == 1
    assert (await roster(client, ctx, fee_status="none"))["total"] == 1
    assert (await roster(client, ctx, fee_status="paid"))["total"] == 0


async def test_roster_is_paged(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await build_academy(client, tenant_a)
    for name in ("Aryan Mehta", "Nisha Kapoor", "Rohit Jain"):
        await make_student(client, ctx, name)

    page = await roster(client, ctx, size=2, page=2)
    assert page["total"] == 3 and page["pages"] == 2
    assert [r["name"] for r in page["items"]] == ["Rohit Jain"]


async def test_students_do_not_leak_between_academies(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    ctx_a = await build_academy(client, tenant_a)
    ctx_b = await build_academy(client, tenant_b)
    sid = await make_student(client, ctx_a, "Aryan Mehta")

    assert (await roster(client, ctx_b))["total"] == 0
    stolen = await client.get(f"/api/v1/academy/students/{sid}/profile", headers=ctx_b["headers"])
    assert stolen.status_code == 404


# ── Needs attention ─────────────────────────────────────────────────────────


async def test_repeat_absence_and_low_attendance_are_flagged_with_a_reason(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")
    for days_ago, mark in ((9, "present"), (6, "absent"), (4, "absent"), (2, "absent")):
        await run_session(client, ctx, days_ago=days_ago, marks={sid: mark})

    row = (await roster(client, ctx))["items"][0]
    assert set(row["flags"]) >= {"repeat_absentee", "low_attendance"}

    report = (await client.get(ATTENTION, headers=ctx["headers"])).json()
    assert report["counts"]["repeat_absentees"] == 1
    assert report["counts"]["low_attendance"] == 1
    assert "3 absences" in report["repeat_absentees"][0]["detail"]
    assert "25%" in report["low_attendance"][0]["detail"]

    only = await roster(client, ctx, attention="repeat_absentee")
    assert [r["id"] for r in only["items"]] == [sid]


async def test_too_few_sessions_never_raise_a_low_attendance_flag(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """One miss in two sessions is 50% — and noise. A flag nobody trusts is worse than none."""
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")
    await run_session(client, ctx, days_ago=3, marks={sid: "present"})
    await run_session(client, ctx, days_ago=1, marks={sid: "absent"})

    assert "low_attendance" not in (await roster(client, ctx))["items"][0]["flags"]


async def test_a_paused_student_is_not_nagged_about(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")
    for days_ago in (6, 4, 2):
        await run_session(client, ctx, days_ago=days_ago, marks={sid: "absent"})
    await client.patch(
        f"/api/v1/academy/students/{sid}", json={"status": "paused"}, headers=ctx["headers"]
    )

    report = (await client.get(ATTENTION, headers=ctx["headers"])).json()
    assert report["counts"]["repeat_absentees"] == 0


async def test_a_term_ending_soon_is_listed_for_renewal(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await make_student(client, ctx, "Aryan Mehta")
    # A one-month term that started 28 days ago ends in a couple of days.
    start = (date.today() - timedelta(days=28)).isoformat()
    response = await client.post(
        "/api/v1/academy/enrollments",
        json={"student_id": sid, "batch_id": ctx["batch_id"], "duration": "1m", "start_date": start},
        headers=ctx["headers"],
    )
    assert response.status_code == 201, response.text

    row = (await roster(client, ctx))["items"][0]
    assert row["renewal_state"] == "due_soon"
    assert "renewal_due" in row["flags"]

    report = (await client.get(ATTENTION, headers=ctx["headers"])).json()
    assert report["counts"]["renewals_due"] == 1
    assert "Term ends" in report["renewals_due"][0]["detail"]


async def test_a_strong_consistent_student_is_suggested_for_promotion(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")
    # Beginner since two months ago, rated 9, never misses.
    await client.post(
        f"/api/v1/academy/students/{sid}/promotions",
        json={
            "sport_id": ctx["sport_id"],
            "to_level": "beginner",
            "assessed_on": (date.today() - timedelta(days=60)).isoformat(),
        },
        headers=ctx["headers"],
    )
    await review(client, ctx, sid, rating="9", skills=[])
    for days_ago in (8, 6, 4, 2):
        await run_session(client, ctx, days_ago=days_ago, marks={sid: "present"})

    report = (await client.get(ATTENTION, headers=ctx["headers"])).json()
    assert report["counts"]["promotion_candidates"] == 1
    assert report["promotion_candidates"][0]["student_id"] == sid


async def test_a_recently_levelled_student_is_not_suggested_again(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")
    await client.post(
        f"/api/v1/academy/students/{sid}/promotions",
        json={"sport_id": ctx["sport_id"], "to_level": "beginner"},  # assessed today
        headers=ctx["headers"],
    )
    await review(client, ctx, sid, rating="9", skills=[])
    for days_ago in (8, 6, 4, 2):
        await run_session(client, ctx, days_ago=days_ago, marks={sid: "present"})

    report = (await client.get(ATTENTION, headers=ctx["headers"])).json()
    assert report["counts"]["promotion_candidates"] == 0


# ── Reviews ─────────────────────────────────────────────────────────────────


async def test_a_review_is_mirrored_onto_the_student(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")

    created = await review(
        client,
        ctx,
        sid,
        rating="7.5",
        skills=[{"name": "Forehand", "score": 8}, {"name": "Serve", "score": 6}],
        comment="  Great footwork this term.  ",
    )
    assert created["comment"] == "Great footwork this term."
    assert created["assessed_by"]  # defaults to whoever recorded it

    row = (await roster(client, ctx))["items"][0]
    assert float(row["rating"]) == 7.5
    student = (await client.get(f"/api/v1/academy/students/{sid}", headers=ctx["headers"])).json()
    assert {s["name"]: s["score"] for s in student["skills"]} == {"Forehand": 8, "Serve": 6}


async def test_a_back_dated_review_never_overwrites_a_newer_one(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")

    await review(client, ctx, sid, rating="8", skills=[{"name": "Serve", "score": 8}])
    await review(
        client, ctx, sid, rating="4", skills=[{"name": "Serve", "score": 4}],
        assessed_on=(date.today() - timedelta(days=90)).isoformat(),
    )

    row = (await roster(client, ctx))["items"][0]
    assert float(row["rating"]) == 8  # the older review is history, not the present


async def test_a_review_cannot_be_dated_in_the_future(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")

    response = await client.post(
        f"/api/v1/academy/students/{sid}/assessments",
        json={"rating": "7", "assessed_on": (date.today() + timedelta(days=3)).isoformat()},
        headers=ctx["headers"],
    )
    assert response.status_code in (400, 422)


async def test_reception_can_look_but_not_review(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")
    desk = await make_user(tenant_a, email="desk@example.com", role=Role.RECEPTION)
    headers = auth_headers(await login(client, tenant_a, desk.username, PASSWORD), tenant_a)

    assert (await client.get(ROSTER, headers=headers)).status_code == 200
    assert (await client.get(f"/api/v1/academy/students/{sid}/profile", headers=headers)).status_code == 200
    refused = await client.post(
        f"/api/v1/academy/students/{sid}/assessments", json={"rating": "7"}, headers=headers
    )
    assert refused.status_code == 403


async def test_the_counter_tablet_cannot_read_the_roster(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    await enrolled_student(client, ctx, "Aryan Mehta")
    kiosk = await make_user(tenant_a, email="counter@example.com", role=Role.KIOSK)
    headers = auth_headers(await login(client, tenant_a, kiosk.username, PASSWORD), tenant_a)

    assert (await client.get(ROSTER, headers=headers)).status_code == 403
    assert (await client.get(ATTENTION, headers=headers)).status_code == 403


# ── Profile ─────────────────────────────────────────────────────────────────


async def test_profile_summarises_attendance_and_streak(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")
    # Oldest to newest: absent, present, late, present — a streak of three.
    for days_ago, mark in ((8, "absent"), (6, "present"), (4, "late"), (2, "present")):
        await run_session(client, ctx, days_ago=days_ago, marks={sid: mark})

    profile = (await client.get(f"/api/v1/academy/students/{sid}/profile", headers=ctx["headers"])).json()
    attendance = profile["attendance"]

    assert attendance["total"] == 4
    assert (attendance["present"], attendance["late"], attendance["absent"]) == (2, 1, 1)
    assert attendance["overall_pct"] == 75.0
    assert attendance["streak"] == 3
    assert len(attendance["monthly"]) == 6
    assert attendance["recent"][0]["status"] == "present"  # newest first
    assert profile["row"]["student_no"] == "XC-S-001"


async def test_profile_orders_reviews_for_a_trend_and_keeps_the_previous_skills(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await enrolled_student(client, ctx, "Aryan Mehta")
    older = (date.today() - timedelta(days=60)).isoformat()
    newer = (date.today() - timedelta(days=5)).isoformat()

    # Entered newest-first on purpose: the trend must follow the dates, not the order written.
    await review(client, ctx, sid, rating="7", skills=[{"name": "Serve", "score": 7}], assessed_on=newer)
    await review(client, ctx, sid, rating="5", skills=[{"name": "Serve", "score": 5}], assessed_on=older)

    profile = (await client.get(f"/api/v1/academy/students/{sid}/profile", headers=ctx["headers"])).json()
    assert [float(a["rating"]) for a in profile["assessments"]] == [5, 7]
    assert profile["skills"] == [{"name": "Serve", "score": 7}]
    assert profile["previous_skills"] == [{"name": "Serve", "score": 5}]


async def test_standing_ranks_a_student_within_their_batch(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)  # capacity 2
    star = await enrolled_student(client, ctx, "Aryan Mehta")
    other = await enrolled_student(client, ctx, "Nisha Kapoor")
    await review(client, ctx, star, rating="9", skills=[])
    await review(client, ctx, other, rating="5", skills=[])
    await run_session(client, ctx, days_ago=2, marks={star: "present", other: "present"})

    best = (await client.get(f"/api/v1/academy/students/{star}/profile", headers=ctx["headers"])).json()
    behind = (await client.get(f"/api/v1/academy/students/{other}/profile", headers=ctx["headers"])).json()

    assert best["standing"]["batch_rank"] == 1
    assert behind["standing"]["batch_rank"] == 2
    assert best["standing"]["batch_size"] == 2
    # 60% of (9 x 10) plus 40% of 100% attendance.
    assert best["standing"]["score"] == 94.0


async def test_an_unenrolled_student_has_a_profile_but_no_standing(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await make_student(client, ctx, "Aryan Mehta")

    profile = (await client.get(f"/api/v1/academy/students/{sid}/profile", headers=ctx["headers"])).json()
    assert profile["standing"]["batch_rank"] is None
    assert profile["row"]["fee_status"] == "none"
    assert profile["attendance"]["total"] == 0
    assert profile["attendance"]["overall_pct"] is None


async def test_a_photo_url_is_stored_and_returned(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await build_academy(client, tenant_a)
    sid = await make_student(client, ctx, "Aryan Mehta")

    patched = await client.patch(
        f"/api/v1/academy/students/{sid}",
        json={"photo_url": "https://cdn.example.com/aryan.jpg"},
        headers=ctx["headers"],
    )
    assert patched.status_code == 200, patched.text
    assert (await roster(client, ctx))["items"][0]["photo_url"] == "https://cdn.example.com/aryan.jpg"
