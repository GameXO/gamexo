"""Booking domain logic. Routers stay thin; everything tenant-aware lives here."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, time, timedelta
from decimal import Decimal
from typing import Any, Iterable, Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.modules.booking.models import (
    Booking,
    BookingEvent,
    BookingEventKind,
    BookingStatus,
    BookingType,
    Court,
    Customer,
    Equipment,
    EquipmentMode,
    EquipmentMovement,
    EquipmentUnit,
    MovementKind,
    Sport,
)
from app.modules.booking.pricing import EquipmentLine, Quote, money, quote_booking, tenant_zone
from app.modules.booking.schemas import EquipmentSelection
from app.models.tenant import TenantSettings


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-") or "sport"


def initials(name: str) -> str:
    parts = [p for p in name.strip().split() if p]
    if not parts:
        return "?"
    return (parts[0][0] + (parts[-1][0] if len(parts) > 1 else parts[0][1:2])).upper()


async def load_settings(session: AsyncSession) -> TenantSettings:
    """The current academy's settings. Tenant-scoped, so no filter is needed."""
    result = await session.execute(select(TenantSettings))
    settings = result.scalar_one_or_none()
    if settings is None:
        raise NotFoundError("This academy has no settings row.")
    return settings


# ── Booking references ──────────────────────────────────────────────────────
#
# `XC-B-0042`. The academy's own prefix, the booking series, then the counter.

#: Any leading letters, then the digits that carry the meaning. The letters are
#: matched but discarded: on a kiosk the tenant is already fixed by the hostname,
#: so "XCB42", "B-42" and "42" can only mean one booking, and refusing the short
#: forms would make someone key a prefix they can see printed above the screen.
_REFERENCE_INPUT = re.compile(r"^[A-Z]*B?[^0-9]*([0-9]+)$")


async def next_booking_reference(session: AsyncSession) -> str:
    """Allocate the next reference for this academy.

    Deferred import: finance imports booking models, so pulling numbering in at
    module scope closes the cycle.
    """
    from app.modules.finance.models import CounterKind
    from app.modules.finance.numbering import next_number

    settings = await load_settings(session)
    return await next_number(session, CounterKind.BOOKING, prefix=settings.invoice_prefix)


def normalise_reference(raw: str, *, prefix: str) -> str | None:
    """Turn whatever was typed into the stored form, or None if it cannot be one.

    Forgiving on purpose. This value is keyed one character at a time on a
    touchscreen by someone who has just arrived, reading a phone screen or a
    printed ticket, so every one of these resolves to `XC-B-0042`:

        XC-B-0042   xc b 0042   XCB0042   B-42   0042   42

    What it will not do is guess. A string with no digits, or one that is all
    digits and too long to be a counter value, returns None rather than being
    coerced into a lookup that would fail confusingly further down — a 10-digit
    phone number typed out of habit is the case that matters.
    """
    cleaned = re.sub(r"[^A-Za-z0-9]", "", raw or "").upper()
    match = _REFERENCE_INPUT.match(cleaned)
    if match is None:
        return None

    digits = match.group(1)
    # Eight digits is 99,999,999 bookings for one academy. Anything longer is not a
    # reference someone mistyped, it is a phone number or a card number.
    if len(digits) > 8:
        return None

    return f"{prefix}-B-{int(digits):04d}"


async def find_by_reference(session: AsyncSession, raw: str) -> Booking | None:
    """Resolve a typed reference to exactly one booking, or nothing.

    Tenant-scoped by the session, so a reference from another academy cannot be
    reached even though the counter guarantees the same string exists there.
    """
    settings = await load_settings(session)
    reference = normalise_reference(raw, prefix=settings.invoice_prefix)
    if reference is None:
        return None

    result = await session.execute(select(Booking).where(Booking.reference == reference))
    return result.scalar_one_or_none()


