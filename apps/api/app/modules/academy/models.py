"""Academy: coaches, programs, batches, students, sessions, attendance."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import TenantScoped
from app.db.types import enum_type, money


class CoachType(StrEnum):
    FULL_TIME = "full-time"
    PART_TIME = "part-time"
    GUEST = "guest"
    VISITING = "visiting"


class CoachStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    ON_LEAVE = "on-leave"


class PayModel(StrEnum):
    """How a coach is paid. Which of `salary`, `hourly_rate` and `commission_pct`
    count is decided by this, so a coach can carry all three numbers without anyone
    having to blank the unused ones.
    """

    FIXED = "fixed"  # `salary`, every month
    HOURLY = "hourly"  # `hourly_rate` × hours of completed sessions
    COMMISSION = "commission"  # `commission_pct` of fees collected on their students
    HYBRID = "hybrid"  # `salary` plus the commission


class StudentStatus(StrEnum):
    ACTIVE = "active"
    #: Trying the academy out. Can be on a roster; not yet a paying regular.
    TRIAL = "trial"
    #: Taking a break. Keeps their history but **does not hold a seat** — see
    #: `service.batch_enrolment_counts`.
    PAUSED = "paused"
    COMPLETED = "completed"
    INACTIVE = "inactive"
    #: Left, and kept on file for a comeback. History stays visible on rejoining.
    ALUMNI = "alumni"
    #: Barred from new enrolments by academy policy (unpaid dues, conduct).
    RESTRICTED = "restricted"


#: Students who take up a place in a batch. A paused student keeps their history and
#: their enrolment but gives the seat back — the point of pausing — and an alumnus
#: or a completed student has left.
SEAT_STATUSES = (StudentStatus.ACTIVE, StudentStatus.TRIAL, StudentStatus.RESTRICTED)


class SessionStatus(StrEnum):
    SCHEDULED = "scheduled"
    ONGOING = "ongoing"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class BatchStatus(StrEnum):
    ACTIVE = "active"
    UPCOMING = "upcoming"
    COMPLETED = "completed"


class AttendanceStatus(StrEnum):
    PRESENT = "present"
    ABSENT = "absent"
    LATE = "late"
    #: Told us in advance. Not held against their attendance, and it earns a
    #: make-up class (see `insights.makeup_credits`).
    EXCUSED = "excused"
    #: A trial student sitting in.
    TRIAL = "trial"
    #: Attending to make up an excused absence — possibly in another batch.
    MAKEUP = "makeup"
    NOT_STARTED = "not-started"


#: Marks that count as turning up.
ATTENDED = (
    AttendanceStatus.PRESENT,
    AttendanceStatus.LATE,
    AttendanceStatus.TRIAL,
    AttendanceStatus.MAKEUP,
)
#: Marks that count at all. An excused absence leaves the denominator, so telling
#: the academy you will be away does not lower your percentage.
COUNTED = ATTENDED + (AttendanceStatus.ABSENT,)


class AbsenceReason(StrEnum):
    ILLNESS = "illness"
    TRAVEL = "travel"
    EXAM = "exam"
    NO_NOTICE = "no-notice"
    OTHER = "other"


class DeliveryType(StrEnum):
    """Group coaching runs in batches; private coaching is one student, one coach.

    A private enrolment still gets a batch — of one — so attendance, sessions and
    fees work exactly as they do for a group, and nothing downstream needs a second
    code path (see `service.private_batch`).
    """

    GROUP = "group"
    PRIVATE = "private"


class NoteVisibility(StrEnum):
    #: Every staff member and the student's coach.
    STAFF = "staff"
    #: The author, managers and admins only.
    PRIVATE = "private"


class EnrollmentStatus(StrEnum):
    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class AgeBand(StrEnum):
    """Who a programme is for. Enforced at enrolment against the student's DOB.

    Two states, not a spectrum: an academy runs a kids' programme and an adults'
    programme, and the thing staff need at the counter is which of the two a child
    belongs in. The actual boundary lives in `age_min`/`age_max` beside this,
    because "kids" is 5–16 at one academy and 4–12 at another — this names the
    group, those enforce it.
    """

    KIDS = "kids"
    ADULTS = "adults"


#: Used when a programme is given a band but no explicit bounds. Deliberately wide
#: at the top: an "adults" programme should not refuse a 70-year-old.
DEFAULT_AGE_BOUNDS: dict[AgeBand, tuple[int, int]] = {
    AgeBand.KIDS: (5, 16),
    AgeBand.ADULTS: (17, 99),
}


class SkillLevel(StrEnum):
    """The progression ladder a student climbs, per sport.

    Ordered — `LEVEL_ORDER` below turns it into something comparable, so "is this a
    promotion or a demotion" is a question the code can answer rather than a label
    someone types.
    """

    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"
    COMPETITIVE = "competitive"


LEVEL_ORDER: dict[SkillLevel, int] = {
    SkillLevel.BEGINNER: 0,
    SkillLevel.INTERMEDIATE: 1,
    SkillLevel.ADVANCED: 2,
    SkillLevel.COMPETITIVE: 3,
}
TOP_LEVEL = SkillLevel.COMPETITIVE


class Coach(TenantScoped):
    """A coach. ← `Coach` in src/pages/Coaching.tsx.

    `activeBatches` and `totalStudents` from the frontend are derived — they are
    counts over batches and enrolments, and a stored copy drifts the moment a
    student transfers between batches.
    """

    __tablename__ = "coach"
    __table_args__ = (
        Index("uq_coach_tenant_number", "tenant_id", "coach_no", unique=True),
        Index("ix_coach_tenant_status", "tenant_id", "status"),
        Index(
            "uq_coach_tenant_email",
            "tenant_id",
            text("lower(email)"),
            unique=True,
            postgresql_where=text("email IS NOT NULL"),
        ),
    )

    coach_no: Mapped[str] = mapped_column(String(32), nullable=False)  # XC-C-001
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(320))
    avatar_initials: Mapped[str | None] = mapped_column(String(4))
    gender: Mapped[str | None] = mapped_column(String(20))

    specialization: Mapped[str | None] = mapped_column(Text)
    type: Mapped[CoachType] = mapped_column(
        enum_type(CoachType, name="coach_type"), default=CoachType.FULL_TIME, nullable=False
    )
    experience_years: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    certifications: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    languages: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)

    joining_date: Mapped[date | None] = mapped_column(Date)
    pay_model: Mapped[PayModel] = mapped_column(
        enum_type(PayModel, name="coach_pay_model"), default=PayModel.FIXED, nullable=False
    )
    #: Monthly. Counts for `fixed` and `hybrid`.
    salary: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    #: Per hour taught. Counts for `hourly`.
    hourly_rate: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    #: Percent (0–100) of the fees *collected* in the month on this coach's students.
    #: Counts for `commission` and `hybrid`.
    commission_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0, nullable=False)

    morning_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    evening_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    rating: Mapped[Decimal] = mapped_column(Numeric(3, 2), default=0, nullable=False)
    status: Mapped[CoachStatus] = mapped_column(
        enum_type(CoachStatus, name="coach_status"), default=CoachStatus.ACTIVE, nullable=False
    )
    bio: Mapped[str | None] = mapped_column(Text)

    # A coach who also logs in to the app. Nullable because most do not.
    user_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True))

    sports: Mapped[list[CoachSport]] = relationship(
        back_populates="coach", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Coach {self.coach_no} {self.name}>"


class CoachSport(TenantScoped):
    """Which sports a coach teaches.

    `Coach.sport: string[]` in the frontend becomes a join table, because `sport` is
    a real entity here and the coaches list filters by it — a JSONB array of names
    would need a scan and would break the moment a sport is renamed.
    """

    __tablename__ = "coach_sport"
    __table_args__ = (
        Index("uq_coach_sport_tenant_pair", "tenant_id", "coach_id", "sport_id", unique=True),
    )

    coach_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("coach.id", ondelete="CASCADE"), nullable=False
    )
    sport_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("sport.id", ondelete="CASCADE"), nullable=False
    )

    coach: Mapped[Coach] = relationship(back_populates="sports")


class CoachAvailability(TenantScoped):
    """One weekly window a coach can teach: "Monday 16:00–21:00".

    Several rows per weekday are fine (a split shift). Exceptions — a week off, a
    tournament — are `CoachTimeOff`, never edits to this pattern.
    """

    __tablename__ = "coach_availability"
    __table_args__ = (
        Index("ix_coach_availability_tenant_coach", "tenant_id", "coach_id"),
        CheckConstraint("weekday >= 0 AND weekday <= 6", name="weekday_in_range"),
        CheckConstraint("end_time > start_time", name="ends_after_starts"),
    )

    coach_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("coach.id", ondelete="CASCADE"), nullable=False
    )
    #: Monday is 0, as in Python's `date.weekday()`.
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)


class CoachTimeOff(TenantScoped):
    """Dates a coach is away. Inclusive at both ends."""

    __tablename__ = "coach_time_off"
    __table_args__ = (
        Index("ix_coach_time_off_tenant_coach", "tenant_id", "coach_id", "start_date"),
        CheckConstraint("end_date >= start_date", name="ends_after_starts"),
    )

    coach_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("coach.id", ondelete="CASCADE"), nullable=False
    )
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(200))


class CoachReview(TenantScoped):
    """Feedback on a coach, from a student or parent, recorded by staff.

    Kept as events so the profile can show a trend and the actual words, and
    `coach.rating` is their average — a cache written by the endpoint, the same
    arrangement as `student.performance_rating`. A coach with no reviews keeps
    whatever figure they had before.
    """

    __tablename__ = "coach_review"
    __table_args__ = (
        Index("ix_coach_review_tenant_coach", "tenant_id", "coach_id", "reviewed_on"),
        CheckConstraint("rating >= 1 AND rating <= 5", name="rating_in_range"),
    )

    coach_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("coach.id", ondelete="CASCADE"), nullable=False
    )
    #: Which student it came from, when known. SET NULL: a review outlives a student
    #: record that has been cleaned up.
    student_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("student.id", ondelete="SET NULL")
    )
    #: Who said it, as a name — "Meera (Aarav's mother)" is as common as a student.
    reviewer_name: Mapped[str | None] = mapped_column(String(200))
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text)
    reviewed_on: Mapped[date] = mapped_column(Date, nullable=False)
    #: The staff member who entered it, as a name, for the same reason as elsewhere.
    recorded_by: Mapped[str | None] = mapped_column(String(200))


class CoachPayout(TenantScoped):
    """Money paid to a coach for one month.

    **The amounts are a snapshot.** Earnings are computed from sessions and payments
    as they stand when the payout is recorded, then frozen here: a later refund or a
    changed commission rate must not rewrite what was actually handed over. What a
    month *would* come to now is always recomputed (`payroll.compute_earnings`); what
    it *did* come to is this row.

    One per coach per month, which is what stops the same month being paid twice.
    A payout made in error is deleted (admin only) and recorded again.
    """

    __tablename__ = "coach_payout"
    __table_args__ = (
        Index("uq_coach_payout_month", "tenant_id", "coach_id", "period", unique=True),
        Index("ix_coach_payout_tenant_period", "tenant_id", "period"),
        CheckConstraint("total >= 0", name="total_not_negative"),
    )

    #: RESTRICT: pay history is a financial record; a coach who has been paid is
    #: archived, never deleted (see `router.remove_coach`).
    coach_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("coach.id", ondelete="RESTRICT"), nullable=False
    )
    coach_name: Mapped[str] = mapped_column(String(200), nullable=False)  # snapshot
    #: First day of the month paid for.
    period: Mapped[date] = mapped_column(Date, nullable=False)

    pay_model: Mapped[PayModel] = mapped_column(
        enum_type(PayModel, name="coach_pay_model"), nullable=False
    )
    sessions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    hours: Mapped[Decimal] = mapped_column(Numeric(8, 2), default=0, nullable=False)
    fees_collected: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    commission_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0, nullable=False)

    base_amount: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    commission_amount: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    #: Signed — a bonus is positive, a deduction negative — with the reason beside it.
    adjustment: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    adjustment_note: Mapped[str | None] = mapped_column(String(300))
    total: Mapped[Decimal] = mapped_column(money(), nullable=False)

    method: Mapped[str] = mapped_column(String(20), default="bank", nullable=False)
    reference: Mapped[str | None] = mapped_column(String(120))
    paid_on: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    paid_by: Mapped[str | None] = mapped_column(String(200))


class Program(TenantScoped):
    """A coaching programme. ← `CoachingProgram`."""

    __tablename__ = "program"
    __table_args__ = (Index("uq_program_tenant_name", "tenant_id", "name", unique=True),)

    name: Mapped[str] = mapped_column(String(150), nullable=False)
    sport_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("sport.id", ondelete="RESTRICT")
    )

    #: Where this programme sits on the ladder. NULL means the programme predates
    #: levelling, or is genuinely mixed-ability — either way, no level check runs.
    skill_level: Mapped[SkillLevel | None] = mapped_column(
        enum_type(SkillLevel, name="skill_level")
    )

    #: Kids or adults. **NULL means unrestricted**, which is what every programme
    #: created before this existed carries — so the migration cannot start refusing
    #: enrolments that worked yesterday. The check switches on only once a band is
    #: set deliberately.
    age_band: Mapped[AgeBand | None] = mapped_column(enum_type(AgeBand, name="age_band"))
    #: The enforced bounds, inclusive, in years at the *start of the term*. Set from
    #: DEFAULT_AGE_BOUNDS when a band is chosen without explicit numbers.
    age_min: Mapped[int | None] = mapped_column(Integer)
    age_max: Mapped[int | None] = mapped_column(Integer)

    #: Free text, kept: "6–14 yrs" as staff wrote it. Superseded by the three fields
    #: above for anything that decides something, and left alone because it is the
    #: only record of what a pre-existing programme meant.
    age_group: Mapped[str | None] = mapped_column(String(50))
    level: Mapped[str | None] = mapped_column(String(50))  # legacy free text
    duration_label: Mapped[str | None] = mapped_column(String(50))  # "3 Months"
    max_students: Mapped[int] = mapped_column(Integer, default=12, nullable=False)
    session_freq: Mapped[str | None] = mapped_column(String(50))  # "3 sessions/week"
    session_duration: Mapped[str | None] = mapped_column(String(50))  # "60 min"
    coach_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("coach.id", ondelete="SET NULL")
    )
    location: Mapped[str | None] = mapped_column(String(150))

    fee_1m: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    fee_3m: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    fee_6m: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    fee_12m: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)

    #: The "was" price shown struck through beside the fee. 0 means no offer is
    #: running for that term. Display only — what is charged is always `fee_*`.
    list_1m: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    list_3m: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    list_6m: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    list_12m: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    #: "Festive offer", "Early bird" — shown with the struck-through price.
    offer_label: Mapped[str | None] = mapped_column(String(60))

    #: Which venue sells this. NULL means every branch.
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("branch.id", ondelete="SET NULL")
    )
    delivery_type: Mapped[DeliveryType] = mapped_column(
        enum_type(DeliveryType, name="delivery_type"), default=DeliveryType.GROUP, nullable=False
    )
    #: Classes a student is entitled to per month, for "sessions used / remaining".
    #: NULL when the plan is open-ended ("come to every batch session").
    classes_per_month: Mapped[int | None] = mapped_column(Integer)

    color: Mapped[str | None] = mapped_column(String(9))
    bg_color: Mapped[str | None] = mapped_column(String(9))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    def list_price_for(self, duration: str) -> Decimal:
        return {"1m": self.list_1m, "3m": self.list_3m, "6m": self.list_6m, "12m": self.list_12m}[
            duration
        ]

    def fee_for(self, duration: str) -> Decimal:
        return {"1m": self.fee_1m, "3m": self.fee_3m, "6m": self.fee_6m, "12m": self.fee_12m}[
            duration
        ]

    def age_bounds(self) -> tuple[int, int] | None:
        """The inclusive age range this programme admits, or None if unrestricted.

        Explicit bounds win over the band's defaults, so an academy that runs its
        kids' football to 14 rather than 16 says so once and is believed. A band
        with no bounds falls back to DEFAULT_AGE_BOUNDS rather than to "anyone",
        because a band that admits everybody is not a band.
        """
        if self.age_band is None and self.age_min is None and self.age_max is None:
            return None

        default_min, default_max = (
            DEFAULT_AGE_BOUNDS[self.age_band] if self.age_band else (0, 200)
        )
        return (
            self.age_min if self.age_min is not None else default_min,
            self.age_max if self.age_max is not None else default_max,
        )


class Batch(TenantScoped):
    """A scheduled group. ← `Batch`.

    `enrolled` and the `full` status are derived from `student_enrollment` — a
    stored count and a real enrolment row are two things that can disagree, and the
    capacity check would then admit a student into a full batch.
    """

    __tablename__ = "batch"
    __table_args__ = (
        Index("uq_batch_tenant_name", "tenant_id", "name", unique=True),
        Index("ix_batch_tenant_coach", "tenant_id", "coach_id"),
        Index("ix_batch_tenant_program", "tenant_id", "program_id"),
        CheckConstraint("capacity > 0", name="capacity_positive"),
    )

    name: Mapped[str] = mapped_column(String(150), nullable=False)
    sport_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("sport.id", ondelete="RESTRICT")
    )
    program_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("program.id", ondelete="RESTRICT"), nullable=False
    )
    coach_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("coach.id", ondelete="SET NULL")
    )

    capacity: Mapped[int] = mapped_column(Integer, default=12, nullable=False)
    #: The size the academy is aiming for. Past this the batch is "nearly full" and
    #: the enrol screen says so; `capacity` is the hard stop.
    target_size: Mapped[int | None] = mapped_column(Integer)

    #: The schedule as data: weekdays (Monday 0) and a daily time. This is what
    #: sessions are generated from. `schedule` and `time_label` below are the same
    #: thing as display text, kept for every screen that already prints them.
    days: Mapped[list[int]] = mapped_column(JSONB, default=list, server_default="[]", nullable=False)
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)
    schedule: Mapped[str | None] = mapped_column(String(100))  # "Mon · Wed · Fri"
    time_label: Mapped[str | None] = mapped_column(String(50))  # "6:30 AM – 7:30 AM"

    #: The court this batch plays on. Its sessions inherit it, and a public booking
    #: on that court at the same time shows up as a conflict.
    court_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("court.id", ondelete="SET NULL")
    )
    location: Mapped[str | None] = mapped_column(String(150))
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[BatchStatus] = mapped_column(
        enum_type(BatchStatus, name="batch_status"), default=BatchStatus.ACTIVE, nullable=False
    )
    color: Mapped[str | None] = mapped_column(String(9))


class Student(TenantScoped):
    """An academy student. ← `Student`.

    Two changes from the frontend interface:

    `age: number` becomes `date_of_birth`. An age column is wrong within a year of
    being written, and Coaching.tsx filters by age group.

    The enrolment fields (`programId`, `batchId`, `coachId`, `joiningDate`,
    `renewalDate`, `totalFee`, `pendingFee`) move to `student_enrollment`. Inline,
    they model a student as being in exactly one batch forever and destroy the
    history on renewal or transfer — and there is nowhere to hang the fee invoice.
    """

    __tablename__ = "student"
    __table_args__ = (
        Index("uq_student_tenant_number", "tenant_id", "student_no", unique=True),
        Index("ix_student_tenant_status", "tenant_id", "status"),
        Index("ix_student_tenant_name", "tenant_id", "name"),
    )

    student_no: Mapped[str] = mapped_column(String(32), nullable=False)  # XC-S-001
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    parent_name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(320))
    avatar_initials: Mapped[str | None] = mapped_column(String(4))
    gender: Mapped[str | None] = mapped_column(String(20))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    blood_group: Mapped[str | None] = mapped_column(String(8))

    status: Mapped[StudentStatus] = mapped_column(
        enum_type(StudentStatus, name="student_status"),
        default=StudentStatus.ACTIVE,
        nullable=False,
    )
    #: The latest review's overall score — a cache of the newest `student_assessment`
    #: so list screens do not have to join for it. The reviews are the history; this
    #: is only ever their most recent value (or a hand-entered figure on a student
    #: who has not been reviewed yet).
    performance_rating: Mapped[Decimal] = mapped_column(Numeric(4, 2), default=0, nullable=False)

    #: A URL from `POST /uploads`, not the image itself.
    photo_url: Mapped[str | None] = mapped_column(Text)

    #: Where they mainly train. One student record serves every branch; this is only
    #: the home location, for filtering and for the venue on their documents.
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("branch.id", ondelete="SET NULL")
    )

    emergency_contact_name: Mapped[str | None] = mapped_column(String(200))
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(32))
    #: Allergies, asthma, an old injury. Shown to staff and the student's coach;
    #: the counter tablet only ever sees that a note *exists*.
    medical_notes: Mapped[str | None] = mapped_column(Text)

    achievements: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    # [{"name": "Forehand", "score": 7}] — genuinely document-shaped, rendered as a
    # radar chart and never queried across students.
    skills: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)

    # Links a student to the payer's customer record, so academy fees and court
    # bookings roll up to one person.
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("customer.id", ondelete="SET NULL")
    )

    def age_on(self, today: date) -> int | None:
        if self.date_of_birth is None:
            return None
        born = self.date_of_birth
        return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


class StudentGuardian(TenantScoped):
    """A parent or guardian, and what they should hear about.

    Separate rows rather than `parent_name` on the student because the real shape
    is "mother pays and gets reminders, father only wants the progress report". The
    primary guardian is mirrored onto `student.parent_name`/`phone` so every screen
    that already prints those keeps working.
    """

    __tablename__ = "student_guardian"
    __table_args__ = (
        Index("ix_student_guardian_tenant_student", "tenant_id", "student_id"),
        Index(
            "uq_student_guardian_primary",
            "tenant_id",
            "student_id",
            unique=True,
            postgresql_where=text("is_primary"),
        ),
    )

    student_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("student.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    relation: Mapped[str | None] = mapped_column(String(40))  # "Mother"
    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(320))
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    #: Pays the fees: receives invoices, payment and renewal reminders.
    is_payer: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    receives_progress: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    receives_attendance: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class StudentNote(TenantScoped):
    """A quick note on a student — "focus on footwork recovery next week".

    Short and frequent by design, unlike a review. Who wrote it is kept as a name
    as well as an id, so it still reads correctly after their account is gone.
    """

    __tablename__ = "student_note"
    __table_args__ = (Index("ix_student_note_tenant_student", "tenant_id", "student_id", "created_at"),)

    student_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("student.id", ondelete="CASCADE"), nullable=False
    )
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("coaching_session.id", ondelete="SET NULL")
    )
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True))
    author_name: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    visibility: Mapped[NoteVisibility] = mapped_column(
        enum_type(NoteVisibility, name="note_visibility"), default=NoteVisibility.STAFF, nullable=False
    )


class StudentEnrollment(TenantScoped):
    """A student's place in a batch for one paid term.

    Extracted from the frontend's flat `Student` so that renewals and batch
    transfers accumulate rather than overwrite: the current enrolment is the active
    row, and the endpoint flattens it back into the shape Coaching.tsx renders.
    """

    __tablename__ = "student_enrollment"
    __table_args__ = (
        Index("ix_student_enrollment_tenant_student", "tenant_id", "student_id"),
        Index("ix_student_enrollment_tenant_batch", "tenant_id", "batch_id"),
        Index("ix_student_enrollment_tenant_status", "tenant_id", "status"),
        # One live enrolment per student per batch. A student may re-enrol in the
        # same batch next term, so the constraint is partial on the active status.
        Index(
            "uq_student_enrollment_active",
            "tenant_id",
            "student_id",
            "batch_id",
            unique=True,
            postgresql_where=text("status = 'active'"),
        ),
    )

    student_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("student.id", ondelete="CASCADE"), nullable=False
    )
    program_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("program.id", ondelete="RESTRICT"), nullable=False
    )
    batch_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("batch.id", ondelete="RESTRICT"), nullable=False
    )
    coach_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("coach.id", ondelete="SET NULL")
    )

    duration: Mapped[str] = mapped_column(String(8), default="3m", nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    renewal_date: Mapped[date] = mapped_column(Date, nullable=False)
    total_fee: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    status: Mapped[EnrollmentStatus] = mapped_column(
        enum_type(EnrollmentStatus, name="enrollment_status"),
        default=EnrollmentStatus.ACTIVE,
        nullable=False,
    )


class StudentSportLevel(TenantScoped):
    """Where a student currently stands in one sport.

    Per sport, not per student: a child can be advanced at tennis and a beginner at
    football, and a single column would force one of those to be a lie. The row is
    the *current* standing only — how they got here is `StudentPromotion`.
    """

    __tablename__ = "student_sport_level"
    __table_args__ = (
        # One standing per student per sport. Without this, two assessments recorded
        # in the same week leave the student at two levels and every read picks one
        # arbitrarily.
        Index(
            "uq_student_sport_level",
            "tenant_id",
            "student_id",
            "sport_id",
            unique=True,
        ),
    )

    student_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("student.id", ondelete="CASCADE"), nullable=False
    )
    sport_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("sport.id", ondelete="CASCADE"), nullable=False
    )
    level: Mapped[SkillLevel] = mapped_column(
        enum_type(SkillLevel, name="skill_level"), nullable=False
    )
    #: When this standing was last reviewed — not when the row was written. A level
    #: nobody has looked at in two years is a different thing from a fresh one.
    assessed_on: Mapped[date] = mapped_column(Date, nullable=False)


class StudentPromotion(TenantScoped):
    """A movement on the ladder — up or down.

    Kept as events rather than only a current level because the question a parent
    asks is "has she moved up this year?", and a single mutable column cannot answer
    it. Demotions are recorded the same way: `LEVEL_ORDER` tells the two apart, so
    nothing needs a separate table or a direction flag.

    Not an append-only ledger, unlike `audit_log`. A promotion entered against the
    wrong child is a clerical slip staff should be able to erase, and nothing
    financial or legal hangs off these rows.
    """

    __tablename__ = "student_promotion"
    __table_args__ = (
        Index("ix_student_promotion_tenant_student", "tenant_id", "student_id", "assessed_on"),
    )

    student_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("student.id", ondelete="CASCADE"), nullable=False
    )
    sport_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("sport.id", ondelete="CASCADE"), nullable=False
    )
    #: NULL for the first assessment — a student arriving at a level rather than
    #: moving from one. Distinct from "moved from beginner", which is a real event.
    from_level: Mapped[SkillLevel | None] = mapped_column(enum_type(SkillLevel, name="skill_level"))
    to_level: Mapped[SkillLevel] = mapped_column(
        enum_type(SkillLevel, name="skill_level"), nullable=False
    )
    assessed_on: Mapped[date] = mapped_column(Date, nullable=False)
    #: The coach who made the call, as a name rather than an FK — it has to keep
    #: answering "who promoted her?" after that coach leaves and their row goes.
    assessed_by: Mapped[str | None] = mapped_column(String(200))
    note: Mapped[str | None] = mapped_column(Text)


class StudentAssessment(TenantScoped):
    """One dated review of a student: an overall score, the skill scores behind it,
    and what the coach had to say.

    Kept as events rather than overwriting `student.skills`, for the same reason
    promotions are: a parent asks "is she improving?", and a single mutable set of
    numbers cannot show a trend. The newest review is mirrored onto the student
    (see `router.add_assessment`) so existing screens that read the student keep
    working.

    Distinct from `StudentPromotion`. A review scores *how well* someone is playing
    now; a promotion records a *decision to move them up the ladder*. They often
    happen together, and neither implies the other.
    """

    __tablename__ = "student_assessment"
    __table_args__ = (
        Index("ix_student_assessment_tenant_student", "tenant_id", "student_id", "assessed_on"),
        CheckConstraint("rating >= 0 AND rating <= 10", name="rating_in_range"),
    )

    student_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("student.id", ondelete="CASCADE"), nullable=False
    )
    #: Which sport it reviews. NULL for a general review. SET NULL rather than
    #: CASCADE: retiring a sport must not erase a child's review history.
    sport_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("sport.id", ondelete="SET NULL")
    )
    assessed_on: Mapped[date] = mapped_column(Date, nullable=False)
    rating: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False)
    #: [{"name": "Forehand", "score": 7}] — the same shape as `student.skills`.
    skills: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text)
    #: The reviewer as a name, not an FK — it has to keep answering "who wrote this?"
    #: after that person's account is gone. Same reasoning as `student_promotion`.
    assessed_by: Mapped[str | None] = mapped_column(String(200))


class CoachingSession(TenantScoped):
    """One class. ← `Session`.

    Named CoachingSession rather than Session so it cannot be confused with a
    SQLAlchemy session anywhere in this codebase; the table is still `session`.

    `studentsEnrolled`, `present` and `absent` are derived from `attendance` rows.
    """

    __tablename__ = "coaching_session"
    __table_args__ = (
        Index("ix_coaching_session_tenant_batch", "tenant_id", "batch_id", "starts_at"),
        Index("ix_coaching_session_tenant_starts", "tenant_id", "starts_at"),
        Index("ix_coaching_session_tenant_coach", "tenant_id", "coach_id"),
        CheckConstraint("ends_at > starts_at", name="ends_after_starts"),
    )

    batch_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("batch.id", ondelete="CASCADE"), nullable=False
    )
    coach_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("coach.id", ondelete="SET NULL")
    )
    sport_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("sport.id", ondelete="SET NULL")
    )
    batch_name: Mapped[str] = mapped_column(String(150), nullable=False)  # snapshot

    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_min: Mapped[int] = mapped_column(Integer, default=60, nullable=False)

    status: Mapped[SessionStatus] = mapped_column(
        enum_type(SessionStatus, name="coaching_session_status"),
        default=SessionStatus.SCHEDULED,
        nullable=False,
    )
    notes: Mapped[str | None] = mapped_column(Text)

    court_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("court.id", ondelete="SET NULL")
    )
    #: When the coach said they had arrived — the coach's own attendance.
    coach_checked_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: When the coach (or staff) closed the session out.
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    incident_note: Mapped[str | None] = mapped_column(Text)
    #: Set when someone else taught it. `coach_id` is then the substitute — who gets
    #: the hours — and this keeps who it was meant to be.
    substitute_for_coach_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("coach.id", ondelete="SET NULL")
    )


class Attendance(TenantScoped):
    """One student's attendance at one session. ← the `attendanceToday` array."""

    __tablename__ = "attendance"
    __table_args__ = (
        # Marking the same student twice for one session would double-count them in
        # every attendance percentage on the dashboard.
        Index(
            "uq_attendance_tenant_session_student",
            "tenant_id",
            "session_id",
            "student_id",
            unique=True,
        ),
        Index("ix_attendance_tenant_student", "tenant_id", "student_id"),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("coaching_session.id", ondelete="CASCADE"), nullable=False
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("student.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[AttendanceStatus] = mapped_column(
        enum_type(AttendanceStatus, name="attendance_status"),
        default=AttendanceStatus.NOT_STARTED,
        nullable=False,
    )
    marked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    marked_by_user_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True))
    note: Mapped[str | None] = mapped_column(Text)
    #: Why they were away, for an absence or an excused mark.
    reason: Mapped[AbsenceReason | None] = mapped_column(enum_type(AbsenceReason, name="absence_reason"))


class AcademyReminder(TenantScoped):
    """One reminder that has been sent, so the same one is never sent twice.

    The worker runs every few minutes; without this, "your term ends in 7 days"
    would arrive on every pass of that day. Keyed by what it is about (`ref_id`, an
    enrolment or an invoice), the kind, and the stage ("7d", "overdue-3").
    """

    __tablename__ = "academy_reminder"
    __table_args__ = (
        Index("uq_academy_reminder", "tenant_id", "kind", "ref_id", "stage", unique=True),
    )

    kind: Mapped[str] = mapped_column(String(32), nullable=False)  # "renewal" | "payment"
    ref_id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), nullable=False)
    stage: Mapped[str] = mapped_column(String(16), nullable=False)
    #: Who it went to, for the record. Empty when nobody had an address and only the
    #: staff task was raised.
    recipients: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
