"""Academy domain logic."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Any, Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, InvalidInputError, NotFoundError
from app.modules.academy.models import (
    LEVEL_ORDER,
    Attendance,
    AttendanceStatus,
    Batch,
    Coach,
    CoachingSession,
    CoachStatus,
    EnrollmentStatus,
    Program,
    SkillLevel,
    Student,
    StudentEnrollment,
    StudentPromotion,
    StudentSportLevel,
)
from app.modules.booking.pricing import money, percent
from app.modules.finance.models import CounterKind, Invoice, Payment
from app.modules.finance.service import add_months, create_invoice

DURATION_MONTHS = {"1m": 1, "3m": 3, "6m": 6, "12m": 12}


async def batch_enrolment_counts(
    session: AsyncSession, batch_ids: Sequence[uuid.UUID] | None = None
) -> dict[uuid.UUID, int]:
    """How many students are actually enrolled in each batch.

    A query rather than a stored counter: the two can disagree, and the version that
    disagrees is the one the capacity check reads — which then admits a student into
    a batch that is already full.
    """
    stmt = (
        select(StudentEnrollment.batch_id, func.count(StudentEnrollment.id))
        .where(StudentEnrollment.status == EnrollmentStatus.ACTIVE)
        .group_by(StudentEnrollment.batch_id)
    )
    if batch_ids is not None:
        stmt = stmt.where(StudentEnrollment.batch_id.in_(list(batch_ids)))
    return {row[0]: int(row[1]) for row in (await session.execute(stmt)).all()}


def assert_age_fits(student: Student, program: Program, *, on: date) -> None:
    """Refuse to put a student in a programme their age does not admit.

    Checked at the **start of the term**, not today: a sixteen-year-old signing up
    in December for a January term that begins after their birthday is enrolling as
    a seventeen-year-old, and the kids' batch is the wrong answer for them.

    The flip side is that this never runs again mid-term. A child who turns
    seventeen in week three finishes the course they paid for — the alternative is
    evicting a kid from their class on their birthday, which no academy would do
    and no parent would forgive. The next renewal is where it comes up, and that is
    a conversation staff can have in advance.

    A programme with no band set is unrestricted, so every programme that existed
    before age bands keeps working exactly as it did.
    """
    bounds = program.age_bounds()
    if bounds is None:
        return

    low, high = bounds
    age = student.age_on(on)
    if age is None:
        raise InvalidInputError(
            f"{student.name} needs a date of birth before they can join "
            f"'{program.name}', which is limited to ages {low}–{high}.",
            details={"field": "date_of_birth", "student_id": str(student.id)},
        )

    if not (low <= age <= high):
        band = program.age_band.value if program.age_band else "age-restricted"
        raise InvalidInputError(
            f"{student.name} is {age} at the start of this term. "
            f"'{program.name}' is a {band} programme, for ages {low}–{high}.",
            details={
                "student_age": age,
                "age_min": low,
                "age_max": high,
                "age_band": program.age_band.value if program.age_band else None,
                "program_id": str(program.id),
            },
        )


async def enrol_student(
    session: AsyncSession,
    *,
    student: Student,
    batch: Batch,
    duration: str,
    start_date: date,
    discount: Decimal = Decimal("0"),
) -> tuple[StudentEnrollment, Invoice]:
    """Place a student in a batch for a paid term, and raise the fee invoice.

    Capacity is checked against live enrolments immediately before inserting. Two
    reception staff enrolling the last place simultaneously could still both pass
    this check — the partial unique index prevents the duplicate *enrolment*, and at
    academy scale one over-subscribed batch is a conversation, not a corruption.
    """
    counts = await batch_enrolment_counts(session, [batch.id])
    if counts.get(batch.id, 0) >= batch.capacity:
        raise ConflictError(
            f"'{batch.name}' is full ({batch.capacity} places).",
            details={"batch_id": str(batch.id), "capacity": batch.capacity},
        )

    program = await session.get(Program, batch.program_id)
    if program is None:
        raise NotFoundError("The programme behind this batch no longer exists.")

    # Before the invoice, so a refused enrolment never leaves a fee behind.
    assert_age_fits(student, program, on=start_date)

    fee = program.fee_for(duration)
    enrollment = StudentEnrollment(
        student_id=student.id,
        program_id=program.id,
        batch_id=batch.id,
        coach_id=batch.coach_id,
        duration=duration,
        start_date=start_date,
        renewal_date=add_months(start_date, DURATION_MONTHS[duration]),
        total_fee=money(fee),
        status=EnrollmentStatus.ACTIVE,
    )
    session.add(enrollment)
    await session.flush()

    invoice = await create_invoice(
        session,
        customer_id=student.customer_id,
        customer_name=student.parent_name or student.name,
        items=[
            {
                "description": f"{program.name} · {duration} · {student.name}",
                "qty": 1,
                "rate": float(fee),
                "amount": float(fee),
            }
        ],
        discount=discount,
        student_enrollment_id=enrollment.id,
        due_date=start_date,
    )
    return enrollment, invoice


async def levels_for(session: AsyncSession, student_id: uuid.UUID) -> dict[uuid.UUID, SkillLevel]:
    """This student's standing in every sport they have been assessed in."""
    rows = (
        await session.execute(
            select(StudentSportLevel).where(StudentSportLevel.student_id == student_id)
        )
    ).scalars()
    return {row.sport_id: row.level for row in rows}