async def resolve_equipment_lines(
    session: AsyncSession, selections: Iterable[EquipmentSelection]
) -> tuple[list[EquipmentLine], dict[uuid.UUID, Equipment]]:
    """Turn equipment ids into priced lines, at the rate current right now.

    The rate is captured onto the booking rather than referenced, so re-pricing the
    catalogue tomorrow does not silently rewrite yesterday's bookings and invoices.
    """
    selections = list(selections)
    if not selections:
        return [], {}

    ids = [s.equipment_id for s in selections]
    rows = (await session.execute(select(Equipment).where(Equipment.id.in_(ids)))).scalars().all()
    by_id = {row.id: row for row in rows}

    missing = set(ids) - set(by_id)
    if missing:
        raise NotFoundError(
            "Unknown equipment.", details={"ids": sorted(str(i) for i in missing)}
        )

    lines = [_line_for(by_id[s.equipment_id], s) for s in selections]
    return lines, by_id


def rate_for(item: Equipment, selection: EquipmentSelection) -> Decimal:
    """The price of one unit of what was actually chosen.

    Refuses a mode the catalogue does not offer rather than quietly falling back to
    the other price — charging a sale price for something the customer thinks they
    rented is the kind of error nobody notices until the deposit is disputed.
    """
    if selection.unit is EquipmentUnit.PACK:
        if not item.for_sale:
            raise ConflictError(f"{item.name} is not for sale.")
        if item.pack_size <= 1:
            raise ConflictError(f"{item.name} is not sold in packs.")
        return item.pack_price

    if selection.mode is EquipmentMode.BUY:
        if not item.for_sale:
            raise ConflictError(f"{item.name} is not for sale.")
        return item.sale_price

    if not item.for_rent:
        raise ConflictError(f"{item.name} is not available to rent.")
    return item.rental_price


def units_drawn(item: Equipment, selection: EquipmentSelection) -> int:
    """How many base units leave the shelf for this line.

    Stock is counted in single items, so two 3-packs take six. Keeping the ledger
    in base units is what lets a pack and a loose single share one stock figure.
    """
    if selection.unit is EquipmentUnit.PACK:
        return selection.qty * max(1, item.pack_size)
    return selection.qty


def _line_for(item: Equipment, selection: EquipmentSelection) -> EquipmentLine:
    suffix = (
        f" (pack of {item.pack_size})"
        if selection.unit is EquipmentUnit.PACK
        else ("" if selection.mode is EquipmentMode.RENT else " (purchase)")
    )
    return EquipmentLine(
        name=f"{item.name}{suffix}",
        qty=selection.qty,
        rate=rate_for(item, selection),
        equipment_id=item.id,
        mode=selection.mode,
        unit=selection.unit,
    )


async def price_with_lines(
    session: AsyncSession,
    *,
    court: Court,
    starts_at: datetime,
    duration_min: int,
    lines: Sequence[EquipmentLine],
    discount: Decimal,
) -> Quote:
    """Price a booking against equipment lines that are already resolved.

    Split out from `price_booking` for edits that must NOT re-resolve kit against
    the catalogue. Moving a booking to a later slot re-prices the court, but the
    racket the customer already has in hand was agreed at the rate on their bill —
    re-resolving would silently restate it at today's price. Passing the stored
    lines through keeps that half of the total frozen.
    """
    settings = await load_settings(session)
    return quote_booking(
        court=court,
        starts_at=starts_at,
        duration_min=duration_min,
        equipment_lines=lines,
        discount=discount,
        booking_rules=settings.booking_rules,
        tax_config=settings.tax_config,
        timezone_name=settings.timezone,
    )


async def price_booking(
    session: AsyncSession,
    *,
    court: Court,
    starts_at: datetime,
    duration_min: int,
    selections: Iterable[EquipmentSelection],
    discount: Decimal,
) -> tuple[Quote, list[EquipmentLine]]:
    """Price a booking, resolving kit selections against the catalogue first."""
    lines, _ = await resolve_equipment_lines(session, selections)
    quote = await price_with_lines(
        session,
        court=court,
        starts_at=starts_at,
        duration_min=duration_min,
        lines=lines,
        discount=discount,
    )
    return quote, lines


