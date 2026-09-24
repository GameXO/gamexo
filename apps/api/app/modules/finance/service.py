"""Finance domain logic: invoicing, payment application, subscriptions."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo
from decimal import Decimal
from typing import Any, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.models.tenant import TenantSettings
from app.modules.booking.models import Booking, Customer, PaymentStatus as BookingPaymentStatus
from app.modules.booking.pricing import money
from app.modules.finance.models import (
    DURATION_MONTHS,
    CounterKind,
    PaymentMethod,
    Invoice,
    InvoiceStatus,
    MembershipPlan,
    MemberSubscription,
    Payment,
    PlanDuration,
    SubscriptionStatus,
)
from app.modules.finance.numbering import next_number


async def _settings(session: AsyncSession) -> TenantSettings:
    settings = (await session.execute(select(TenantSettings))).scalar_one_or_none()
    if settings is None:
        raise NotFoundError("This academy has no settings row.")
    return settings


def add_months(start: date, months: int) -> date:
    """Advance by calendar months, clamping to the end of a short month.

    31 Jan + 1 month is 28 Feb, not 3 March. Naively adding 30 days would drift the
    renewal date by a day or two every cycle, and members notice when their annual
    membership expires earlier each year.
    """
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1

    if month == 12:
        next_month_start = date(year + 1, 1, 1)
    else:
        next_month_start = date(year, month + 1, 1)
    last_day = (next_month_start - date.resolution).day

    return date(year, month, min(start.day, last_day))


# ── Invoices ────────────────────────────────────────────────────────────────


def jsonable_items(items: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Make line items safe for a JSONB column.

    Amounts arrive as Decimal (correct for arithmetic) but `json.dumps` cannot
    encode them. Converted to float here at the storage boundary — the line items
    are a display-time snapshot, while every figure the business relies on lives in
    a NUMERIC column on the invoice itself, so no precision that matters is lost.
    """
    normalised: list[dict[str, Any]] = []
    for item in items:
        normalised.append(
            {
                key: float(value) if isinstance(value, Decimal) else value
                for key, value in item.items()
            }
        )
    return normalised


async def create_invoice(
    session: AsyncSession,
    *,
    customer_id: uuid.UUID | None,
    customer_name: str,
    items: Sequence[dict[str, Any]],
    discount: Decimal = Decimal("0"),
    booking_id: uuid.UUID | None = None,
    member_subscription_id: uuid.UUID | None = None,
    student_enrollment_id: uuid.UUID | None = None,
    due_date: date | None = None,
    notes: str | None = None,
    gst_override: Decimal | None = None,
) -> Invoice:
    """Raise an invoice, taking the next number in this academy's series."""
    settings = await _settings(session)

    subtotal = money(sum(Decimal(str(item.get("amount", 0))) for item in items))
    discount = money(min(max(Decimal("0"), discount), subtotal))

    if gst_override is not None:
        gst = money(gst_override)
    else:
        rate = Decimal(str(settings.tax_config.get("gst_rate", 18)))
        # GST on the discounted subtotal, matching how bookings are priced.
        gst = money((subtotal - discount) * rate / Decimal(100))

    total = money(subtotal - discount + gst)

    invoice = Invoice(
        invoice_no=await next_number(
            session, CounterKind.INVOICE, prefix=settings.invoice_prefix
        ),
        booking_id=booking_id,
        member_subscription_id=member_subscription_id,
        student_enrollment_id=student_enrollment_id,
        customer_id=customer_id,
        customer_name=customer_name,
        billing_address=settings.address,
        gst_number=settings.gst_number,
        due_date=due_date,
        items=jsonable_items(items),
        subtotal=subtotal,
        gst=gst,
        discount=discount,
        total=total,
        status=InvoiceStatus.PENDING,
        notes=notes,
    )
    session.add(invoice)
    await session.flush()
    return invoice


