"""Cron-driven background worker.

    python -m app.jobs.worker            # one pass over every tenant, then exit
    python -m app.jobs.worker --tenant xcourt

Designed to be invoked by cron (or a scheduled container) rather than run as a
daemon: at one academy's volume the work is a handful of rows a day, and a
long-lived worker is a process to monitor, restart and pay for.

NOT Celery, deliberately. If throughput ever justifies a broker, this table becomes
its outbox rather than being thrown away — the claim protocol below (`FOR UPDATE
SKIP LOCKED`) already makes running several workers concurrently safe.
"""

from __future__ import annotations

import argparse
import asyncio
import socket
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any, Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.mail import Message, send_email
from app.core.mail_templates import booking_confirmation, invoice_raised, payment_receipt
from app.modules.branches.models import Branch
from app.db.session import dispose_engine, tenant_session, untenanted_session
from app.models.tenant import Tenant, TenantSettings, TenantStatus
from app.modules.admin.models import Job, JobState, Notification, NotificationKind
from app.modules.admin.notify import (
    EMAIL_BOOKING_CONFIRMATION,
    EMAIL_INVOICE,
    EMAIL_PAYMENT_RECEIPT,
    as_id,
)
from app.modules.advertising.models import HOLDING_STATUSES, AdContract
from app.modules.booking.models import Booking, BookingStatus, Court, Sport
from app.modules.finance.models import Invoice, MemberSubscription, SubscriptionStatus

WORKER_ID = f"{socket.gethostname()}:{uuid.uuid4().hex[:8]}"

Handler = Callable[[AsyncSession, dict[str, Any]], Awaitable[str]]
HANDLERS: dict[str, Handler] = {}


def handler(kind: str) -> Callable[[Handler], Handler]:
    def register(fn: Handler) -> Handler:
        HANDLERS[kind] = fn
        return fn

    return register


# ── Job claiming ────────────────────────────────────────────────────────────