def equipment_lines_from_json(rows: Iterable[dict[str, Any]] | None) -> list[EquipmentLine]:
    """Rebuild priced lines from the JSON stored on a booking.

    Rows written before `equipment_id` was recorded carry None there. They still
    price correctly — name, qty and rate are all present — they just cannot be
    matched back to a catalogue row, which is why merging falls back to the name.
    """
    out: list[EquipmentLine] = []
    for row in rows or []:
        raw_id = row.get("equipment_id")
        out.append(
            EquipmentLine(
                name=str(row.get("name", "")),
                qty=int(row.get("qty", 0)),
                rate=Decimal(str(row.get("rate", "0"))),
                equipment_id=uuid.UUID(raw_id) if raw_id else None,
                mode=str(row.get("mode", "rent")),
                unit=str(row.get("unit", "single")),
            )
        )
    return out


def merge_equipment_lines(
    existing: Sequence[EquipmentLine], added: Sequence[EquipmentLine]
) -> list[EquipmentLine]:
    """Combine two sets of kit, summing quantities of the same item.

    Matched on equipment_id where both sides have one, falling back to name so a
    legacy line without an id still merges rather than appearing twice on the bill.
    The later rate wins, because it is the one the catalogue charges today.
    """
    merged: list[EquipmentLine] = []
    index: dict[str, int] = {}

    for line in [*existing, *added]:
        # Mode and unit are part of the identity: a rented racket and a bought one
        # are two lines at two prices, and three loose balls are not one 3-pack.
        base = str(line.equipment_id) if line.equipment_id else f"name:{line.name.lower()}"
        key = f"{base}|{line.mode}|{line.unit}"
        at = index.get(key)
        if at is None:
            index[key] = len(merged)
            merged.append(line)
        else:
            prior = merged[at]
            merged[at] = EquipmentLine(
                name=line.name or prior.name,
                qty=prior.qty + line.qty,
                rate=line.rate,
                equipment_id=line.equipment_id or prior.equipment_id,
                mode=line.mode,
                unit=line.unit,
            )
    return merged


async def find_adjoining_booking(
    session: AsyncSession,
    *,
    court_id: uuid.UUID,
    starts_at: datetime,
    customer_id: uuid.UUID | None,
    customer_phone: str | None,
) -> Booking | None:
    """The same customer's session on this court that ends exactly when this starts.

    Two rows for one continuous stretch of play is the thing this exists to stop.
    They read as separate bills, so the counter settles one and misses the other,
    and add-ons issued in the first hour are priced against that hour alone.

    Deliberately strict: same court, exactly contiguous, same customer, and still
    live. A gap of even a minute is two sessions, and a different customer on the
    next slot is obviously not the same booking.
    """
    stmt = select(Booking).where(
        Booking.court_id == court_id,
        Booking.ends_at == starts_at,
        Booking.status.notin_([BookingStatus.CANCELLED, BookingStatus.COMPLETED]),
    )

    if customer_id is not None:
        stmt = stmt.where(Booking.customer_id == customer_id)
    elif customer_phone:
        # Walk-ins are frequently anonymous, so the phone number is the only stable
        # identity they have. Without this the common counter case never merges.
        stmt = stmt.where(Booking.customer_phone == customer_phone)
    else:
        return None

    return (await session.execute(stmt.order_by(Booking.ends_at.desc()).limit(1))).scalar_one_or_none()


async def absorb_into_booking(
    session: AsyncSession,
    booking: Booking,
    *,
    court: Court,
    additional_minutes: int,
    selections: Sequence[EquipmentSelection],
) -> Booking:
    """Fold a would-be adjacent booking into an existing one, and re-price the whole.

    Priced as a single longer session rather than by adding two quotes together:
    peak-rate boundaries and any per-booking rounding then apply once, to the real
    duration, which is the number the customer is actually charged for.
    """
    added_lines, _ = await resolve_equipment_lines(session, selections)
    combined = merge_equipment_lines(equipment_lines_from_json(booking.equipment), added_lines)

    settings = await load_settings(session)
    duration = booking.duration_min + additional_minutes
    quote = quote_booking(
        court=court,
        starts_at=booking.starts_at,
        duration_min=duration,
        equipment_lines=combined,
        discount=booking.discount,
        booking_rules=settings.booking_rules,
        tax_config=settings.tax_config,
        timezone_name=settings.timezone,
    )

    booking.duration_min = duration
    booking.ends_at = booking.starts_at + timedelta(minutes=duration)
    _apply_quote(booking, quote, combined)
    return booking


