"""Reporting: the aggregates behind the dashboard and Reports pages.

Every figure the frontend currently hardcodes in `src/data/mockData.ts` —
`revenueData`, `sportPopularity`, `peakHoursData`, `courtUtilization`,
`feeCollectionData` — has an endpoint here.

All of them bucket time in the *tenant's* timezone. Grouping in UTC would shift an
Indian academy's evening peak by 5h30m, moving the 6pm rush into the afternoon
bucket and making the single most-used chart on the dashboard wrong.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import Numeric, cast, func, select, text

from app.auth.deps import RequireStaff
from app.modules.academy.models import StudentEnrollment
from app.modules.booking.models import LIVE_STATUSES, Booking, BookingStatus, Court, Sport
from app.modules.booking.pricing import money, percent
from app.modules.booking.service import load_settings
from app.modules.finance.models import Invoice, InvoiceStatus, Payment
from app.tenancy.deps import Db

router = APIRouter(prefix="/reports", tags=["reporting"])


class RevenuePoint(BaseModel):
    month: str
    revenue: Decimal
    bookings: int


class SportPopularity(BaseModel):
    sport: str
    bookings: int
    percentage: float


class PeakHour(BaseModel):
    hour: str
    bookings: int


class CourtUtilization(BaseModel):
    court: str
    utilization: float
    booked_minutes: int
    available_minutes: int


class FeeCollection(BaseModel):
    month: str
    collected: Decimal
    pending: Decimal


class Kpis(BaseModel):
    total_revenue: Decimal
    total_bookings: int
    average_booking_value: Decimal
    court_utilization: float
    active_members: int
    outstanding_dues: Decimal


def _default_window(date_from: datetime | None, date_to: datetime | None) -> tuple[datetime, datetime]:
    end = date_to or datetime.now(UTC)
    start = date_from or (end - timedelta(days=180))
    return start, end


async def _tz(db) -> str:
    settings = await load_settings(db)
    return settings.timezone


@router.get(
    "/revenue",
    response_model=list[RevenuePoint],
    summary="Revenue and booking count by month",
    description="Backs `revenueData` — the Revenue vs Bookings chart on Reports.",
)
async def revenue(
    db: Db,
    _: RequireStaff,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[RevenuePoint]:
    start, end = _default_window(date_from, date_to)
    tz = await _tz(db)

    bucket = func.date_trunc("month", func.timezone(tz, Payment.received_at))
    rows = (
        await db.execute(
            select(bucket.label("month"), func.sum(Payment.amount), func.count(Payment.id))
            .where(Payment.received_at >= start, Payment.received_at < end)
            .group_by(bucket)
            .order_by(bucket)
        )
    ).all()

    booking_bucket = func.date_trunc("month", func.timezone(tz, Booking.starts_at))
    booking_rows = dict(
        (
            await db.execute(
                select(booking_bucket, func.count(Booking.id))
                .where(
                    Booking.starts_at >= start,
                    Booking.starts_at < end,
                    Booking.status.in_(LIVE_STATUSES),
                )
                .group_by(booking_bucket)
            )
        ).all()
    )

    return [
        RevenuePoint(
            month=month.strftime("%b %Y"),
            revenue=money(total or 0),
            bookings=int(booking_rows.get(month, 0)),
        )
        for month, total, _count in rows
    ]


@router.get(
    "/sport-popularity",
    response_model=list[SportPopularity],
    summary="Bookings by sport",
    description="Backs `sportPopularity` — the pie chart on Reports.",
)
async def sport_popularity(
    db: Db,
    _: RequireStaff,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[SportPopularity]:
    start, end = _default_window(date_from, date_to)

    rows = (
        await db.execute(
            select(Sport.name, func.count(Booking.id))
            .join(Booking, Booking.sport_id == Sport.id)
            .where(
                Booking.starts_at >= start,
                Booking.starts_at < end,
                Booking.status.in_(LIVE_STATUSES),
            )
            .group_by(Sport.name)
            .order_by(func.count(Booking.id).desc())
        )
    ).all()

    total = sum(int(count) for _name, count in rows)
    return [
        SportPopularity(
            sport=name,
            bookings=int(count),
            percentage=percent(int(count) / total * 100) if total else 0.0,
        )
        for name, count in rows
    ]


@router.get(
    "/peak-hours",
    response_model=list[PeakHour],
    summary="Bookings by hour of day",
    description=(
        "Backs `peakHoursData`. Bucketed in the academy's own timezone — in UTC an "
        "Indian academy's 6pm peak lands in the 12:30 bucket."
    ),
)
async def peak_hours(
    db: Db,
    _: RequireStaff,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[PeakHour]:
    start, end = _default_window(date_from, date_to)
    tz = await _tz(db)

    hour = func.extract("hour", func.timezone(tz, Booking.starts_at))
    rows = (
        await db.execute(
            select(hour.label("hour"), func.count(Booking.id))
            .where(
                Booking.starts_at >= start,
                Booking.starts_at < end,
                Booking.status.in_(LIVE_STATUSES),
            )
            .group_by(hour)
            .order_by(hour)
        )
    ).all()

    def label(value: int) -> str:
        suffix = "AM" if value < 12 else "PM"
        display = value % 12 or 12
        return f"{display}{suffix}"

    return [PeakHour(hour=label(int(h)), bookings=int(count)) for h, count in rows]


@router.get(
    "/court-utilization",
    response_model=list[CourtUtilization],
    summary="Court utilisation",
    description=(
        "Backs `courtUtilization`: booked minutes divided by the court's own "
        "operating hours over the window, not by a flat 24h day — a pool open "
        "05:30–21:00 would otherwise always look underused."
    ),
)
async def court_utilization(
    db: Db,
    _: RequireStaff,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[CourtUtilization]:
    start, end = _default_window(date_from, date_to)
    days = max(1, (end - start).days)

    courts = (await db.execute(select(Court).order_by(Court.name))).scalars().all()
    booked = dict(
        (
            await db.execute(
                select(Booking.court_id, func.coalesce(func.sum(Booking.duration_min), 0))
                .where(
                    Booking.starts_at >= start,
                    Booking.starts_at < end,
                    Booking.status.in_(LIVE_STATUSES),
                )
                .group_by(Booking.court_id)
            )
        ).all()
    )

    results: list[CourtUtilization] = []
    for court in courts:
        hours = court.operating_hours or {}
        try:
            open_h, _, open_m = str(hours.get("open", "06:00")).partition(":")
            close_h, _, close_m = str(hours.get("close", "22:00")).partition(":")
            daily = (int(close_h) * 60 + int(close_m or 0)) - (int(open_h) * 60 + int(open_m or 0))
        except ValueError:
            daily = 16 * 60
        if daily <= 0:
            daily = 16 * 60

        available = daily * days
        used = int(booked.get(court.id, 0))
        results.append(
            CourtUtilization(
                court=court.name,
                utilization=percent(used / available * 100) if available else 0.0,
                booked_minutes=used,
                available_minutes=available,
            )
        )
    return results


@router.get(
    "/fee-collection",
    response_model=list[FeeCollection],
    summary="Academy fee collection by month",
    description="Backs `feeCollectionData` on the Coaching dashboard.",
)
async def fee_collection(
    db: Db,
    _: RequireStaff,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[FeeCollection]:
    start, end = _default_window(date_from, date_to)
    tz = await _tz(db)

    bucket = func.date_trunc("month", func.timezone(tz, Invoice.created_at))
    rows = (
        await db.execute(
            select(
                bucket.label("month"),
                func.coalesce(func.sum(Invoice.amount_paid), 0),
                func.coalesce(func.sum(Invoice.total - Invoice.amount_paid), 0),
            )
            .where(
                Invoice.student_enrollment_id.isnot(None),
                Invoice.created_at >= start,
                Invoice.created_at < end,
            )
            .group_by(bucket)
            .order_by(bucket)
        )
    ).all()

    return [
        FeeCollection(
            month=month.strftime("%b %Y"),
            collected=money(collected or 0),
            pending=money(max(Decimal("0"), pending or Decimal("0"))),
        )
        for month, collected, pending in rows
    ]


@router.get(
    "/kpis",
    response_model=Kpis,
    summary="Headline numbers",
    description="The KPI row at the top of Reports and the Dashboard.",
)
async def kpis(
    db: Db,
    _: RequireStaff,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> Kpis:
    from app.modules.finance.models import MemberSubscription, SubscriptionStatus

    start, end = _default_window(date_from, date_to)

    revenue_total = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.received_at >= start, Payment.received_at < end
        )
    )
    booking_count = int(
        await db.scalar(
            select(func.count(Booking.id)).where(
                Booking.starts_at >= start,
                Booking.starts_at < end,
                Booking.status.in_(LIVE_STATUSES),
            )
        )
        or 0
    )
    active_members = int(
        await db.scalar(
            select(func.count(MemberSubscription.id)).where(
                MemberSubscription.status == SubscriptionStatus.ACTIVE
            )
        )
        or 0
    )
    outstanding = await db.scalar(
        select(func.coalesce(func.sum(Invoice.total - Invoice.amount_paid), 0)).where(
            Invoice.status.in_([InvoiceStatus.PENDING, InvoiceStatus.OVERDUE])
        )
    )

    utilisation = await court_utilization(db, _, date_from, date_to)
    average_util = (
        percent(sum(row.utilization for row in utilisation) / len(utilisation))
        if utilisation
        else 0.0
    )

    return Kpis(
        total_revenue=money(revenue_total or 0),
        total_bookings=booking_count,
        average_booking_value=(
            money(Decimal(revenue_total or 0) / booking_count) if booking_count else Decimal("0.00")
        ),
        court_utilization=average_util,
        active_members=active_members,
        outstanding_dues=money(max(Decimal("0"), outstanding or Decimal("0"))),
    )
