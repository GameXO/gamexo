"""Pydantic schemas for the academy domain."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.modules.academy.models import (
    AgeBand,
    AttendanceStatus,
    BatchStatus,
    CoachStatus,
    CoachType,
    EnrollmentStatus,
    SessionStatus,
    SkillLevel,
    StudentStatus,
)

ORM = ConfigDict(from_attributes=True)


# ── Coach ───────────────────────────────────────────────────────────────────


class CoachBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    gender: str | None = None
    specialization: str | None = None
    type: CoachType = CoachType.FULL_TIME
    experience_years: int = Field(default=0, ge=0, le=80)
    certifications: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    joining_date: date | None = None
    salary: Decimal = Field(default=Decimal("0"), ge=0)
    hourly_rate: Decimal = Field(default=Decimal("0"), ge=0)
    morning_available: bool = True
    evening_available: bool = True
    status: CoachStatus = CoachStatus.ACTIVE
    bio: str | None = None


class CoachCreate(CoachBase):
    sport_ids: list[uuid.UUID] = Field(default_factory=list)


class CoachUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = None
    email: EmailStr | None = None
    gender: str | None = None
    specialization: str | None = None
    type: CoachType | None = None
    experience_years: int | None = Field(default=None, ge=0, le=80)
    certifications: list[str] | None = None
    languages: list[str] | None = None
    joining_date: date | None = None
    salary: Decimal | None = Field(default=None, ge=0)
    hourly_rate: Decimal | None = Field(default=None, ge=0)
    morning_available: bool | None = None
    evening_available: bool | None = None
    status: CoachStatus | None = None
    bio: str | None = None
    sport_ids: list[uuid.UUID] | None = None


class CoachOut(CoachBase):
    model_config = ORM
    id: uuid.UUID
    coach_no: str
    avatar_initials: str | None = None
    rating: Decimal = Decimal("0")
    sport_ids: list[uuid.UUID] = Field(default_factory=list)
    # Derived counts — the frontend's activeBatches / totalStudents.
    active_batches: int = 0
    total_students: int = 0


# ── Program ─────────────────────────────────────────────────────────────────


class ProgramBase(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    sport_id: uuid.UUID | None = None

    #: Where this sits on the ladder. None means mixed-ability.
    skill_level: SkillLevel | None = None
    #: None means the programme admits any age. Setting a band switches enforcement
    #: on at enrolment; explicit bounds override the band's defaults.
    age_band: AgeBand | None = None
    age_min: int | None = Field(default=None, ge=0, le=120)
    age_max: int | None = Field(default=None, ge=0, le=120)

    level: str | None = None
    age_group: str | None = None
    duration_label: str | None = None
    max_students: int = Field(default=12, gt=0, le=500)
    session_freq: str | None = None
    session_duration: str | None = None
    coach_id: uuid.UUID | None = None
    location: str | None = None
    fee_1m: Decimal = Field(default=Decimal("0"), ge=0)
    fee_3m: Decimal = Field(default=Decimal("0"), ge=0)
    fee_6m: Decimal = Field(default=Decimal("0"), ge=0)
    fee_12m: Decimal = Field(default=Decimal("0"), ge=0)
    color: str | None = Field(default=None, max_length=9)
    bg_color: str | None = Field(default=None, max_length=9)
    is_active: bool = True


class ProgramCreate(ProgramBase):
    pass


class ProgramUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    sport_id: uuid.UUID | None = None
    skill_level: SkillLevel | None = None
    age_band: AgeBand | None = None
    age_min: int | None = Field(default=None, ge=0, le=120)
    age_max: int | None = Field(default=None, ge=0, le=120)
    level: str | None = None
    age_group: str | None = None
    duration_label: str | None = None
    max_students: int | None = Field(default=None, gt=0, le=500)
    session_freq: str | None = None
    session_duration: str | None = None
    coach_id: uuid.UUID | None = None
    location: str | None = None
    fee_1m: Decimal | None = Field(default=None, ge=0)
    fee_3m: Decimal | None = Field(default=None, ge=0)
    fee_6m: Decimal | None = Field(default=None, ge=0)
    fee_12m: Decimal | None = Field(default=None, ge=0)
    color: str | None = None
    bg_color: str | None = None
    is_active: bool | None = None


class ProgramOut(ProgramBase):
    model_config = ORM
    id: uuid.UUID


# ── Batch ───────────────────────────────────────────────────────────────────


class BatchBase(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    program_id: uuid.UUID
    sport_id: uuid.UUID | None = None
    coach_id: uuid.UUID | None = None
    capacity: int = Field(default=12, gt=0, le=500)
    schedule: str | None = None
    time_label: str | None = None
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: BatchStatus = BatchStatus.ACTIVE
    color: str | None = Field(default=None, max_length=9)


class BatchCreate(BatchBase):
    pass


class BatchUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    program_id: uuid.UUID | None = None
    sport_id: uuid.UUID | None = None
    coach_id: uuid.UUID | None = None
    capacity: int | None = Field(default=None, gt=0, le=500)
    schedule: str | None = None
    time_label: str | None = None
    location: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: BatchStatus | None = None
    color: str | None = None


class BatchOut(BatchBase):
    model_config = ORM
    id: uuid.UUID
    # Derived, so a stored count can never admit a student into a full batch.
    enrolled: int = 0
    is_full: bool = False


# ── Student ─────────────────────────────────────────────────────────────────


class SkillScore(BaseModel):
    name: str
    score: int = Field(ge=0, le=10)


class StudentBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    parent_name: str | None = None
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    gender: str | None = None
    date_of_birth: date | None = None
    blood_group: str | None = Field(default=None, max_length=8)
    status: StudentStatus = StudentStatus.ACTIVE
    performance_rating: Decimal = Field(default=Decimal("0"), ge=0, le=10)
    achievements: list[str] = Field(default_factory=list)
    skills: list[SkillScore] = Field(default_factory=list)
    customer_id: uuid.UUID | None = None


class StudentCreate(StudentBase):
    pass


class StudentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    parent_name: str | None = None
    phone: str | None = None
    email: EmailStr | None = None
    gender: str | None = None
    date_of_birth: date | None = None
    blood_group: str | None = None
    status: StudentStatus | None = None
    performance_rating: Decimal | None = Field(default=None, ge=0, le=10)
    achievements: list[str] | None = None
    skills: list[SkillScore] | None = None
    customer_id: uuid.UUID | None = None


class StudentOut(StudentBase):
    model_config = ORM
    id: uuid.UUID
    student_no: str
    avatar_initials: str | None = None
    # Derived from date_of_birth, so it is never a year out of date.
    age: int | None = None


class StudentLevelOut(BaseModel):
    """A student's standing in one sport."""

    model_config = ORM
    sport_id: uuid.UUID
    level: SkillLevel
    assessed_on: date