def _apply_quote(booking: Booking, quote: Quote, lines: Sequence[EquipmentLine]) -> None:
    booking.court_charge = quote.court_charge
    booking.equipment_charge = quote.equipment_charge
    booking.discount = quote.discount
    booking.taxes = quote.taxes
    booking.total = quote.total
    booking.equipment = [line.as_json() for line in lines]


# How far ahead of a slot still counts as "the player is standing here".
#
# Not zero: someone at the counter at 5:52 taking the 6:00 court is on the spot, and
# making them wait eight minutes to be checked in is exactly the friction this
# removes. Not an hour either — a walk-in booked at noon for an evening slot is a
# reservation, and marking that court in-play for six hours would be a lie the whole
# board is reading.
AUTO_CHECKIN_LEAD = timedelta(minutes=15)


CHECKIN_LOOKUP_WINDOW = timedelta(minutes=30)

# How far back a checkout lookup will still search for a session to settle. Not
# unbounded: a booking id typed at the counter for checkout is always today's
# session, and a query with no floor would scan the tenant's entire booking
# history — every session it has ever run — on every single checkout.
CHECKOUT_LOOKUP_LOOKBACK = timedelta(hours=12)


def matches_booking_code(booking_id: uuid.UUID, external_ref: str | None, code: str) -> bool:
    """Does `code`, typed on the check-in keyboard, identify this booking?

    There is no single booking-id format: our own bookings are UUIDs, a customer
    only ever holds a shortened piece of one, and a Playo or Hudle booking carries
    whatever reference that platform hands out. Punctuation is stripped from both
    sides before comparing either way — not just for case-insensitivity, but
    because the kiosk's on-screen keyboard has no hyphen key, so a customer reading
    "PLYO-998877" off their phone can only ever type "PLYO998877" here.

    A partner reference must match in full once compacted (an equality check, not
    a substring one — `external_ref` is opaque to us, so a partial hit proves
    nothing). Our own booking id matches on any long-enough compacted substring,
    since the code on a ticket is deliberately only a piece of the full UUID.
    """
    compact = re.sub(r"[^0-9a-zA-Z]", "", code).upper()
    if not compact:
        return False
    if external_ref:
        ref_compact = re.sub(r"[^0-9a-zA-Z]", "", external_ref).upper()
        if ref_compact and ref_compact == compact:
            return True
    if len(compact) < 4:
        return False
    return compact in str(booking_id).replace("-", "").upper()


def should_auto_check_in(
    *,
    booking_type: BookingType,
    starts_at: datetime,
    ends_at: datetime,
    now: datetime,
) -> bool:
    """Is this booking being taken for a player who is already here?

    Walk-ins only. An `online` booking is made from somewhere else, possibly days
    ahead, and arriving is a separate event the desk still has to confirm.

    Pure and fully parameterised — `now` is passed rather than read — because the
    interesting cases are all about time, and they are only testable if the clock
    is an argument.
    """
    if booking_type is not BookingType.WALKIN:
        return False
    # Already finished: a session entered after the fact is a record, not an arrival.
    # Without this, back-filling yesterday's cash booking would light up the court.
    if ends_at <= now:
        return False
    return starts_at <= now + AUTO_CHECKIN_LEAD