async def set_level(
    session: AsyncSession,
    *,
    student: Student,
    sport_id: uuid.UUID,
    level: SkillLevel,
    assessed_on: date,
    assessed_by: str | None = None,
    note: str | None = None,
) -> StudentPromotion:
    """Record where a student now stands, and the move that got them there.

    Writes both halves in one go: the current standing staff read, and the event a
    parent is shown. Re-assessing at the level they are already at is allowed and
    still writes an event — "reviewed in March, staying at intermediate" is a real
    thing a coach decides, and losing it would make the ladder look untended.
    """
    existing = (
        await session.execute(
            select(StudentSportLevel).where(
                StudentSportLevel.student_id == student.id,
                StudentSportLevel.sport_id == sport_id,
            )
        )
    ).scalar_one_or_none()

    promotion = StudentPromotion(
        student_id=student.id,
        sport_id=sport_id,
        from_level=existing.level if existing else None,
        to_level=level,
        assessed_on=assessed_on,
        assessed_by=assessed_by,
        note=note,
    )
    session.add(promotion)

    if existing is None:
        session.add(
            StudentSportLevel(
                student_id=student.id,
                sport_id=sport_id,
                level=level,
                assessed_on=assessed_on,
            )
        )
    else:
        existing.level = level
        existing.assessed_on = assessed_on

    await session.flush()
    return promotion


def level_gap(student_level: SkillLevel | None, program_level: SkillLevel | None) -> int | None:
    """How far a programme sits above the student, in rungs. None if not comparable.

    Positive means the programme is harder than where they stand. Deliberately
    returned rather than raised on: unlike age, a level mismatch is a coaching
    judgment — putting a strong beginner into an intermediate batch is how anyone
    ever improves. The caller surfaces this as a warning, never a refusal.
    """
    if student_level is None or program_level is None:
        return None
    return LEVEL_ORDER[program_level] - LEVEL_ORDER[student_level]


async def current_enrollment(
    session: AsyncSession, student_id: uuid.UUID
) -> StudentEnrollment | None:
    return (
        await session.execute(
            select(StudentEnrollment)
            .where(
                StudentEnrollment.student_id == student_id,
                StudentEnrollment.status == EnrollmentStatus.ACTIVE,
            )
            .order_by(StudentEnrollment.start_date.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def enrollment_fee_paid(session: AsyncSession, enrollment_id: uuid.UUID) -> Decimal:
    """Fees actually received against an enrolment — summed, never stored.

    `Student.pendingFee` in the frontend is this subtracted from the total; storing
    it would go stale on every payment.
    """
    total = await session.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0))
        .select_from(Payment)
        .join(Invoice, Payment.invoice_id == Invoice.id)
        .where(Invoice.student_enrollment_id == enrollment_id)
    )
    return money(total or 0)


async def attendance_pct(session: AsyncSession, student_id: uuid.UUID) -> float:
    """Share of completed sessions the student was present for.

    Only sessions that actually have a mark count towards the denominator, so a
    batch whose register has not been taken yet does not drag every student's
    percentage down.
    """
    row = (
        await session.execute(
            select(
                func.count(Attendance.id),
                func.count(Attendance.id).filter(
                    Attendance.status.in_([AttendanceStatus.PRESENT, AttendanceStatus.LATE])
                ),
            ).where(
                Attendance.student_id == student_id,
                Attendance.status != AttendanceStatus.NOT_STARTED,
            )
        )
    ).one()
    total, present = int(row[0]), int(row[1])
    return percent(present / total * 100) if total else 0.0


async def session_attendance_counts(
    session: AsyncSession, session_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, int, int]]:
    """(marked, present, absent) per session — the frontend's Session counters."""
    if not session_ids:
        return {}
    rows = (
        await session.execute(
            select(
                Attendance.session_id,
                func.count(Attendance.id),
                func.count(Attendance.id).filter(
                    Attendance.status.in_([AttendanceStatus.PRESENT, AttendanceStatus.LATE])
                ),
                func.count(Attendance.id).filter(Attendance.status == AttendanceStatus.ABSENT),
            )
            .where(Attendance.session_id.in_(list(session_ids)))
            .group_by(Attendance.session_id)
        )
    ).all()
    return {row[0]: (int(row[1]), int(row[2]), int(row[3])) for row in rows}


async def coach_workload(session: AsyncSession) -> dict[uuid.UUID, tuple[int, int]]:
    """(active batches, students) per coach — the frontend's derived coach counters."""
    batches = (
        await session.execute(
            select(Batch.coach_id, func.count(Batch.id))
            .where(Batch.coach_id.isnot(None))
            .group_by(Batch.coach_id)
        )
    ).all()
    students = (
        await session.execute(
            select(StudentEnrollment.coach_id, func.count(StudentEnrollment.id))
            .where(
                StudentEnrollment.coach_id.isnot(None),
                StudentEnrollment.status == EnrollmentStatus.ACTIVE,
            )
            .group_by(StudentEnrollment.coach_id)
        )
    ).all()

    batch_counts = {row[0]: int(row[1]) for row in batches}
    student_counts = {row[0]: int(row[1]) for row in students}
    return {
        coach_id: (batch_counts.get(coach_id, 0), student_counts.get(coach_id, 0))
        for coach_id in set(batch_counts) | set(student_counts)
    }


async def coach_sport_map(session: AsyncSession) -> dict[uuid.UUID, list[uuid.UUID]]:
    from app.modules.academy.models import CoachSport

    rows = (await session.execute(select(CoachSport.coach_id, CoachSport.sport_id))).all()
    mapping: dict[uuid.UUID, list[uuid.UUID]] = {}
    for coach_id, sport_id in rows:
        mapping.setdefault(coach_id, []).append(sport_id)
    return mapping
