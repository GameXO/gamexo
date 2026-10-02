"""Pydantic schemas for the academy domain."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from datetime import time
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.modules.academy.models import (
    AbsenceReason,
    AgeBand,
    AttendanceStatus,
    BatchStatus,
    CoachStatus,
    CoachType,
    DeliveryType,
    EnrollmentStatus,
    NoteVisibility,
    PayModel,
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
    pay_model: PayModel = PayModel.FIXED
    salary: Decimal = Field(default=Decimal("0"), ge=0)
    hourly_rate: Decimal = Field(default=Decimal("0"), ge=0)
    commission_pct: Decimal = Field(default=Decimal("0"), ge=0, le=100)
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
    pay_model: PayModel | None = None
    salary: Decimal | None = Field(default=None, ge=0)
    hourly_rate: Decimal | None = Field(default=None, ge=0)
    commission_pct: Decimal | None = Field(default=None, ge=0, le=100)
    morning_available: bool | None = None
    evening_available: bool | None = None
    status: CoachStatus | None = None
    bio: str | None = None
    sport_ids: list[uuid.UUID] | None = None


class CoachOut(CoachBase):
    model_config = ORM
    id: uuid.UUID
    coach_no: str
    #: The login this coach signs in with, if they have one.
    user_id: uuid.UUID | None = None
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
    #: The struck-through "was" price per term; 0 means no offer is running.
    list_1m: Decimal = Field(default=Decimal("0"), ge=0)
    list_3m: Decimal = Field(default=Decimal("0"), ge=0)
    list_6m: Decimal = Field(default=Decimal("0"), ge=0)
    list_12m: Decimal = Field(default=Decimal("0"), ge=0)
    offer_label: str | None = Field(default=None, max_length=60)
    #: NULL sells at every branch.
    branch_id: uuid.UUID | None = None
    delivery_type: DeliveryType = DeliveryType.GROUP
    classes_per_month: int | None = Field(default=None, gt=0, le=62)
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
    list_1m: Decimal | None = Field(default=None, ge=0)
    list_3m: Decimal | None = Field(default=None, ge=0)
    list_6m: Decimal | None = Field(default=None, ge=0)
    list_12m: Decimal | None = Field(default=None, ge=0)
    offer_label: str | None = Field(default=None, max_length=60)
    branch_id: uuid.UUID | None = None
    delivery_type: DeliveryType | None = None
    classes_per_month: int | None = Field(default=None, gt=0, le=62)
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
    #: The size the academy is aiming for; past it the batch reads as nearly full.
    target_size: int | None = Field(default=None, gt=0, le=500)
    #: Weekdays the batch meets, Monday = 0. With the times below this is the
    #: schedule as data, and it is what sessions are generated from.
    days: list[int] = Field(default_factory=list)
    start_time: time | None = None
    end_time: time | None = None
    #: Free text, kept: the display schedule. Filled from `days` and the times when
    #: those are given, so the two cannot drift.
    schedule: str | None = None
    time_label: str | None = None
    location: str | None = None
    court_id: uuid.UUID | None = None
    start_date: date | None = None
    end_date: date | None = None
    status: BatchStatus = BatchStatus.ACTIVE
    color: str | None = Field(default=None, max_length=9)

    @model_validator(mode="after")
    def _schedule_is_sane(self):
        if any(d < 0 or d > 6 for d in self.days):
            raise ValueError("days must be weekdays from 0 (Monday) to 6 (Sunday)")
        if (self.start_time is None) != (self.end_time is None):
            raise ValueError("give both a start time and an end time, or neither")
        if self.start_time and self.end_time and self.end_time <= self.start_time:
            raise ValueError("the end time must be after the start time")
        if self.target_size and self.target_size > self.capacity:
            raise ValueError("the target size cannot be larger than the capacity")
        return self


class BatchCreate(BatchBase):
    pass


class BatchUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    program_id: uuid.UUID | None = None
    sport_id: uuid.UUID | None = None
    coach_id: uuid.UUID | None = None
    capacity: int | None = Field(default=None, gt=0, le=500)
    target_size: int | None = Field(default=None, gt=0, le=500)
    days: list[int] | None = None
    start_time: time | None = None
    end_time: time | None = None
    schedule: str | None = None
    time_label: str | None = None
    location: str | None = None
    court_id: uuid.UUID | None = None
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
    #: "ok", "near_full" or "full".
    capacity_state: Literal["ok", "near_full", "full"] = "ok"


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
    #: A URL from `POST /uploads` (manager and above can upload).
    photo_url: str | None = None
    branch_id: uuid.UUID | None = None
    emergency_contact_name: str | None = Field(default=None, max_length=200)
    emergency_contact_phone: str | None = Field(default=None, max_length=32)
    #: Allergies, asthma, an old injury — for staff and the coach, never the tablet.
    medical_notes: str | None = None
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
    photo_url: str | None = None
    branch_id: uuid.UUID | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    medical_notes: str | None = None
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


class PayNow(BaseModel):
    """Money received at the desk while enrolling, recorded against the new invoice."""

    amount: Decimal = Field(gt=0)
    method: Literal["cash", "upi", "card", "bank", "cheque"] = "cash"
    reference: str | None = Field(default=None, max_length=120)


class EnrollmentCreate(BaseModel):
    student_id: uuid.UUID
    batch_id: uuid.UUID
    duration: str = Field(default="3m", pattern="^(1m|3m|6m|12m)$")
    start_date: date | None = None
    discount: Decimal = Field(default=Decimal("0"), ge=0)
    pay_now: PayNow | None = None


class RenewRequest(BaseModel):
    """Renew a student's current enrolment — same batch, next term."""

    duration: str | None = Field(default=None, pattern="^(1m|3m|6m|12m)$")
    discount: Decimal = Field(default=Decimal("0"), ge=0)
    pay_now: PayNow | None = None


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
    reason: AbsenceReason | None = None
    photo_url: str | None = None
    #: On trial rather than a regular — the coach should know who is new.
    is_trial: bool = False
    #: Whether a medical note exists. The tablet sees only this flag; the text
    #: itself is `medical_note`, withheld from it.
    has_medical_note: bool = False
    medical_note: str | None = None
    emergency_contact_available: bool = False
    #: Excused absences this student has not yet made up.
    makeup_credits: int = 0


