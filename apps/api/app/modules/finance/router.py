"""Finance endpoints: invoices, payments, membership plans and subscriptions."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.api_utils import Page, Params, get_or_404, paginate
from app.auth.deps import RequireKiosk, RequireManager, RequireStaff
from app.core.errors import ConflictError, MailDeliveryError, NotFoundError
from app.core.mail import MailNotConfigured, Message, send_email
from app.core.mail_templates import invoice_raised
from app.models.tenant import TenantSettings
from app.modules.booking.models import Booking, BookingEventKind, Customer
from app.modules.booking.pricing import money, tenant_zone
from app.modules.admin.notify import (
    EMAIL_INVOICE,
    EMAIL_PAYMENT_RECEIPT,
    enqueue_email,
)
from app.modules.booking.service import record_event
from app.modules.finance import service
from app.modules.finance.models import (
    Invoice,
    InvoiceStatus,
    MembershipPlan,
    MemberSubscription,
    Payment,
    PlanDuration,
    SubscriptionStatus,
)
from app.modules.finance.schemas import (
    InvoiceCreate,
    InvoiceDetail,
    InvoiceEmailRequest,
    InvoiceEmailResult,
    InvoiceOut,
    MembershipPlanCreate,
    MembershipPlanOut,
    MembershipPlanUpdate,
    MembershipCheck,
    PaymentCreate,
    PaymentOut,
    PaymentsOverview,
    PaymentSummary,
    SubscriptionCreate,
    SubscriptionOut,
    SubscriptionRenew,
    SubscriptionWithInvoice,
)
from app.tenancy.deps import Db

router = APIRouter(tags=["finance"])


# ── Invoices ────────────────────────────────────────────────────────────────


async def _queue_invoice_email(db, invoice: Invoice) -> None:
    """Email the invoice to whoever it is addressed to, if they have an address.

    An invoice stores `customer_name` as free text but only sometimes a
    `customer_id`; without the link there is nowhere to look up an address, so an
    ad-hoc counter invoice for a walk-in simply is not emailed.
    """
    if invoice.customer_id is None:
        return
    customer = await db.get(Customer, invoice.customer_id)
    await enqueue_email(
        db,
        kind=EMAIL_INVOICE,
        event_key="invoice_sent",
        recipient=customer.email if customer else None,
        payload={"invoice_id": str(invoice.id)},
    )


@router.get("/invoices", response_model=Page[InvoiceOut], summary="List invoices")
async def list_invoices(
    db: Db,
    _: RequireStaff,
    params: Params,
    invoice_status: Annotated[InvoiceStatus | None, Query(alias="status")] = None,
    customer_id: uuid.UUID | None = None,
    search: str | None = Query(default=None, description="Matches invoice number or customer"),
) -> Page[InvoiceOut]:
    stmt = select(Invoice).order_by(Invoice.issue_date.desc(), Invoice.invoice_no.desc())
    if invoice_status is not None:
        stmt = stmt.where(Invoice.status == invoice_status)
    if customer_id is not None:
        stmt = stmt.where(Invoice.customer_id == customer_id)
    if search:
        like = f"%{search.lower()}%"
        stmt = stmt.where(Invoice.invoice_no.ilike(like) | Invoice.customer_name.ilike(like))
    return await paginate(db, stmt, params, InvoiceOut)


@router.post(
    "/invoices",
    response_model=InvoiceOut,
    status_code=status.HTTP_201_CREATED,
    summary="Raise an ad-hoc invoice",
    description="Takes the next number in this academy's own series — see `/invoices` docs.",
)
async def create_invoice(payload: InvoiceCreate, db: Db, _: RequireStaff) -> InvoiceOut:
    invoice = await service.create_invoice(
        db,
        customer_id=payload.customer_id,
        customer_name=payload.customer_name,
        items=[item.model_dump() for item in payload.items],
        discount=payload.discount,
        due_date=payload.due_date,
        notes=payload.notes,
    )
    await _queue_invoice_email(db, invoice)
    return InvoiceOut.model_validate(invoice)


@router.get("/invoices/{invoice_id}", response_model=InvoiceDetail, summary="An invoice with its payments")
async def get_invoice(invoice_id: uuid.UUID, db: Db, _: RequireStaff) -> InvoiceDetail:
    invoice = await get_or_404(db, Invoice, invoice_id, label="Invoice")
    payments = (
        (await db.execute(select(Payment).where(Payment.invoice_id == invoice.id).order_by(Payment.received_at)))
        .scalars()
        .all()
    )
    methods = {p.method.value for p in payments}
    return InvoiceDetail(
        **InvoiceOut.model_validate(invoice).model_dump(),
        payments=[PaymentOut.model_validate(p) for p in payments],
        payment_method=(
            None if not methods else (methods.pop() if len(methods) == 1 else "split")
        ),
    )


@router.post(
    "/bookings/{booking_id}/invoice",
    response_model=InvoiceOut,
    status_code=status.HTTP_201_CREATED,
    summary="Invoice a booking",
    description=(
        "Idempotent: a booking that already has an invoice returns the existing one "
        "rather than issuing a second number for the same money."
    ),
)
async def invoice_booking(booking_id: uuid.UUID, db: Db, principal: RequireKiosk) -> InvoiceOut:
    booking = await get_or_404(db, Booking, booking_id, label="Booking")
    existed = booking.id is not None and (
        await db.execute(select(Invoice.id).where(Invoice.booking_id == booking.id))
    ).scalar_one_or_none() is not None

    invoice = await service.invoice_for_booking(db, booking)
    if not existed:
        await record_event(
            db,
            booking,
            kind=BookingEventKind.INVOICE,
            label="Invoice Generated",
            detail=invoice.invoice_no,
            actor_user_id=principal.id,
        )
        await db.flush()
        # Only on first issue. This endpoint is idempotent, and re-emailing the
        # same invoice every time someone reopens the screen is how a customer
        # ends up with nine copies of one bill.
        await _queue_invoice_email(db, invoice)
    return InvoiceOut.model_validate(invoice)


@router.post(
    "/bookings/{booking_id}/invoice/email",
    response_model=InvoiceEmailResult,
    summary="Email a booking's invoice to the customer",
    description=(
        "Sends immediately rather than queueing, because someone pressed a button "
        "and is waiting to tell the customer it has gone. A failure comes back as "
        "**502** with the reason rather than disappearing into a retry queue.\n\n"
        "Raises the invoice first if the booking has none — the same idempotent "
        "call as `POST /bookings/{booking_id}/invoice`, so this never issues a "
        "second number for the same money. Safe to press twice; the customer gets "
        "two copies of one invoice, not two invoices."
    ),
)
async def email_booking_invoice(
    booking_id: uuid.UUID,
    payload: InvoiceEmailRequest,
    db: Db,
    _: RequireKiosk,
) -> InvoiceEmailResult:
    booking = await get_or_404(db, Booking, booking_id, label="Booking")
    invoice = await service.invoice_for_booking(db, booking)
    await db.flush()

    recipient = payload.to
    if recipient is None and invoice.customer_id:
        customer = await db.get(Customer, invoice.customer_id)
        recipient = customer.email if customer else None
    if not recipient:
        raise ConflictError(
            "No email address on file for this customer — ask for one and send it to that.",
            details={"booking_id": str(booking_id)},
        )

    tenant_settings = (await db.execute(select(TenantSettings))).scalar_one()
    subject, text, html = invoice_raised(
        tenant_settings,
        invoice_no=invoice.invoice_no,
        customer_name=invoice.customer_name,
        items=list(invoice.items or []),
        subtotal=invoice.subtotal,
        gst=invoice.gst,
        discount=invoice.discount,
        total=invoice.total,
        balance_due=invoice.balance_due,
    )

    try:
        delivery = await send_email(
            db,
            Message(to=str(recipient), subject=subject, text=text, html=html),
            event_key="invoice_sent",
            from_email=tenant_settings.notification_sender_email,
            from_name=tenant_settings.notification_sender_name or tenant_settings.business_name,
        )
    except MailNotConfigured as exc:
        raise ConflictError(
            "Email is not set up on this server yet — add the SMTP settings first.",
        ) from exc
    except Exception as exc:  # noqa: BLE001 — the operator needs the real reason
        raise MailDeliveryError(f"Could not send the invoice: {exc}") from exc

    return InvoiceEmailResult(invoice_no=invoice.invoice_no, sent_to=delivery.recipient)


# ── Payments ────────────────────────────────────────────────────────────────


@router.get("/payments", response_model=Page[PaymentOut], summary="List payments")
async def list_payments(
    db: Db,
    _: RequireStaff,
    params: Params,
    method: str | None = None,
    customer_id: uuid.UUID | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> Page[PaymentOut]:
    stmt = select(Payment).order_by(Payment.received_at.desc())
    if method:
        stmt = stmt.where(Payment.method == method)
    if customer_id is not None:
        stmt = stmt.where(Payment.customer_id == customer_id)
    if date_from is not None:
        stmt = stmt.where(Payment.received_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(Payment.received_at < date_to)
    return await paginate(db, stmt, params, PaymentOut)


@router.post(
    "/payments",
    response_model=PaymentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Record a payment",
    description=(
        "Rolls the amount up to the invoice and the booking in the same transaction. "
        "Paying more than the outstanding balance is refused — at a reception desk "
        "that is nearly always a typo, and absorbing it creates a credit nobody tracks."
    ),
)
async def create_payment(payload: PaymentCreate, db: Db, principal: RequireKiosk) -> PaymentOut:
    payment = await service.record_payment(
        db,
        amount=payload.amount,
        method=payload.method,
        invoice_id=payload.invoice_id,
        booking_id=payload.booking_id,
        customer_id=payload.customer_id,
        reference=payload.reference,
        notes=payload.notes,
        received_by_user_id=principal.id,
    )
    # Whoever the money came from, and where to write to them. A payment can be
    # attached to a booking, an invoice, a customer, or none of the three.
    recipient: str | None = None
    customer_name = ""
    balance_remaining: Decimal | None = None

    if payment.booking_id:
        booking = await db.get(Booking, payment.booking_id)
        if booking is not None:
            await record_event(
                db,
                booking,
                kind=BookingEventKind.PAYMENT,
                label="Payment Received",
                detail=f"{payment.amount} via {payment.method.value}",
                actor_user_id=principal.id,
            )
            await db.flush()
            customer_name = booking.customer_name
            balance_remaining = booking.balance_due
            if booking.customer_id:
                customer = await db.get(Customer, booking.customer_id)
                recipient = customer.email if customer else None

    if recipient is None and payment.customer_id:
        customer = await db.get(Customer, payment.customer_id)
        if customer is not None:
            recipient = customer.email
            customer_name = customer_name or customer.name

    await enqueue_email(
        db,
        kind=EMAIL_PAYMENT_RECEIPT,
        event_key="payment_receipt",
        recipient=recipient,
        payload={
            "customer_name": customer_name,
            # Decimals are not JSON, and float would round money. Strings round-trip
            # exactly and the handler rebuilds them as Decimal.
            "amount": str(payment.amount),
            "method": payment.method.value,
            "reference": payment.reference or str(payment.id),
            "balance_remaining": None if balance_remaining is None else str(balance_remaining),
        },
    )
    return PaymentOut.model_validate(payment)


@router.get(
    "/payments/overview",
    response_model=PaymentsOverview,
    summary="Collection summary",
    description="Backs the stat cards and method breakdown on the Payments page.",
)
async def payments_overview(
    db: Db,
    _: RequireStaff,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> PaymentsOverview:
    stmt = select(
        Payment.method, func.sum(Payment.amount), func.count(Payment.id)
    ).group_by(Payment.method)
    if date_from is not None:
        stmt = stmt.where(Payment.received_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(Payment.received_at < date_to)

    rows = (await db.execute(stmt)).all()
    by_method = [
        PaymentSummary(method=str(method), amount=money(total), count=int(count))
        for method, total, count in rows
    ]
    collected = money(sum((row.amount for row in by_method), Decimal("0")))
    count = sum(row.count for row in by_method)

    pending = await db.scalar(
        select(func.coalesce(func.sum(Invoice.total - Invoice.amount_paid), 0)).where(
            Invoice.status.in_([InvoiceStatus.PENDING, InvoiceStatus.OVERDUE])
        )
    )

    return PaymentsOverview(
        total_collected=collected,
        total_pending=money(pending or 0),
        transaction_count=count,
        average_transaction=money(collected / count) if count else Decimal("0.00"),
        by_method=sorted(by_method, key=lambda r: r.amount, reverse=True),
    )


# ── Membership plans ────────────────────────────────────────────────────────


@router.get("/membership-plans", response_model=list[MembershipPlanOut], summary="List membership plans")
async def list_plans(db: Db, _: RequireStaff, include_inactive: bool = False) -> list[MembershipPlanOut]:
    stmt = select(MembershipPlan).order_by(MembershipPlan.name)
    if not include_inactive:
        stmt = stmt.where(MembershipPlan.is_active.is_(True))
    plans = (await db.execute(stmt)).scalars().all()

    counts = dict(
        (
            await db.execute(
                select(MemberSubscription.plan_id, func.count(MemberSubscription.id))
                .where(MemberSubscription.status == SubscriptionStatus.ACTIVE)
                .group_by(MemberSubscription.plan_id)
            )
        ).all()
    )
    return [
        MembershipPlanOut(
            **MembershipPlanOut.model_validate(plan).model_dump(exclude={"active_count"}),
            active_count=int(counts.get(plan.id, 0)),
        )
        for plan in plans
    ]


@router.post(
    "/membership-plans",
    response_model=MembershipPlanOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a membership plan",
)
async def create_plan(payload: MembershipPlanCreate, db: Db, _: RequireManager) -> MembershipPlanOut:
    plan = MembershipPlan(**payload.model_dump())
    db.add(plan)
    await db.flush()
    return MembershipPlanOut.model_validate(plan)


@router.patch(
    "/membership-plans/{plan_id}", response_model=MembershipPlanOut, summary="Update a plan"
)
async def update_plan(
    plan_id: uuid.UUID, payload: MembershipPlanUpdate, db: Db, _: RequireManager
) -> MembershipPlanOut:
    plan = await get_or_404(db, MembershipPlan, plan_id, label="Membership plan")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(plan, field, value)
    await db.flush()
    return MembershipPlanOut.model_validate(plan)


# ── Subscriptions ───────────────────────────────────────────────────────────


def _to_out(subscription: MemberSubscription, today: date) -> SubscriptionOut:
    return SubscriptionOut(
        **{
            field: getattr(subscription, field)
            for field in (
                "id",
                "member_no",
                "customer_id",
                "plan_id",
                "plan_name",
                "plan_color",
                "start_date",
                "joined_on",
                "expiry_date",
                "duration",
                "status",
                "visits_used",
                "total_paid",
                "paused_days_total",
            )
        },
        days_left=subscription.days_left(today),
        renewal_due=subscription.renewal_due(today),
    )


@router.get(
    "/memberships/check",
    response_model=MembershipCheck,
    summary="Is this person a member?",
    description=(
        "The counter's question, and the only membership endpoint the **kiosk** "
        "can reach. Matches a member number or the customer's phone, and answers "
        "with status and expiry — never with money, and never with a list.\n\n"
        "Selling and renewing stay at reception and above: the shared tablet "
        "login is the most exposed credential in the venue, and taking payment "
        "for a twelve-month membership is not something it should be able to do. "
        "A **404** here means no membership, which is a complete answer."
    ),
)
async def check_membership(
    db: Db,
    _: RequireKiosk,
    code: Annotated[str, Query(min_length=3, description="Member number or phone")],
) -> MembershipCheck:
    cleaned = code.strip()
    customer_ids = (
        (await db.execute(select(Customer.id).where(Customer.phone == cleaned))).scalars().all()
    )

    stmt = select(MemberSubscription).where(
        (MemberSubscription.member_no.ilike(cleaned))
        | (MemberSubscription.customer_id.in_(customer_ids) if customer_ids else False)
    )
    # Newest first: somebody who let one lapse and bought another should be read
    # as the member they are now, not the one they used to be.
    subscription = (
        await db.execute(stmt.order_by(MemberSubscription.start_date.desc()).limit(1))
    ).scalar_one_or_none()

    if subscription is None:
        raise NotFoundError("No membership found for that number or phone.")

    customer = await db.get(Customer, subscription.customer_id)
    return MembershipCheck(
        member_no=subscription.member_no,
        customer_name=customer.name if customer else subscription.member_no,
        plan_name=subscription.plan_name,
        status=subscription.status,
        expiry_date=subscription.expiry_date,
        days_left=subscription.days_left(date.today()),
    )


@router.get("/memberships", response_model=Page[SubscriptionOut], summary="List memberships")
async def list_memberships(
    db: Db,
    _: RequireStaff,
    params: Params,
    membership_status: Annotated[SubscriptionStatus | None, Query(alias="status")] = None,
    plan_id: uuid.UUID | None = None,
    renewal_due: bool = Query(default=False, description="Active and expiring within 30 days"),
) -> Page[SubscriptionOut]:
    today = date.today()
    stmt = select(MemberSubscription).order_by(MemberSubscription.expiry_date)
    if membership_status is not None:
        stmt = stmt.where(MemberSubscription.status == membership_status)
    if plan_id is not None:
        stmt = stmt.where(MemberSubscription.plan_id == plan_id)
    if renewal_due:
        from datetime import timedelta

        stmt = stmt.where(
            MemberSubscription.status == SubscriptionStatus.ACTIVE,
            MemberSubscription.expiry_date <= today + timedelta(days=30),
        )

    total = await db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
    rows = (await db.execute(stmt.offset(params.offset).limit(params.size))).scalars().all()

    return Page[SubscriptionOut](
        items=[_to_out(row, today) for row in rows],
        total=int(total or 0),
        page=params.page,
        size=params.size,
        pages=max(1, (int(total or 0) + params.size - 1) // params.size),
    )


@router.post(
    "/memberships",
    response_model=SubscriptionWithInvoice,
    status_code=status.HTTP_201_CREATED,
    summary="Enrol a customer on a plan",
    description=(
        "Creates the membership and its invoice in one transaction. A membership "
        "with no bill, or a bill for a membership that failed to save, is a "
        "reconciliation problem someone has to chase by hand later."
    ),
)
async def create_membership(
    payload: SubscriptionCreate, db: Db, _: RequireStaff
) -> SubscriptionWithInvoice:
    subscription, invoice = await service.create_subscription(
        db,
        customer_id=payload.customer_id,
        plan_id=payload.plan_id,
        duration=payload.duration,
        start_date=payload.start_date or date.today(),
        discount_pct=payload.discount_pct,
        referral_code=payload.referral_code,
    )
    return SubscriptionWithInvoice(
        subscription=_to_out(subscription, date.today()),
        invoice=InvoiceOut.model_validate(invoice),
    )


@router.get("/memberships/{subscription_id}", response_model=SubscriptionOut, summary="A membership")
async def get_membership(subscription_id: uuid.UUID, db: Db, _: RequireStaff) -> SubscriptionOut:
    subscription = await get_or_404(db, MemberSubscription, subscription_id, label="Membership")
    subscription.total_paid = await service.subscription_paid_total(db, subscription.id)
    return _to_out(subscription, date.today())


@router.post(
    "/memberships/{subscription_id}/renew",
    response_model=SubscriptionWithInvoice,
    summary="Renew a membership",
    description=(
        "A membership renewed before it lapses continues from its current expiry "
        "date, so an early renewer does not forfeit days they already paid for."
    ),
)
async def renew_membership(
    subscription_id: uuid.UUID, payload: SubscriptionRenew, db: Db, _: RequireStaff
) -> SubscriptionWithInvoice:
    subscription = await get_or_404(db, MemberSubscription, subscription_id, label="Membership")
    subscription, invoice = await service.renew_subscription(
        db, subscription, duration=payload.duration
    )
    return SubscriptionWithInvoice(
        subscription=_to_out(subscription, date.today()),
        invoice=InvoiceOut.model_validate(invoice),
    )


@router.post(
    "/memberships/{subscription_id}/pause",
    response_model=SubscriptionOut,
    summary="Pause a membership",
    description=(
        "Parks the membership without consuming the paid term: the days spent "
        "paused are given back on resume, so the expiry moves out by however long "
        "it was parked. Reversible with `POST /memberships/{id}/resume`."
    ),
)
async def pause_membership(subscription_id: uuid.UUID, db: Db, _: RequireStaff) -> SubscriptionOut:
    subscription = await get_or_404(db, MemberSubscription, subscription_id, label="Membership")
    if subscription.status is not SubscriptionStatus.ACTIVE:
        raise ConflictError(f"This membership is {subscription.status.value}.")
    subscription.status = SubscriptionStatus.PAUSED
    subscription.paused_at = datetime.now(UTC)
    await db.flush()
    return _to_out(subscription, date.today())


@router.post(
    "/memberships/{subscription_id}/resume",
    response_model=SubscriptionOut,
    summary="Resume a paused membership",
    description=(
        "Returns a paused membership to active and extends its expiry by the "
        "number of days it spent paused. The running total is on "
        "`paused_days_total`, so a member asking why their year now ends in "
        "February can be shown the answer."
    ),
)
async def resume_membership(subscription_id: uuid.UUID, db: Db, _: RequireStaff) -> SubscriptionOut:
    subscription = await get_or_404(db, MemberSubscription, subscription_id, label="Membership")

    # The venue's own clock, on both sides of the subtraction. `date.today()` here
    # would be the server's, which is UTC in production and five and a half hours
    # behind the academy — enough to bank a day that was never paused.
    settings = await service._settings(db)
    zone = tenant_zone(settings.timezone)
    local_today = datetime.now(zone).date()

    service.resume_subscription(subscription, today=local_today, zone=zone)
    await db.flush()
    return _to_out(subscription, local_today)


@router.post(
    "/memberships/{subscription_id}/cancel",
    response_model=SubscriptionOut,
    summary="Cancel a membership",
)
async def cancel_membership(subscription_id: uuid.UUID, db: Db, _: RequireStaff) -> SubscriptionOut:
    subscription = await get_or_404(db, MemberSubscription, subscription_id, label="Membership")
    subscription.status = SubscriptionStatus.CANCELLED
    subscription.cancelled_at = datetime.now(UTC)
    await db.flush()
    return _to_out(subscription, date.today())
