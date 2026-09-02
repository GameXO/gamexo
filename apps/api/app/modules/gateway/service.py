"""Every operation a third-party integration needs, once.

── Why this file exists ────────────────────────────────────────────────────────
The gateway was written twice: once speaking our own REST contract, and again when
Playo turned out to dictate its own. Both independently resolved courts, priced
slots, checked availability, created bookings and cancelled them — and the *generic*
one ended up the weaker of the two, with no holds, no atomicity and no expiry.

So the domain lives here, partner-agnostic, and a dialect is only ever a translation
of wire format. A partner willing to use our API costs no code at all. A partner that
dictates its own spec costs one file in `dialects/`, and inherits every guarantee
below for free.

── What this file does NOT do ──────────────────────────────────────────────────
Prevent double bookings. That is `booking_no_overlap`, a Postgres exclusion
constraint, and it holds whichever client is asking and whether or not this module
has a bug. Everything here is about turning that constraint into a legible answer,
and about the guarantees Postgres cannot express on its own: idempotency, all-or-
nothing writes, and holds that expire.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError
from app.modules.booking import service as booking_service
from app.modules.booking.models import (
    Booking,
    BookingEventKind,
    BookingStatus,
    BookingType,
    Court,
    PaymentStatus,
)
from app.modules.booking.pricing import money, tenant_zone
from app.modules.gateway.models import IntegrationPartner

#: How long an unconfirmed hold blocks a court.
#:
#: The trade-off is one-sided in each direction, so the number matters: too short and
#: a customer genuinely mid-payment loses the court under them; too long and every
#: abandoned checkout takes a prime evening slot off the market. Fifteen minutes is
#: longer than any card or UPI flow and short enough that a dropped session costs at
#: most one slot rotation.
HOLD_TTL = timedelta(minutes=15)


class GatewayError(Exception):
    """A business failure, phrased for the partner.

    Deliberately not an `AppError`: those map to an HTTP status, and the right status
    depends on the dialect. Our own contract answers a taken slot with 409; Playo's
    answers it with a 200 carrying `requestStatus: 0`, because their client treats a
    non-2xx as a transport fault and retries — and a sold court never becomes
    available by retrying. The dialect decides; the core just says what went wrong.
    """


@dataclass(frozen=True)
class SlotRequest:
    """One slot a partner wants, already normalised out of their wire format.

    Times are aware and in UTC by the time they reach here. Parsing is the dialect's
    job precisely because it is where the formats differ — Playo sends a date and a
    wall-clock time in venue-local, our own contract sends an ISO instant — and a
    timezone mistake made once in the core would be made for every partner at once.
    """

    court_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime

    #: The partner's own id for this booking. The idempotency key: a retried create
    #: with the same value returns the original rather than selling the court twice.
    #:
    #: `None` opts out — stored as SQL NULL, which is what keeps the partial unique
    #: index (`WHERE external_ref IS NOT NULL`) from treating every ref-less booking
    #: as a duplicate of every other. An empty string would *not* be NULL and would
    #: collide on the second one.
    external_ref: str | None

    customer_name: str
    customer_phone: str | None = None

    #: What the partner charged. `None` means "use our rate card" — appropriate for a
    #: partner that reads prices from our availability rather than setting its own.
    price: Decimal | None = None

    #: How much the partner already collected. Becomes `amount_paid`, so anything
    #: short shows as a balance the desk collects on arrival.
    amount_paid: Decimal = Decimal(0)

    @property
    def duration_min(self) -> int:
        return int((self.ends_at - self.starts_at).total_seconds() // 60)


@dataclass
class ClaimResult:
    bookings: list[Booking] = field(default_factory=list)
    #: Bookings that already existed under this `external_ref` — a replayed request.
    #: Surfaced so a dialect can report "created" versus "already had this" if its
    #: contract distinguishes them. Playo's does not; ours does.
    replayed: set[uuid.UUID] = field(default_factory=set)


@asynccontextmanager
async def atomic(db: AsyncSession) -> AsyncIterator[None]:
    """A SAVEPOINT around a multi-slot write. All of it lands, or none of it.

    This is the least obvious thing in the module and the easiest to lose.

    The request-scoped session runs inside `async with session.begin()`, which
    **commits when the handler returns normally**. A handler that creates three of
    four bookings, hits a conflict, and then returns a failure envelope has returned
    normally — so those three would be committed while the partner is told nothing
    was created. Their side shows no booking, ours shows three courts blocked, and
    nothing anywhere records why.

    `db.rollback()` is not an alternative: it ends the outer transaction too, and the
    enclosing `begin()` then fails on the way out. A savepoint keeps the rollback
    local, so the handler is free to return its own failure response.

    Playo's spec requires this explicitly for create, confirm and cancel
    (*"if any order fails then no order should be created on the client side"*), but
    it is right for every dialect — a partially-applied booking request is never what
    anyone meant.
    """
    async with db.begin_nested():
        yield


# ── Reading ─────────────────────────────────────────────────────────────────


async def availability(
    db: AsyncSession,
    *,
    on_date: datetime,
    duration_min: int = 60,
    sport_id: uuid.UUID | None = None,
    court_id: uuid.UUID | None = None,
    slot_minutes: int = 60,
) -> list[dict[str, Any]]:
    """Free slots for a day, reflecting **every** booking.

    Counter, dashboard, other platforms, and unconfirmed holds still in checkout. A
    slot a partner cannot see as taken is a slot that partner will sell again.

    Expired holds are released first, so an abandoned checkout from twenty minutes
    ago is not still showing a court as busy. `booking_service.court_availability`
    already does that sweep; the call is here so the ordering is visible rather than
    implied.
    """
    await booking_service.release_expired_holds(db)
    return await booking_service.court_availability(
        db,
        on_date=on_date,
        duration_min=duration_min,
        sport_id=sport_id,
        court_id=court_id,
        slot_minutes=slot_minutes,
    )


async def owned(
    db: AsyncSession, partner: IntegrationPartner, ref: str
) -> Booking | None:
    """Resolve an id the partner quotes back at us — but only if they created it.

    Scoped to `created_by_partner_id` on every path. A partner must never be able to
    reach a walk-in, or another platform's booking, by quoting its reference — and
    references are printed on every customer's ticket, so they are not secret.

    Accepts our booking reference (`XCB0042`, what we hand back), our UUID (for an
    integration that stored it), or the partner's own `external_ref`.
    """
    cleaned = (ref or "").strip().strip('"')
    if not cleaned:
        return None

    scoped = select(Booking).where(Booking.created_by_partner_id == partner.id)

    try:
        as_uuid = uuid.UUID(cleaned)
    except ValueError:
        pass
    else:
        return (await db.execute(scoped.where(Booking.id == as_uuid))).scalar_one_or_none()

    found = (
        await db.execute(scoped.where(Booking.reference == cleaned))
    ).scalar_one_or_none()
    if found is not None:
        return found

    return (
        await db.execute(scoped.where(Booking.external_ref == cleaned))
    ).scalar_one_or_none()


async def _by_external_ref(
    db: AsyncSession, partner: IntegrationPartner, external_ref: str
) -> Booking | None:
    """The idempotency lookup.

    Backed by the partial unique index `uq_booking_partner_external_ref`, which is
    also what stops a retry from creating a second booking if this check races.
    """
    return (
        await db.execute(
            select(Booking).where(
                Booking.created_by_partner_id == partner.id,
                Booking.external_ref == external_ref.strip().strip('"'),
            )
        )
    ).scalar_one_or_none()


# ── Pricing ─────────────────────────────────────────────────────────────────


def _reconcile_price(
    slot: SlotRequest, our_total: Decimal, tax_config: dict
) -> tuple[Decimal, Decimal, Decimal, str | None]:
    """`(court_charge, taxes, total, warning)` for a slot the partner already sold.

    ── Whose price wins ────────────────────────────────────────────────────────
    Theirs, when they sent one. The customer has seen a price, agreed to it and
    usually paid it; booking them in at our rate card instead means the counter
    asking for money the customer was never told about, or the venue quietly
    under-charging.

    Our own quote is still computed, to compare. A disagreement is a real problem —
    the rate card the partner is selling from has drifted from ours — but it is the
    venue's problem to fix in the morning, not a reason to refuse a booking already
    paid for. It comes back as a warning that lands on the booking's timeline.

    Tax is worked backwards out of the gross, since a partner quotes one all-in
    figure. Without that the invoice would show a total that does not equal its own
    lines, which is the sort of thing that surfaces during a GST audit.
    """
    if slot.price is None:
        # No price supplied: our rate card is the only number in play, and
        # price_booking has already split it correctly.
        return Decimal("0"), Decimal("0"), our_total, None

    total = money(slot.price)
    gst_rate = Decimal(str(tax_config.get("gst_rate", 18)))
    base = money(total / (Decimal(1) + gst_rate / Decimal(100)))
    taxes = money(total - base)

    warning = None
    if our_total and abs(our_total - total) > Decimal("1"):
        warning = (
            f"Charged {total} for this slot; our rate card says {our_total}. Booked "
            "at the partner's price — check the rates you have published with them."
        )

    return base, taxes, total, warning


def _payment_status(total: Decimal, paid: Decimal) -> PaymentStatus:
    if paid <= 0:
        return PaymentStatus.PENDING
    if paid >= total:
        return PaymentStatus.PAID
    return PaymentStatus.PARTIAL


# ── Writing ─────────────────────────────────────────────────────────────────


async def _load_court(db: AsyncSession, court_id: uuid.UUID) -> Court:
    court = await db.get(Court, court_id)
    if court is None:
        raise GatewayError(f"Unknown court {court_id}.")
    if not court.is_bookable:
        raise GatewayError(f"{court.name} is under maintenance.")
    return court


async def _claim_one(
    db: AsyncSession,
    partner: IntegrationPartner,
    slot: SlotRequest,
    *,
    hold: bool,
) -> tuple[Booking, bool]:
    """One slot. Returns `(booking, created)`; `created` is False on a replay.

    Idempotency comes first, before anything is priced or written. A retried create
    after a timeout on the partner's side must be a cheap no-op returning the
    original booking — not a second attempt that races the exclusion constraint and
    reports a conflict against itself.
    """
    if slot.external_ref:
        existing = await _by_external_ref(db, partner, slot.external_ref)
        if existing is not None and existing.status is not BookingStatus.CANCELLED:
            return existing, False

    settings = await booking_service.load_settings(db)
    court = await _load_court(db, slot.court_id)

    if slot.ends_at <= slot.starts_at:
        raise GatewayError("A slot must end after it starts.")
    if slot.ends_at <= datetime.now(UTC):
        raise GatewayError("That slot has already finished.")

    customer_id, name, phone = await booking_service.resolve_customer(
        db,
        customer_id=None,
        customer_name=slot.customer_name,
        customer_phone=slot.customer_phone,
    )

    our_quote, _ = await booking_service.price_booking(
        db,
        court=court,
        starts_at=slot.starts_at,
        duration_min=slot.duration_min,
        selections=[],
        discount=0,
    )
    court_charge, taxes, total, warning = _reconcile_price(
        slot, our_quote.total, settings.tax_config
    )
    if slot.price is None:
        court_charge, taxes = our_quote.court_charge, our_quote.taxes

    booking = Booking(
        reference=await booking_service.next_booking_reference(db),
        customer_id=customer_id,
        customer_name=name,
        customer_phone=phone,
        sport_id=court.sport_id,
        court_id=court.id,
        starts_at=slot.starts_at,
        ends_at=slot.ends_at,
        duration_min=slot.duration_min,
        # ONLINE, never WALKIN: nobody is at the counter, so this must not trip the
        # auto check-in. Arriving stays a separate event the desk confirms.
        booking_type=BookingType.ONLINE,
        status=BookingStatus.HELD if hold else BookingStatus.UPCOMING,
        hold_expires_at=(datetime.now(UTC) + HOLD_TTL) if hold else None,
        open_slot=court.open_slots_enabled,
        created_by_partner_id=partner.id,
        # From the authenticated key, never from the request body — a platform must
        # not be able to file a booking under a competitor's name.
        source_platform=partner.slug,
        external_ref=(slot.external_ref or "").strip().strip('"') or None,
        court_charge=court_charge,
        equipment_charge=0,
        discount=0,
        taxes=taxes,
        total=total,
        amount_paid=slot.amount_paid,
        payment_status=_payment_status(total, slot.amount_paid),
        equipment=[],
    )
    db.add(booking)

    # Turns the exclusion constraint into a legible message. The constraint is what
    # actually prevents the double booking; this is what says why it was refused.
    try:
        await booking_service.ensure_slot_free(
            db, court_id=court.id, starts_at=slot.starts_at, ends_at=slot.ends_at
        )
    except ConflictError as exc:
        local = slot.starts_at.astimezone(tenant_zone(settings.timezone))
        raise GatewayError(
            f"{court.name} is already booked at {local:%H:%M} on {local:%Y-%m-%d}."
        ) from exc

    await db.flush()

    await booking_service.record_event(
        db,
        booking,
        kind=BookingEventKind.CREATED,
        label="Slot Held" if hold else "Booking Created",
        detail=(
            f"Via {partner.name}"
            + (f" (ref {slot.external_ref})" if slot.external_ref else "")
        ),
        actor_user_id=None,
    )
    if warning:
        # Its own entry. A price mismatch is something someone has to act on, and
        # folding it into the creation note is how it gets scrolled past.
        await booking_service.record_event(
            db,
            booking,
            kind=BookingEventKind.NOTE,
            label="Price mismatch",
            detail=warning,
            actor_user_id=None,
        )
    await db.flush()
    return booking, True


async def claim(
    db: AsyncSession,
    partner: IntegrationPartner,
    slots: Sequence[SlotRequest],
    *,
    hold: bool,
) -> ClaimResult:
    """Take one or more slots, all or nothing.

    `hold=True` blocks the courts without creating bookings — the two-phase flow, for
    a partner whose customer is still paying. A hold is a real row against the same
    exclusion constraint, so the counter cannot sell the slot underneath them; it is
    not a booking, so it never reaches a report, the POS board or the day's takings
    (see `LIVE_STATUSES` in booking/models.py).

    `hold=False` creates confirmed bookings directly, for a partner that takes
    payment before calling us.

    Caller wraps this in `atomic()`. Left to the caller rather than done here because
    a dialect may need more than one core call inside the same all-or-nothing region.
    """
    if not slots:
        raise GatewayError("No slots were supplied.")

    await booking_service.release_expired_holds(db)

    result = ClaimResult()
    for slot in slots:
        booking, created = await _claim_one(db, partner, slot, hold=hold)
        result.bookings.append(booking)
        if not created:
            result.replayed.add(booking.id)
    return result


async def confirm(
    db: AsyncSession, partner: IntegrationPartner, refs: Sequence[str]
) -> list[Booking]:
    """Turn held slots into real bookings, once payment has cleared.

    Only after this do they appear in reports, on the POS board and in the takings.

    Idempotent: confirming an already-confirmed booking succeeds and returns it, so a
    dropped response is safe to retry.

    ── The expired-hold case ───────────────────────────────────────────────────
    Holds are swept *first*, so the statuses read below are true. Without that an
    expired-but-unswept hold is still `HELD` and gets confirmed — which is how a
    court already re-sold at the counter ends up with two customers. That was a real
    bug, caught by the sandbox's `confirm-expired` scenario.

    Once swept, a lapsed hold still confirms **if the court is free**: the customer
    paid, and our fifteen-minute timer is not their problem. It is refused only when
    someone else has taken the slot — and the exclusion constraint would refuse the
    flush anyway, which is what makes the check safe rather than merely polite.
    """
    if not refs:
        raise GatewayError("No bookings were supplied.")

    await booking_service.release_expired_holds(db)

    confirmed: list[Booking] = []
    for ref in refs:
        booking = await owned(db, partner, ref)
        if booking is None:
            raise GatewayError(f"Unknown booking {ref!r}.")

        if booking.status is BookingStatus.CANCELLED:
            try:
                await booking_service.ensure_slot_free(
                    db,
                    court_id=booking.court_id,
                    starts_at=booking.starts_at,
                    ends_at=booking.ends_at,
                    exclude_booking_id=booking.id,
                )
            except ConflictError as exc:
                raise GatewayError(
                    f"{ref!r} expired and the court has since been booked by someone "
                    "else. Refund the customer."
                ) from exc

            booking.status = BookingStatus.UPCOMING
            booking.hold_expires_at = None
            booking.cancelled_at = None
            booking.cancellation_reason = None
            await booking_service.record_event(
                db,
                booking,
                kind=BookingEventKind.CREATED,
                label="Booking Confirmed",
                detail=(
                    f"Payment confirmed on {partner.name} after the hold had expired; "
                    "the court was still free."
                ),
                actor_user_id=None,
            )
        elif booking.status is BookingStatus.HELD:
            booking.status = BookingStatus.UPCOMING
            booking.hold_expires_at = None
            await booking_service.record_event(
                db,
                booking,
                kind=BookingEventKind.CREATED,
                label="Booking Confirmed",
                detail=f"Payment confirmed on {partner.name}",
                actor_user_id=None,
            )

        confirmed.append(booking)

    await db.flush()
    return confirmed


async def release(
    db: AsyncSession,
    partner: IntegrationPartner,
    refs: Sequence[str],
    *,
    reason: str | None = None,
    detail_suffix: str = "",
) -> list[Booking]:
    """Cancel bookings or holds, freeing the courts for everyone immediately.

    Idempotent — cancelling an already-cancelled booking is a success, not an error.
    `booking_service.release_booking` does the real work: cancelling is not one
    field, it also returns any kit still signed out.
    """
    if not refs:
        raise GatewayError("No bookings were supplied.")

    released: list[Booking] = []
    for ref in refs:
        booking = await owned(db, partner, ref)
        if booking is None:
            raise GatewayError(f"Unknown booking {ref!r}.")

        await booking_service.release_booking(
            db,
            booking,
            reason=reason or f"Cancelled on {partner.name}",
            actor_user_id=None,
            detail_prefix=f"Cancelled via {partner.name}{detail_suffix}",
        )
        booking.hold_expires_at = None
        released.append(booking)

    await db.flush()
    return released


async def map_external(
    db: AsyncSession, partner: IntegrationPartner, pairs: Sequence[tuple[str, str]]
) -> None:
    """Record a partner's second identifier against bookings we already hold.

    Some platforms issue two: an order id at checkout and a booking id once their
    side settles. `external_ref` holds the first, `partner_booking_ref` the second.
    Kept apart because reconciliation matches on whichever the other system is
    quoting, and conflating them silently mismatches rows.
    """
    if not pairs:
        raise GatewayError("No bookings were supplied.")

    for ref, partner_booking_ref in pairs:
        booking = await owned(db, partner, ref)
        if booking is None:
            raise GatewayError(f"Unknown booking {ref!r}.")
        booking.partner_booking_ref = partner_booking_ref

    await db.flush()