class EnrollmentWithInvoice(BaseModel):
    enrollment: EnrollmentOut
    invoice_id: uuid.UUID
    invoice_no: str
    invoice_total: Decimal
    #: Set when the batch sits above the student's assessed level for that sport.
    #: A note, not a refusal — stretching a strong student is how coaching works,
    #: and the person at the desk is better placed to judge it than this endpoint.
    level_warning: str | None = None
    #: "9 of 10 places are taken" when the batch is now nearly full.
    capacity_warning: str | None = None
    #: What is still owed on the invoice after any `pay_now`.
    balance_due: Decimal = Decimal("0")


# ── Sessions & attendance ───────────────────────────────────────────────────


class SessionCreate(BaseModel):
    batch_id: uuid.UUID
    starts_at: datetime
    duration_min: int = Field(default=60, ge=15, le=480)
    coach_id: uuid.UUID | None = None
    court_id: uuid.UUID | None = None
    notes: str | None = None


class SessionUpdate(BaseModel):
    starts_at: datetime | None = None
    duration_min: int | None = Field(default=None, ge=15, le=480)
    status: SessionStatus | None = None
    notes: str | None = None
    court_id: uuid.UUID | None = None


class SubstituteRequest(BaseModel):
    """Have someone else take one session. The original coach is remembered."""

    coach_id: uuid.UUID


class CloseSessionRequest(BaseModel):
    incident_note: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=2000)


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
    court_id: uuid.UUID | None = None
    coach_checked_in_at: datetime | None = None
    closed_at: datetime | None = None
    incident_note: str | None = None
    substitute_for_coach_id: uuid.UUID | None = None
    # Derived from attendance rows.
    students_enrolled: int = 0
    present: int = 0
    absent: int = 0


class AttendanceMark(BaseModel):
    student_id: uuid.UUID
    status: AttendanceStatus
    note: str | None = None
    #: Why they were away; only kept for an absence or an excused mark.
    reason: AbsenceReason | None = None


class AttendanceBulkMark(BaseModel):
    """Mark a whole batch at once, not one student at a time.

    `all_present` is the "mark all present, then fix the two exceptions" shortcut:
    every enrolled student not listed in `marks` is marked present. Explicit marks
    always win over it.
    """

    marks: list[AttendanceMark] = Field(default_factory=list)
    all_present: bool = False

    @model_validator(mode="after")
    def _something_to_mark(self):
        if not self.marks and not self.all_present:
            raise ValueError("send at least one mark, or set all_present")
        return self


class AttendanceOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    session_id: uuid.UUID
    student_id: uuid.UUID
    status: AttendanceStatus
    marked_at: datetime | None
    note: str | None
    reason: AbsenceReason | None = None


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


# ── Roster, profile and attention ───────────────────────────────────────────

FeeStatus = Literal["paid", "due", "none"]
RenewalState = Literal["ok", "due_soon", "lapsed", "none"]
AttentionFlag = Literal["repeat_absentee", "low_attendance", "renewal_due", "promotion_ready"]


class AssessmentCreate(BaseModel):
    sport_id: uuid.UUID | None = None
    assessed_on: date | None = None
    rating: Decimal = Field(ge=0, le=10)
    skills: list[SkillScore] = Field(default_factory=list)
    comment: str | None = Field(default=None, max_length=2000)
    assessed_by: str | None = Field(default=None, max_length=200)


class AssessmentOut(BaseModel):
    model_config = ORM

    id: uuid.UUID
    student_id: uuid.UUID
    sport_id: uuid.UUID | None
    assessed_on: date
    rating: Decimal
    skills: list[SkillScore]
    comment: str | None
    assessed_by: str | None
    created_at: datetime


class LevelEntry(BaseModel):
    sport_id: uuid.UUID
    level: SkillLevel
    assessed_on: date


class StudentRow(BaseModel):
    """One line of the students table: who, where they train, and how it is going.

    Everything after `status` is derived at request time — attendance, fee state and
    the attention flags are never stored, so they cannot go stale between a register
    being marked and somebody opening this screen.
    """

    id: uuid.UUID
    student_no: str
    name: str
    photo_url: str | None
    avatar_initials: str | None
    age: int | None
    gender: str | None
    parent_name: str | None
    phone: str | None
    status: StudentStatus
    branch_id: uuid.UUID | None = None
    #: Active coaching relationships. More than one means several sports at once.
    active_enrollments: int = 0

    program_id: uuid.UUID | None
    program_name: str | None
    sport_id: uuid.UUID | None
    batch_id: uuid.UUID | None
    batch_name: str | None
    coach_id: uuid.UUID | None
    coach_name: str | None
    levels: list[LevelEntry]

    #: Last 30 days. NULL when nothing was marked in that window — "no data" is not
    #: 0%, and the table shows a dash rather than a red zero for a new joiner.
    attendance_pct: float | None
    #: Since joining, for the profile and the standing score.
    attendance_overall_pct: float | None
    sessions_marked_30d: int
    rating: Decimal

    fee_status: FeeStatus
    pending_fee: Decimal
    renewal_date: date | None
    renewal_state: RenewalState
    #: Whole days until the term ends; negative once it has lapsed.
    days_to_renewal: int | None

    flags: list[AttentionFlag]


class AttendanceMonth(BaseModel):
    month: str  # "2026-09"
    pct: float | None
    marked: int


class RecentSession(BaseModel):
    session_id: uuid.UUID
    starts_at: datetime
    batch_name: str
    status: AttendanceStatus


class AttendanceSummary(BaseModel):
    overall_pct: float | None
    last_30_pct: float | None
    present: int
    late: int
    absent: int
    #: Told us in advance; left out of every percentage.
    excused: int = 0
    #: Excused absences not yet made up.
    makeup_credits: int = 0
    #: Absences by stated reason: {"illness": 2, "travel": 1}.
    reasons: dict[str, int] = Field(default_factory=dict)
    total: int
    #: Consecutive most-recent sessions attended (present or late).
    streak: int
    monthly: list[AttendanceMonth]
    recent: list[RecentSession]


class FeeHistoryRow(BaseModel):
    enrollment_id: uuid.UUID
    program_name: str | None
    start_date: date
    renewal_date: date
    total_fee: Decimal
    paid: Decimal
    pending: Decimal
    status: EnrollmentStatus


class FeeSummary(BaseModel):
    total_fee: Decimal
    paid: Decimal
    pending: Decimal
    history: list[FeeHistoryRow]


