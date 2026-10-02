"""Coach earnings, payroll and the coach profile.

Like the student insights, everything here is derived at request time from sessions,
payments and reviews. The one thing that is *stored* is a payout — and that is a
frozen record of what was actually paid, written by `router.record_payout`.

How a month's pay is worked out (`compute_earnings`):

    fixed        the coach's monthly `salary`
    hourly       `hourly_rate` × hours of sessions marked completed in the month
    commission   `commission_pct` of the fees *collected* in the month on their students
    hybrid       `salary` plus the commission

"Collected" means payments received in the month, not fees invoiced — a coach is not
owed commission on money the academy has not yet been paid. "Their students" means
enrolments attributed to the coach: the enrolment's own coach, or the batch's coach
for enrolments that predate coaches being recorded per student.

A salary accrues only while it is owed. Not for months before the coach started
(`joining_date`, else the day their record was made) — otherwise adding a coach today
would show six months of unpaid salary — and not while they are inactive, or an
archived coach would be "due" every month for ever. Hours and commission need no such
rule: they come from sessions and payments that actually happened, so a coach who has
left is still owed for what they taught or collected before going. A coach's first
month is paid in full; part-months are for the bonus/deduction field, not a hidden
proration rule.

Months are the academy's own calendar months in its own timezone, so a session at
23:30 on the last evening belongs to that month, not the next.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Sequence
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.academy import insights
from app.modules.academy.models import (
    ATTENDED,
    COUNTED,
    Attendance,
    AttendanceStatus,
    Batch,
    Coach,
    CoachingSession,
    CoachPayout,
    CoachReview,
    CoachStatus,
    EnrollmentStatus,
    PayModel,
    Program,
    SessionStatus,
    StudentEnrollment,
    StudentStatus,
)
from app.modules.academy.schemas import (
    CoachBatchRow,
    CoachEarnings,
    CoachOut,
    CoachPay,
    CoachPayoutOut,
    CoachProfile,
    CoachReviewOut,
    CoachStats,
    EarningLine,
    MonthPoint,
    SessionBrief,
)
from app.modules.booking.pricing import money, percent
from app.modules.finance.models import Invoice, Payment, PaymentState

HUNDRED = Decimal("100")
SIXTY = Decimal("60")

#: How far back the profile's trend lines go.
TREND_MONTHS = 6
#: Students shown on a coach's profile. A coach with more has the Students tab,
#: filtered, for the rest.
PROFILE_STUDENT_LIMIT = 100
PROFILE_REVIEW_LIMIT = 30


# ── Months ──────────────────────────────────────────────────────────────────


def month_start(on: date) -> date:
    return on.replace(day=1)


def next_month(first: date) -> date:
    return (first.replace(day=28) + timedelta(days=4)).replace(day=1)


def previous_month(first: date) -> date:
    return (first - timedelta(days=1)).replace(day=1)


def parse_month(value: str) -> date:
    """"2026-09" → 2026-09-01. The schema's pattern has already vetted the shape."""
    year, month = value.split("-")
    return date(int(year), int(month), 1)


def month_label(first: date) -> str:
    return f"{first.year:04d}-{first.month:02d}"