async def claim_batch(session: AsyncSession, *, limit: int = 20) -> list[Job]:
    """Take up to `limit` due jobs, locking them against other workers.

    `SKIP LOCKED` is what makes a second worker safe: rather than blocking on rows
    another worker already holds, it steps over them and takes the next available
    ones. Without it two workers serialise into one.
    """
    jobs = (
        (
            await session.execute(
                select(Job)
                .where(Job.state == JobState.PENDING, Job.run_at <= datetime.now(UTC))
                .order_by(Job.run_at)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )
    for job in jobs:
        job.state = JobState.RUNNING
        job.locked_at = datetime.now(UTC)
        job.locked_by = WORKER_ID
        job.attempts += 1
    await session.flush()
    return list(jobs)


async def run_job(session: AsyncSession, job: Job) -> None:
    fn = HANDLERS.get(job.kind)
    if fn is None:
        job.state = JobState.FAILED
        job.last_error = f"No handler registered for {job.kind!r}"
        return

    try:
        result = await fn(session, job.payload or {})
    except Exception as exc:  # noqa: BLE001 — a bad job must not stop the queue
        job.last_error = f"{type(exc).__name__}: {exc}"
        # Exhausted retries stay FAILED so they are visible in /jobs rather than
        # silently retried forever.
        job.state = JobState.PENDING if job.attempts < job.max_attempts else JobState.FAILED
        job.run_at = datetime.now(UTC) + timedelta(minutes=5 * job.attempts)
        return

    job.state = JobState.DONE
    job.completed_at = datetime.now(UTC)
    job.last_error = result or None


# ── Scheduled sweeps ────────────────────────────────────────────────────────


async def expire_memberships(session: AsyncSession) -> int:
    """Flip memberships whose expiry has passed.

    `days_left` and `renewal_due` are computed on read, so this only maintains the
    stored `status` that filters and reports depend on.
    """
    today = date.today()
    rows = (
        (
            await session.execute(
                select(MemberSubscription).where(
                    MemberSubscription.status == SubscriptionStatus.ACTIVE,
                    MemberSubscription.expiry_date < today,
                )
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        row.status = SubscriptionStatus.EXPIRED
    return len(rows)


async def notify_expiring_memberships(session: AsyncSession, *, within_days: int = 7) -> int:
    """Raise a notification for memberships about to lapse."""
    today = date.today()
    rows = (
        (
            await session.execute(
                select(MemberSubscription).where(
                    MemberSubscription.status == SubscriptionStatus.ACTIVE,
                    MemberSubscription.expiry_date.between(
                        today, today + timedelta(days=within_days)
                    ),
                )
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        session.add(
            Notification(
                kind=NotificationKind.MEMBERSHIP,
                title="Membership Expiring",
                body=(
                    f"{row.plan_name} ({row.member_no}) expires on "
                    f"{row.expiry_date:%d %b %Y}"
                ),
                severity_color="#FF8800",
                entity_type="member_subscription",
                entity_id=row.id,
            )
        )
    return len(rows)


async def advance_booking_states(session: AsyncSession) -> int:
    """Move bookings through upcoming → active → overdue as the clock passes them.

    Only the states that a wall clock determines. `completed` is a human act —
    reception confirms the session ended — and `cancelled` is explicit.
    """
    now = datetime.now(UTC)
    rows = (
        (
            await session.execute(
                select(Booking).where(
                    Booking.status.in_([BookingStatus.UPCOMING, BookingStatus.ACTIVE])
                )
            )
        )
        .scalars()
        .all()
    )
    changed = 0
    for booking in rows:
        if booking.starts_at <= now < booking.ends_at:
            new_state = BookingStatus.ACTIVE
        elif booking.ends_at <= now:
            # Past its end and still unpaid is what the frontend calls overdue.
            new_state = (
                BookingStatus.OVERDUE
                if booking.amount_paid < booking.total
                else BookingStatus.COMPLETED
            )
        else:
            continue
        if booking.status is not new_state:
            booking.status = new_state
            changed += 1
    return changed


async def notify_expiring_ad_contracts(session: AsyncSession, *, within_days: int = 30) -> int:
    today = date.today()
    rows = (
        (
            await session.execute(
                select(AdContract).where(
                    AdContract.status.in_(HOLDING_STATUSES),
                    AdContract.end_date.between(today, today + timedelta(days=within_days)),
                )
            )
        )
        .scalars()
        .all()
    )
    for row in rows:
        session.add(
            Notification(
                kind=NotificationKind.ADVERTISING,
                title="Ad Contract Expiring",
                body=f"{row.company} · {row.spot_name} ends {row.end_date:%d %b %Y}",
                severity_color="#FF8800",
                entity_type="ad_contract",
                entity_id=row.id,
            )
        )
    return len(rows)


@handler("membership.expire_lapsed")
async def _job_expire(session: AsyncSession, payload: dict[str, Any]) -> str:
    del payload
    return f"expired {await expire_memberships(session)}"


@handler("membership.renewal_reminder")
async def _job_renewal(session: AsyncSession, payload: dict[str, Any]) -> str:
    return f"notified {await notify_expiring_memberships(session, within_days=int(payload.get('within_days', 7)))}"


@handler("booking.advance_states")
async def _job_bookings(session: AsyncSession, payload: dict[str, Any]) -> str:
    del payload
    return f"advanced {await advance_booking_states(session)}"


# ── Outbound email ──────────────────────────────────────────────────────────
#
# Handlers re-read the entity rather than trusting the payload, so a confirmation
# sent a minute after the booking reflects the booking as it now stands — extended,
# re-priced, kit added. Anything raising here is retried by `run_job` with backoff;
# anything returning normally is done.


async def _tenant_settings(session: AsyncSession) -> TenantSettings:
    return (await session.execute(select(TenantSettings))).scalar_one()


async def _deliver(
    session: AsyncSession, settings_row: TenantSettings, payload: dict[str, Any], built: tuple[str, str, str]
) -> str:
    subject, text, html = built
    recipient = str(payload.get("recipient", ""))
    await send_email(
        session,
        Message(to=recipient, subject=subject, text=text, html=html),
        event_key=str(payload.get("event_key", "unknown")),
        from_email=settings_row.notification_sender_email,
        from_name=settings_row.notification_sender_name or settings_row.business_name,
    )
    return f"emailed {recipient}"


@handler(EMAIL_BOOKING_CONFIRMATION)
async def _job_booking_email(session: AsyncSession, payload: dict[str, Any]) -> str:
    booking_id = as_id(payload.get("booking_id"))
    booking = await session.get(Booking, booking_id) if booking_id else None
    if booking is None:
        # Deleted between queueing and sending. Nothing to apologise for and
        # nothing to retry — returning marks the job done.
        return "booking no longer exists; skipped"
    if booking.status is BookingStatus.CANCELLED:
        return "booking cancelled before the confirmation went out; skipped"

    tenant_settings = await _tenant_settings(session)
    court = await session.get(Court, booking.court_id)
    sport = await session.get(Sport, booking.sport_id)
    return await _deliver(
        session,
        tenant_settings,
        payload,
        booking_confirmation(
            booking,
            tenant_settings,
            court_name=court.name if court else "Court",
            sport_name=sport.name if sport else "",
        ),
    )


@handler(EMAIL_PAYMENT_RECEIPT)
async def _job_payment_email(session: AsyncSession, payload: dict[str, Any]) -> str:
    tenant_settings = await _tenant_settings(session)
    balance = payload.get("balance_remaining")
    return await _deliver(
        session,
        tenant_settings,
        payload,
        payment_receipt(
            tenant_settings,
            customer_name=str(payload.get("customer_name", "")),
            amount=Decimal(str(payload.get("amount", "0"))),
            method=str(payload.get("method", "")),
            reference=str(payload.get("reference", "")),
            balance_remaining=None if balance is None else Decimal(str(balance)),
        ),
    )


@handler(EMAIL_INVOICE)
async def _job_invoice_email(session: AsyncSession, payload: dict[str, Any]) -> str:
    invoice_id = as_id(payload.get("invoice_id"))
    invoice = await session.get(Invoice, invoice_id) if invoice_id else None
    if invoice is None:
        return "invoice no longer exists; skipped"

    tenant_settings = await _tenant_settings(session)
    branch = await session.get(Branch, invoice.branch_id) if invoice.branch_id else None
    return await _deliver(
        session,
        tenant_settings,
        payload,
        invoice_raised(
            tenant_settings,
            branch=branch,
            invoice_no=invoice.invoice_no,
            customer_name=invoice.customer_name,
            items=list(invoice.items or []),
            subtotal=invoice.subtotal,
            gst=invoice.gst,
            discount=invoice.discount,
            total=invoice.total,
            balance_due=invoice.balance_due,
        ),
    )


# ── Entry point ─────────────────────────────────────────────────────────────


async def sweep_tenant(tenant_id: uuid.UUID) -> dict[str, int]:
    """One pass for one academy: scheduled sweeps, then any queued jobs."""
    async with tenant_session(tenant_id) as session:
        stats = {
            "memberships_expired": await expire_memberships(session),
            "membership_reminders": await notify_expiring_memberships(session),
            "bookings_advanced": await advance_booking_states(session),
            "ad_contract_reminders": await notify_expiring_ad_contracts(session),
        }

        jobs = await claim_batch(session)
        for job in jobs:
            await run_job(session, job)
        stats["jobs_processed"] = len(jobs)
        return stats


async def main() -> None:
    parser = argparse.ArgumentParser(description="gamexo background worker")
    parser.add_argument("--tenant", help="Limit to one tenant slug; default is all active")
    args = parser.parse_args()

    async with untenanted_session() as session:
        stmt = select(Tenant).where(Tenant.status != TenantStatus.SUSPENDED)
        if args.tenant:
            stmt = stmt.where(Tenant.slug == args.tenant)
        tenants = [(row.id, row.slug) for row in (await session.execute(stmt)).scalars()]

    for tenant_id, slug in tenants:
        # Each academy gets its own transaction: one tenant's bad data must not
        # roll back the sweep for everyone else.
        try:
            stats = await sweep_tenant(tenant_id)
        except Exception as exc:  # noqa: BLE001
            print(f"[{slug}] FAILED: {type(exc).__name__}: {exc}")
            continue
        summary = " ".join(f"{k}={v}" for k, v in stats.items() if v)
        print(f"[{slug}] {summary or 'nothing to do'}")

    await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
