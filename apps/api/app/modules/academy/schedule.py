"""A batch's weekly pattern, the dated sessions generated from it, and court clashes.

A batch stores its schedule as data — weekdays and a daily start/end time — and
`generate_sessions` turns that into real `coaching_session` rows: the things a
register is taken against, hours are paid from and a coach's "Today" lists. Until
now sessions could only be made one at a time through the API, so in practice
nothing created them.

Generation is idempotent: a batch/start pair that already exists is skipped, so
running it twice, or the nightly sweep running after somebody clicked "Schedule",
never doubles a register. Times are the academy's own wall-clock times in its own
timezone — a 6 PM batch is 6 PM in Hyderabad whatever the server's clock says.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Sequence
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.academy.models import (
    Batch,
    BatchStatus,
    Coach,
    CoachingSession,
    CoachStatus,
    CoachTimeOff,
    SessionStatus,
)
from app.modules.booking.models import Booking, BookingStatus

DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

#: How far ahead the nightly sweep keeps every running batch scheduled.
SWEEP_HORIZON_DAYS = 14
#: The most a single "Schedule sessions" request will create, so a typo in the end
#: date cannot fill the calendar with years of classes.
MAX_GENERATE_DAYS = 120


def schedule_text(days: Sequence[int]) -> str | None:
    """[0, 2, 4] → "Mon · Wed · Fri"."""
    ordered = sorted(set(d for d in days if 0 <= d <= 6))
    return " · ".join(DAY_NAMES[d] for d in ordered) or None


def _clock(t: time) -> str:
    suffix = "PM" if t.hour >= 12 else "AM"
    return f"{t.hour % 12 or 12}:{t.minute:02d} {suffix}"


def time_text(start: time | None, end: time | None) -> str | None:
    """18:00, 19:30 → "6:00 PM – 7:30 PM"."""
    if start is None or end is None:
        return None
    return f"{_clock(start)} – {_clock(end)}"


def duration_minutes(start: time, end: time) -> int:
    return (end.hour * 60 + end.minute) - (start.hour * 60 + start.minute)


@dataclass
class Generated:
    created: list[CoachingSession] = field(default_factory=list)
    skipped_existing: int = 0
    #: Dates in the range on which the batch's coach is on time off. The sessions
    #: are still created — the class still happens — so a substitute can be found.
    coach_away: list[date] = field(default_factory=list)


async def coach_away_dates(
    db: AsyncSession, coach_id: uuid.UUID, start: date, end: date
) -> set[date]:
    """Every date in [start, end] on which the coach has time off."""
    rows = (
        await db.execute(
            select(CoachTimeOff.start_date, CoachTimeOff.end_date).where(
                CoachTimeOff.coach_id == coach_id,
                CoachTimeOff.start_date <= end,
                CoachTimeOff.end_date >= start,
            )
        )
    ).all()
    out: set[date] = set()
    for lo, hi in rows:
        day = max(lo, start)
        while day <= min(hi, end):
            out.add(day)
            day += timedelta(days=1)
    return out


async def generate_sessions(
    db: AsyncSession, batch: Batch, *, start: date, end: date, tz: ZoneInfo
) -> Generated:
    """Create the batch's sessions for every scheduled day in [start, end]."""
    result = Generated()
    if not batch.days or batch.start_time is None or batch.end_time is None:
        return result
    if batch.status is BatchStatus.COMPLETED:
        return result

    # A batch's own dates bound the range: no classes before it starts or after
    # it ends.
    if batch.start_date and batch.start_date > start:
        start = batch.start_date
    if batch.end_date and batch.end_date < end:
        end = batch.end_date
    if end < start:
        return result

    minutes = duration_minutes(batch.start_time, batch.end_time)
    window_start = datetime.combine(start, time.min, tzinfo=tz)
    window_end = datetime.combine(end + timedelta(days=1), time.min, tzinfo=tz)
    existing = set(
        (
            await db.execute(
                select(CoachingSession.starts_at).where(
                    CoachingSession.batch_id == batch.id,
                    CoachingSession.starts_at >= window_start,
                    CoachingSession.starts_at < window_end,
                    CoachingSession.status != SessionStatus.CANCELLED,
                )
            )
        ).scalars()
    )
    away = (
        await coach_away_dates(db, batch.coach_id, start, end) if batch.coach_id else set()
    )

    wanted = set(batch.days)
    day = start
    while day <= end:
        if day.weekday() in wanted:
            starts = datetime.combine(day, batch.start_time, tzinfo=tz)
            if starts in existing:
                result.skipped_existing += 1
            else:
                session = CoachingSession(
                    batch_id=batch.id,
                    batch_name=batch.name,
                    coach_id=batch.coach_id,
                    sport_id=batch.sport_id,
                    court_id=batch.court_id,
                    starts_at=starts,
                    ends_at=starts + timedelta(minutes=minutes),
                    duration_min=minutes,
                )
                db.add(session)
                result.created.append(session)
                if day in away:
                    result.coach_away.append(day)
        day += timedelta(days=1)

    await db.flush()
    return result