def bounds(first: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    """The month as a half-open [start, end) pair of timezone-aware instants."""
    return (
        datetime.combine(first, time.min, tzinfo=tz),
        datetime.combine(next_month(first), time.min, tzinfo=tz),
    )


# ── Raw measurements ────────────────────────────────────────────────────────


async def session_totals(
    db: AsyncSession,
    coach_ids: Sequence[uuid.UUID],
    start: datetime,
    end: datetime,
) -> dict[uuid.UUID, tuple[int, int, int]]:
    """(completed, completed minutes, cancelled) per coach within [start, end)."""
    if not coach_ids:
        return {}
    rows = (
        await db.execute(
            select(
                CoachingSession.coach_id,
                func.count(CoachingSession.id).filter(
                    CoachingSession.status == SessionStatus.COMPLETED
                ),
                func.coalesce(
                    func.sum(CoachingSession.duration_min).filter(
                        CoachingSession.status == SessionStatus.COMPLETED
                    ),
                    0,
                ),
                func.count(CoachingSession.id).filter(
                    CoachingSession.status == SessionStatus.CANCELLED
                ),
            )
            .where(
                CoachingSession.coach_id.in_(list(coach_ids)),
                CoachingSession.starts_at >= start,
                CoachingSession.starts_at < end,
            )
            .group_by(CoachingSession.coach_id)
        )
    ).all()
    return {r[0]: (int(r[1]), int(r[2]), int(r[3])) for r in rows}


async def fees_collected(
    db: AsyncSession,
    coach_ids: Sequence[uuid.UUID],
    start: datetime,
    end: datetime,
) -> dict[uuid.UUID, Decimal]:
    """Fees received in [start, end) on each coach's students."""
    if not coach_ids:
        return {}
    owner = func.coalesce(StudentEnrollment.coach_id, Batch.coach_id)
    rows = (
        await db.execute(
            select(owner, func.coalesce(func.sum(Payment.amount), 0))
            .select_from(Payment)
            .join(Invoice, Payment.invoice_id == Invoice.id)
            .join(StudentEnrollment, Invoice.student_enrollment_id == StudentEnrollment.id)
            .join(Batch, StudentEnrollment.batch_id == Batch.id)
            .where(
                Payment.state == PaymentState.CAPTURED,
                Payment.received_at >= start,
                Payment.received_at < end,
                owner.in_(list(coach_ids)),
            )
            .group_by(owner)
        )
    ).all()
    return {r[0]: money(r[1] or 0) for r in rows}


# ── Earnings ────────────────────────────────────────────────────────────────


def _rupees(value: Decimal) -> str:
    return f"₹{value:,.2f}".replace(".00", "")


def compute_earnings(
    coach: Coach,
    *,
    period: date,
    sessions: int,
    minutes: int,
    fees: Decimal,
    salary_accrues: bool = True,
) -> dict:
    """Pure arithmetic: a coach's terms and a month's measurements → the month's pay.

    Separate from the queries so the rules can be tested without a database, and so
    the payout endpoint and the payroll screen are provably using the same numbers.
    """
    model = coach.pay_model
    hours = (Decimal(minutes) / SIXTY).quantize(Decimal("0.01"))
    pct = Decimal(coach.commission_pct or 0)

    base = Decimal("0")
    commission = Decimal("0")
    lines: list[EarningLine] = []

    if model in (PayModel.FIXED, PayModel.HYBRID) and salary_accrues:
        base = money(coach.salary)
        lines.append(EarningLine(label="Fixed salary", detail="Monthly", amount=base))

    if model is PayModel.HOURLY:
        rate = Decimal(coach.hourly_rate or 0)
        base = money(rate * Decimal(minutes) / SIXTY)
        lines.append(
            EarningLine(
                label="Hourly pay",
                detail=f"{hours} h × {_rupees(rate)}/h across {sessions} completed sessions",
                amount=base,
            )
        )

    if model in (PayModel.COMMISSION, PayModel.HYBRID):
        commission = money(fees * pct / HUNDRED)
        lines.append(
            EarningLine(
                label="Commission",
                detail=f"{pct.normalize():f}% of {_rupees(fees)} collected",
                amount=commission,
            )
        )

    return {
        "coach_id": coach.id,
        "period": period,
        "pay_model": model,
        "sessions": sessions,
        "hours": hours,
        "fees_collected": fees,
        "commission_pct": pct,
        "base_amount": base,
        "commission_amount": commission,
        "gross": base + commission,
        "lines": lines,
    }


def salary_accrues(coach: Coach, period: date, tz: ZoneInfo) -> bool:
    """Whether a fixed salary is owed for this month. See the module docstring."""
    if coach.status is CoachStatus.INACTIVE:
        return False
    started = coach.joining_date or coach.created_at.astimezone(tz).date()
    return period >= month_start(started)


async def earnings_for(
    db: AsyncSession, coaches: Sequence[Coach], period: date, tz: ZoneInfo
) -> dict[uuid.UUID, CoachEarnings]:
    """Earnings for each coach for one month, with the payout if it has been made."""
    ids = [c.id for c in coaches]
    start, end = bounds(period, tz)
    totals = await session_totals(db, ids, start, end)
    fees = await fees_collected(db, ids, start, end)
    payouts = {
        p.coach_id: p
        for p in (
            await db.execute(
                select(CoachPayout).where(
                    CoachPayout.period == period, CoachPayout.coach_id.in_(ids or [uuid.uuid4()])
                )
            )
        ).scalars()
    }

    out: dict[uuid.UUID, CoachEarnings] = {}
    for coach in coaches:
        done, minutes, _cancelled = totals.get(coach.id, (0, 0, 0))
        data = compute_earnings(
            coach,
            period=period,
            sessions=done,
            minutes=minutes,
            fees=fees.get(coach.id, Decimal("0")),
            salary_accrues=salary_accrues(coach, period, tz),
        )
        payout = payouts.get(coach.id)
        data["payout"] = CoachPayoutOut.model_validate(payout) if payout else None
        data["status"] = "paid" if payout else ("due" if data["gross"] > 0 else "nothing")
        out[coach.id] = CoachEarnings(**data)
    return out


# ── Profile ─────────────────────────────────────────────────────────────────


def redact_pay(out: CoachOut) -> CoachOut:
    """Strip the money fields. Reception can open a coach; it cannot read their pay."""
    return out.model_copy(
        update={
            "salary": Decimal("0"),
            "hourly_rate": Decimal("0"),
            "commission_pct": Decimal("0"),
        }
    )


async def _batch_rows(db: AsyncSession, coach: Coach, since: datetime) -> list[CoachBatchRow]:
    batches = (
        (await db.execute(select(Batch).where(Batch.coach_id == coach.id).order_by(Batch.name)))
        .scalars()
        .all()
    )
    if not batches:
        return []
    ids = [b.id for b in batches]

    programs = {
        p.id: p.name
        for p in (
            await db.execute(select(Program).where(Program.id.in_({b.program_id for b in batches})))
        ).scalars()
    }
    enrolled = {
        r[0]: int(r[1])
        for r in (
            await db.execute(
                select(StudentEnrollment.batch_id, func.count(StudentEnrollment.id))
                .where(
                    StudentEnrollment.batch_id.in_(ids),
                    StudentEnrollment.status == EnrollmentStatus.ACTIVE,
                )
                .group_by(StudentEnrollment.batch_id)
            )
        ).all()
    }
    attendance = {
        r[0]: (int(r[1]), int(r[2]))
        for r in (
            await db.execute(
                select(
                    CoachingSession.batch_id,
                    func.count(Attendance.id),
                    func.count(Attendance.id).filter(Attendance.status.in_(ATTENDED)),
                )
                .select_from(Attendance)
                .join(CoachingSession, Attendance.session_id == CoachingSession.id)
                .where(
                    CoachingSession.batch_id.in_(ids),
                    CoachingSession.starts_at >= since,
                    Attendance.status.in_(COUNTED),
                )
                .group_by(CoachingSession.batch_id)
            )
        ).all()
    }

    rows = []
    for b in batches:
        marked, present = attendance.get(b.id, (0, 0))
        rows.append(
            CoachBatchRow(
                id=b.id,
                name=b.name,
                sport_id=b.sport_id,
                program_name=programs.get(b.program_id),
                schedule=b.schedule,
                time_label=b.time_label,
                location=b.location,
                status=b.status,
                capacity=b.capacity,
                enrolled=enrolled.get(b.id, 0),
                attendance_pct=percent(present / marked * 100) if marked else None,
            )
        )
    return rows


async def _session_briefs(
    db: AsyncSession, coach_id: uuid.UUID, *, upcoming: bool, now: datetime, limit: int
) -> list[SessionBrief]:
    stmt = select(CoachingSession).where(CoachingSession.coach_id == coach_id)
    if upcoming:
        stmt = stmt.where(
            CoachingSession.starts_at >= now, CoachingSession.status != SessionStatus.CANCELLED
        ).order_by(CoachingSession.starts_at)
    else:
        stmt = stmt.where(CoachingSession.starts_at < now).order_by(CoachingSession.starts_at.desc())
    sessions = (await db.execute(stmt.limit(limit))).scalars().all()
    if not sessions:
        return []

    counts = {
        r[0]: (int(r[1]), int(r[2]))
        for r in (
            await db.execute(
                select(
                    Attendance.session_id,
                    func.count(Attendance.id),
                    func.count(Attendance.id).filter(Attendance.status.in_(ATTENDED)),
                )
                .where(
                    Attendance.session_id.in_([s.id for s in sessions]),
                    Attendance.status.in_(COUNTED),
                )
                .group_by(Attendance.session_id)
            )
        ).all()
    }
    return [
        SessionBrief(
            id=s.id,
            batch_id=s.batch_id,
            batch_name=s.batch_name,
            starts_at=s.starts_at,
            ends_at=s.ends_at,
            status=s.status,
            marked=counts.get(s.id, (0, 0))[0],
            present=counts.get(s.id, (0, 0))[1],
        )
        for s in sessions
    ]


async def build_profile(
    db: AsyncSession,
    coach: Coach,
    coach_out: CoachOut,
    *,
    tz: ZoneInfo,
    now: datetime,
    today: date,
    with_pay: bool,
) -> CoachProfile:
    """Everything a coach's page shows. `with_pay` is False for anyone below manager,
    and then no money — not even a salary — leaves the server."""
    since = now - timedelta(days=insights.WINDOW_DAYS)

    # Their students, through the same machinery as the Students tab so the two
    # screens can never disagree about someone's attendance or fee state.
    roster = await insights.roster(
        db,
        insights.RosterFilters(coach_id=coach.id, status=StudentStatus.ACTIVE),
        today=today,
        now=now,
    )
    rated = [float(r.rating) for r in roster if r.rating and float(r.rating) > 0]
    attended = [r.attendance_pct for r in roster if r.attendance_pct is not None]

    batches = await _batch_rows(db, coach, since)

    done, minutes, cancelled = (await session_totals(db, [coach.id], since, now + timedelta(days=1))).get(
        coach.id, (0, 0, 0)
    )

    reviews = (
        (
            await db.execute(
                select(CoachReview)
                .where(CoachReview.coach_id == coach.id)
                .order_by(CoachReview.reviewed_on.desc(), CoachReview.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    breakdown = [0, 0, 0, 0, 0]
    for r in reviews:
        breakdown[r.rating - 1] += 1

    stats = CoachStats(
        students=len(roster),
        batches=sum(1 for b in batches if b.status.value != "completed"),
        sessions_completed_30d=done,
        sessions_cancelled_30d=cancelled,
        hours_30d=(Decimal(minutes) / SIXTY).quantize(Decimal("0.01")),
        avg_student_rating=round(sum(rated) / len(rated), 1) if rated else None,
        student_attendance_pct=round(sum(attended) / len(attended), 1) if attended else None,
        review_count=len(reviews),
        rating=coach.rating,
    )

    # Trend: the last few calendar months, oldest first.
    months: list[date] = []
    cursor = month_start(today)
    for _ in range(TREND_MONTHS):
        months.append(cursor)
        cursor = previous_month(cursor)
    months.reverse()

    by_month_reviews: dict[date, list[int]] = {}
    for r in reviews:
        by_month_reviews.setdefault(month_start(r.reviewed_on), []).append(r.rating)

    paid_by_month: dict[date, Decimal] = {}
    payouts: list[CoachPayout] = []
    if with_pay:
        payouts = list(
            (
                await db.execute(
                    select(CoachPayout)
                    .where(CoachPayout.coach_id == coach.id)
                    .order_by(CoachPayout.period.desc())
                )
            ).scalars()
        )
        paid_by_month = {p.period: p.total for p in payouts}

    monthly: list[MonthPoint] = []
    current_earnings: CoachEarnings | None = None
    for first in months:
        start, end = bounds(first, tz)
        m_done, m_minutes, _ = (await session_totals(db, [coach.id], start, end)).get(
            coach.id, (0, 0, 0)
        )
        ratings = by_month_reviews.get(first)
        point = MonthPoint(
            month=month_label(first),
            sessions=m_done,
            hours=(Decimal(m_minutes) / SIXTY).quantize(Decimal("0.01")),
            rating=round(sum(ratings) / len(ratings), 2) if ratings else None,
        )
        if with_pay:
            earned = (await earnings_for(db, [coach], first, tz))[coach.id]
            point.earned = earned.payout.total if earned.payout else earned.gross
            point.paid = paid_by_month.get(first)
            if first == month_start(today):
                current_earnings = earned
        monthly.append(point)

    pay = None
    if with_pay:
        assert current_earnings is not None
        pay = CoachPay(
            pay_model=coach.pay_model,
            salary=coach.salary,
            hourly_rate=coach.hourly_rate,
            commission_pct=coach.commission_pct,
            current=current_earnings,
            payouts=[CoachPayoutOut.model_validate(p) for p in payouts],
            paid_to_date=sum((p.total for p in payouts), Decimal("0")),
        )

    return CoachProfile(
        coach=coach_out if with_pay else redact_pay(coach_out),
        stats=stats,
        batches=batches,
        students=roster[:PROFILE_STUDENT_LIMIT],
        students_total=len(roster),
        upcoming=await _session_briefs(db, coach.id, upcoming=True, now=now, limit=8),
        recent=await _session_briefs(db, coach.id, upcoming=False, now=now, limit=8),
        reviews=[CoachReviewOut.model_validate(r) for r in reviews[:PROFILE_REVIEW_LIMIT]],
        rating_breakdown=breakdown,
        monthly=monthly,
        pay=pay,
    )
