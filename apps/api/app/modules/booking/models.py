"""Booking domain: sports, courts, equipment, customers, bookings."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, TSTZRANGE, ExcludeConstraint
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import TenantScoped
from app.db.types import enum_type, money


class BookingStatus(StrEnum):
    UPCOMING = "upcoming"
    ACTIVE = "active"
    COMPLETED = "completed"
    OVERDUE = "overdue"
    CANCELLED = "cancelled"


class PaymentStatus(StrEnum):
    PAID = "paid"
    PENDING = "pending"
    PARTIAL = "partial"
    REFUNDED = "refunded"


class BookingType(StrEnum):
    WALKIN = "walkin"
    ONLINE = "online"


class MemberType(StrEnum):
    MEMBER = "member"
    NON_MEMBER = "non-member"


class MembershipTier(StrEnum):
    GOLD = "gold"
    SILVER = "silver"
    BRONZE = "bronze"


class Gender(StrEnum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"


class EquipmentCondition(StrEnum):
    EXCELLENT = "excellent"
    GOOD = "good"
    FAIR = "fair"
    POOR = "poor"


class EquipmentMode(StrEnum):
    """Whether an add-on leaves the venue for good or comes back."""

    RENT = "rent"
    BUY = "buy"


class EquipmentUnit(StrEnum):
    """What one unit of an add-on line means — a single item, or a bulk pack."""

    SINGLE = "single"
    PACK = "pack"


class MovementKind(StrEnum):
    """Every way equipment changes state. The ledger the counters derive from."""

    ISSUE = "issue"
    RETURN = "return"
    TO_MAINTENANCE = "to_maintenance"
    FROM_MAINTENANCE = "from_maintenance"
    LOST = "lost"
    RESTOCK = "restock"
    ADJUST = "adjust"
    WRITE_OFF = "write_off"


class BookingEventKind(StrEnum):
    """Mirrors the timeline types in src/pages/BookingsList.tsx."""

    CREATED = "created"
    CHECKED_IN = "checked_in"
    EXTENDED = "extended"
    EQUIPMENT = "equipment"
    PAYMENT = "payment"
    INVOICE = "invoice"
    EDIT = "edit"
    NOTE = "note"
    CANCELLED = "cancelled"


class Sport(TenantScoped):
    """A sport offered by the academy. ← `Sport` in src/data/mockData.ts.

    `Sport.courts: string[]` is not stored — it is the inverse of `court.sport_id`.
    `pricing: {base, peak, weekend}` is flattened to three columns rather than JSONB:
    it is a fixed three-field shape that gets compared and filtered, not a document.
    """

    __tablename__ = "sport"
    __table_args__ = (
        Index("uq_sport_tenant_slug", "tenant_id", "slug", unique=True),
        Index("uq_sport_tenant_name", "tenant_id", "name", unique=True),
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(16))  # emoji, e.g. "🎾"
    color: Mapped[str | None] = mapped_column(String(9))
    bg_color: Mapped[str | None] = mapped_column(String(9))
    default_duration_min: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    price_base: Mapped[Decimal] = mapped_column(money(), nullable=False)
    price_peak: Mapped[Decimal] = mapped_column(money(), nullable=False)
    price_weekend: Mapped[Decimal] = mapped_column(money(), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    courts: Mapped[list[Court]] = relationship(back_populates="sport")

    def __repr__(self) -> str:
        return f"<Sport {self.name}>"


class Court(TenantScoped):
    """A bookable playing surface. ← `Court`.

    `Court.status` from the frontend is deliberately split. `available`, `occupied`
    and `booked` are *derived* from the bookings table at a given instant — storing
    them guarantees they go stale the moment a booking starts or ends, and nothing
    would be responsible for correcting them. Only `maintenance` is a real stored
    state, held as `is_bookable = false` plus a note. The availability endpoint
    recomposes the status the UI already renders.
    """

    __tablename__ = "court"
    __table_args__ = (
        Index("uq_court_tenant_code", "tenant_id", "code", unique=True),
        Index("ix_court_tenant_sport", "tenant_id", "sport_id"),
        CheckConstraint(
            "rating IS NULL OR (rating >= 0 AND rating <= 5)", name="rating_within_range"
        ),
        # An open-slot court without a capacity has no way to decide when it is
        # full, so the two fields are only meaningful together.
        CheckConstraint(
            "NOT open_slots_enabled OR slot_capacity >= 1", name="open_slots_needs_capacity"
        ),
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    sport_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("sport.id", ondelete="RESTRICT"), nullable=False
    )
    hourly_rate: Mapped[Decimal] = mapped_column(money(), nullable=False)
    peak_rate: Mapped[Decimal] = mapped_column(money(), nullable=False)
    #: Up to five, capped in the Pydantic schema rather than here — "how many photos
    #: does the form allow" is interface policy that will change, not an invariant.
    images: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    operating_hours: Mapped[dict[str, str]] = mapped_column(
        JSONB, default=lambda: {"open": "06:00", "close": "22:00"}, nullable=False
    )
    #: The facility chips: floodlights, washroom, parking, seating…
    amenities: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    #: Entered by the venue, not computed from customer reviews — there is no review
    #: model, and inventing an average from nothing would be a lie with a decimal point.
    rating: Mapped[Decimal | None] = mapped_column(Numeric(2, 1))
    display_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # ── Open slots ───────────────────────────────────────────────────────────
    #
    # A court where strangers join the same session — five-a-side looking for a
    # sixth — rather than one booking taking the whole surface. `slot_capacity` is
    # how many can join before it is full.
    #
    # This is why `Booking.open_slot` exists: the exclusion constraint that stops
    # double-booking cannot read this column (an exclusion constraint sees only its
    # own table), so the flag is stamped onto each booking at creation and the
    # constraint skips the ones carrying it. Capacity is then enforced in
    # service.ensure_slot_free, under a row lock on this court.
    open_slots_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    slot_capacity: Mapped[int | None] = mapped_column(Integer)

    is_bookable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    maintenance_note: Mapped[str | None] = mapped_column(Text)

    sport: Mapped[Sport] = relationship(back_populates="courts")

    def __repr__(self) -> str:
        return f"<Court {self.name}>"


class Equipment(TenantScoped):
    """Rentable kit. ← `Equipment`.

    The four quantity columns are denormalised counters; `equipment_movement` is the
    truth. They are maintained in the same transaction as the movement that changes
    them, and the CHECK below means any drift is a constraint violation at write
    time rather than a silent inventory discrepancy discovered at stocktake.

    `published_to_pos` is the line between back-office Inventory and what a walk-in
    customer actually sees at the counter — an item can exist, be tracked and be
    restocked here for a while before anyone decides to sell it. `sport_id` is
    nullable: general kit (towels, water) has no sport of its own.
    """

    __tablename__ = "equipment"
    __table_args__ = (
        Index("uq_equipment_tenant_barcode", "tenant_id", "barcode", unique=True),
        Index("ix_equipment_tenant_category", "tenant_id", "category"),
        Index("ix_equipment_tenant_sport", "tenant_id", "sport_id"),
        CheckConstraint(
            "qty_available + qty_issued + qty_maintenance + qty_lost = qty_stock",
            name="quantities_balance",
        ),
        CheckConstraint(
            "qty_available >= 0 AND qty_issued >= 0 AND qty_maintenance >= 0 AND qty_lost >= 0",
            name="quantities_non_negative",
        ),
        CheckConstraint("pack_size >= 1", name="pack_size_at_least_one"),
    )

    name: Mapped[str] = mapped_column(String(150), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    barcode: Mapped[str] = mapped_column(String(64), nullable=False)

    # Two prices, because the same item is often both. A racket rents by the
    # session or sells outright; a shuttlecock sells by the tube or goes out with
    # a court hire. Which ones are actually offered is stated explicitly rather
    # than inferred from a non-zero price — a free loan is a legitimate offer, and
    # a price of 0 is not the same as "not for sale".
    rental_price: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    sale_price: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    for_rent: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    for_sale: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Packs are a *purchase* concept: you buy a tube of three shuttles, you rent
    # one racket. `pack_size` is how many base units are in a pack, and stock is
    # always counted in base units — so selling one 3-pack draws 3 off the shelf.
    # Counting packs instead would make "0 packs but 7 loose balls" unrepresentable.
    pack_size: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    pack_price: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)

    deposit: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    condition: Mapped[EquipmentCondition] = mapped_column(
        enum_type(EquipmentCondition, name="equipment_condition"),
        default=EquipmentCondition.GOOD,
        nullable=False,
    )

    qty_stock: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    qty_available: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    qty_issued: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    qty_maintenance: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    qty_lost: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    low_stock_threshold: Mapped[int] = mapped_column(Integer, default=3, nullable=False)

    sport_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("sport.id", ondelete="SET NULL")
    )
    published_to_pos: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    image_url: Mapped[str | None] = mapped_column(Text)
    # A consumable is sold and gone (a ball, a shuttlecock); the alternative is kit
    # that leaves and comes back (a bat, a locker key) via issue/return movements
    # and a deposit. This is a POS/UI hint, not an enforcement — either kind can
    # still have any movement recorded against it.
    consumable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    sport: Mapped[Sport | None] = relationship()

    def __repr__(self) -> str:
        return f"<Equipment {self.name} {self.qty_available}/{self.qty_stock}>"


class EquipmentMovement(TenantScoped):
    """Append-only inventory ledger — the source of truth behind Equipment's counters."""

    __tablename__ = "equipment_movement"
    __table_args__ = (
        Index("ix_equipment_movement_tenant_equipment", "tenant_id", "equipment_id", "occurred_at"),
        Index("ix_equipment_movement_tenant_booking", "tenant_id", "booking_id"),
        CheckConstraint("qty > 0", name="qty_positive"),
    )

    equipment_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("equipment.id", ondelete="RESTRICT"), nullable=False
    )
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("booking.id", ondelete="SET NULL")
    )
    kind: Mapped[MovementKind] = mapped_column(
        enum_type(MovementKind, name="equipment_movement_kind"), nullable=False
    )
    qty: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True))
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