async def invoice_for_booking(session: AsyncSession, booking: Booking) -> Invoice:
    """Turn a booking into an invoice, once.

    Re-invoicing the same booking would issue a second number for the same money and
    double-count revenue, so the existing invoice is returned instead.
    """
    existing = (
        await session.execute(select(Invoice).where(Invoice.booking_id == booking.id))
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    items: list[dict[str, Any]] = [
        {
            "description": f"Court booking · {booking.duration_min} min",
            "qty": 1,
            "rate": float(booking.court_charge),
            "amount": float(booking.court_charge),
        }
    ]
    for line in booking.equipment or []:
        qty = int(line.get("qty", 1))
        rate = Decimal(str(line.get("rate", 0)))
        items.append(
            {
                "description": f"{line.get('name')} rental × {qty}",
                "qty": qty,
                "rate": float(rate),
                "amount": float(money(rate * qty)),
            }
        )

    invoice = await create_invoice(
        session,
        customer_id=booking.customer_id,
        customer_name=booking.customer_name,
        items=items,
        discount=booking.discount,
        booking_id=booking.id,
        due_date=booking.starts_at.date(),
        # Reuse the tax already computed on the booking, so the invoice total matches
        # the amount the customer was quoted at the desk, to the paisa.
        gst_override=booking.taxes,
    )
    invoice.amount_paid = booking.amount_paid
    _refresh_invoice_status(invoice)
    await session.flush()
    return invoice


def _refresh_invoice_status(invoice: Invoice) -> None:
    if invoice.status is InvoiceStatus.CANCELLED:
        return
    if invoice.amount_paid >= invoice.total and invoice.total > 0:
        invoice.status = InvoiceStatus.PAID
    elif invoice.due_date is not None and invoice.due_date < date.today() and invoice.balance_due > 0:
        invoice.status = InvoiceStatus.OVERDUE
    else:
        invoice.status = InvoiceStatus.PENDING


def refresh_booking_payment_status(booking: Booking) -> None:
    """Derive payment_status from amount_paid vs total.

    Public because editing a booking re-prices it, and a new total with an unchanged
    amount_paid has to move the status or the booking reads PAID while money is owed.
    Booking edits call this too — the derivation lives here, once, because two copies
    of "when is a booking paid" is how they drift.

    Never sets REFUNDED: that is a deliberate act recorded elsewhere, not something
    a total recalculation can infer. Callers that might touch a refunded booking
    check for it before calling.
    """
    if booking.amount_paid <= 0:
        booking.payment_status = BookingPaymentStatus.PENDING
    elif booking.amount_paid < booking.total:
        booking.payment_status = BookingPaymentStatus.PARTIAL
    else:
        booking.payment_status = BookingPaymentStatus.PAID


async def record_payment(
    session: AsyncSession,
    *,
    amount: Decimal,
    method: PaymentMethod,
    invoice_id: uuid.UUID | None = None,
    booking_id: uuid.UUID | None = None,
    customer_id: uuid.UUID | None = None,
    reference: str | None = None,
    notes: str | None = None,
    received_by_user_id: uuid.UUID | None = None,
) -> Payment:
    """Record money received and roll it up to the invoice and booking.

    Overpayment is refused rather than absorbed: an amount that exceeds the balance
    is nearly always a typo at the desk, and silently accepting it creates a credit
    nobody tracks and an invoice that reconciles to the wrong figure.
    """
    amount = money(amount)
    if amount <= 0:
        raise ConflictError("A payment must be greater than zero.")

    invoice: Invoice | None = None
    booking: Booking | None = None

    if invoice_id is not None:
        invoice = await session.get(Invoice, invoice_id)
        if invoice is None:
            raise NotFoundError("Invoice not found.", details={"id": str(invoice_id)})
        if invoice.status is InvoiceStatus.CANCELLED:
            raise ConflictError("This invoice has been cancelled.")
        if amount > invoice.balance_due:
            raise ConflictError(
                f"That is more than the outstanding balance of {invoice.balance_due}.",
                details={"balance_due": str(invoice.balance_due)},
            )
        booking_id = booking_id or invoice.booking_id
        customer_id = customer_id or invoice.customer_id

    if booking_id is not None:
        booking = await session.get(Booking, booking_id)
        if booking is None:
            raise NotFoundError("Booking not found.", details={"id": str(booking_id)})
        if invoice is None and amount > (booking.total - booking.amount_paid):
            raise ConflictError(
                f"That is more than the outstanding balance of "
                f"{booking.total - booking.amount_paid}.",
                details={"balance_due": str(booking.total - booking.amount_paid)},
            )
        customer_id = customer_id or booking.customer_id

    payment = Payment(
        invoice_id=invoice_id,
        booking_id=booking_id,
        customer_id=customer_id,
        amount=amount,
        method=method,
        reference=reference,
        notes=notes,
        received_by_user_id=received_by_user_id,
    )
    session.add(payment)

    if invoice is not None:
        invoice.amount_paid = money(invoice.amount_paid + amount)
        _refresh_invoice_status(invoice)
    if booking is not None:
        booking.amount_paid = money(booking.amount_paid + amount)
        booking.payment_method = method
        refresh_booking_payment_status(booking)

    await session.flush()
    return payment


# ── Memberships ─────────────────────────────────────────────────────────────


async def create_subscription(
    session: AsyncSession,
    *,
    customer_id: uuid.UUID,
    plan_id: uuid.UUID,
    duration: PlanDuration,
    start_date: date,
    discount_pct: int = 0,
    referral_code: str | None = None,
) -> tuple[MemberSubscription, Invoice]:
    """Enrol a customer on a plan and raise the invoice for it.

    The subscription and its invoice are created in one transaction: a membership
    that exists without a bill, or a bill for a membership that failed to save, are
    both reconciliation problems someone has to chase by hand later.
    """
    customer = await session.get(Customer, customer_id)
    if customer is None:
        raise NotFoundError("Customer not found.", details={"id": str(customer_id)})

    plan = await session.get(MembershipPlan, plan_id)
    if plan is None:
        raise NotFoundError("Membership plan not found.", details={"id": str(plan_id)})
    if not plan.is_active:
        raise ConflictError(f"The '{plan.name}' plan is no longer offered.")

    settings = await _settings(session)
    base_price = plan.price_for(duration)

    # A zero price is how a plan says "we don't sell this term length" — every
    # price column defaults to 0, so without this a plan priced only by the year
    # would happily sell a free month to anyone who picked the wrong radio button.
    if base_price <= 0:
        raise ConflictError(
            f"The '{plan.name}' plan is not sold by the {duration.value} term.",
            details={"plan_id": str(plan.id), "duration": duration.value},
        )

    discount = money(base_price * Decimal(discount_pct) / Decimal(100))

    subscription = MemberSubscription(
        member_no=await next_number(
            session, CounterKind.MEMBER, prefix=settings.invoice_prefix
        ),
        customer_id=customer.id,
        plan_id=plan.id,
        plan_name=plan.name,
        plan_color=plan.color,
        start_date=start_date,
        joined_on=start_date,
        expiry_date=add_months(start_date, DURATION_MONTHS[duration]),
        duration=duration,
        status=SubscriptionStatus.ACTIVE,
        referral_code=referral_code,
    )
    session.add(subscription)
    await session.flush()

    items: list[dict[str, Any]] = [
        {
            "description": f"{plan.name} membership · {duration.value}",
            "qty": 1,
            "rate": float(base_price),
            "amount": float(base_price),
        }
    ]
    if plan.joining_fee > 0:
        items.append(
            {
                "description": "Joining fee",
                "qty": 1,
                "rate": float(plan.joining_fee),
                "amount": float(plan.joining_fee),
            }
        )

    invoice = await create_invoice(
        session,
        customer_id=customer.id,
        customer_name=customer.name,
        items=items,
        discount=discount,
        member_subscription_id=subscription.id,
        due_date=start_date,
    )

    # The customer becomes a member the moment they hold a membership.
    customer.member_type = "member"
    await session.flush()
    return subscription, invoice


async def renew_subscription(
    session: AsyncSession, subscription: MemberSubscription, *, duration: PlanDuration
) -> tuple[MemberSubscription, Invoice]:
    """Extend a membership by another term.

    A renewal starts from the current expiry date when the membership is still
    running, so a member who renews early is not penalised by losing the days they
    already paid for. If it has already lapsed, the new term starts today.
    """
    today = date.today()
    start = subscription.expiry_date if subscription.expiry_date > today else today

    plan = await session.get(MembershipPlan, subscription.plan_id)
    if plan is None:
        raise NotFoundError("The plan behind this membership no longer exists.")

    if plan.price_for(duration) <= 0:
        raise ConflictError(
            f"The '{plan.name}' plan is not sold by the {duration.value} term.",
            details={"plan_id": str(plan.id), "duration": duration.value},
        )

    # `start_date` is this term's start and is meant to move. `joined_on` is not
    # touched here — that is the whole reason it exists.
    subscription.start_date = start
    subscription.expiry_date = add_months(start, DURATION_MONTHS[duration])
    subscription.duration = duration
    subscription.status = SubscriptionStatus.ACTIVE
    subscription.paused_at = None
    subscription.cancelled_at = None

    customer = await session.get(Customer, subscription.customer_id)
    invoice = await create_invoice(
        session,
        customer_id=subscription.customer_id,
        customer_name=customer.name if customer else subscription.member_no,
        items=[
            {
                "description": f"{plan.name} renewal · {duration.value}",
                "qty": 1,
                "rate": float(plan.price_for(duration)),
                "amount": float(plan.price_for(duration)),
            }
        ],
        member_subscription_id=subscription.id,
        due_date=start,
    )
    await session.flush()
    return subscription, invoice


def resume_subscription(
    subscription: MemberSubscription, *, today: date, zone: ZoneInfo
) -> int:
    """Take a membership off pause, giving back the days it was parked for.

    The paid term is a quantity of *membership*, not a window on the calendar. A
    member who pauses for six weeks while injured and comes back to six fewer weeks
    has been charged for time they were explicitly told they were not using — which
    makes pause strictly worse for them than doing nothing, and the feature becomes
    a trap. So the expiry moves out by exactly the days spent paused.

    `zone` is load-bearing, not decoration. `paused_at` is a UTC instant while every
    date on this row is a civil date in the venue's own timezone. Taking `.date()`
    off the UTC value and subtracting it from a local `today` gifts an IST member a
    free day whenever they pause and resume during the evening — 20:30 UTC is
    already tomorrow in Kolkata. Both sides have to be read in the venue's frame.

    Returns the number of days banked, which the caller reports back.
    """
    if subscription.status is not SubscriptionStatus.PAUSED:
        raise ConflictError(
            f"This membership is {subscription.status.value}, not paused.",
            details={"status": subscription.status.value},
        )

    # `paused_at` should always be set alongside the PAUSED status, but a row that
    # lost it must still be resumable — stranding a member because of our bad data
    # is not an option. Zero days banked is the honest fallback.
    if subscription.paused_at is None:
        banked = 0
    else:
        paused_at = subscription.paused_at
        # Rows written before the column was timezone-aware, and SQLite in tests,
        # can hand back a naive datetime. It is UTC either way — that is what was
        # stored — so say so rather than letting astimezone() assume local.
        if paused_at.tzinfo is None:
            paused_at = paused_at.replace(tzinfo=UTC)
        banked = (today - paused_at.astimezone(zone).date()).days
    banked = max(banked, 0)

    subscription.expiry_date = subscription.expiry_date + timedelta(days=banked)
    subscription.paused_days_total += banked
    subscription.paused_at = None
    subscription.status = SubscriptionStatus.ACTIVE
    return banked


def expire_lapsed(subscriptions: Sequence[MemberSubscription], *, today: date) -> int:
    """Mark memberships whose expiry has passed. Driven by the Phase 6 cron worker."""
    changed = 0
    for subscription in subscriptions:
        if subscription.status is SubscriptionStatus.ACTIVE and subscription.expiry_date < today:
            subscription.status = SubscriptionStatus.EXPIRED
            changed += 1
    return changed


async def subscription_paid_total(session: AsyncSession, subscription_id: uuid.UUID) -> Decimal:
    """What a member has actually paid — summed from payments, not stored."""
    from sqlalchemy import func

    total = await session.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0))
        .select_from(Payment)
        .join(Invoice, Payment.invoice_id == Invoice.id)
        .where(Invoice.member_subscription_id == subscription_id)
    )
    return money(total or 0)