async def ensure_slot_free(
    session: AsyncSession,
    *,
    court_id: uuid.UUID,
    starts_at: datetime,
    ends_at: datetime,
    exclude_booking_id: uuid.UUID | None = None,
) -> None:
    """Reject an overlapping slot with a message that names the conflict.

    On an ordinary court this check is for the *message*, not for the guarantee.
    Two reception staff hitting Confirm at the same instant can both pass this
    SELECT — that race is closed by the `booking_no_overlap` exclusion constraint,
    which is why the constraint exists rather than this function being trusted on
    its own. If the constraint does fire, the IntegrityError handler in
    core/errors.py still turns it into a 409; the caller just gets a blunter message.

    On an **open-slot** court there is no constraint standing behind this, because
    overlapping bookings are the feature. See `ensure_open_slot_available`, which
    takes a lock precisely because it *is* the guarantee.

    Half-open comparison (`starts < other_end AND ends > other_start`) mirrors the
    constraint's '[)' bounds, so back-to-back bookings are not reported as clashing.
    """
    court = await session.get(Court, court_id)
    if court is not None and court.open_slots_enabled:
        await ensure_open_slot_available(
            session,
            court=court,
            starts_at=starts_at,
            ends_at=ends_at,
            exclude_booking_id=exclude_booking_id,
        )
        return

    stmt = select(Booking.id, Booking.customer_name, Booking.starts_at, Booking.ends_at).where(
        Booking.court_id == court_id,
        Booking.status != BookingStatus.CANCELLED,
        Booking.starts_at < ends_at,
        Booking.ends_at > starts_at,
    )
    if exclude_booking_id is not None:
        stmt = stmt.where(Booking.id != exclude_booking_id)

    row = (await session.execute(stmt.limit(1))).first()
    if row is not None:
        raise ConflictError(
            "That court is already booked for part of this time.",
            details={
                "conflicting_booking_id": str(row.id),
                "conflicting_from": row.starts_at.isoformat(),
                "conflicting_to": row.ends_at.isoformat(),
            },
        )


async def ensure_open_slot_available(
    session: AsyncSession,
    *,
    court: Court,
    starts_at: datetime,
    ends_at: datetime,
    exclude_booking_id: uuid.UUID | None = None,
) -> None:
    """Refuse a join when an open session is already full.

    Unlike the ordinary path, this function *is* the guarantee — `booking_no_overlap`
    skips open-slot bookings entirely, so nothing in the database is counting behind
    it. That is what the `SELECT ... FOR UPDATE` on the court row is for: without it
    two people taking the last place both count `capacity - 1` and both succeed. The
    lock serialises them on a row every booking for this court must pass through, and
    is held until the transaction commits — which is the same transaction that
    inserts the booking, so the count cannot go stale between check and write.

    Locking the *court* rather than the overlapping bookings is deliberate: there may
    be no overlapping bookings yet (nothing to lock), and the first two joiners of an
    empty session are exactly the pair that would race.
    """
    capacity = court.slot_capacity or 1

    # The CHECK constraint keeps capacity >= 1 whenever open slots are on, so a
    # locked row is all this needs — no re-read of the flag.
    await session.execute(select(Court.id).where(Court.id == court.id).with_for_update())

    stmt = select(func.count(Booking.id)).where(
        Booking.court_id == court.id,
        Booking.status != BookingStatus.CANCELLED,
        Booking.starts_at < ends_at,
        Booking.ends_at > starts_at,
    )
    if exclude_booking_id is not None:
        stmt = stmt.where(Booking.id != exclude_booking_id)

    taken = (await session.execute(stmt)).scalar_one()
    if taken >= capacity:
        raise ConflictError(
            f"This session is full — all {capacity} slots on {court.name} are taken.",
            details={"court_id": str(court.id), "capacity": capacity, "taken": taken},
        )


