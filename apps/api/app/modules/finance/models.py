"""Finance: per-tenant document numbering, invoices, payments, memberships."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import TenantScoped
from app.db.types import enum_type, money


class CounterKind(StrEnum):
    """The human-readable ID series the frontend uses.

    All of them leak business volume if implemented as a global sequence: an academy
    that signs up second would see its first invoice numbered XC-2024-0873 and learn
    exactly how much business every other tenant has done.
    """

    INVOICE = "invoice"  # XC-2024-0001, resets each year
    MEMBER = "member"  # XC-M-0001
    COACH = "coach"  # XC-C-001
    STUDENT = "student"  # XC-S-001
    #: XCB0042 — what a customer reads off their ticket and types at the kiosk to
    #: check in. Sequential rather than a slice of the UUID because six hex
    #: characters collide within a few thousand bookings, and "is it a B or an 8?"
    #: is not a question to put to someone at a counter.
    BOOKING = "booking"  # XCB0042


class InvoiceStatus(StrEnum):
    DRAFT = "draft"
    PENDING = "pending"
    PAID = "paid"
    OVERDUE = "overdue"
    CANCELLED = "cancelled"


class PaymentMethod(StrEnum):
    CASH = "cash"
    UPI = "upi"
    CARD = "card"
    BANK = "bank"
    CHEQUE = "cheque"


class PaymentState(StrEnum):
    CAPTURED = "captured"
    PENDING = "pending"
    FAILED = "failed"
    REFUNDED = "refunded"


class SubscriptionStatus(StrEnum):
    ACTIVE = "active"
    EXPIRED = "expired"
    PAUSED = "paused"
    CANCELLED = "cancelled"


class PlanDuration(StrEnum):
    M1 = "1m"
    M3 = "3m"
    M6 = "6m"
    M12 = "12m"


DURATION_MONTHS: dict[PlanDuration, int] = {
    PlanDuration.M1: 1,
    PlanDuration.M3: 3,
    PlanDuration.M6: 6,
    PlanDuration.M12: 12,
}


class DocumentCounter(TenantScoped):
    """A per-tenant, per-series, gapless counter.

    WHY A LOCKED ROW RATHER THAN A POSTGRES SEQUENCE
    Sequences are deliberately non-transactional: `nextval` does not roll back. An
    invoice that fails validation after its number is drawn would burn that number
    permanently, leaving a hole in the series. Gapless invoice numbering is a
    statutory requirement under Indian GST, and the Settings page carries a GST
    number — so a hole is a compliance problem, not a cosmetic one.

    Taking `SELECT ... FOR UPDATE` on this row inside the caller's transaction makes
    allocation roll back with everything else. The lock serialises only within one
    tenant's one series; two academies never contend, and at academy volume a single
    tenant's contention is irrelevant.

    `period` is the year for invoices (so they reset annually, matching XC-2024-0001)
    and '' for the perpetual member/coach/student series.
    """

    __tablename__ = "document_counter"
    __table_args__ = (
        Index("uq_document_counter_tenant_kind_period", "tenant_id", "kind", "period", unique=True),
    )

    kind: Mapped[CounterKind] = mapped_column(
        enum_type(CounterKind, name="document_counter_kind"), nullable=False
    )
    period: Mapped[str] = mapped_column(String(16), default="", nullable=False)
    last_value: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)


class Invoice(TenantScoped):
    """A bill. ← `Invoice` in src/data/mockData.ts.

    `Invoice.bookingId` in the frontend is only one of the things an invoice can be
    raised against — memberships, academy fees and ad contracts all produce invoices
    too. Modelled as nullable typed FKs with a CHECK that at most one is set, which
    keeps real referential integrity; a polymorphic (source_type, source_id) pair
    would throw that away for no gain at this scale.

    `Invoice.paymentMethod` is deliberately absent: it belongs to the payment. Mock
    row inv-005 already shows the strain by storing the string "Partial Cash".
    """

    __tablename__ = "invoice"
    __table_args__ = (
        Index("uq_invoice_tenant_number", "tenant_id", "invoice_no", unique=True),
        Index("ix_invoice_tenant_customer", "tenant_id", "customer_id"),
        Index("ix_invoice_tenant_status", "tenant_id", "status"),
        Index("ix_invoice_tenant_issue_date", "tenant_id", "issue_date"),
        # At most one source. Each phase adds its own typed FK and widens this
        # check, which keeps real referential integrity — a polymorphic
        # (source_type, source_id) pair would throw that away for no gain here.
        CheckConstraint(
            "num_nonnulls(booking_id, member_subscription_id, student_enrollment_id) <= 1",
            name="single_source",
        ),
        CheckConstraint("total >= 0 AND amount_paid >= 0", name="amounts_non_negative"),
    )

    invoice_no: Mapped[str] = mapped_column(String(32), nullable=False)

    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("booking.id", ondelete="RESTRICT")
    )
    member_subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("member_subscription.id", ondelete="RESTRICT")
    )
    student_enrollment_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("student_enrollment.id", ondelete="RESTRICT")
    )

    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("customer.id", ondelete="RESTRICT")
    )
    # Snapshot: an invoice records who was billed, and must not rewrite itself when
    # the customer later changes their name or the academy changes its address.
    customer_name: Mapped[str] = mapped_column(String(200), nullable=False)
    billing_address: Mapped[str | None] = mapped_column(Text)
    gst_number: Mapped[str | None] = mapped_column(String(20))

    issue_date: Mapped[date] = mapped_column(Date, server_default=text("CURRENT_DATE"), nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date)

    # [{"description": ..., "qty": 1, "rate": 800, "amount": 800}]
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)

    subtotal: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    gst: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    discount: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    total: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)

    status: Mapped[InvoiceStatus] = mapped_column(
        enum_type(InvoiceStatus, name="invoice_status"),
        default=InvoiceStatus.PENDING,
        nullable=False,
    )
    notes: Mapped[str | None] = mapped_column(Text)

    payments: Mapped[list[Payment]] = relationship(
        back_populates="invoice", order_by="Payment.received_at"
    )

    @property
    def balance_due(self) -> Decimal:
        return self.total - self.amount_paid

    def __repr__(self) -> str:
        return f"<Invoice {self.invoice_no} {self.total}>"


class Payment(TenantScoped):
    """Money received.

    A split payment is several rows against one invoice — which is also what makes a
    partial payment representable without a special case (mock booking bk-004 has
    ₹2,000 of ₹4,130). The frontend's Payments page lists "Split" as a method; that
    is derived from the row count, not stored.
    """

    __tablename__ = "payment"
    __table_args__ = (
        Index("ix_payment_tenant_invoice", "tenant_id", "invoice_id"),
        Index("ix_payment_tenant_booking", "tenant_id", "booking_id"),
        Index("ix_payment_tenant_received", "tenant_id", "received_at"),
        Index("ix_payment_tenant_method", "tenant_id", "method"),
        CheckConstraint("amount > 0", name="amount_positive"),
    )

    invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("invoice.id", ondelete="RESTRICT")
    )
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("booking.id", ondelete="RESTRICT")
    )
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("customer.id", ondelete="RESTRICT")
    )

    amount: Mapped[Decimal] = mapped_column(money(), nullable=False)
    method: Mapped[PaymentMethod] = mapped_column(
        enum_type(PaymentMethod, name="payment_method"), nullable=False
    )
    reference: Mapped[str | None] = mapped_column(String(120))  # UPI txn id, cheque no
    state: Mapped[PaymentState] = mapped_column(
        enum_type(PaymentState, name="payment_state"),
        default=PaymentState.CAPTURED,
        nullable=False,
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    received_by_user_id: Mapped[uuid.UUID | None] = mapped_column(PgUUID(as_uuid=True))
    notes: Mapped[str | None] = mapped_column(Text)

    invoice: Mapped[Invoice | None] = relationship(back_populates="payments")


class MembershipPlan(TenantScoped):
    """A membership tier. ← `MembershipPlan` in src/pages/Membership.tsx.

    `activeCount` from the frontend is derived from live subscriptions, not stored.
    """

    __tablename__ = "membership_plan"
    __table_args__ = (Index("uq_membership_plan_tenant_name", "tenant_id", "name", unique=True),)

    name: Mapped[str] = mapped_column(String(150), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(9))
    bg_color: Mapped[str | None] = mapped_column(String(9))

    price_1m: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    price_3m: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    price_6m: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    price_12m: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    joining_fee: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    discount_pct: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # NULL means unlimited — the frontend's `maxVisits: number | null`.
    max_visits: Mapped[int | None] = mapped_column(Integer)
    benefits: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    # A boolean rather than the frontend's "active"/"inactive" string: it is a
    # two-state flag that SQL filters on constantly.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    def price_for(self, duration: PlanDuration) -> Decimal:
        return {
            PlanDuration.M1: self.price_1m,
            PlanDuration.M3: self.price_3m,
            PlanDuration.M6: self.price_6m,
            PlanDuration.M12: self.price_12m,
        }[duration]


class MemberSubscription(TenantScoped):
    """A customer's membership. ← `MemberRecord` in src/pages/Membership.tsx.

    `renewalDue` and `daysLeft` are NOT stored. They are functions of the wall clock:
    mock record mr-4 has `daysLeft: 1`, which is wrong tomorrow. Stored, they would
    also drive the renewal reminders — which would then fire on stale data.
    """

    __tablename__ = "member_subscription"
    __table_args__ = (
        Index("uq_member_subscription_tenant_number", "tenant_id", "member_no", unique=True),
        Index("ix_member_subscription_tenant_customer", "tenant_id", "customer_id"),
        Index("ix_member_subscription_tenant_expiry", "tenant_id", "expiry_date"),
        Index("ix_member_subscription_tenant_status", "tenant_id", "status"),
        CheckConstraint("expiry_date >= start_date", name="expiry_after_start"),
    )

    member_no: Mapped[str] = mapped_column(String(32), nullable=False)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("customer.id", ondelete="RESTRICT"), nullable=False
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("membership_plan.id", ondelete="RESTRICT"), nullable=False
    )
    # Snapshots, so a renamed or recoloured plan does not rewrite past subscriptions.
    plan_name: Mapped[str] = mapped_column(String(150), nullable=False)
    plan_color: Mapped[str | None] = mapped_column(String(9))

    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)
    duration: Mapped[PlanDuration] = mapped_column(
        enum_type(PlanDuration, name="subscription_duration"), nullable=False
    )
    status: Mapped[SubscriptionStatus] = mapped_column(
        enum_type(SubscriptionStatus, name="subscription_status"),
        default=SubscriptionStatus.ACTIVE,
        nullable=False,
    )

    visits_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_paid: Mapped[Decimal] = mapped_column(money(), default=0, nullable=False)
    referral_code: Mapped[str | None] = mapped_column(String(64))
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def days_left(self, today: date) -> int:
        """Negative once expired — the frontend renders mr-1 as `daysLeft: -17`."""
        return (self.expiry_date - today).days

    def renewal_due(self, today: date, *, window_days: int = 30) -> bool:
        return self.status is SubscriptionStatus.ACTIVE and self.days_left(today) <= window_days