class PromotionCreate(BaseModel):
    sport_id: uuid.UUID
    to_level: SkillLevel
    assessed_on: date | None = None
    assessed_by: str | None = Field(default=None, max_length=200)
    note: str | None = None


class PromotionOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    student_id: uuid.UUID
    sport_id: uuid.UUID
    from_level: SkillLevel | None
    to_level: SkillLevel
    assessed_on: date
    assessed_by: str | None
    note: str | None


class StudentDetail(StudentOut):
    """Flattens the current enrolment back into the shape Coaching.tsx renders."""

    program_id: uuid.UUID | None = None
    batch_id: uuid.UUID | None = None
    coach_id: uuid.UUID | None = None
    batch_name: str | None = None
    joining_date: date | None = None
    renewal_date: date | None = None
    total_fee: Decimal = Decimal("0")
    pending_fee: Decimal = Decimal("0")
    attendance_pct: float = 0.0


# ── Enrollment ──────────────────────────────────────────────────────────────


class EnrollmentCreate(BaseModel):
    student_id: uuid.UUID
    batch_id: uuid.UUID
    duration: str = Field(default="3m", pattern="^(1m|3m|6m|12m)$")
    start_date: date | None = None
    discount: Decimal = Field(default=Decimal("0"), ge=0)


class EnrollmentOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    student_id: uuid.UUID
    program_id: uuid.UUID
    batch_id: uuid.UUID
    coach_id: uuid.UUID | None
    duration: str
    start_date: date
    renewal_date: date
    total_fee: Decimal
    status: EnrollmentStatus


class RosterEntry(BaseModel):
    """One student on a session's register, with their mark if one exists.

    Built for the counter tablet, which needs the *roster* — everyone enrolled in
    the batch — not the attendance rows, which only exist for students already
    marked. A fresh session has no attendance rows at all, so a register built
    from those would show an empty class.
    """

    student_id: uuid.UUID
    student_name: str
    #: None until somebody marks them.
    status: AttendanceStatus | None = None
    note: str | None = None


class EnrollmentWithInvoice(BaseModel):
    enrollment: EnrollmentOut
    invoice_id: uuid.UUID
    invoice_no: str
    invoice_total: Decimal
    #: Set when the batch sits above the student's assessed level for that sport.
    #: A note, not a refusal — stretching a strong student is how coaching works,
    #: and the person at the desk is better placed to judge it than this endpoint.
    level_warning: str | None = None


# ── Sessions & attendance ───────────────────────────────────────────────────


class SessionCreate(BaseModel):
    batch_id: uuid.UUID
    starts_at: datetime
    duration_min: int = Field(default=60, ge=15, le=480)
    coach_id: uuid.UUID | None = None
    notes: str | None = None


class SessionUpdate(BaseModel):
    starts_at: datetime | None = None
    duration_min: int | None = Field(default=None, ge=15, le=480)
    status: SessionStatus | None = None
    notes: str | None = None


class SessionOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    batch_id: uuid.UUID
    batch_name: str
    coach_id: uuid.UUID | None
    sport_id: uuid.UUID | None
    starts_at: datetime
    ends_at: datetime
    duration_min: int
    status: SessionStatus
    notes: str | None
    # Derived from attendance rows.
    students_enrolled: int = 0
    present: int = 0
    absent: int = 0


class AttendanceMark(BaseModel):
    student_id: uuid.UUID
    status: AttendanceStatus
    note: str | None = None


class AttendanceBulkMark(BaseModel):
    """Reception marks a whole batch at once, not one student at a time."""

    marks: list[AttendanceMark] = Field(min_length=1)


class AttendanceOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    session_id: uuid.UUID
    student_id: uuid.UUID
    status: AttendanceStatus
    marked_at: datetime | None
    note: str | None


class AcademyOverview(BaseModel):
    """The summary cards on the Coaching dashboard."""

    total_coaches: int
    active_coaches: int
    guest_coaches: int
    sports_offered: int
    active_students: int
    new_admissions_this_month: int
    fee_collected: Decimal
    fee_pending: Decimal
    sessions_today: int
    present_today: int
    absent_today: int