async def release_booking(
    session: AsyncSession,
    booking: Booking,
    *,
    reason: str | None,
    actor_user_id: uuid.UUID | None = None,
    detail_prefix: str | None = None,
) -> bool:
    """Cancel a booking: free the slot, return outstanding kit, record the event.

    Shared by the staff endpoint and the partner gateway, because cancelling is not
    one field. The slot is only genuinely released once `status` is CANCELLED — the
    exclusion constraint's `WHERE status <> 'cancelled'` is what lets someone else
    book that court again — and any racket still signed out has to come back to the
    shelf or `qty_available` drifts every time a booking is cancelled.

    `actor_user_id` is None when a partner cancels: there is no staff member behind
    the request. `detail_prefix` is how the timeline still names who did it.

    Returns False if it was already cancelled, so callers can stay idempotent
    without re-reading the row.
    """
    if booking.status is BookingStatus.CANCELLED:
        return False

    booking.status = BookingStatus.CANCELLED
    booking.cancelled_at = datetime.now(UTC)
    booking.cancellation_reason = reason

    issued = (
        (
            await session.execute(
                select(EquipmentMovement).where(
                    EquipmentMovement.booking_id == booking.id,
                    EquipmentMovement.kind == MovementKind.ISSUE,
                )
            )
        )
        .scalars()
        .all()
    )
    returned = (
        (
            await session.execute(
                select(EquipmentMovement).where(
                    EquipmentMovement.booking_id == booking.id,
                    EquipmentMovement.kind == MovementKind.RETURN,
                )
            )
        )
        .scalars()
        .all()
    )
    still_out: dict[uuid.UUID, int] = {}
    for movement in issued:
        still_out[movement.equipment_id] = still_out.get(movement.equipment_id, 0) + movement.qty
    for movement in returned:
        still_out[movement.equipment_id] = still_out.get(movement.equipment_id, 0) - movement.qty

    for equipment_id, qty in still_out.items():
        if qty <= 0:
            continue
        item = await session.get(Equipment, equipment_id)
        if item is not None:
            await apply_movement(
                session,
                item,
                kind=MovementKind.RETURN,
                qty=qty,
                booking_id=booking.id,
                note="Auto-returned on cancellation",
                actor_user_id=actor_user_id,
            )

    detail = reason
    if detail_prefix:
        detail = f"{detail_prefix}{f' — {reason}' if reason else ''}"

    await record_event(
        session,
        booking,
        kind=BookingEventKind.CANCELLED,
        label="Booking Cancelled",
        detail=detail,
        actor_user_id=actor_user_id,
    )
    await session.flush()
    return True


async def record_event(
    session: AsyncSession,
    booking: Booking,
    *,
    kind: BookingEventKind,
    label: str,
    detail: str | None = None,
    actor_user_id: uuid.UUID | None = None,
) -> BookingEvent:
    event = BookingEvent(
        booking_id=booking.id,
        kind=kind,
        label=label,
        detail=detail,
        actor_user_id=actor_user_id,
    )
    session.add(event)
    return event


async def apply_movement(
    session: AsyncSession,
    equipment: Equipment,
    *,
    kind: MovementKind,
    qty: int,
    booking_id: uuid.UUID | None = None,
    note: str | None = None,
    actor_user_id: uuid.UUID | None = None,
) -> EquipmentMovement:
    """Move stock between states and record the ledger row, in one transaction.

    The counters on `equipment` and this ledger cannot disagree: the CHECK
    constraint requires them to balance, so an incorrect transition fails the write
    rather than quietly corrupting the inventory.
    """
    transitions = {
        MovementKind.ISSUE: ("qty_available", "qty_issued"),
        MovementKind.RETURN: ("qty_issued", "qty_available"),
        MovementKind.TO_MAINTENANCE: ("qty_available", "qty_maintenance"),
        MovementKind.FROM_MAINTENANCE: ("qty_maintenance", "qty_available"),
        MovementKind.LOST: ("qty_issued", "qty_lost"),
    }

    if kind is MovementKind.RESTOCK:
        equipment.qty_stock += qty
        equipment.qty_available += qty
    elif kind is MovementKind.ADJUST:
        equipment.qty_stock += qty
        equipment.qty_available += qty
    elif kind is MovementKind.WRITE_OFF:
        # Stock removed straight off the shelf — damage found on a stocktake,
        # a manual correction, anything that never went out issued to begin
        # with. The inverse of RESTOCK: both counters drop together.
        if equipment.qty_available < qty:
            raise ConflictError(
                f"Only {equipment.qty_available} unit(s) of {equipment.name} are available to write off.",
                details={"equipment_id": str(equipment.id), "requested": qty},
            )
        equipment.qty_stock -= qty
        equipment.qty_available -= qty
    else:
        source, target = transitions[kind]
        if getattr(equipment, source) < qty:
            raise ConflictError(
                f"Only {getattr(equipment, source)} unit(s) of {equipment.name} are in "
                f"'{source.removeprefix('qty_')}' state.",
                details={"equipment_id": str(equipment.id), "requested": qty},
            )
        setattr(equipment, source, getattr(equipment, source) - qty)
        setattr(equipment, target, getattr(equipment, target) + qty)

    movement = EquipmentMovement(
        equipment_id=equipment.id,
        booking_id=booking_id,
        kind=kind,
        qty=qty,
        note=note,
        actor_user_id=actor_user_id,
    )
    session.add(movement)
    return movement