class Standing(BaseModel):
    """Where the student ranks among their current batch.

    Score is 60% overall rating (0-10 scaled to 100) plus 40% attendance. A weighting
    chosen so that turning up counts for nearly as much as talent — the figure is for
    a coach's conversation with a parent, not a league table.
    """

    batch_name: str | None
    batch_rank: int | None
    batch_size: int
    score: float | None


class StudentPersonal(BaseModel):
    email: str | None
    gender: str | None
    date_of_birth: date | None
    blood_group: str | None
    achievements: list[str]
    joined_on: date | None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    medical_notes: str | None = None


class StudentProfile(BaseModel):
    row: StudentRow
    personal: StudentPersonal
    promotions: list[PromotionOut]
    attendance: AttendanceSummary
    #: Oldest first, so it plots left-to-right as a trend.
    assessments: list[AssessmentOut]
    skills: list[SkillScore]
    previous_skills: list[SkillScore]
    fees: FeeSummary
    standing: Standing
    #: Every active coaching relationship, side by side — one per sport.
    enrollments: list[ActiveCoaching] = Field(default_factory=list)
    guardians: list[GuardianOut] = Field(default_factory=list)
    #: The student's next scheduled class across all their batches.
    next_class: NextClass | None = None
    lifetime: Lifetime | None = None


class AttentionItem(BaseModel):
    student_id: uuid.UUID
    student_no: str
    name: str
    photo_url: str | None
    avatar_initials: str | None
    batch_name: str | None
    sport_id: uuid.UUID | None
    #: One human sentence: "3 absences in the last 14 days".
    detail: str


class AttentionCounts(BaseModel):
    repeat_absentees: int
    low_attendance: int
    renewals_due: int
    promotion_candidates: int


class AttentionOut(BaseModel):
    counts: AttentionCounts
    repeat_absentees: list[AttentionItem]
    low_attendance: list[AttentionItem]
    renewals_due: list[AttentionItem]
    promotion_candidates: list[AttentionItem]


# ── Coach profile, payroll and reviews ──────────────────────────────────────

PayoutMethod = Literal["cash", "upi", "bank", "cheque"]


class EarningLine(BaseModel):
    """One line of how a month's pay was worked out, so nobody has to take it on trust."""

    label: str
    detail: str
    amount: Decimal


class CoachPayoutOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    coach_id: uuid.UUID
    coach_name: str
    period: date
    pay_model: PayModel
    sessions: int
    hours: Decimal
    fees_collected: Decimal
    commission_pct: Decimal
    base_amount: Decimal
    commission_amount: Decimal
    adjustment: Decimal
    adjustment_note: str | None
    total: Decimal
    method: str
    reference: str | None
    paid_on: date
    note: str | None
    paid_by: str | None


class CoachEarnings(BaseModel):
    """What a coach has earned for one month, recomputed from sessions and payments.

    `payout` is what was actually paid, if anything — and when present it is the
    record of truth, not these figures, which move with later refunds or rate changes.
    """

    coach_id: uuid.UUID
    period: date
    pay_model: PayModel
    sessions: int
    hours: Decimal
    fees_collected: Decimal
    commission_pct: Decimal
    base_amount: Decimal
    commission_amount: Decimal
    gross: Decimal
    lines: list[EarningLine]
    status: Literal["paid", "due", "nothing"]
    payout: CoachPayoutOut | None = None


class PayoutCreate(BaseModel):
    #: "2026-09". The amounts are recomputed server-side; the client never sends them.
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    adjustment: Decimal = Field(default=Decimal("0"), ge=-1_000_000, le=1_000_000)
    adjustment_note: str | None = Field(default=None, max_length=300)
    method: PayoutMethod = "bank"
    reference: str | None = Field(default=None, max_length=120)
    paid_on: date | None = None
    note: str | None = None


class PayrollRow(BaseModel):
    coach_id: uuid.UUID
    coach_no: str
    name: str
    avatar_initials: str | None
    coach_status: CoachStatus
    pay_model: PayModel
    sessions: int
    hours: Decimal
    fees_collected: Decimal
    base_amount: Decimal
    commission_amount: Decimal
    gross: Decimal
    status: Literal["paid", "due", "nothing"]
    paid_total: Decimal | None = None
    payout_id: uuid.UUID | None = None