async def sweep(db: AsyncSession, *, tz: ZoneInfo, today: date) -> int:
    """Keep every running batch scheduled `SWEEP_HORIZON_DAYS` ahead. For the worker."""
    batches = (
        (
            await db.execute(
                select(Batch).where(
                    Batch.status != BatchStatus.COMPLETED,
                    Batch.start_time.isnot(None),
                    Batch.end_time.isnot(None),
                )
            )
        )
        .scalars()
        .all()
    )
    made = 0
    for batch in batches:
        made += len(
            (
                await generate_sessions(
                    db, batch, start=today, end=today + timedelta(days=SWEEP_HORIZON_DAYS), tz=tz
                )
            ).created
        )
    return made


# ── Court clashes ───────────────────────────────────────────────────────────


@dataclass
class Clash:
    session_id: uuid.UUID
    starts_at: datetime
    court_id: uuid.UUID
    #: "Public booking · Rohan (XCB0042)" or "Session · Tennis B".
    with_what: str


async def court_clashes(db: AsyncSession, sessions: Sequence[CoachingSession]) -> list[Clash]:
    """Sessions that share a court and a time with a public booking or another class.

    Detection, not prevention: a public booking already made is a customer who has
    paid, and the academy decides who moves. Cancelled bookings and sessions never
    clash.
    """
    on_court = [s for s in sessions if s.court_id is not None and s.status != SessionStatus.CANCELLED]
    if not on_court:
        return []

    lo = min(s.starts_at for s in on_court)
    hi = max(s.ends_at for s in on_court)
    courts = {s.court_id for s in on_court}

    bookings = (
        (
            await db.execute(
                select(Booking).where(
                    Booking.court_id.in_(courts),
                    Booking.status != BookingStatus.CANCELLED,
                    Booking.starts_at < hi,
                    Booking.ends_at > lo,
                )
            )
        )
        .scalars()
        .all()
    )
    others = (
        (
            await db.execute(
                select(CoachingSession).where(
                    CoachingSession.court_id.in_(courts),
                    CoachingSession.status != SessionStatus.CANCELLED,
                    CoachingSession.starts_at < hi,
                    CoachingSession.ends_at > lo,
                )
            )
        )
        .scalars()
        .all()
    )

    clashes: list[Clash] = []
    for s in on_court:
        for b in bookings:
            if b.court_id == s.court_id and b.starts_at < s.ends_at and b.ends_at > s.starts_at:
                clashes.append(
                    Clash(s.id, s.starts_at, s.court_id, f"Public booking · {b.customer_name} ({b.reference})")
                )
        for o in others:
            if (
                o.id != s.id
                and o.court_id == s.court_id
                and o.starts_at < s.ends_at
                and o.ends_at > s.starts_at
            ):
                clashes.append(Clash(s.id, s.starts_at, s.court_id, f"Session · {o.batch_name}"))
    return clashes


async def coaches_away_today(db: AsyncSession, today: date) -> list[Coach]:
    """Coaches on time off today, or marked on leave."""
    off_ids = select(CoachTimeOff.coach_id).where(
        CoachTimeOff.start_date <= today, CoachTimeOff.end_date >= today
    )
    return list(
        (
            await db.execute(
                select(Coach)
                .where(or_(Coach.id.in_(off_ids), and_(Coach.status == CoachStatus.ON_LEAVE)))
                .order_by(Coach.name)
            )
        )
        .scalars()
        .all()
    )