async def resolve_customer(
    session: AsyncSession,
    *,
    customer_id: uuid.UUID | None,
    customer_name: str | None,
    customer_phone: str | None,
) -> tuple[uuid.UUID | None, str, str | None]:
    """Return (customer_id, name, phone) for a booking.

    Walk-ins are often anonymous — someone turns up and pays cash — so a booking may
    carry a name and phone with no customer row behind it.
    """
    if customer_id is not None:
        customer = await session.get(Customer, customer_id)
        if customer is None:
            raise NotFoundError("Customer not found.", details={"id": str(customer_id)})
        return customer.id, customer.name, customer.phone
    return None, (customer_name or "").strip(), customer_phone


# ── Availability ────────────────────────────────────────────────────────────


def _day_bounds(day: datetime, hours: dict[str, str], tz) -> tuple[datetime, datetime]:
    def parse(value: str, fallback: time) -> time:
        try:
            h, _, m = value.partition(":")
            return time(int(h), int(m or 0))
        except (ValueError, TypeError):
            return fallback

    local_day = day.astimezone(tz).date()
    opens = parse(str(hours.get("open", "06:00")), time(6, 0))
    closes = parse(str(hours.get("close", "22:00")), time(22, 0))

    start = datetime.combine(local_day, opens, tzinfo=tz)
    end = datetime.combine(local_day, closes, tzinfo=tz)
    if end <= start:  # closing after midnight
        end += timedelta(days=1)
    return start, end


async def court_availability(
    session: AsyncSession,
    *,
    on_date: datetime,
    duration_min: int,
    sport_id: uuid.UUID | None = None,
    court_id: uuid.UUID | None = None,
    slot_minutes: int = 60,
) -> list[dict]:
    """Which slots are free on a given day.

    Bookings are fetched once for the whole day and matched in memory rather than
    issuing a query per slot: a 16-hour day at 60-minute granularity across 8 courts
    is 128 slots, and 128 round trips is a slow endpoint for no benefit.
    """
    settings = await load_settings(session)
    tz = tenant_zone(settings.timezone)

    court_stmt = select(Court, Sport.name).join(Sport, Court.sport_id == Sport.id)
    if sport_id is not None:
        court_stmt = court_stmt.where(Court.sport_id == sport_id)
    if court_id is not None:
        court_stmt = court_stmt.where(Court.id == court_id)
    court_rows = (await session.execute(court_stmt.order_by(Court.name))).all()

    if not court_rows:
        return []

    day_start, day_end = _day_bounds(on_date, {"open": "00:00", "close": "00:00"}, tz)
    day_start = datetime.combine(on_date.astimezone(tz).date(), time(0, 0), tzinfo=tz)
    day_end = day_start + timedelta(days=1)

    bookings = (
        (
            await session.execute(
                select(Booking).where(
                    Booking.status != BookingStatus.CANCELLED,
                    Booking.starts_at < day_end,
                    Booking.ends_at > day_start,
                )
            )
        )
        .scalars()
        .all()
    )
    by_court: dict[uuid.UUID, list[Booking]] = {}
    for booking in bookings:
        by_court.setdefault(booking.court_id, []).append(booking)

    from app.modules.booking.pricing import is_peak_slot, is_weekend

    results: list[dict] = []
    for court, _sport_name in court_rows:
        opens, closes = _day_bounds(on_date, court.operating_hours, tz)
        taken = by_court.get(court.id, [])

        slots = []
        cursor = opens
        step = timedelta(minutes=slot_minutes)
        length = timedelta(minutes=duration_min)

        while cursor + length <= closes:
            slot_end = cursor + length
            # Half-open comparison, matching the exclusion constraint's '[)' bounds,
            # so a slot starting exactly when another booking ends reads as free.
            blocker = next(
                (b for b in taken if b.starts_at < slot_end and b.ends_at > cursor), None
            )
            peak = is_peak_slot(cursor, settings.booking_rules, tz)
            weekend = is_weekend(cursor, tz)
            slots.append(
                {
                    "starts_at": cursor,
                    "ends_at": slot_end,
                    "available": blocker is None and court.is_bookable,
                    "rate": money(court.peak_rate if (peak or weekend) else court.hourly_rate),
                    "is_peak": peak or weekend,
                    "blocked_by_booking_id": blocker.id if blocker else None,
                }
            )
            cursor += step

        results.append(
            {
                "court_id": court.id,
                "court_name": court.name,
                "court_code": court.code,
                "sport_id": court.sport_id,
                "is_bookable": court.is_bookable,
                "maintenance_note": court.maintenance_note,
                "slots": slots,
            }
        )

    return results