class Payroll(BaseModel):
    period: date
    #: The academy's own current month — the last one that can be paid. The client
    #: stops navigation here rather than guessing from the browser's clock.
    current_period: date
    rows: list[PayrollRow]
    total_gross: Decimal
    total_paid: Decimal
    total_due: Decimal


class CoachReviewCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)
    student_id: uuid.UUID | None = None
    #: Used when the feedback is from someone other than a student on file.
    reviewer_name: str | None = Field(default=None, max_length=200)
    reviewed_on: date | None = None


class CoachReviewOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    coach_id: uuid.UUID
    student_id: uuid.UUID | None
    reviewer_name: str | None
    rating: int
    comment: str | None
    reviewed_on: date
    recorded_by: str | None


class CoachBatchRow(BaseModel):
    id: uuid.UUID
    name: str
    sport_id: uuid.UUID | None
    program_name: str | None
    schedule: str | None
    time_label: str | None
    location: str | None
    status: BatchStatus
    capacity: int
    enrolled: int
    #: Last 30 days; None when no register was taken in that window.
    attendance_pct: float | None


class SessionBrief(BaseModel):
    id: uuid.UUID
    batch_id: uuid.UUID
    batch_name: str
    starts_at: datetime
    ends_at: datetime
    status: SessionStatus
    marked: int
    present: int


class CoachStats(BaseModel):
    students: int
    batches: int
    sessions_completed_30d: int
    sessions_cancelled_30d: int
    hours_30d: Decimal
    #: Mean of their students' latest review scores (0–10); None if nobody is reviewed.
    avg_student_rating: float | None
    #: Mean of their students' 30-day attendance; None if no register was taken.
    student_attendance_pct: float | None
    review_count: int
    rating: Decimal


class MonthPoint(BaseModel):
    month: str  # "2026-09"
    sessions: int
    hours: Decimal
    rating: float | None
    #: Only for managers: what the month came to, and what was paid for it.
    earned: Decimal | None = None
    paid: Decimal | None = None


class CoachPay(BaseModel):
    """Everything about money, and only ever sent to a manager or admin."""

    pay_model: PayModel
    salary: Decimal
    hourly_rate: Decimal
    commission_pct: Decimal
    current: CoachEarnings
    payouts: list[CoachPayoutOut]
    paid_to_date: Decimal


class CoachProfile(BaseModel):
    coach: CoachOut
    stats: CoachStats
    batches: list[CoachBatchRow]
    students: list[StudentRow]
    students_total: int
    upcoming: list[SessionBrief]
    recent: list[SessionBrief]
    reviews: list[CoachReviewOut]
    #: Review counts for 1★…5★, in that order.
    rating_breakdown: list[int]
    monthly: list[MonthPoint]
    pay: CoachPay | None = None


class BatchAssign(BaseModel):
    batch_ids: list[uuid.UUID] = Field(min_length=1, max_length=100)


class CoachRemoval(BaseModel):
    #: "deleted" when there was no history to keep; "archived" (made inactive)
    #: when the coach has sessions, reviews, students or pay on record.
    outcome: Literal["deleted", "archived"]
    reassigned_batches: int
    reassigned_programs: int


# ── P0: guardians, notes, availability, workspace, dashboard ────────────────


class GuardianIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    relation: str | None = Field(default=None, max_length=40)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    is_primary: bool = False
    #: Pays the fees: gets invoices, payment and renewal reminders.
    is_payer: bool = False
    receives_progress: bool = True
    receives_attendance: bool = False


class GuardianOut(GuardianIn):
    model_config = ORM
    id: uuid.UUID


class GuardiansPut(BaseModel):
    """The student's complete guardian list. Exactly one primary when non-empty."""

    guardians: list[GuardianIn] = Field(default_factory=list, max_length=6)

    @model_validator(mode="after")
    def _one_primary(self):
        if self.guardians and sum(1 for g in self.guardians if g.is_primary) != 1:
            raise ValueError("mark exactly one guardian as the primary contact")
        return self


class NoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    visibility: NoteVisibility = NoteVisibility.STAFF
    session_id: uuid.UUID | None = None


class NoteOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    student_id: uuid.UUID
    session_id: uuid.UUID | None
    author_name: str
    body: str
    visibility: NoteVisibility
    created_at: datetime


