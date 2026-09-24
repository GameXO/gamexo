"""Pydantic schemas for finance."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.modules.finance.models import (
    InvoiceStatus,
    PaymentMethod,
    PaymentState,
    PlanDuration,
    SubscriptionStatus,
)

ORM = ConfigDict(from_attributes=True)


class InvoiceItem(BaseModel):
    description: str
    qty: int = 1
    rate: Decimal
    amount: Decimal


class InvoiceCreate(BaseModel):
    customer_id: uuid.UUID | None = None
    customer_name: str = Field(min_length=1, max_length=200)
    items: list[InvoiceItem] = Field(min_length=1)
    discount: Decimal = Field(default=Decimal("0"), ge=0)
    due_date: date | None = None
    notes: str | None = None


class InvoiceEmailRequest(BaseModel):
    """Where to send it, when the address on file is wrong or missing.

    Counter staff frequently take an address verbally at the point of paying, and
    the customer record either has none or has an old one. Overriding here does not
    change the customer record — this is one message, not a correction.
    """

    to: EmailStr | None = None


class InvoiceEmailResult(BaseModel):
    invoice_no: str
    sent_to: str


class InvoiceOut(BaseModel):
    model_config = ORM

    id: uuid.UUID
    invoice_no: str
    booking_id: uuid.UUID | None
    member_subscription_id: uuid.UUID | None
    student_enrollment_id: uuid.UUID | None
    customer_id: uuid.UUID | None
    customer_name: str
    billing_address: str | None
    gst_number: str | None
    issue_date: date
    due_date: date | None
    items: list[dict[str, Any]]
    subtotal: Decimal
    gst: Decimal
    discount: Decimal
    total: Decimal
    amount_paid: Decimal
    balance_due: Decimal
    status: InvoiceStatus
    notes: str | None
    created_at: datetime


class InvoiceDetail(InvoiceOut):
    payments: list[PaymentOut] = Field(default_factory=list)
    # "Split" when more than one payment was taken, matching the Payments page's
    # method breakdown. Derived from the rows, never stored.
    payment_method: str | None = None


class PaymentCreate(BaseModel):
    amount: Decimal = Field(gt=0)
    method: PaymentMethod
    invoice_id: uuid.UUID | None = None
    booking_id: uuid.UUID | None = None
    customer_id: uuid.UUID | None = None
    reference: str | None = Field(default=None, max_length=120)
    notes: str | None = None


class PaymentOut(BaseModel):
    model_config = ORM

    id: uuid.UUID
    invoice_id: uuid.UUID | None
    booking_id: uuid.UUID | None
    customer_id: uuid.UUID | None
    amount: Decimal
    method: PaymentMethod
    reference: str | None
    state: PaymentState
    received_at: datetime
    notes: str | None


class PaymentSummary(BaseModel):
    """Backs the four method cards on the Payments page."""

    method: str
    amount: Decimal
    count: int


class PaymentsOverview(BaseModel):
    total_collected: Decimal
    total_pending: Decimal
    transaction_count: int
    average_transaction: Decimal
    by_method: list[PaymentSummary]


# ── Membership plans ────────────────────────────────────────────────────────


class MembershipPlanBase(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    category: str | None = None
    description: str | None = None
    color: str | None = Field(default=None, max_length=9)
    bg_color: str | None = Field(default=None, max_length=9)
    price_1m: Decimal = Field(default=Decimal("0"), ge=0)
    price_3m: Decimal = Field(default=Decimal("0"), ge=0)
    price_6m: Decimal = Field(default=Decimal("0"), ge=0)
    price_12m: Decimal = Field(default=Decimal("0"), ge=0)
    joining_fee: Decimal = Field(default=Decimal("0"), ge=0)
    discount_pct: int = Field(default=0, ge=0, le=100)
    max_visits: int | None = Field(default=None, ge=0, description="null means unlimited")
    benefits: list[str] = Field(default_factory=list)
    is_active: bool = True


class MembershipPlanCreate(MembershipPlanBase):
    pass


class MembershipPlanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    category: str | None = None
    description: str | None = None
    color: str | None = None
    bg_color: str | None = None
    price_1m: Decimal | None = Field(default=None, ge=0)
    price_3m: Decimal | None = Field(default=None, ge=0)
    price_6m: Decimal | None = Field(default=None, ge=0)
    price_12m: Decimal | None = Field(default=None, ge=0)
    joining_fee: Decimal | None = Field(default=None, ge=0)
    discount_pct: int | None = Field(default=None, ge=0, le=100)
    max_visits: int | None = None
    benefits: list[str] | None = None
    is_active: bool | None = None


class MembershipPlanOut(MembershipPlanBase):
    model_config = ORM
    id: uuid.UUID
    active_count: int = Field(default=0, description="Live subscriptions — computed, not stored")


# ── Subscriptions ───────────────────────────────────────────────────────────


class SubscriptionCreate(BaseModel):
    customer_id: uuid.UUID
    plan_id: uuid.UUID
    duration: PlanDuration = PlanDuration.M12
    start_date: date | None = None
    discount_pct: int = Field(default=0, ge=0, le=100)
    referral_code: str | None = None


class SubscriptionRenew(BaseModel):
    duration: PlanDuration = PlanDuration.M12


class SubscriptionOut(BaseModel):
    model_config = ORM

    id: uuid.UUID
    member_no: str
    customer_id: uuid.UUID
    plan_id: uuid.UUID
    plan_name: str
    plan_color: str | None
    #: The current term's start. `joined_on` is the one that answers tenure — a
    #: renewal moves this and leaves that alone.
    start_date: date
    joined_on: date
    expiry_date: date
    duration: PlanDuration
    status: SubscriptionStatus
    visits_used: int
    total_paid: Decimal
    #: Days banked across every pause. Already reflected in `expiry_date`; carried
    #: separately so the UI can explain an expiry that looks too far out.
    paused_days_total: int

    # Wall-clock functions, computed per request. Storing them would mean mr-4's
    # `daysLeft: 1` is wrong tomorrow — and the renewal reminders run off it.
    days_left: int
    renewal_due: bool


class MembershipCheck(BaseModel):
    """What the counter is allowed to learn about a membership.

    Status and dates, never money. The question at the door is "is this person a
    member today", and answering it needs nothing about what they paid — so the
    shared tablet credential cannot read that even if it is leaked.
    """

    member_no: str
    customer_name: str
    plan_name: str
    status: SubscriptionStatus
    expiry_date: date
    days_left: int


class SubscriptionWithInvoice(BaseModel):
    subscription: SubscriptionOut
    invoice: InvoiceOut


InvoiceDetail.model_rebuild()
