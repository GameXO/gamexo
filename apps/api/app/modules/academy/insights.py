"""Student insights: the roster, one student's profile, and who needs attention.

Everything here is *derived* — attendance, fee state, standing and the attention
flags are computed from registers, enrolments and payments at request time and never
stored. A stored "attendance %" is wrong the moment the next register is marked, and
nothing would be responsible for correcting it.

The metrics are computed in bulk (a handful of grouped queries for any number of
students) and filtered, sorted and paged in Python. That is deliberate at this
scale — an academy has hundreds of students, not millions — and it keeps filters like
"fee due" and "low attendance" honest, since they depend on the derived figures and
could not be expressed in the list query anyway. If a single academy ever outgrows
that, the place to push work down into SQL is `attendance_stats`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Sequence
from zoneinfo import ZoneInfo

from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.academy.models import (
    ATTENDED,
    COUNTED,
    Attendance,
    AttendanceStatus,
    Batch,
    Coach,
    CoachingSession,
    DeliveryType,
    EnrollmentStatus,
    Program,
    SessionStatus,
    SkillLevel,
    Student,
    StudentAssessment,
    StudentGuardian,
    StudentEnrollment,
    StudentPromotion,
    StudentSportLevel,
    StudentStatus,
)
from app.modules.academy.schemas import (
    AssessmentOut,
    AttendanceMonth,
    AttendanceSummary,
    AttentionCounts,
    AttentionItem,
    ActiveCoaching,
    AttentionOut,
    FeeHistoryRow,
    GuardianOut,
    Lifetime,
    NextClass,
    FeeSummary,
    LevelEntry,
    PromotionOut,
    RecentSession,
    SkillScore,
    Standing,
    StudentPersonal,
    StudentProfile,
    StudentRow,
)
from app.modules.booking.models import Court
from app.modules.booking.pricing import money, percent
from app.modules.finance.models import Invoice, Payment

# ── Thresholds ──────────────────────────────────────────────────────────────
#
# Named and in one place because they are policy, not mechanism: the day an academy
# wants "low attendance" to mean 70%, this is the line that changes.

WINDOW_DAYS = 30
#: Fewer marked sessions than this and a percentage is noise — one absence in two
#: sessions is 50%, and flagging a brand-new joiner for it is how a flag stops being
#: trusted.
MIN_SESSIONS_FOR_FLAG = 4
LOW_ATTENDANCE_PCT = 60.0
REPEAT_ABSENCE_COUNT = 3
REPEAT_ABSENCE_DAYS = 14
RENEWAL_WINDOW_DAYS = 7
PROMOTION_MIN_RATING = Decimal("8")
PROMOTION_MIN_ATTENDANCE = 80.0
PROMOTION_MIN_DAYS_AT_LEVEL = 45

#: Standing = 60% rating + 40% attendance. See `schemas.Standing`.
RATING_WEIGHT = 0.6
ATTENDANCE_WEIGHT = 0.4

_PRESENT = ATTENDED


# ── Bulk metrics ────────────────────────────────────────────────────────────


@dataclass(slots=True)
class AttStats:
    total: int = 0
    present: int = 0
    total30: int = 0
    present30: int = 0
    absent14: int = 0

    @property
    def overall_pct(self) -> float | None:
        return percent(self.present / self.total * 100) if self.total else None

    @property
    def pct30(self) -> float | None:
        return percent(self.present30 / self.total30 * 100) if self.total30 else None


async def attendance_stats(
    db: AsyncSession, student_ids: Sequence[uuid.UUID], *, now: datetime
) -> dict[uuid.UUID, AttStats]:
    """Marked-session counts per student, overall and over the recent windows.

    Sessions with no mark yet are ignored, so a register that has not been taken does
    not drag everyone's percentage down.
    """
    if not student_ids:
        return {}
    since30 = now - timedelta(days=WINDOW_DAYS)
    since14 = now - timedelta(days=REPEAT_ABSENCE_DAYS)
    in_present = Attendance.status.in_(ATTENDED)
    recent30 = CoachingSession.starts_at >= since30

    rows = (
        await db.execute(
            select(
                Attendance.student_id,
                func.count(Attendance.id),
                func.count(Attendance.id).filter(in_present),
                func.count(Attendance.id).filter(recent30),
                func.count(Attendance.id).filter(recent30, in_present),
                func.count(Attendance.id).filter(
                    CoachingSession.starts_at >= since14,
                    Attendance.status == AttendanceStatus.ABSENT,
                ),
            )
            .join(CoachingSession, CoachingSession.id == Attendance.session_id)
            .where(
                Attendance.student_id.in_(list(student_ids)),
                # Excused absences are left out entirely: telling the academy you
                # will be away does not lower your percentage.
                Attendance.status.in_(COUNTED),
            )
            .group_by(Attendance.student_id)
        )
    ).all()
    return {
        r[0]: AttStats(total=int(r[1]), present=int(r[2]), total30=int(r[3]), present30=int(r[4]), absent14=int(r[5]))
        for r in rows
    }


async def active_enrollments(
    db: AsyncSession, student_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, StudentEnrollment]:
    """Each student's newest active enrolment."""
    if not student_ids:
        return {}
    rows = (
        (
            await db.execute(
                select(StudentEnrollment)
                .where(
                    StudentEnrollment.student_id.in_(list(student_ids)),
                    StudentEnrollment.status == EnrollmentStatus.ACTIVE,
                )
                .order_by(StudentEnrollment.start_date.desc(), StudentEnrollment.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    out: dict[uuid.UUID, StudentEnrollment] = {}
    for row in rows:
        out.setdefault(row.student_id, row)  # first seen is the newest
    return out


async def fees_paid(
    db: AsyncSession, enrollment_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, Decimal]:
    """Fees received per enrolment — summed from payments, never stored."""
    if not enrollment_ids:
        return {}
    rows = (
        await db.execute(
            select(Invoice.student_enrollment_id, func.coalesce(func.sum(Payment.amount), 0))
            .select_from(Payment)
            .join(Invoice, Payment.invoice_id == Invoice.id)
            .where(Invoice.student_enrollment_id.in_(list(enrollment_ids)))
            .group_by(Invoice.student_enrollment_id)
        )
    ).all()
    return {r[0]: money(r[1] or 0) for r in rows}


async def levels_by_student(
    db: AsyncSession, student_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[StudentSportLevel]]:
    if not student_ids:
        return {}
    rows = (
        (
            await db.execute(
                select(StudentSportLevel).where(StudentSportLevel.student_id.in_(list(student_ids)))
            )
        )
        .scalars()
        .all()
    )
    out: dict[uuid.UUID, list[StudentSportLevel]] = {}
    for row in rows:
        out.setdefault(row.student_id, []).append(row)
    return out


def _renewal(enrollment: StudentEnrollment | None, today: date) -> tuple[str, int | None]:
    if enrollment is None:
        return "none", None
    days = (enrollment.renewal_date - today).days
    if days < 0:
        return "lapsed", days
    if days <= RENEWAL_WINDOW_DAYS:
        return "due_soon", days
    return "ok", days


# ── Rows ────────────────────────────────────────────────────────────────────


async def build_rows(
    db: AsyncSession, students: Sequence[Student], *, today: date, now: datetime
) -> list[StudentRow]:
    """Turn students into table rows, with every derived figure computed in bulk."""
    if not students:
        return []
    ids = [s.id for s in students]

    enrollments = await active_enrollments(db, ids)
    enrolment_counts = {
        r[0]: int(r[1])
        for r in (
            await db.execute(
                select(StudentEnrollment.student_id, func.count(StudentEnrollment.id))
                .where(
                    StudentEnrollment.student_id.in_(ids),
                    StudentEnrollment.status == EnrollmentStatus.ACTIVE,
                )
                .group_by(StudentEnrollment.student_id)
            )
        ).all()
    }
    att = await attendance_stats(db, ids, now=now)
    levels = await levels_by_student(db, ids)
    paid = await fees_paid(db, [e.id for e in enrollments.values()])

    program_ids = {e.program_id for e in enrollments.values()}
    batch_ids = {e.batch_id for e in enrollments.values()}
    programs = (
        {p.id: p for p in (await db.execute(select(Program).where(Program.id.in_(program_ids)))).scalars()}
        if program_ids
        else {}
    )
    batches = (
        {b.id: b for b in (await db.execute(select(Batch).where(Batch.id.in_(batch_ids)))).scalars()}
        if batch_ids
        else {}
    )
    coach_ids = {e.coach_id for e in enrollments.values() if e.coach_id} | {
        b.coach_id for b in batches.values() if b.coach_id
    }
    coaches = (
        {c.id: c for c in (await db.execute(select(Coach).where(Coach.id.in_(coach_ids)))).scalars()}
        if coach_ids
        else {}
    )

    rows: list[StudentRow] = []
    for student in students:
        enrollment = enrollments.get(student.id)
        program = programs.get(enrollment.program_id) if enrollment else None
        batch = batches.get(enrollment.batch_id) if enrollment else None
        # The enrolment's own coach wins; a batch's coach is the fallback for the
        # enrolments created before coaches were recorded per student.
        coach_id = (enrollment.coach_id if enrollment else None) or (batch.coach_id if batch else None)
        coach = coaches.get(coach_id) if coach_id else None
        stats = att.get(student.id, AttStats())

        total_fee = enrollment.total_fee if enrollment else Decimal("0")
        pending = money(max(Decimal("0"), total_fee - paid.get(enrollment.id, Decimal("0")))) if enrollment else Decimal("0")
        fee_status = "none" if enrollment is None else ("paid" if pending <= 0 else "due")
        renewal_state, days = _renewal(enrollment, today)

        student_levels = sorted(
            (
                LevelEntry(sport_id=lv.sport_id, level=lv.level, assessed_on=lv.assessed_on)
                for lv in levels.get(student.id, [])
            ),
            key=lambda lv: str(lv.sport_id),
        )

        flags: list[str] = []
        if student.status in (StudentStatus.ACTIVE, StudentStatus.TRIAL):
            if stats.absent14 >= REPEAT_ABSENCE_COUNT:
                flags.append("repeat_absentee")
            if (
                stats.total30 >= MIN_SESSIONS_FOR_FLAG
                and stats.pct30 is not None
                and stats.pct30 < LOW_ATTENDANCE_PCT
            ):
                flags.append("low_attendance")
            if enrollment is not None and days is not None and days <= RENEWAL_WINDOW_DAYS:
                flags.append("renewal_due")
            if _promotion_ready(student, program, levels.get(student.id, []), stats, today):
                flags.append("promotion_ready")

        rows.append(
            StudentRow(
                id=student.id,
                student_no=student.student_no,
                name=student.name,
                photo_url=student.photo_url,
                avatar_initials=student.avatar_initials,
                age=student.age_on(today),
                gender=student.gender,
                parent_name=student.parent_name,
                phone=student.phone,
                status=student.status,
                branch_id=student.branch_id,
                active_enrollments=enrolment_counts.get(student.id, 0),
                program_id=enrollment.program_id if enrollment else None,
                program_name=program.name if program else None,
                sport_id=program.sport_id if program else None,
                batch_id=enrollment.batch_id if enrollment else None,
                batch_name=batch.name if batch else None,
                coach_id=coach_id,
                coach_name=coach.name if coach else None,
                levels=student_levels,
                attendance_pct=stats.pct30,
                attendance_overall_pct=stats.overall_pct,
                sessions_marked_30d=stats.total30,
                rating=student.performance_rating,
                fee_status=fee_status,
                pending_fee=pending,
                renewal_date=enrollment.renewal_date if enrollment else None,
                renewal_state=renewal_state,
                days_to_renewal=days,
                flags=flags,
            )
        )
    return rows


def _promotion_ready(
    student: Student,
    program: Program | None,
    levels: list[StudentSportLevel],
    stats: AttStats,
    today: date,
) -> bool:
    """Strong, consistent, and long enough at the current level to be worth a look.

    Only a *suggestion* for a coach — promotion stays a manager's decision (see
    `promote_student`). A student with no assessed level in their programme's sport
    is skipped: there is no rung to move up from.
    """
    if program is None or program.sport_id is None:
        return False
    current = next((lv for lv in levels if lv.sport_id == program.sport_id), None)
    if current is None or current.level is SkillLevel.ADVANCED:
        return False
    return (
        student.performance_rating >= PROMOTION_MIN_RATING
        and stats.total >= MIN_SESSIONS_FOR_FLAG
        and (stats.overall_pct or 0) >= PROMOTION_MIN_ATTENDANCE
        and (today - current.assessed_on).days >= PROMOTION_MIN_DAYS_AT_LEVEL
    )


# ── Roster ──────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class RosterFilters:
    search: str | None = None
    status: StudentStatus | None = None
    sport_id: uuid.UUID | None = None
    batch_id: uuid.UUID | None = None
    coach_id: uuid.UUID | None = None
    level: SkillLevel | None = None
    fee_status: str | None = None
    attention: str | None = None
    sort: str = "name"
    descending: bool = False


async def roster(
    db: AsyncSession, filters: RosterFilters, *, today: date, now: datetime
) -> list[StudentRow]:
    """Every student matching the filters, sorted — the caller pages the result."""
    stmt = select(Student)

    if filters.status is not None:
        stmt = stmt.where(Student.status == filters.status)
    if filters.search:
        like = f"%{filters.search.strip().lower()}%"
        stmt = stmt.where(
            Student.name.ilike(like)
            | Student.student_no.ilike(like)
            | Student.parent_name.ilike(like)
            | Student.phone.ilike(like)
        )

    # Where they train is a property of the active enrolment, so these three are
    # subqueries over it rather than columns on the student.
    if filters.sport_id or filters.batch_id or filters.coach_id:
        enrolment = (
            select(StudentEnrollment.student_id)
            .join(Program, Program.id == StudentEnrollment.program_id)
            .join(Batch, Batch.id == StudentEnrollment.batch_id)
            .where(StudentEnrollment.status == EnrollmentStatus.ACTIVE)
        )
        if filters.sport_id:
            enrolment = enrolment.where(Program.sport_id == filters.sport_id)
        if filters.batch_id:
            enrolment = enrolment.where(StudentEnrollment.batch_id == filters.batch_id)
        if filters.coach_id:
            enrolment = enrolment.where(
                or_(
                    StudentEnrollment.coach_id == filters.coach_id,
                    and_(StudentEnrollment.coach_id.is_(None), Batch.coach_id == filters.coach_id),
                )
            )
        stmt = stmt.where(Student.id.in_(enrolment))

    if filters.level is not None:
        level_match = select(StudentSportLevel.id).where(
            StudentSportLevel.student_id == Student.id, StudentSportLevel.level == filters.level
        )
        if filters.sport_id:
            level_match = level_match.where(StudentSportLevel.sport_id == filters.sport_id)
        stmt = stmt.where(exists(level_match))

    students = (await db.execute(stmt.order_by(Student.name))).scalars().all()
    rows = await build_rows(db, students, today=today, now=now)

    if filters.fee_status:
        rows = [r for r in rows if r.fee_status == filters.fee_status]
    if filters.attention:
        rows = [r for r in rows if filters.attention in r.flags]

    return _sorted(rows, filters.sort, filters.descending)


def _sorted(rows: list[StudentRow], key: str, descending: bool) -> list[StudentRow]:
    """Sort, with rows that have no value for the key always last.

    "No data" must never lead the list: sorting attendance ascending would otherwise
    open with every brand-new joiner, who have no attendance to speak of, ahead of the
    students who are actually missing classes.
    """
    getters = {
        "name": lambda r: r.name.lower(),
        "attendance": lambda r: r.attendance_pct,
        "rating": lambda r: float(r.rating),
        "renewal": lambda r: r.renewal_date,
    }
    get = getters.get(key, getters["name"])
    present = [r for r in rows if get(r) is not None]
    missing = [r for r in rows if get(r) is None]
    present.sort(key=get, reverse=descending)
    return present + missing


# ── Profile ─────────────────────────────────────────────────────────────────


def _skills(raw: list[dict] | None) -> list[SkillScore]:
    return [SkillScore(name=s["name"], score=int(s["score"])) for s in (raw or [])]


async def _standing(
    db: AsyncSession, student: Student, row: StudentRow, *, now: datetime
) -> Standing:
    if row.batch_id is None:
        return Standing(batch_name=None, batch_rank=None, batch_size=0, score=None)

    mates = (
        (
            await db.execute(
                select(Student)
                .join(StudentEnrollment, StudentEnrollment.student_id == Student.id)
                .where(
                    StudentEnrollment.batch_id == row.batch_id,
                    StudentEnrollment.status == EnrollmentStatus.ACTIVE,
                    Student.status == StudentStatus.ACTIVE,
                )
            )
        )
        .scalars()
        .unique()
        .all()
    )
    stats = await attendance_stats(db, [m.id for m in mates], now=now)

    def score(s: Student) -> float:
        attendance = stats.get(s.id, AttStats()).overall_pct or 0.0
        return RATING_WEIGHT * float(s.performance_rating) * 10 + ATTENDANCE_WEIGHT * attendance

    scores = {m.id: score(m) for m in mates}
    mine = scores.get(student.id)
    if mine is None:  # paused or inactive students are not ranked
        return Standing(batch_name=row.batch_name, batch_rank=None, batch_size=len(mates), score=None)
    # Ties share a rank, as in any league table: two equal scores are both second.
    rank = 1 + sum(1 for other in scores.values() if other > mine)
    return Standing(batch_name=row.batch_name, batch_rank=rank, batch_size=len(mates), score=percent(mine))


async def build_profile(
    db: AsyncSession, student: Student, *, today: date, now: datetime, tz: ZoneInfo
) -> StudentProfile:
    row = (await build_rows(db, [student], today=today, now=now))[0]

    marks = (
        await db.execute(
            select(Attendance.status, CoachingSession.id, CoachingSession.starts_at, CoachingSession.batch_name)
            .join(CoachingSession, CoachingSession.id == Attendance.session_id)
            .where(Attendance.student_id == student.id, Attendance.status != AttendanceStatus.NOT_STARTED)
            .order_by(CoachingSession.starts_at.desc())
        )
    ).all()

    # Excused marks are shown in the recent list but left out of every percentage and
    # of the streak: they neither count for nor against the student.
    counted = [m for m in marks if m[0] in COUNTED]
    present = sum(1 for m in counted if m[0] is AttendanceStatus.PRESENT)
    late = sum(1 for m in counted if m[0] is AttendanceStatus.LATE)
    absent = sum(1 for m in counted if m[0] is AttendanceStatus.ABSENT)
    excused = sum(1 for m in marks if m[0] is AttendanceStatus.EXCUSED)
    makeups = sum(1 for m in marks if m[0] is AttendanceStatus.MAKEUP)
    streak = 0
    for m in counted:  # newest first; stops at the first miss
        if m[0] not in ATTENDED:
            break
        streak += 1

    reasons: dict[str, int] = {}
    for reason in (
        await db.execute(
            select(Attendance.reason, func.count(Attendance.id))
            .where(
                Attendance.student_id == student.id,
                Attendance.reason.isnot(None),
                Attendance.status.in_((AttendanceStatus.ABSENT, AttendanceStatus.EXCUSED)),
            )
            .group_by(Attendance.reason)
        )
    ).all():
        reasons[reason[0].value] = int(reason[1])

    # Last six calendar months in the academy's own timezone — bucketing in UTC
    # would file a late-evening session under the wrong month at the boundary.
    months: list[str] = []
    cursor = today.replace(day=1)
    for _ in range(6):
        months.append(cursor.strftime("%Y-%m"))
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    months.reverse()
    buckets: dict[str, list[int]] = {m: [0, 0] for m in months}  # [marked, attended]
    for status_, _sid, starts_at, _name in counted:
        key = starts_at.astimezone(tz).strftime("%Y-%m")
        if key in buckets:
            buckets[key][0] += 1
            buckets[key][1] += 1 if status_ in ATTENDED else 0
    monthly = [
        AttendanceMonth(month=m, marked=b[0], pct=percent(b[1] / b[0] * 100) if b[0] else None)
        for m, b in buckets.items()
    ]

    attendance = AttendanceSummary(
        overall_pct=(
            percent(sum(1 for m in counted if m[0] in ATTENDED) / len(counted) * 100) if counted else None
        ),
        last_30_pct=row.attendance_pct,
        present=present,
        late=late,
        absent=absent,
        excused=excused,
        # An excused absence earns one make-up class; each make-up attended uses one.
        makeup_credits=max(0, excused - makeups),
        reasons=reasons,
        total=len(counted),
        streak=streak,
        monthly=monthly,
        recent=[
            RecentSession(session_id=m[1], starts_at=m[2], batch_name=m[3], status=m[0]) for m in marks[:20]
        ],
    )

    assessments = (
        (
            await db.execute(
                select(StudentAssessment)
                .where(StudentAssessment.student_id == student.id)
                .order_by(StudentAssessment.assessed_on, StudentAssessment.created_at)
            )
        )
        .scalars()
        .all()
    )
    with_skills = [a for a in assessments if a.skills]
    skills = _skills(with_skills[-1].skills) if with_skills else _skills(student.skills)
    previous = _skills(with_skills[-2].skills) if len(with_skills) >= 2 else []

    promotions = (
        (
            await db.execute(
                select(StudentPromotion)
                .where(StudentPromotion.student_id == student.id)
                .order_by(StudentPromotion.assessed_on.desc(), StudentPromotion.created_at.desc())
            )
        )
        .scalars()
        .all()
    )

    all_enrolments = (
        (
            await db.execute(
                select(StudentEnrollment)
                .where(StudentEnrollment.student_id == student.id)
                .order_by(StudentEnrollment.start_date.desc())
            )
        )
        .scalars()
        .all()
    )
    paid = await fees_paid(db, [e.id for e in all_enrolments])
    program_names = {
        p.id: p.name
        for p in (
            await db.execute(select(Program).where(Program.id.in_({e.program_id for e in all_enrolments})))
        ).scalars()
    } if all_enrolments else {}
    history = [
        FeeHistoryRow(
            enrollment_id=e.id,
            program_name=program_names.get(e.program_id),
            start_date=e.start_date,
            renewal_date=e.renewal_date,
            total_fee=e.total_fee,
            paid=paid.get(e.id, Decimal("0")),
            pending=money(max(Decimal("0"), e.total_fee - paid.get(e.id, Decimal("0")))),
            status=e.status,
        )
        for e in all_enrolments
    ]
    fees = FeeSummary(
        total_fee=money(sum((h.total_fee for h in history), Decimal("0"))),
        paid=money(sum((h.paid for h in history), Decimal("0"))),
        pending=money(sum((h.pending for h in history if h.status is EnrollmentStatus.ACTIVE), Decimal("0"))),
        history=history,
    )

    current = next((e for e in all_enrolments if e.status is EnrollmentStatus.ACTIVE), None)

    active_list = [e for e in all_enrolments if e.status is EnrollmentStatus.ACTIVE]
    coaching = await _active_coaching(db, active_list, paid, tz=tz, today=today)
    guardians = (
        (
            await db.execute(
                select(StudentGuardian)
                .where(StudentGuardian.student_id == student.id)
                .order_by(StudentGuardian.is_primary.desc(), StudentGuardian.created_at)
            )
        )
        .scalars()
        .all()
    )
    next_class = await _next_class(db, [e.batch_id for e in active_list], now=now)
    lifetime = await _lifetime(db, all_enrolments, paid, marks_total=len(counted))

    return StudentProfile(
        row=row,
        personal=StudentPersonal(
            email=student.email,
            gender=student.gender,
            date_of_birth=student.date_of_birth,
            blood_group=student.blood_group,
            achievements=list(student.achievements or []),
            joined_on=all_enrolments[-1].start_date if all_enrolments else (current.start_date if current else None),
            emergency_contact_name=student.emergency_contact_name,
            emergency_contact_phone=student.emergency_contact_phone,
            medical_notes=student.medical_notes,
        ),
        promotions=[PromotionOut.model_validate(p) for p in promotions],
        attendance=attendance,
        assessments=[AssessmentOut.model_validate(a) for a in assessments],
        skills=skills,
        previous_skills=previous,
        fees=fees,
        standing=await _standing(db, student, row, now=now),
        enrollments=coaching,
        guardians=[GuardianOut.model_validate(g) for g in guardians],
        next_class=next_class,
        lifetime=lifetime,
    )


async def _active_coaching(
    db: AsyncSession,
    enrolments: list[StudentEnrollment],
    paid: dict[uuid.UUID, Decimal],
    *,
    tz: ZoneInfo,
    today: date,
) -> list[ActiveCoaching]:
    """Each active enrolment as a card: what, with whom, when it renews, and what is left."""
    if not enrolments:
        return []
    programs = {
        p.id: p
        for p in (
            await db.execute(select(Program).where(Program.id.in_({e.program_id for e in enrolments})))
        ).scalars()
    }
    batches = {
        b.id: b
        for b in (await db.execute(select(Batch).where(Batch.id.in_({e.batch_id for e in enrolments})))).scalars()
    }
    coach_ids = {e.coach_id or batches[e.batch_id].coach_id for e in enrolments if e.batch_id in batches}
    coaches = {
        c.id: c.name
        for c in (await db.execute(select(Coach).where(Coach.id.in_({c for c in coach_ids if c})))).scalars()
    } if any(coach_ids) else {}
    invoices = {
        i.student_enrollment_id: i
        for i in (
            await db.execute(
                select(Invoice)
                .where(Invoice.student_enrollment_id.in_([e.id for e in enrolments]))
                .order_by(Invoice.created_at.desc())
            )
        ).scalars()
    }

    month_start = datetime.combine(today.replace(day=1), datetime.min.time(), tzinfo=tz)
    used: dict[uuid.UUID, int] = {
        r[0]: int(r[1])
        for r in (
            await db.execute(
                select(CoachingSession.batch_id, func.count(Attendance.id))
                .join(CoachingSession, CoachingSession.id == Attendance.session_id)
                .where(
                    CoachingSession.batch_id.in_({e.batch_id for e in enrolments}),
                    CoachingSession.starts_at >= month_start,
                    Attendance.student_id == enrolments[0].student_id,
                    Attendance.status.in_(ATTENDED),
                )
                .group_by(CoachingSession.batch_id)
            )
        ).all()
    }

    out: list[ActiveCoaching] = []
    for e in enrolments:
        program = programs.get(e.program_id)
        batch = batches.get(e.batch_id)
        coach_id = e.coach_id or (batch.coach_id if batch else None)
        pending = money(max(Decimal("0"), e.total_fee - paid.get(e.id, Decimal("0"))))
        quota = program.classes_per_month if program else None
        done = used.get(e.batch_id, 0)
        invoice = invoices.get(e.id)
        out.append(
            ActiveCoaching(
                enrollment_id=e.id,
                program_id=e.program_id,
                program_name=program.name if program else None,
                sport_id=program.sport_id if program else None,
                delivery_type=program.delivery_type if program else DeliveryType.GROUP,
                batch_id=e.batch_id,
                batch_name=batch.name if batch else None,
                schedule=batch.schedule if batch else None,
                time_label=batch.time_label if batch else None,
                coach_name=coaches.get(coach_id) if coach_id else None,
                start_date=e.start_date,
                renewal_date=e.renewal_date,
                duration=e.duration,
                total_fee=e.total_fee,
                paid=paid.get(e.id, Decimal("0")),
                pending=pending,
                invoice_id=invoice.id if invoice else None,
                invoice_no=invoice.invoice_no if invoice else None,
                classes_per_month=quota,
                sessions_used=done,
                sessions_remaining=max(0, quota - done) if quota else None,
            )
        )
    return out


async def _next_class(
    db: AsyncSession, batch_ids: list[uuid.UUID], *, now: datetime
) -> NextClass | None:
    if not batch_ids:
        return None
    session = (
        await db.execute(
            select(CoachingSession)
            .where(
                CoachingSession.batch_id.in_(batch_ids),
                CoachingSession.starts_at >= now,
                CoachingSession.status != SessionStatus.CANCELLED,
            )
            .order_by(CoachingSession.starts_at)
            .limit(1)
        )
    ).scalar_one_or_none()
    if session is None:
        return None
    court = await db.get(Court, session.court_id) if session.court_id else None
    return NextClass(
        session_id=session.id,
        batch_name=session.batch_name,
        starts_at=session.starts_at,
        court_name=court.name if court else None,
    )


async def _lifetime(
    db: AsyncSession,
    enrolments: list[StudentEnrollment],
    paid: dict[uuid.UUID, Decimal],
    *,
    marks_total: int,
) -> Lifetime:
    coach_ids = {e.coach_id for e in enrolments if e.coach_id}
    names = sorted(
        c.name
        for c in (await db.execute(select(Coach).where(Coach.id.in_(coach_ids)))).scalars()
    ) if coach_ids else []
    return Lifetime(
        # The first term is a joining, not a renewal.
        renewals=max(0, len(enrolments) - 1),
        lifetime_paid=money(sum(paid.values(), Decimal("0"))),
        total_classes=marks_total,
        coaches=names,
    )


# ── Needs attention ─────────────────────────────────────────────────────────


def _item(row: StudentRow, detail: str) -> AttentionItem:
    return AttentionItem(
        student_id=row.id,
        student_no=row.student_no,
        name=row.name,
        photo_url=row.photo_url,
        avatar_initials=row.avatar_initials,
        batch_name=row.batch_name,
        sport_id=row.sport_id,
        detail=detail,
    )


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


async def attention(db: AsyncSession, *, today: date, now: datetime) -> AttentionOut:
    students = (
        (await db.execute(select(Student).where(Student.status == StudentStatus.ACTIVE).order_by(Student.name)))
        .scalars()
        .all()
    )
    rows = await build_rows(db, students, today=today, now=now)
    stats = await attendance_stats(db, [r.id for r in rows], now=now)

    absentees = sorted(
        (r for r in rows if "repeat_absentee" in r.flags), key=lambda r: -stats[r.id].absent14
    )
    low = sorted((r for r in rows if "low_attendance" in r.flags), key=lambda r: r.attendance_pct or 0)
    renewals = sorted((r for r in rows if "renewal_due" in r.flags), key=lambda r: r.days_to_renewal or 0)
    promos = sorted((r for r in rows if "promotion_ready" in r.flags), key=lambda r: -float(r.rating))

    def renewal_text(r: StudentRow) -> str:
        d = r.days_to_renewal or 0
        if d < 0:
            return f"Term ended {_plural(-d, 'day')} ago"
        if d == 0:
            return "Term ends today"
        return f"Term ends in {_plural(d, 'day')}"

    out = AttentionOut(
        counts=AttentionCounts(
            repeat_absentees=len(absentees),
            low_attendance=len(low),
            renewals_due=len(renewals),
            promotion_candidates=len(promos),
        ),
        repeat_absentees=[
            _item(r, f"{_plural(stats[r.id].absent14, 'absence')} in the last {REPEAT_ABSENCE_DAYS} days")
            for r in absentees
        ],
        low_attendance=[
            _item(r, f"{r.attendance_pct:.0f}% attendance over {_plural(r.sessions_marked_30d, 'session')}")
            for r in low
        ],
        renewals_due=[_item(r, renewal_text(r)) for r in renewals],
        promotion_candidates=[
            _item(r, f"Rated {float(r.rating):.1f} · {r.attendance_overall_pct or 0:.0f}% attendance")
            for r in promos
        ],
    )
    return out


def now_utc() -> datetime:
    return datetime.now(UTC)
