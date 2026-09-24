"""Academy endpoints: coaches, programmes, batches, students, sessions, attendance."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select

from app.api_utils import Page, Params, get_or_404, paginate
from app.auth.deps import RequireKiosk, RequireManager, RequireStaff
from app.core.errors import ConflictError
from app.modules.academy import service
from app.modules.academy.models import (
    Attendance,
    AttendanceStatus,
    Batch,
    Coach,
    CoachingSession,
    CoachSport,
    CoachStatus,
    CoachType,
    EnrollmentStatus,
    Program,
    SessionStatus,
    Student,
    StudentEnrollment,
    StudentPromotion,
    StudentSportLevel,
    StudentStatus,
)
from app.modules.academy.schemas import (
    AcademyOverview,
    AttendanceBulkMark,
    AttendanceOut,
    BatchCreate,
    BatchOut,
    BatchUpdate,
    CoachCreate,
    CoachOut,
    CoachUpdate,
    EnrollmentCreate,
    EnrollmentOut,
    EnrollmentWithInvoice,
    ProgramCreate,
    ProgramOut,
    ProgramUpdate,
    PromotionCreate,
    PromotionOut,
    RosterEntry,
    SessionCreate,
    SessionOut,
    SessionUpdate,
    StudentCreate,
    StudentDetail,
    StudentLevelOut,
    StudentOut,
    StudentUpdate,
)
from app.modules.booking.pricing import money
from app.modules.booking.service import initials
from app.modules.finance.models import CounterKind, Invoice, Payment
from app.modules.finance.numbering import next_number
from app.modules.finance.service import _settings
from app.tenancy.deps import Db

router = APIRouter(prefix="/academy", tags=["academy"])


# ── Coaches ─────────────────────────────────────────────────────────────────


async def _coach_out(db, coach: Coach, sports: dict, workload: dict) -> CoachOut:
    batches, students = workload.get(coach.id, (0, 0))
    return CoachOut(
        **CoachOut.model_validate(coach).model_dump(
            exclude={"sport_ids", "active_batches", "total_students"}
        ),
        sport_ids=sports.get(coach.id, []),
        active_batches=batches,
        total_students=students,
    )


@router.get("/coaches", response_model=Page[CoachOut], summary="List coaches")
async def list_coaches(
    db: Db,
    _: RequireStaff,
    params: Params,
    coach_status: Annotated[CoachStatus | None, Query(alias="status")] = None,
    coach_type: Annotated[CoachType | None, Query(alias="type")] = None,
    sport_id: uuid.UUID | None = None,
    search: str | None = None,
) -> Page[CoachOut]:
    stmt = select(Coach).order_by(Coach.name)
    if coach_status is not None:
        stmt = stmt.where(Coach.status == coach_status)
    if coach_type is not None:
        stmt = stmt.where(Coach.type == coach_type)
    if sport_id is not None:
        stmt = stmt.where(
            Coach.id.in_(select(CoachSport.coach_id).where(CoachSport.sport_id == sport_id))
        )
    if search:
        like = f"%{search.lower()}%"
        stmt = stmt.where(Coach.name.ilike(like) | Coach.specialization.ilike(like))

    total = await db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows = (await db.execute(stmt.offset(params.offset).limit(params.size))).scalars().all()

    sports = await service.coach_sport_map(db)
    workload = await service.coach_workload(db)
    total = int(total or 0)

    return Page[CoachOut](
        items=[await _coach_out(db, coach, sports, workload) for coach in rows],
        total=total,
        page=params.page,
        size=params.size,
        pages=max(1, (total + params.size - 1) // params.size),
    )


@router.post(
    "/coaches",
    response_model=CoachOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a coach",
    description="Assigns the next coach number in this academy's own series (XC-C-001).",
)
async def create_coach(payload: CoachCreate, db: Db, _: RequireManager) -> CoachOut:
    settings = await _settings(db)
    coach = Coach(
        **payload.model_dump(exclude={"sport_ids", "email"}),
        email=str(payload.email) if payload.email else None,
        coach_no=await next_number(db, CounterKind.COACH, prefix=settings.invoice_prefix),
        avatar_initials=initials(payload.name),
    )
    db.add(coach)
    await db.flush()

    for sport_id in payload.sport_ids:
        db.add(CoachSport(coach_id=coach.id, sport_id=sport_id))
    await db.flush()

    return CoachOut(
        **CoachOut.model_validate(coach).model_dump(exclude={"sport_ids"}),
        sport_ids=list(payload.sport_ids),
    )


@router.patch("/coaches/{coach_id}", response_model=CoachOut, summary="Update a coach")
async def update_coach(
    coach_id: uuid.UUID, payload: CoachUpdate, db: Db, _: RequireManager
) -> CoachOut:
    coach = await get_or_404(db, Coach, coach_id, label="Coach")
    updates = payload.model_dump(exclude_unset=True, exclude={"sport_ids"})
    if "email" in updates and updates["email"] is not None:
        updates["email"] = str(updates["email"])
    for field, value in updates.items():
        setattr(coach, field, value)
    if "name" in updates:
        coach.avatar_initials = initials(coach.name)

    if payload.sport_ids is not None:
        existing = (
            (await db.execute(select(CoachSport).where(CoachSport.coach_id == coach.id)))
            .scalars()
            .all()
        )
        for row in existing:
            await db.delete(row)
        await db.flush()
        for sport_id in payload.sport_ids:
            db.add(CoachSport(coach_id=coach.id, sport_id=sport_id))

    await db.flush()
    sports = await service.coach_sport_map(db)
    workload = await service.coach_workload(db)
    return await _coach_out(db, coach, sports, workload)


# ── Programmes ──────────────────────────────────────────────────────────────


@router.get("/programs", response_model=list[ProgramOut], summary="List programmes")
async def list_programs(db: Db, _: RequireStaff, include_inactive: bool = False) -> list[ProgramOut]:
    stmt = select(Program).order_by(Program.name)
    if not include_inactive:
        stmt = stmt.where(Program.is_active.is_(True))
    return [ProgramOut.model_validate(row) for row in (await db.execute(stmt)).scalars()]


@router.post(
    "/programs",
    response_model=ProgramOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a programme",
)
async def create_program(payload: ProgramCreate, db: Db, _: RequireManager) -> ProgramOut:
    program = Program(**payload.model_dump())
    db.add(program)
    await db.flush()
    return ProgramOut.model_validate(program)


@router.patch("/programs/{program_id}", response_model=ProgramOut, summary="Update a programme")
async def update_program(
    program_id: uuid.UUID, payload: ProgramUpdate, db: Db, _: RequireManager
) -> ProgramOut:
    program = await get_or_404(db, Program, program_id, label="Programme")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(program, field, value)
    await db.flush()
    return ProgramOut.model_validate(program)


# ── Batches ─────────────────────────────────────────────────────────────────


@router.get("/batches", response_model=list[BatchOut], summary="List batches with live occupancy")
async def list_batches(
    db: Db,
    _: RequireStaff,
    program_id: uuid.UUID | None = None,
    coach_id: uuid.UUID | None = None,
) -> list[BatchOut]:
    stmt = select(Batch).order_by(Batch.name)
    if program_id is not None:
        stmt = stmt.where(Batch.program_id == program_id)
    if coach_id is not None:
        stmt = stmt.where(Batch.coach_id == coach_id)
    batches = (await db.execute(stmt)).scalars().all()

    counts = await service.batch_enrolment_counts(db, [b.id for b in batches])
    return [
        BatchOut(
            **BatchOut.model_validate(batch).model_dump(exclude={"enrolled", "is_full"}),
            enrolled=counts.get(batch.id, 0),
            is_full=counts.get(batch.id, 0) >= batch.capacity,
        )
        for batch in batches
    ]


@router.post(
    "/batches", response_model=BatchOut, status_code=status.HTTP_201_CREATED, summary="Add a batch"
)
async def create_batch(payload: BatchCreate, db: Db, _: RequireManager) -> BatchOut:
    await get_or_404(db, Program, payload.program_id, label="Programme")
    batch = Batch(**payload.model_dump())
    db.add(batch)
    await db.flush()
    return BatchOut.model_validate(batch)


@router.patch("/batches/{batch_id}", response_model=BatchOut, summary="Update a batch")
async def update_batch(
    batch_id: uuid.UUID, payload: BatchUpdate, db: Db, _: RequireManager
) -> BatchOut:
    batch = await get_or_404(db, Batch, batch_id, label="Batch")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(batch, field, value)
    await db.flush()
    counts = await service.batch_enrolment_counts(db, [batch.id])
    return BatchOut(
        **BatchOut.model_validate(batch).model_dump(exclude={"enrolled", "is_full"}),
        enrolled=counts.get(batch.id, 0),
        is_full=counts.get(batch.id, 0) >= batch.capacity,
    )


# ── Students ────────────────────────────────────────────────────────────────


@router.get("/students", response_model=Page[StudentOut], summary="List students")
async def list_students(
    db: Db,
    _: RequireStaff,
    params: Params,
    student_status: Annotated[StudentStatus | None, Query(alias="status")] = None,
    batch_id: uuid.UUID | None = None,
    search: str | None = None,
) -> Page[StudentOut]:
    stmt = select(Student).order_by(Student.name)
    if student_status is not None:
        stmt = stmt.where(Student.status == student_status)
    if batch_id is not None:
        stmt = stmt.where(
            Student.id.in_(
                select(StudentEnrollment.student_id).where(
                    StudentEnrollment.batch_id == batch_id,
                    StudentEnrollment.status == EnrollmentStatus.ACTIVE,
                )
            )
        )
    if search:
        like = f"%{search.lower()}%"
        stmt = stmt.where(
            Student.name.ilike(like) | Student.parent_name.ilike(like) | Student.phone.ilike(like)
        )

    total = int(await db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0)
    rows = (await db.execute(stmt.offset(params.offset).limit(params.size))).scalars().all()
    today = date.today()

    return Page[StudentOut](
        items=[
            StudentOut(
                **StudentOut.model_validate(row).model_dump(exclude={"age"}),
                age=row.age_on(today),
            )
            for row in rows
        ],
        total=total,
        page=params.page,
        size=params.size,
        pages=max(1, (total + params.size - 1) // params.size),
    )


@router.post(
    "/students",
    response_model=StudentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Register a student",
)
async def create_student(payload: StudentCreate, db: Db, _: RequireStaff) -> StudentOut:
    settings = await _settings(db)
    student = Student(
        **payload.model_dump(exclude={"skills", "email"}),
        email=str(payload.email) if payload.email else None,
        skills=[skill.model_dump() for skill in payload.skills],
        student_no=await next_number(db, CounterKind.STUDENT, prefix=settings.invoice_prefix),
        avatar_initials=initials(payload.name),
    )
    db.add(student)
    await db.flush()
    return StudentOut(
        **StudentOut.model_validate(student).model_dump(exclude={"age"}),
        age=student.age_on(date.today()),
    )


@router.get(
    "/students/{student_id}",
    response_model=StudentDetail,
    summary="A student, flattened with their current enrolment",
    description=(
        "Returns the shape Coaching.tsx already renders. `age`, `attendance_pct` and "
        "`pending_fee` are computed, and the enrolment fields come from the active "
        "`student_enrollment` row rather than being duplicated onto the student."
    ),
)
async def get_student(student_id: uuid.UUID, db: Db, _: RequireStaff) -> StudentDetail:
    student = await get_or_404(db, Student, student_id, label="Student")
    today = date.today()
    base = StudentOut.model_validate(student).model_dump(exclude={"age"})

    enrollment = await service.current_enrollment(db, student.id)
    if enrollment is None:
        return StudentDetail(**base, age=student.age_on(today))

    batch = await db.get(Batch, enrollment.batch_id)
    paid = await service.enrollment_fee_paid(db, enrollment.id)

    return StudentDetail(
        **base,
        age=student.age_on(today),
        program_id=enrollment.program_id,
        batch_id=enrollment.batch_id,
        coach_id=enrollment.coach_id,
        batch_name=batch.name if batch else None,
        joining_date=enrollment.start_date,
        renewal_date=enrollment.renewal_date,
        total_fee=enrollment.total_fee,
        pending_fee=money(max(Decimal("0"), enrollment.total_fee - paid)),
        attendance_pct=await service.attendance_pct(db, student.id),
    )


@router.patch("/students/{student_id}", response_model=StudentOut, summary="Update a student")
async def update_student(
    student_id: uuid.UUID, payload: StudentUpdate, db: Db, _: RequireStaff
) -> StudentOut:
    student = await get_or_404(db, Student, student_id, label="Student")
    updates = payload.model_dump(exclude_unset=True, exclude={"skills"})
    if "email" in updates and updates["email"] is not None:
        updates["email"] = str(updates["email"])
    for field, value in updates.items():
        setattr(student, field, value)
    if payload.skills is not None:
        student.skills = [skill.model_dump() for skill in payload.skills]
    if "name" in updates:
        student.avatar_initials = initials(student.name)
    await db.flush()
    return StudentOut(
        **StudentOut.model_validate(student).model_dump(exclude={"age"}),
        age=student.age_on(date.today()),
    )


# ── Progression ─────────────────────────────────────────────────────────────


@router.get(
    "/students/{student_id}/levels",
    response_model=list[StudentLevelOut],
    summary="Where a student stands, per sport",
    description=(
        "One row per sport the student has been assessed in. A sport that is "
        "missing has simply never been assessed — it is not the same as beginner."
    ),
)
async def list_student_levels(
    student_id: uuid.UUID, db: Db, _: RequireStaff
) -> list[StudentLevelOut]:
    await get_or_404(db, Student, student_id, label="Student")
    rows = (
        await db.execute(
            select(StudentSportLevel).where(StudentSportLevel.student_id == student_id)
        )
    ).scalars()
    return [StudentLevelOut.model_validate(row) for row in rows]


@router.get(
    "/students/{student_id}/promotions",
    response_model=list[PromotionOut],
    summary="A student's movements on the ladder",
    description="Newest first. Includes demotions and re-assessments at the same level.",
)
async def list_student_promotions(
    student_id: uuid.UUID, db: Db, _: RequireStaff
) -> list[PromotionOut]:
    await get_or_404(db, Student, student_id, label="Student")
    rows = (
        await db.execute(
            select(StudentPromotion)
            .where(StudentPromotion.student_id == student_id)
            .order_by(StudentPromotion.assessed_on.desc(), StudentPromotion.created_at.desc())
        )
    ).scalars()
    return [PromotionOut.model_validate(row) for row in rows]


@router.post(
    "/students/{student_id}/promotions",
    response_model=PromotionOut,
    status_code=status.HTTP_201_CREATED,
    summary="Assess a student at a level",
    description=(
        "Records the new standing and the move that produced it, in one write. "
        "Works for a first assessment (`from_level` comes back null), a promotion, "
        "a demotion, and a re-assessment at the level they are already at — a "
        "review that confirms the status quo is still a review worth keeping.\n\n"
        "Manager and above: moving a child up a level changes who they train with."
    ),
)
async def promote_student(
    student_id: uuid.UUID, payload: PromotionCreate, db: Db, _: RequireManager
) -> PromotionOut:
    student = await get_or_404(db, Student, student_id, label="Student")
    promotion = await service.set_level(
        db,
        student=student,
        sport_id=payload.sport_id,
        level=payload.to_level,
        assessed_on=payload.assessed_on or date.today(),
        assessed_by=payload.assessed_by,
        note=payload.note,
    )
    return PromotionOut.model_validate(promotion)


# ── Enrolment ───────────────────────────────────────────────────────────────


@router.post(
    "/enrollments",
    response_model=EnrollmentWithInvoice,
    status_code=status.HTTP_201_CREATED,
    summary="Enrol a student in a batch",
    description=(
        "Creates the enrolment and its fee invoice in one transaction, and refuses "
        "with **409** if the batch is already at capacity. Occupancy is counted from "
        "live enrolments, not a stored column that could disagree.\n\n"
        "Refuses with **400** if the student's age at the start of the term falls "
        "outside the programme's band, or if the programme is age-banded and the "
        "student has no date of birth on file. Programmes with no band set admit "
        "any age.\n\n"
        "A batch above the student's assessed level is **allowed** and comes back "
        "with `level_warning` set — that call belongs to the coach, not to us."
    ),
)
async def create_enrollment(
    payload: EnrollmentCreate, db: Db, _: RequireStaff
) -> EnrollmentWithInvoice:
    student = await get_or_404(db, Student, payload.student_id, label="Student")
    batch = await get_or_404(db, Batch, payload.batch_id, label="Batch")
    start_date = payload.start_date or date.today()

    enrollment, invoice = await service.enrol_student(
        db,
        student=student,
        batch=batch,
        duration=payload.duration,
        start_date=start_date,
        discount=payload.discount,
    )

    warning: str | None = None
    program = await db.get(Program, enrollment.program_id)
    if program is not None and program.sport_id is not None:
        levels = await service.levels_for(db, student.id)
        gap = service.level_gap(levels.get(program.sport_id), program.skill_level)
        if gap is not None and gap > 0:
            standing = levels[program.sport_id].value
            rungs = "a level" if gap == 1 else f"{gap} levels"
            warning = (
                f"{student.name} is assessed at {standing} in this sport — "
                f"'{program.name}' is {rungs} above that."
            )

    return EnrollmentWithInvoice(
        enrollment=EnrollmentOut.model_validate(enrollment),
        invoice_id=invoice.id,
        invoice_no=invoice.invoice_no,
        invoice_total=invoice.total,
        level_warning=warning,
    )


@router.get(
    "/students/{student_id}/enrollments",
    response_model=list[EnrollmentOut],
    summary="A student's enrolment history",
    description="The history the frontend's flat Student interface would have destroyed on renewal.",
)
async def student_enrollments(
    student_id: uuid.UUID, db: Db, _: RequireStaff
) -> list[EnrollmentOut]:
    await get_or_404(db, Student, student_id, label="Student")
    rows = (
        (
            await db.execute(
                select(StudentEnrollment)
                .where(StudentEnrollment.student_id == student_id)
                .order_by(StudentEnrollment.start_date.desc())
            )
        )
        .scalars()
        .all()
    )
    return [EnrollmentOut.model_validate(row) for row in rows]


# ── Sessions ────────────────────────────────────────────────────────────────


async def _session_out(db, rows: list[CoachingSession]) -> list[SessionOut]:
    counts = await service.session_attendance_counts(db, [row.id for row in rows])
    enrolments = await service.batch_enrolment_counts(db, [row.batch_id for row in rows])
    out: list[SessionOut] = []
    for row in rows:
        _marked, present, absent = counts.get(row.id, (0, 0, 0))
        out.append(
            SessionOut(
                **SessionOut.model_validate(row).model_dump(
                    exclude={"students_enrolled", "present", "absent"}
                ),
                students_enrolled=enrolments.get(row.batch_id, 0),
                present=present,
                absent=absent,
            )
        )
    return out


@router.get(
    "/sessions",
    response_model=list[SessionOut],
    summary="List sessions",
    description=(
        "Readable by the **counter tablet**, which needs today's classes in order "
        "to take a register. Deliberately the weakest guard in this module — see "
        "`POST /sessions/{session_id}/attendance` for why the register, and only "
        "the register, is reachable from the kiosk."
    ),
)
async def list_sessions(
    db: Db,
    _: RequireKiosk,
    batch_id: uuid.UUID | None = None,
    coach_id: uuid.UUID | None = None,
    session_status: Annotated[SessionStatus | None, Query(alias="status")] = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[SessionOut]:
    stmt = select(CoachingSession).order_by(CoachingSession.starts_at)
    if batch_id is not None:
        stmt = stmt.where(CoachingSession.batch_id == batch_id)
    if coach_id is not None:
        stmt = stmt.where(CoachingSession.coach_id == coach_id)
    if session_status is not None:
        stmt = stmt.where(CoachingSession.status == session_status)
    if date_from is not None:
        stmt = stmt.where(CoachingSession.starts_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(CoachingSession.starts_at < date_to)
    rows = (await db.execute(stmt)).scalars().all()
    return await _session_out(db, list(rows))


@router.post(
    "/sessions",
    response_model=SessionOut,
    status_code=status.HTTP_201_CREATED,
    summary="Schedule a session",
)
async def create_session(payload: SessionCreate, db: Db, _: RequireStaff) -> SessionOut:
    batch = await get_or_404(db, Batch, payload.batch_id, label="Batch")
    coaching_session = CoachingSession(
        batch_id=batch.id,
        batch_name=batch.name,
        coach_id=payload.coach_id or batch.coach_id,
        sport_id=batch.sport_id,
        starts_at=payload.starts_at,
        ends_at=payload.starts_at + timedelta(minutes=payload.duration_min),
        duration_min=payload.duration_min,
        notes=payload.notes,
    )
    db.add(coaching_session)
    await db.flush()
    return (await _session_out(db, [coaching_session]))[0]


@router.patch("/sessions/{session_id}", response_model=SessionOut, summary="Update a session")
async def update_session(
    session_id: uuid.UUID, payload: SessionUpdate, db: Db, _: RequireStaff
) -> SessionOut:
    coaching_session = await get_or_404(db, CoachingSession, session_id, label="Session")
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(coaching_session, field, value)
    if "starts_at" in updates or "duration_min" in updates:
        coaching_session.ends_at = coaching_session.starts_at + timedelta(
            minutes=coaching_session.duration_min
        )
    await db.flush()
    return (await _session_out(db, [coaching_session]))[0]


@router.post(
    "/sessions/{session_id}/attendance",
    response_model=list[AttendanceOut],
    summary="Mark attendance for a session",
    description=(
        "Marks a whole batch in one call, the way a register is actually taken. "
        "Re-marking a student updates their existing row rather than adding a "
        "second one — a duplicate would double-count them in every percentage.\n\n"
        "**Reachable by the counter tablet.** Taking a register is the one academy "
        "action that genuinely belongs on a shared device at the door, and the "
        "worst a leaked kiosk credential does here is mis-mark a child present. "
        "Enrolling students, moving them up a level and anything touching fees "
        "stay at reception and above, where the login names a person."
    ),
)
async def mark_attendance(
    session_id: uuid.UUID, payload: AttendanceBulkMark, db: Db, principal: RequireKiosk
) -> list[AttendanceOut]:
    coaching_session = await get_or_404(db, CoachingSession, session_id, label="Session")

    existing = {
        row.student_id: row
        for row in (
            await db.execute(select(Attendance).where(Attendance.session_id == session_id))
        )
        .scalars()
        .all()
    }

    results: list[Attendance] = []
    for mark in payload.marks:
        row = existing.get(mark.student_id)
        if row is None:
            row = Attendance(session_id=coaching_session.id, student_id=mark.student_id)
            db.add(row)
        row.status = mark.status
        row.note = mark.note
        row.marked_at = datetime.now(UTC)
        row.marked_by_user_id = principal.id
        results.append(row)

    # Taking the register is what completes a session.
    if coaching_session.status is SessionStatus.SCHEDULED:
        coaching_session.status = SessionStatus.COMPLETED

    await db.flush()
    return [AttendanceOut.model_validate(row) for row in results]


@router.get(
    "/sessions/{session_id}/roster",
    response_model=list[RosterEntry],
    summary="Everyone in this class, and how they are marked",
    description=(
        "What the counter tablet needs to take a register: every student "
        "actively enrolled in the session's batch, each with their mark if one "
        "has been recorded and `null` if not.\n\n"
        "Distinct from `GET /sessions/{session_id}/attendance`, which returns "
        "only the rows that exist — empty for a class nobody has marked yet, and "
        "therefore useless as the thing you tick down.\n\n"
        "Readable by the **kiosk**, and scoped to one class: it gives the tablet "
        "the names of the children in front of it and nothing else. Listing the "
        "academy's students stays at reception and above."
    ),
)
async def session_roster(session_id: uuid.UUID, db: Db, _: RequireKiosk) -> list[RosterEntry]:
    coaching_session = await get_or_404(db, CoachingSession, session_id, label="Session")

    rows = (
        await db.execute(
            select(Student, StudentEnrollment.id)
            .join(StudentEnrollment, StudentEnrollment.student_id == Student.id)
            .where(
                StudentEnrollment.batch_id == coaching_session.batch_id,
                StudentEnrollment.status == EnrollmentStatus.ACTIVE,
            )
            .order_by(Student.name)
        )
    ).all()

    marked = {
        row.student_id: row
        for row in (
            await db.execute(select(Attendance).where(Attendance.session_id == session_id))
        )
        .scalars()
        .all()
    }

    return [
        RosterEntry(
            student_id=student.id,
            student_name=student.name,
            status=marked[student.id].status if student.id in marked else None,
            note=marked[student.id].note if student.id in marked else None,
        )
        for student, _ in rows
    ]


@router.get(
    "/sessions/{session_id}/attendance",
    response_model=list[AttendanceOut],
    summary="A session's register",
)
async def session_attendance(session_id: uuid.UUID, db: Db, _: RequireKiosk) -> list[AttendanceOut]:
    await get_or_404(db, CoachingSession, session_id, label="Session")
    rows = (
        (await db.execute(select(Attendance).where(Attendance.session_id == session_id)))
        .scalars()
        .all()
    )
    return [AttendanceOut.model_validate(row) for row in rows]


# ── Dashboard ───────────────────────────────────────────────────────────────


@router.get(
    "/overview",
    response_model=AcademyOverview,
    summary="Coaching dashboard summary",
    description="Backs the summary cards on the Coaching dashboard.",
)
async def academy_overview(db: Db, _: RequireStaff) -> AcademyOverview:
    today = date.today()
    month_start = today.replace(day=1)

    total_coaches = int(await db.scalar(select(func.count(Coach.id))) or 0)
    active_coaches = int(
        await db.scalar(select(func.count(Coach.id)).where(Coach.status == CoachStatus.ACTIVE)) or 0
    )
    guest_coaches = int(
        await db.scalar(select(func.count(Coach.id)).where(Coach.type == CoachType.GUEST)) or 0
    )
    sports_offered = int(
        await db.scalar(select(func.count(func.distinct(CoachSport.sport_id)))) or 0
    )
    active_students = int(
        await db.scalar(
            select(func.count(Student.id)).where(Student.status == StudentStatus.ACTIVE)
        )
        or 0
    )
    new_admissions = int(
        await db.scalar(
            select(func.count(StudentEnrollment.id)).where(
                StudentEnrollment.start_date >= month_start
            )
        )
        or 0
    )

    fee_collected = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0))
        .select_from(Payment)
        .join(Invoice, Payment.invoice_id == Invoice.id)
        .where(Invoice.student_enrollment_id.isnot(None))
    )
    fee_pending = await db.scalar(
        select(func.coalesce(func.sum(Invoice.total - Invoice.amount_paid), 0)).where(
            Invoice.student_enrollment_id.isnot(None)
        )
    )

    day_start = datetime.combine(today, datetime.min.time(), tzinfo=UTC)
    sessions_today = int(
        await db.scalar(
            select(func.count(CoachingSession.id)).where(
                CoachingSession.starts_at >= day_start,
                CoachingSession.starts_at < day_start + timedelta(days=1),
            )
        )
        or 0
    )
    today_session_ids = (
        (
            await db.execute(
                select(CoachingSession.id).where(
                    CoachingSession.starts_at >= day_start,
                    CoachingSession.starts_at < day_start + timedelta(days=1),
                )
            )
        )
        .scalars()
        .all()
    )
    counts = await service.session_attendance_counts(db, list(today_session_ids))

    return AcademyOverview(
        total_coaches=total_coaches,
        active_coaches=active_coaches,
        guest_coaches=guest_coaches,
        sports_offered=sports_offered,
        active_students=active_students,
        new_admissions_this_month=new_admissions,
        fee_collected=money(fee_collected or 0),
        fee_pending=money(max(Decimal("0"), fee_pending or Decimal("0"))),
        sessions_today=sessions_today,
        present_today=sum(row[1] for row in counts.values()),
        absent_today=sum(row[2] for row in counts.values()),
    )