class AvailabilityWindow(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start_time: time
    end_time: time

    @model_validator(mode="after")
    def _ends_after_start(self):
        if self.end_time <= self.start_time:
            raise ValueError("the end time must be after the start time")
        return self


class AvailabilityPut(BaseModel):
    windows: list[AvailabilityWindow] = Field(default_factory=list, max_length=40)


class TimeOffCreate(BaseModel):
    start_date: date
    end_date: date
    reason: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _ordered(self):
        if self.end_date < self.start_date:
            raise ValueError("the last day cannot be before the first")
        return self


class TimeOffOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    start_date: date
    end_date: date
    reason: str | None


class AvailabilityOut(BaseModel):
    windows: list[AvailabilityWindow]
    time_off: list[TimeOffOut]


class CoachLoginCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)


class CoachLoginOut(BaseModel):
    username: str
    email: str


class ActiveCoaching(BaseModel):
    """One active enrolment, with what a profile needs to show it alone."""

    enrollment_id: uuid.UUID
    program_id: uuid.UUID
    program_name: str | None
    sport_id: uuid.UUID | None
    delivery_type: DeliveryType
    batch_id: uuid.UUID
    batch_name: str | None
    schedule: str | None
    time_label: str | None
    coach_name: str | None
    start_date: date
    renewal_date: date
    duration: str
    total_fee: Decimal
    paid: Decimal
    pending: Decimal
    #: The invoice to collect against, for the quick-pay action.
    invoice_id: uuid.UUID | None = None
    invoice_no: str | None = None
    classes_per_month: int | None = None
    #: Classes attended this calendar month, and what is left of the entitlement.
    sessions_used: int = 0
    sessions_remaining: int | None = None


class NextClass(BaseModel):
    session_id: uuid.UUID
    batch_name: str
    starts_at: datetime
    court_name: str | None = None


class Lifetime(BaseModel):
    renewals: int
    lifetime_paid: Decimal
    total_classes: int
    coaches: list[str]


class GenerateSessionsRequest(BaseModel):
    #: Defaults to today, and to two weeks on.
    from_date: date | None = None
    to_date: date | None = None


class ClashOut(BaseModel):
    session_id: uuid.UUID
    starts_at: datetime
    with_what: str


class GenerateSessionsResult(BaseModel):
    created: int
    skipped_existing: int
    #: Dates on which the batch's coach is on time off — find a substitute.
    coach_away: list[date]
    clashes: list[ClashOut]


class TodaySession(BaseModel):
    session: SessionOut
    court_name: str | None = None
    coach_name: str | None = None
    #: Court clashes with a public booking or another class.
    clashes: list[str] = Field(default_factory=list)
    roster: list[RosterEntry] = Field(default_factory=list)


class TodayOut(BaseModel):
    coach_id: uuid.UUID | None
    coach_name: str | None
    date: date
    sessions: list[TodaySession]
    #: Students in this coach's batches with no review in the last 90 days.
    reviews_due: int = 0


class FeeLine(BaseModel):
    invoice_id: uuid.UUID
    invoice_no: str
    student_id: uuid.UUID | None
    student_name: str | None
    customer_name: str
    due_date: date | None
    days_overdue: int
    balance: Decimal
    bucket: Literal["overdue", "due_week", "upcoming"]


class FeesOut(BaseModel):
    overdue: Decimal
    due_this_week: Decimal
    upcoming: Decimal
    lines: list[FeeLine]


class DashboardSession(BaseModel):
    session_id: uuid.UUID
    batch_name: str
    starts_at: datetime
    coach_name: str | None
    court_name: str | None
    status: SessionStatus
    needs_coach: bool = False
    clash: bool = False


class AcademyDashboard(BaseModel):
    """What the owner opens the Academy page for — each figure leads to an action."""

    # Today
    classes_today: list[DashboardSession]
    coaches_away: list[str]
    court_conflicts: int
    trials: int
    present_today: int
    absent_today: int
    # Revenue
    collected_this_month: Decimal
    due_this_week: Decimal
    overdue: Decimal
    renewals_30d_count: int
    renewals_30d_value: Decimal
    # Students
    active_students: int
    new_this_month: int
    expiring_15d: int
    paused: int
    at_risk: int


class LevelOption(BaseModel):
    value: SkillLevel
    label: str


StudentProfile.model_rebuild()