class Customer(TenantScoped):
    """Someone who books. ← `Customer`.

    `totalBookings`, `totalSpent` and `outstandingDues` from the frontend interface
    are deliberately absent: they are rollups over bookings and payments, computed
    at read time by the customer-detail endpoint. Stored counters here would be the
    classic denormalisation that drifts the first time a booking is edited or
    refunded, and nothing would notice.

    The extra fields (`date_of_birth` onwards) come from the New Membership wizard
    in src/pages/Membership.tsx, which collects them but has nowhere to put them.
    """

    __tablename__ = "customer"
    __table_args__ = (
        # Phone is the practical identity at a reception desk, and per-tenant unique.
        Index("uq_customer_tenant_phone", "tenant_id", "phone", unique=True),
        # Functional unique on lower(email), and only where email is present:
        # a partial index lets many customers have no email while still preventing
        # two accounts differing only in case.
        Index(
            "uq_customer_tenant_email",
            "tenant_id",
            text("lower(email)"),
            unique=True,
            postgresql_where=text("email IS NOT NULL"),
        ),
        Index("ix_customer_tenant_name", "tenant_id", "name"),
    )

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str] = mapped_column(String(32), nullable=False)
    gender: Mapped[Gender | None] = mapped_column(enum_type(Gender, name="customer_gender"))
    member_type: Mapped[MemberType] = mapped_column(
        enum_type(MemberType, name="customer_member_type"),
        default=MemberType.NON_MEMBER,
        nullable=False,
    )
    membership_tier: Mapped[MembershipTier | None] = mapped_column(
        enum_type(MembershipTier, name="customer_membership_tier")
    )
    join_date: Mapped[date] = mapped_column(Date, server_default=text("CURRENT_DATE"), nullable=False)
    favorite_sport_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("sport.id", ondelete="SET NULL")
    )
    avatar_initials: Mapped[str | None] = mapped_column(String(4))

    date_of_birth: Mapped[date | None] = mapped_column(Date)
    address: Mapped[str | None] = mapped_column(Text)
    emergency_contact: Mapped[str | None] = mapped_column(String(200))
    emergency_phone: Mapped[str | None] = mapped_column(String(32))
    notes: Mapped[str | None] = mapped_column(Text)

    def __repr__(self) -> str:
        return f"<Customer {self.name} {self.phone}>"