async def court_status_at(
    session: AsyncSession,
    at: datetime,
    courts: Sequence[Court] | None = None,
) -> dict[uuid.UUID, tuple[str, uuid.UUID | None]]:
    """Derive each court's live status — the field the frontend stores on Court.

    `maintenance` comes from the stored `is_bookable` flag; `occupied` is computed
    from whatever booking spans `at`. Storing `occupied` would mean something had to
    remember to clear it when the session ended.

    Pass `courts` when the caller has already loaded them. The list endpoint does,
    and re-selecting the same rows here was a second round trip for data already in
    memory — free next to the database, ~45 ms from Singapore, and paid on every
    render of the courts grid.
    """
    if courts is None:
        courts = (await session.execute(select(Court))).scalars().all()

    # Two columns, not whole Booking rows: this only needs to know which court is
    # busy and which booking made it busy.
    active = (
        await session.execute(
            select(Booking.court_id, Booking.id).where(
                Booking.status.notin_([BookingStatus.CANCELLED, BookingStatus.COMPLETED]),
                Booking.starts_at <= at,
                Booking.ends_at > at,
            )
        )
    ).all()
    occupied = {court_id: booking_id for court_id, booking_id in active}

    status: dict[uuid.UUID, tuple[str, uuid.UUID | None]] = {}
    for court in courts:
        if not court.is_bookable:
            status[court.id] = ("maintenance", None)
        elif court.id in occupied:
            status[court.id] = ("occupied", occupied[court.id])
        else:
            status[court.id] = ("available", None)
    return status


async def max_extension_minutes(
    session: AsyncSession, booking: Booking, *, limit_minutes: int = 480
) -> int:
    """How far a live booking can run on before it meets the next one.

    The Extend flow needs to offer a realistic maximum rather than let staff pick
    +2h and be rejected — the frontend explicitly asks to "suggest the maximum
    available extension".
    """
    next_booking = await session.execute(
        select(Booking.starts_at)
        .where(
            Booking.court_id == booking.court_id,
            Booking.id != booking.id,
            Booking.status != BookingStatus.CANCELLED,
            Booking.starts_at >= booking.ends_at,
        )
        .order_by(Booking.starts_at)
        .limit(1)
    )
    boundary = next_booking.scalar_one_or_none()
    if boundary is None:
        return limit_minutes
    gap = int((boundary - booking.ends_at).total_seconds() // 60)
    return max(0, min(gap, limit_minutes))


async def customer_rollups(
    session: AsyncSession, customer_id: uuid.UUID
) -> tuple[int, Decimal, Decimal]:
    """(total_bookings, total_spent, outstanding_dues), computed not stored."""
    from sqlalchemy import func

    row = (
        await session.execute(
            select(
                func.count(Booking.id),
                func.coalesce(func.sum(Booking.amount_paid), 0),
                func.coalesce(func.sum(Booking.total - Booking.amount_paid), 0),
            ).where(
                Booking.customer_id == customer_id,
                Booking.status != BookingStatus.CANCELLED,
            )
        )
    ).one()
    return int(row[0]), money(row[1]), money(max(Decimal("0"), row[2]))