class Booking(TenantScoped):
    """A court reservation. ← `Booking`. The centrepiece of the schema.

    `date` + `startTime` + `endTime` as strings become `starts_at`/`ends_at`
    timestamptz, plus a generated `time_range` that the exclusion constraint indexes.

    `customer_name` and `customer_phone` are snapshots, not denormalisation errors:
    a booking records who was on the court that day, and must not silently rewrite
    itself when a customer later changes their name.
    """

    __tablename__ = "booking"
    __table_args__ = (
        # Double-booking prevention, enforced by Postgres rather than by a
        # read-then-write check in application code, which two concurrent reception
        # staff can interleave through.
        #
        #   tenant_id WITH =  — conflicts only ever arise within one academy, so the
        #                       constraint can never leak the existence of another
        #                       tenant's booking through an error message.
        #   WHERE status <> 'cancelled'
        #                     — a cancelled booking must not keep blocking the slot
        #                       it released.
        #   AND NOT open_slot — an open-slot court is *meant* to hold overlapping
        #                       bookings: that is what "join this session" is. Those
        #                       are capacity-limited instead, in
        #                       service.ensure_slot_free, under a row lock on the
        #                       court. The constraint cannot do it itself because it
        #                       can only see this table, and the capacity lives on
        #                       `court` — hence the denormalised flag.
        ExcludeConstraint(
            ("tenant_id", "="),
            ("court_id", "="),
            ("time_range", "&&"),
            name="booking_no_overlap",
            using="gist",
            where=text("status <> 'cancelled' AND NOT open_slot"),
        ),
        # Idempotency for the partner gateway. A platform that retries a create —
        # after a timeout, say — must not end up selling the court twice under two
        # of our booking ids. Partial index: `external_ref` is NULL for every
        # booking made at the counter, and those must not collide with each other.
        Index(
            "uq_booking_partner_external_ref",
            "tenant_id",
            "created_by_partner_id",
            "external_ref",
            unique=True,
            postgresql_where=text("external_ref IS NOT NULL"),
        ),
        Index("ix_booking_tenant_court_start", "tenant_id", "court_id", "starts_at"),
        Index("ix_booking_tenant_start", "tenant_id", "starts_at"),
        Index("ix_booking_tenant_customer", "tenant_id", "customer_id"),
        Index("ix_booking_tenant_status", "tenant_id", "status"),
        # The check-in lookup. Unique per academy, not globally: the reference is a
        # per-tenant counter, so two academies both reaching XC-B-0042 is expected.
        # Uniqueness is what lets the kiosk resolve a typed code to exactly one
        # booking instead of asking the customer which of two they meant.
        Index("uq_booking_tenant_reference", "tenant_id", "reference", unique=True),
        CheckConstraint("ends_at > starts_at", name="ends_after_starts"),
        CheckConstraint("amount_paid >= 0 AND total >= 0", name="amounts_non_negative"),
    )

    #: What the customer reads off their ticket and types at the kiosk: `XC-B-0042`.
    #: Allocated from the same per-tenant DocumentCounter series as invoices, so it
    #: is short, gapless and never collides.
    #:
    #: Not derived from `id`. A UUID slice short enough to type is short enough to
    #: collide — six hex characters duplicate within a few thousand bookings — and
    #: check-in is exactly the flow where handing someone the wrong booking matters.
    reference: Mapped[str] = mapped_column(String(32), nullable=False)

    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("customer.id", ondelete="RESTRICT")
    )
    customer_name: Mapped[str] = mapped_column(String(200), nullable=False)
    customer_phone: Mapped[str | None] = mapped_column(String(32))

    sport_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("sport.id", ondelete="RESTRICT"), nullable=False
    )
    court_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("court.id", ondelete="RESTRICT"), nullable=False
    )

    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_min: Mapped[int] = mapped_column(Integer, nullable=False)

    # Generated, so it can never disagree with starts_at/ends_at.
    #
    # '[)' half-open bounds are load-bearing. With '[]', a 10:00–11:00 booking and an
    # 11:00–12:00 booking share the instant 11:00 and are rejected as overlapping —
    # which would make back-to-back slots impossible, and the walk-in flow issues
    # exactly those.
    time_range: Mapped[Any] = mapped_column(
        TSTZRANGE,
        Computed("tstzrange(starts_at, ends_at, '[)')", persisted=True),
        nullable=False,
    )

    status: Mapped[BookingStatus] = mapped_column(
        enum_type(BookingStatus, name="booking_status"),
        default=BookingStatus.UPCOMING,
        nullable=False,
    )
    payment_status: Mapped[PaymentStatus] = mapped_column(
        enum_type(PaymentStatus, name="booking_payment_status"),
        default=PaymentStatus.PENDING,
        nullable=False,
    )
    booking_type: Mapped[BookingType] = mapped_column(
        enum_type(BookingType, name="booking_type"), default=BookingType.WALKIN, nullable=False
    )

    #: Stamped from `court.open_slots_enabled` when the booking is created, and
    #: never updated afterwards. Denormalised on purpose: `booking_no_overlap` is an
    #: exclusion constraint, which can only reference columns on its own table, and
    #: this is the flag that tells it to stand aside. Snapshotting it also means
    #: turning open slots off on a court tomorrow cannot retroactively make today's
    #: legitimately overlapping bookings violate the constraint.
    open_slot: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # ── Where this booking came from ─────────────────────────────────────────
    #
    # Two columns rather than one, for the same reason customer_name sits next to
    # customer_id: the FK is what authorisation is decided on, the string is what
    # survives.
    #
    # `created_by_partner_id` is the ONLY thing the gateway trusts when deciding
    # whether a partner may read or cancel a booking. Matching on the slug instead
    # would mean anyone who could set that string could reach another platform's
    # bookings.
    #
    # `source_platform` is a denormalised snapshot of the partner's slug, so a
    # booking still says "playo" in reports and on the bookings list after the
    # integration is deleted — and so answering "where did this come from?" costs
    # no join. NULL means it was made here: counter, dashboard, or seed.
    created_by_partner_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("integration_partner.id", ondelete="RESTRICT")
    )
    source_platform: Mapped[str | None] = mapped_column(String(50))

    #: The partner's own identifier for this booking. Carried so a reconciliation
    #: run can line our rows up against theirs, and so a retried create is
    #: recognised as the same booking rather than double-selling the court — see
    #: the unique index in __table_args__.
    external_ref: Mapped[str | None] = mapped_column(String(120))

    court_charge: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    equipment_charge: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    taxes: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    discount: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    total: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    payment_method: Mapped[str | None] = mapped_column(String(32))

    # Line items, e.g. [{"name": "Tennis Racket", "qty": 2, "rate": 100}].
    # JSONB rather than a child table: they are read as a unit with the booking,
    # never queried across bookings, and are a priced snapshot of what went out.
    equipment: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)

    notes: Mapped[str | None] = mapped_column(Text)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancellation_reason: Mapped[str | None] = mapped_column(Text)

    customer: Mapped[Customer | None] = relationship()
    sport: Mapped[Sport] = relationship()
    court: Mapped[Court] = relationship()
    events: Mapped[list[BookingEvent]] = relationship(
        back_populates="booking", cascade="all, delete-orphan", order_by="BookingEvent.occurred_at"
    )

    @property
    def balance_due(self) -> Decimal:
        return self.total - self.amount_paid

    def __repr__(self) -> str:
        return f"<Booking {self.customer_name} {self.starts_at:%Y-%m-%d %H:%M}>"


class BookingEvent(TenantScoped):
    """The activity timeline. ← `TimelineEvent` in src/pages/BookingsList.tsx.

    A table rather than JSONB on the booking: the drawer renders it as an ordered
    feed and appends to it live during a session, so it wants rows that can be
    inserted independently without rewriting the booking.
    """

    __tablename__ = "booking_event"
    __table_args__ = (Index("ix_booking_event_tenant_booking", "tenant_id", "booking_id", "occurred_at"),)

    booking_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("booking.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[BookingEventKind] = mapped_column(
        enum_type(BookingEventKind, name="booking_event_kind"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True))

    booking: Mapped[Booking] = relationship(back_populates="events")
