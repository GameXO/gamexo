"""Booking domain endpoints."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query, status
from sqlalchemy import func, select

from app.api_utils import Page, Params, get_or_404, paginate
from app.auth.deps import RequireKiosk, RequireManager, RequireStaff
from app.core.errors import ConflictError, NotFoundError
from app.modules.booking import catalogue, service
from app.modules.booking.models import (
    Booking,
    BookingEvent,
    BookingEventKind,
    BookingStatus,
    Court,
    Customer,
    Equipment,
    EquipmentMovement,
    MovementKind,
    PaymentStatus,
    Sport,
)
from app.modules.admin.notify import EMAIL_BOOKING_CONFIRMATION, enqueue_email
from app.modules.booking.pricing import money
from app.modules.finance.service import refresh_booking_payment_status
from app.modules.booking.schemas import (
    BookingCancel,
    CatalogueSportOut,
    BookingCreate,
    BookingDetail,
    BookingEquipmentSet,
    BookingEventOut,
    BookingExtend,
    BookingOut,
    BookingUpdate,
    CourtAvailability,
    CourtCreate,
    CourtOut,
    CourtUpdate,
    CourtWithStatus,
    CustomerCreate,
    CustomerDetail,
    CustomerOut,
    CustomerUpdate,
    EquipmentCreate,
    EquipmentOut,
    EquipmentUpdate,
    MovementCreate,
    MovementOut,
    QuoteOut,
    QuoteRequest,
    SportCreate,
    SportOut,
    SportUpdate,
)
from app.tenancy.deps import Db

router = APIRouter(tags=["booking"])


# ── Sports ──────────────────────────────────────────────────────────────────


@router.get("/sports", response_model=list[SportOut], summary="List sports")
async def list_sports(db: Db, _: RequireKiosk, include_inactive: bool = False) -> list[SportOut]:
    stmt = select(Sport).order_by(Sport.display_order, Sport.name)
    if not include_inactive:
        stmt = stmt.where(Sport.is_active.is_(True))
    rows = (await db.execute(stmt)).scalars().all()
    return [SportOut.model_validate(row) for row in rows]


@router.get(
    "/sports/catalogue",
    response_model=list[CatalogueSportOut],
    summary="Sports a turf can choose from",
    description=(
        "The fixed menu the onboarding wizard and the Sports & Courts screen pick "
        "from. Not this academy's sports — `GET /sports` is that. Selecting one here "
        "is what creates the row."
    ),
)
async def sport_catalogue(_: RequireManager) -> list[CatalogueSportOut]:
    return [CatalogueSportOut(**entry) for entry in catalogue.as_dicts()]


@router.post("/sports", response_model=SportOut, status_code=status.HTTP_201_CREATED, summary="Add a sport")
async def create_sport(payload: SportCreate, db: Db, _: RequireManager) -> SportOut:
    data = payload.model_dump(exclude={"slug"})
    sport = Sport(**data, slug=payload.slug or service.slugify(payload.name))
    db.add(sport)
    await db.flush()
    return SportOut.model_validate(sport)


@router.patch("/sports/{sport_id}", response_model=SportOut, summary="Update a sport")
async def update_sport(
    sport_id: uuid.UUID, payload: SportUpdate, db: Db, _: RequireManager
) -> SportOut:
    sport = await get_or_404(db, Sport, sport_id, label="Sport")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(sport, field, value)
    await db.flush()
    return SportOut.model_validate(sport)


@router.delete(
    "/sports/{sport_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a sport",
    description=(
        "Only a sport with no courts can be deleted. A sport that has been played "
        "has bookings hanging off its courts, and those are records — deactivate it "
        "with `PATCH /sports/{id}` `{is_active: false}` instead, which hides it "
        "everywhere without rewriting history."
    ),
)
async def delete_sport(sport_id: uuid.UUID, db: Db, _: RequireManager) -> None:
    sport = await get_or_404(db, Sport, sport_id, label="Sport")

    courts = (
        await db.execute(select(func.count(Court.id)).where(Court.sport_id == sport.id))
    ).scalar_one()
    if courts:
        raise ConflictError(
            f"{sport.name} still has {courts} court(s). Delete those first, or "
            f"deactivate the sport instead.",
            details={"court_count": courts},
        )

    await db.delete(sport)
    await db.flush()


# ── Courts ──────────────────────────────────────────────────────────────────


@router.get(
    "/courts",
    response_model=list[CourtWithStatus],
    summary="List courts with their live status",
    description=(
        "`status` is derived at request time from bookings and the maintenance flag, "
        "not stored — a stored status goes stale the moment a session ends."
    ),
)
async def list_courts(
    db: Db,
    _: RequireKiosk,
    sport_id: uuid.UUID | None = None,
    at: datetime | None = Query(default=None, description="Defaults to now"),
) -> list[CourtWithStatus]:
    moment = at or datetime.now(UTC)

    stmt = select(Court, Sport.name).join(Sport, Court.sport_id == Sport.id)
    if sport_id is not None:
        stmt = stmt.where(Court.sport_id == sport_id)
    rows = (await db.execute(stmt.order_by(Court.name))).all()

    # Statuses are derived from the courts already fetched above, so this costs one
    # query for live bookings rather than that plus a second pass over `court`.
    statuses = await service.court_status_at(db, moment, courts=[court for court, _ in rows])

    out: list[CourtWithStatus] = []
    for court, sport_name in rows:
        state, booking_id = statuses.get(court.id, ("available", None))
        out.append(
            CourtWithStatus(
                **CourtOut.model_validate(court).model_dump(),
                status=state,
                current_booking_id=booking_id,
                sport_name=sport_name,
            )
        )
    return out


@router.post("/courts", response_model=CourtOut, status_code=status.HTTP_201_CREATED, summary="Add a court")
async def create_court(payload: CourtCreate, db: Db, _: RequireManager) -> CourtOut:
    await get_or_404(db, Sport, payload.sport_id, label="Sport")
    data = payload.model_dump()
    data["operating_hours"] = payload.operating_hours.model_dump()
    court = Court(**data)
    db.add(court)
    await db.flush()
    return CourtOut.model_validate(court)


@router.patch("/courts/{court_id}", response_model=CourtOut, summary="Update a court")
async def update_court(
    court_id: uuid.UUID, payload: CourtUpdate, db: Db, _: RequireManager
) -> CourtOut:
    court = await get_or_404(db, Court, court_id, label="Court")
    updates = payload.model_dump(exclude_unset=True)
    if "operating_hours" in updates and payload.operating_hours is not None:
        updates["operating_hours"] = payload.operating_hours.model_dump()
    for field, value in updates.items():
        setattr(court, field, value)
    await db.flush()
    return CourtOut.model_validate(court)


@router.delete(
    "/courts/{court_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a court",
    description=(
        "Only a court with no bookings can be deleted — a booking is a financial "
        "record and the FK is RESTRICT. A court that has been played on should be "
        "marked unavailable (`is_bookable: false`) instead, which takes it out of "
        "availability without detaching it from its history."
    ),
)
async def delete_court(court_id: uuid.UUID, db: Db, _: RequireManager) -> None:
    court = await get_or_404(db, Court, court_id, label="Court")

    # Checked rather than caught: the FK would raise an IntegrityError at COMMIT,
    # by which point the message names a constraint instead of telling the owner
    # what to do about it.
    bookings = (
        await db.execute(select(func.count(Booking.id)).where(Booking.court_id == court.id))
    ).scalar_one()
    if bookings:
        raise ConflictError(
            f"{court.name} has {bookings} booking(s) and cannot be deleted. "
            f"Mark it unavailable instead.",
            details={"booking_count": bookings},
        )

    await db.delete(court)
    await db.flush()


@router.get(
    "/courts/availability",
    response_model=list[CourtAvailability],
    summary="Free slots for a day",
    description=(
        "Slot boundaries use half-open comparison, matching the booking exclusion "
        "constraint, so a slot starting exactly when another booking ends is free."
    ),
)
async def availability(
    db: Db,
    _: RequireKiosk,
    date: Annotated[datetime, Query(description="Any instant on the target day")],
    duration_min: Annotated[int, Query(ge=15, le=1440)] = 60,
    sport_id: uuid.UUID | None = None,
    court_id: uuid.UUID | None = None,
    slot_minutes: Annotated[int, Query(ge=15, le=240)] = 60,
) -> list[CourtAvailability]:
    rows = await service.court_availability(
        db,
        on_date=date,
        duration_min=duration_min,
        sport_id=sport_id,
        court_id=court_id,
        slot_minutes=slot_minutes,
    )
    return [CourtAvailability.model_validate(row) for row in rows]


# ── Equipment ───────────────────────────────────────────────────────────────


@router.get("/equipment", response_model=Page[EquipmentOut], summary="List equipment")
async def list_equipment(
    db: Db,
    _: RequireKiosk,
    params: Params,
    category: str | None = None,
    low_stock_only: bool = False,
    sport_id: uuid.UUID | None = None,
    published_to_pos: bool | None = None,
) -> Page[EquipmentOut]:
    stmt = select(Equipment).order_by(Equipment.category, Equipment.name)
    if category:
        stmt = stmt.where(Equipment.category == category)
    if low_stock_only:
        stmt = stmt.where(Equipment.qty_available <= Equipment.low_stock_threshold)
    if sport_id is not None:
        stmt = stmt.where(Equipment.sport_id == sport_id)
    if published_to_pos is not None:
        stmt = stmt.where(Equipment.published_to_pos.is_(published_to_pos))
    return await paginate(db, stmt, params, EquipmentOut)


@router.post(
    "/equipment",
    response_model=EquipmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add equipment",
)
async def create_equipment(payload: EquipmentCreate, db: Db, _: RequireManager) -> EquipmentOut:
    if payload.sport_id is not None:
        await get_or_404(db, Sport, payload.sport_id, label="Sport")
    item = Equipment(
        **payload.model_dump(exclude={"qty_stock"}),
        qty_stock=payload.qty_stock,
        qty_available=payload.qty_stock,
    )
    db.add(item)
    await db.flush()
    return EquipmentOut.model_validate(item)


@router.patch("/equipment/{equipment_id}", response_model=EquipmentOut, summary="Update equipment")
async def update_equipment(
    equipment_id: uuid.UUID, payload: EquipmentUpdate, db: Db, _: RequireManager
) -> EquipmentOut:
    item = await get_or_404(db, Equipment, equipment_id, label="Equipment")
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("sport_id") is not None:
        await get_or_404(db, Sport, updates["sport_id"], label="Sport")
    for field, value in updates.items():
        setattr(item, field, value)
    await db.flush()
    return EquipmentOut.model_validate(item)


@router.delete(
    "/equipment/{equipment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete equipment",
    description=(
        "Only when nothing references it — a movement history or issued units mean "
        "this item has a real trail behind it, so archive it (unpublish, zero the "
        "stock) instead of erasing that trail."
    ),
)
async def delete_equipment(equipment_id: uuid.UUID, db: Db, _: RequireManager) -> None:
    item = await get_or_404(db, Equipment, equipment_id, label="Equipment")
    if item.qty_issued > 0:
        raise ConflictError(
            f"{item.qty_issued} unit(s) of {item.name} are still issued — take them back first.",
            details={"equipment_id": str(equipment_id)},
        )
    has_movements = (
        await db.execute(
            select(EquipmentMovement.id).where(EquipmentMovement.equipment_id == equipment_id).limit(1)
        )
    ).first()
    if has_movements is not None:
        raise ConflictError(
            f"{item.name} has movement history and cannot be deleted — unpublish it instead.",
            details={"equipment_id": str(equipment_id)},
        )
    await db.delete(item)


@router.post(
    "/equipment/{equipment_id}/movements",
    response_model=MovementOut,
    status_code=status.HTTP_201_CREATED,
    summary="Move stock between states",
    description=(
        "Issue, return, send to maintenance, write off or restock. The ledger row "
        "and the counters on the equipment are written in one transaction, and a "
        "CHECK constraint requires them to balance."
    ),
)
async def create_movement(
    equipment_id: uuid.UUID, payload: MovementCreate, db: Db, principal: RequireStaff
) -> MovementOut:
    item = await get_or_404(db, Equipment, equipment_id, label="Equipment")
    movement = await service.apply_movement(
        db,
        item,
        kind=payload.kind,
        qty=payload.qty,
        booking_id=payload.booking_id,
        note=payload.note,
        actor_user_id=principal.id,
    )
    await db.flush()
    return MovementOut.model_validate(movement)


@router.get(
    "/equipment/{equipment_id}/movements",
    response_model=Page[MovementOut],
    summary="Equipment movement history",
)
async def list_movements(
    equipment_id: uuid.UUID, db: Db, _: RequireStaff, params: Params
) -> Page[MovementOut]:
    await get_or_404(db, Equipment, equipment_id, label="Equipment")
    stmt = (
        select(EquipmentMovement)
        .where(EquipmentMovement.equipment_id == equipment_id)
        .order_by(EquipmentMovement.occurred_at.desc())
    )
    return await paginate(db, stmt, params, MovementOut)


# ── Customers ───────────────────────────────────────────────────────────────


@router.get("/customers", response_model=Page[CustomerOut], summary="List customers")
async def list_customers(
    db: Db,
    _: RequireStaff,
    params: Params,
    search: str | None = Query(default=None, description="Matches name, phone or email"),
    member_type: str | None = None,
) -> Page[CustomerOut]:
    stmt = select(Customer).order_by(Customer.name)
    if search:
        like = f"%{search.lower()}%"
        stmt = stmt.where(
            Customer.name.ilike(like) | Customer.phone.ilike(like) | Customer.email.ilike(like)
        )
    if member_type:
        stmt = stmt.where(Customer.member_type == member_type)
    return await paginate(db, stmt, params, CustomerOut)


@router.post(
    "/customers",
    response_model=CustomerOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a customer",
)
async def create_customer(payload: CustomerCreate, db: Db, _: RequireStaff) -> CustomerOut:
    customer = Customer(
        **payload.model_dump(exclude={"email"}),
        email=str(payload.email) if payload.email else None,
        avatar_initials=service.initials(payload.name),
    )
    db.add(customer)
    await db.flush()
    return CustomerOut.model_validate(customer)


@router.get(
    "/customers/{customer_id}",
    response_model=CustomerDetail,
    summary="A customer with their booking rollups",
)
async def get_customer(customer_id: uuid.UUID, db: Db, _: RequireStaff) -> CustomerDetail:
    customer = await get_or_404(db, Customer, customer_id, label="Customer")
    total_bookings, total_spent, dues = await service.customer_rollups(db, customer_id)

    favorite = None
    if customer.favorite_sport_id:
        sport = await db.get(Sport, customer.favorite_sport_id)
        favorite = sport.name if sport else None

    return CustomerDetail(
        **CustomerOut.model_validate(customer).model_dump(),
        total_bookings=total_bookings,
        total_spent=total_spent,
        outstanding_dues=dues,
        favorite_sport=favorite,
    )


@router.patch("/customers/{customer_id}", response_model=CustomerOut, summary="Update a customer")
async def update_customer(
    customer_id: uuid.UUID, payload: CustomerUpdate, db: Db, _: RequireStaff
) -> CustomerOut:
    customer = await get_or_404(db, Customer, customer_id, label="Customer")
    updates = payload.model_dump(exclude_unset=True)
    if "email" in updates and updates["email"] is not None:
        updates["email"] = str(updates["email"])
    for field, value in updates.items():
        setattr(customer, field, value)
    if "name" in updates:
        customer.avatar_initials = service.initials(customer.name)
    await db.flush()
    return CustomerOut.model_validate(customer)


# ── Bookings ────────────────────────────────────────────────────────────────


@router.post(
    "/bookings/quote",
    response_model=QuoteOut,
    summary="Price a booking without creating it",
    description="Backs the walk-in wizard's live summary, so the quote and the booking agree.",
)
async def quote(payload: QuoteRequest, db: Db, _: RequireKiosk) -> QuoteOut:
    court = await get_or_404(db, Court, payload.court_id, label="Court")
    result, lines = await service.price_booking(
        db,
        court=court,
        starts_at=payload.starts_at,
        duration_min=payload.duration_min,
        selections=payload.equipment,
        discount=payload.discount,
    )
    return QuoteOut(
        court_charge=result.court_charge,
        equipment_charge=result.equipment_charge,
        discount=result.discount,
        taxes=result.taxes,
        total=result.total,
        is_peak=result.is_peak,
        is_weekend=result.is_weekend,
        rate_applied=result.rate_applied,
        # Whole lines, not just name/qty/rate. Dropping the rest let Pydantic fill
        # its defaults, so a quote reported every purchase and every pack back as a
        # single rental — the charge was right and the summary beside it was not.
        equipment=[
            {
                "name": l.name,
                "qty": l.qty,
                "rate": l.rate,
                "equipment_id": l.equipment_id,
                "mode": l.mode,
                "unit": l.unit,
            }
            for l in lines
        ],
    )


@router.get("/bookings", response_model=Page[BookingOut], summary="List bookings")
async def list_bookings(
    db: Db,
    _: RequireKiosk,
    params: Params,
    booking_status: Annotated[BookingStatus | None, Query(alias="status")] = None,
    court_id: uuid.UUID | None = None,
    customer_id: uuid.UUID | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    search: str | None = None,
) -> Page[BookingOut]:
    stmt = select(Booking).order_by(Booking.starts_at.desc())
    if booking_status is not None:
        stmt = stmt.where(Booking.status == booking_status)
    if court_id is not None:
        stmt = stmt.where(Booking.court_id == court_id)
    if customer_id is not None:
        stmt = stmt.where(Booking.customer_id == customer_id)
    if date_from is not None:
        stmt = stmt.where(Booking.starts_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(Booking.starts_at < date_to)
    if search:
        like = f"%{search.lower()}%"
        # Reference included so one search box answers all three ways a booking gets
        # asked about at the desk: "it's under Priya", the phone they booked with,
        # or the code off their ticket.
        stmt = stmt.where(
            Booking.customer_name.ilike(like)
            | Booking.customer_phone.ilike(like)
            | Booking.reference.ilike(like)
        )
    return await paginate(db, stmt, params, BookingOut)


async def _queue_booking_confirmation(db, booking: Booking) -> None:
    """Queue the customer's confirmation email, if we can reach them.

    Enqueued rather than sent: this runs inside the booking's transaction, so the
    email exists exactly when the booking does, and a slow or unreachable mail
    server can never fail a booking someone is standing at the counter for.

    The address lives on `customer`, not on the booking — a walk-in gives a name
    and a phone, and most never give an email at all, which is why a missing one is
    silence rather than an error.
    """
    if booking.customer_id is None:
        return
    customer = await db.get(Customer, booking.customer_id)
    await enqueue_email(
        db,
        kind=EMAIL_BOOKING_CONFIRMATION,
        event_key="booking_confirmation",
        recipient=customer.email if customer else None,
        payload={"booking_id": str(booking.id)},
    )


@router.post(
    "/bookings",
    response_model=BookingDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Create a booking",
    description=(
        "Returns **409** if the court is already taken for any part of the slot. "
        "That check is a PostgreSQL exclusion constraint, not a read-then-write in "
        "application code — two staff confirming simultaneously cannot both win.\n\n"
        "If the same customer already holds a session on this court that ends exactly "
        "when this one starts, no new booking is created: the existing one is extended "
        "and returned instead, re-priced as a single longer session. Check the `id` in "
        "the response rather than assuming it is new."
    ),
)
async def create_booking(payload: BookingCreate, db: Db, principal: RequireKiosk) -> BookingDetail:
    court = await get_or_404(db, Court, payload.court_id, label="Court")
    if not court.is_bookable:
        raise ConflictError(
            f"{court.name} is under maintenance.",
            details={"maintenance_note": court.maintenance_note},
        )

    customer_id, name, phone = await service.resolve_customer(
        db,
        customer_id=payload.customer_id,
        customer_name=payload.customer_name,
        customer_phone=payload.customer_phone,
    )

    # One continuous stretch of play is one booking. If this customer already has a
    # session on this court that ends exactly when this one starts, extend it rather
    # than opening a second row: two rows read as two bills, so the counter settles
    # one and misses the other, and kit issued in the first hour is priced against
    # that hour alone. Returns the absorbing booking, so its id is what the caller
    # should hold on to.
    adjoining = await service.find_adjoining_booking(
        db,
        court_id=court.id,
        starts_at=payload.starts_at,
        customer_id=customer_id,
        customer_phone=phone,
    )
    if adjoining is not None:
        await service.absorb_into_booking(
            db,
            adjoining,
            court=court,
            additional_minutes=payload.duration_min,
            selections=payload.equipment,
        )
        await service.ensure_slot_free(
            db,
            court_id=court.id,
            starts_at=adjoining.starts_at,
            ends_at=adjoining.ends_at,
            exclude_booking_id=adjoining.id,
        )
        await db.flush()

        await service.record_event(
            db,
            adjoining,
            kind=BookingEventKind.EXTENDED,
            label=f"Extended by {payload.duration_min} min",
            detail=(
                "A back-to-back booking for the same customer was merged into this "
                f"session by {principal.email}. Now ends at {adjoining.ends_at.isoformat()}."
            ),
            actor_user_id=principal.id,
        )

        for selection in payload.equipment:
            item = await db.get(Equipment, selection.equipment_id)
            if item is not None:
                await service.apply_movement(
                    db,
                    item,
                    kind=MovementKind.ISSUE,
                    qty=service.units_drawn(item, selection),
                    booking_id=adjoining.id,
                    actor_user_id=principal.id,
                )

        await db.flush()
        # The merged session is a different booking from the one the caller asked
        # for, so it gets its own confirmation showing the full, combined slot.
        await _queue_booking_confirmation(db, adjoining)
        return await _detail(db, adjoining)

    quote_result, lines = await service.price_booking(
        db,
        court=court,
        starts_at=payload.starts_at,
        duration_min=payload.duration_min,
        selections=payload.equipment,
        discount=payload.discount,
    )

    ends_at = payload.starts_at + timedelta(minutes=payload.duration_min)

    # A walk-in taken for a slot that is already running is someone standing at the
    # counter. Leaving it UPCOMING means the desk creates the booking and then
    # immediately presses Check In on the same screen — two actions recording one
    # arrival. The player is demonstrably here; that is what a walk-in means.
    auto_checked_in = service.should_auto_check_in(
        booking_type=payload.booking_type,
        starts_at=payload.starts_at,
        ends_at=ends_at,
        now=datetime.now(UTC),
    )

    booking = Booking(
        # Allocated before the slot check on purpose. The counter row is locked for
        # the rest of this transaction, so a conflicting slot rolls the number back
        # with everything else and the series stays gapless.
        reference=await service.next_booking_reference(db),
        customer_id=customer_id,
        customer_name=name,
        customer_phone=phone,
        sport_id=court.sport_id,
        court_id=court.id,
        starts_at=payload.starts_at,
        ends_at=ends_at,
        duration_min=payload.duration_min,
        booking_type=payload.booking_type,
        status=BookingStatus.ACTIVE if auto_checked_in else BookingStatus.UPCOMING,
        # Snapshot, so the exclusion constraint treats this booking the way the court
        # was configured when it was taken — see Booking.open_slot.
        open_slot=court.open_slots_enabled,
        notes=payload.notes,
        created_by_user_id=principal.id,
    )
    service._apply_quote(booking, quote_result, lines)
    db.add(booking)

    await service.ensure_slot_free(
        db, court_id=court.id, starts_at=payload.starts_at, ends_at=ends_at
    )
    await db.flush()

    await service.record_event(
        db,
        booking,
        kind=BookingEventKind.CREATED,
        label="Booking Created",
        detail=f"{payload.booking_type.value.title()} booking by {principal.email}",
        actor_user_id=principal.id,
    )

    # Its own timeline entry rather than a note folded into "Booking Created": when
    # a dispute is about whether someone actually turned up, "who checked this in,
    # and when" is the question being asked, and an automatic check-in should answer
    # it as plainly as a manual one would.
    if auto_checked_in:
        await service.record_event(
            db,
            booking,
            kind=BookingEventKind.CHECKED_IN,
            label="Checked In",
            detail=f"Automatic — walk-in taken at the counter by {principal.email}",
            actor_user_id=principal.id,
        )

    # Issuing equipment moves real stock, so it goes through the ledger.
    for selection in payload.equipment:
        item = await db.get(Equipment, selection.equipment_id)
        if item is not None:
            await service.apply_movement(
                db,
                item,
                kind=MovementKind.ISSUE,
                qty=service.units_drawn(item, selection),
                booking_id=booking.id,
                actor_user_id=principal.id,
            )
    if payload.equipment:
        await service.record_event(
            db,
            booking,
            kind=BookingEventKind.EQUIPMENT,
            label="Equipment Issued",
            detail=", ".join(f"{l.qty}× {l.name}" for l in lines),
            actor_user_id=principal.id,
        )

    await db.flush()
    await _queue_booking_confirmation(db, booking)
    return await _detail(db, booking)


@router.get(
    "/bookings/checkin-lookup",
    response_model=BookingDetail,
    summary="Find a booking to check in by its booking id",
    description=(
        "For the kiosk's 'Already have a Booking' flow: matches `code` against this "
        "booking's own id (punctuation-insensitive, since a customer only ever holds "
        "a shortened piece of the UUID) or a partner's `external_ref` (Playo, Hudle, "
        "...), matched verbatim since that string is opaque to us.\n\n"
        "Scoped to bookings starting within 30 minutes either side of now. A 404 "
        "covers both 'no such id' and 'right id, wrong time' — check-in doesn't "
        "distinguish them, so a customer can't use it to fish for whether a code is "
        "valid outside its window."
    ),
)
async def checkin_lookup(db: Db, _: RequireKiosk, code: Annotated[str, Query(min_length=1)]) -> BookingDetail:
    now = datetime.now(UTC)
    window_start = now - service.CHECKIN_LOOKUP_WINDOW
    window_end = now + service.CHECKIN_LOOKUP_WINDOW
    stmt = select(Booking).where(
        Booking.status != BookingStatus.CANCELLED,
        Booking.starts_at >= window_start,
        Booking.starts_at <= window_end,
    )
    candidates = (await db.execute(stmt)).scalars().all()
    booking = next(
        (b for b in candidates if service.matches_booking_code(b.id, b.external_ref, code)), None
    )
    if booking is None:
        raise NotFoundError("Booking not found.")
    return await _detail(db, booking)


@router.get(
    "/bookings/checkout-lookup",
    response_model=BookingDetail,
    summary="Find a booking to settle by its booking id",
    description=(
        "Same id matching as `GET /bookings/checkin-lookup`, but for settling a "
        "bill rather than confirming an arrival: matches any not-cancelled booking "
        "that has already started, up to 12 hours back, with no upper bound — a "
        "session settled late is still the same session. The most recently "
        "started match wins if more than one fits."
    ),
)
async def checkout_lookup(db: Db, _: RequireKiosk, code: Annotated[str, Query(min_length=1)]) -> BookingDetail:
    now = datetime.now(UTC)
    stmt = (
        select(Booking)
        .where(
            Booking.status != BookingStatus.CANCELLED,
            Booking.starts_at >= now - service.CHECKOUT_LOOKUP_LOOKBACK,
            Booking.starts_at <= now,
        )
        .order_by(Booking.starts_at.desc())
    )
    candidates = (await db.execute(stmt)).scalars().all()
    booking = next(
        (b for b in candidates if service.matches_booking_code(b.id, b.external_ref, code)), None
    )
    if booking is None:
        raise NotFoundError("Booking not found.")
    return await _detail(db, booking)


@router.get("/bookings/{booking_id}", response_model=BookingDetail, summary="A single booking")
async def get_booking(booking_id: uuid.UUID, db: Db, _: RequireKiosk) -> BookingDetail:
    booking = await get_or_404(db, Booking, booking_id, label="Booking")
    return await _detail(db, booking)


@router.patch(
    "/bookings/{booking_id}",
    response_model=BookingDetail,
    summary="Edit a booking",
    description="Re-prices whenever the court, time, duration, equipment or discount changes.",
)
async def update_booking(
    booking_id: uuid.UUID, payload: BookingUpdate, db: Db, principal: RequireStaff
) -> BookingDetail:
    booking = await get_or_404(db, Booking, booking_id, label="Booking")
    if booking.status is BookingStatus.CANCELLED:
        raise ConflictError("This booking has been cancelled and can no longer be edited.")

    updates = payload.model_dump(exclude_unset=True)
    reprice = {"court_id", "starts_at", "duration_min", "equipment", "discount"} & set(updates)
    changed: list[str] = []

    # Cancelling has consequences this endpoint does not implement — releasing the
    # slot, the refund decision, the cancellation event. Routing it here would skip
    # all three and leave a booking that looks cancelled but never freed its court.
    if "status" in updates and updates["status"] == BookingStatus.CANCELLED:
        raise ConflictError(
            "Use POST /bookings/{id}/cancel to cancel a booking.",
            details={"booking_id": str(booking.id)},
        )

    if "status" in updates and booking.status is not updates["status"]:
        changed.append(f"status → {updates['status'].value}")
        booking.status = updates["status"]
    if "notes" in updates:
        changed.append("notes")
        booking.notes = updates["notes"]

    # ── Who played ───────────────────────────────────────────────────────────
    # The booking's snapshot is authoritative for this booking. The linked customer
    # row is corrected alongside so the fix follows them to their next visit — the
    # snapshot still protects every OTHER booking they have from being rewritten.
    if "customer_name" in updates or "customer_phone" in updates:
        customer = await db.get(Customer, booking.customer_id) if booking.customer_id else None
        if "customer_name" in updates:
            changed.append("player name")
            booking.customer_name = updates["customer_name"]
            if customer is not None:
                customer.name = updates["customer_name"]
        if "customer_phone" in updates:
            changed.append("player phone")
            booking.customer_phone = updates["customer_phone"]
            if customer is not None and updates["customer_phone"]:
                customer.phone = updates["customer_phone"]

    if reprice:
        court = (
            await get_or_404(db, Court, payload.court_id, label="Court")
            if payload.court_id
            else await db.get(Court, booking.court_id)
        )
        starts_at = payload.starts_at if "starts_at" in updates else booking.starts_at
        duration = payload.duration_min if "duration_min" in updates else booking.duration_min
        discount = payload.discount if "discount" in updates else booking.discount

        if "equipment" in updates:
            # Explicitly sent — a replacement, including `[]` to clear the kit.
            quote_result, lines = await service.price_booking(
                db,
                court=court,
                starts_at=starts_at,
                duration_min=duration,
                selections=payload.equipment or [],
                discount=discount,
            )
        else:
            # NOT sent. Carry the stored lines through verbatim. Treating "absent"
            # as "empty" here silently deleted the customer's kit — and reduced
            # their bill — every time someone moved a booking by ten minutes.
            lines = service.equipment_lines_from_json(booking.equipment)
            quote_result = await service.price_with_lines(
                db,
                court=court,
                starts_at=starts_at,
                duration_min=duration,
                lines=lines,
                discount=discount,
            )

        changed.extend(sorted(reprice))
        booking.court_id = court.id
        booking.sport_id = court.sport_id
        booking.starts_at = starts_at
        booking.ends_at = starts_at + timedelta(minutes=duration)
        booking.duration_min = duration
        service._apply_quote(booking, quote_result, lines)

        await service.ensure_slot_free(
            db,
            court_id=court.id,
            starts_at=booking.starts_at,
            ends_at=booking.ends_at,
            exclude_booking_id=booking.id,
        )
        _resync_payment(booking)

    if changed:
        await db.flush()
        await service.record_event(
            db,
            booking,
            kind=BookingEventKind.EDIT,
            label="Booking Edited",
            detail=f"Updated {', '.join(changed)}",
            actor_user_id=principal.id,
        )

    await db.flush()
    return await _detail(db, booking)


def _resync_payment(booking: Booking) -> None:
    """Re-derive payment_status after a re-price.

    A booking paid in full that is then extended owes money again; one that shrinks
    is overpaid. Leaving payment_status alone would let a booking read PAID with a
    balance outstanding, which is the version of this bug that reaches a customer.

    REFUNDED is left alone: it records something that happened, not a comparison of
    two numbers, and no recalculation should overwrite it.
    """
    if booking.payment_status is not PaymentStatus.REFUNDED:
        refresh_booking_payment_status(booking)


@router.put(
    "/bookings/{booking_id}/equipment",
    response_model=BookingDetail,
    summary="Set a booking's equipment",
    description=(
        "Replaces the whole kit list and re-prices. **Reachable by the POS counter**, "
        "unlike `PATCH /bookings/{id}` — adding a racket mid-game is counter work, "
        "rescheduling is not.\n\n"
        "A replacement, not an addition: send the complete list. Both frontends "
        "already merge against the booking's existing lines before calling."
    ),
)
async def set_booking_equipment(
    booking_id: uuid.UUID, payload: BookingEquipmentSet, db: Db, principal: RequireKiosk
) -> BookingDetail:
    booking = await get_or_404(db, Booking, booking_id, label="Booking")
    if booking.status is BookingStatus.CANCELLED:
        raise ConflictError("This booking has been cancelled and can no longer be edited.")

    court = await db.get(Court, booking.court_id)
    quote_result, lines = await service.price_booking(
        db,
        court=court,
        starts_at=booking.starts_at,
        duration_min=booking.duration_min,
        selections=payload.equipment,
        discount=booking.discount,
    )
    service._apply_quote(booking, quote_result, lines)
    _resync_payment(booking)

    await db.flush()
    await service.record_event(
        db,
        booking,
        kind=BookingEventKind.EDIT,
        label="Kit Updated",
        detail=f"{len(lines)} item line(s) on the bill",
        actor_user_id=principal.id,
    )
    await db.flush()
    return await _detail(db, booking)


@router.post(
    "/bookings/{booking_id}/extend",
    response_model=BookingDetail,
    summary="Extend a live booking",
    description=(
        "The common case of a player deciding to keep going. Rejected with **409** "
        "and the maximum possible extension if another booking already follows."
    ),
)
async def extend_booking(
    booking_id: uuid.UUID, payload: BookingExtend, db: Db, principal: RequireStaff
) -> BookingDetail:
    booking = await get_or_404(db, Booking, booking_id, label="Booking")
    if booking.status is BookingStatus.CANCELLED:
        raise ConflictError("This booking has been cancelled.")

    available = await service.max_extension_minutes(db, booking)
    if payload.additional_minutes > available:
        raise ConflictError(
            "The court is booked again before that."
            if available
            else "The court is booked again immediately after this session.",
            details={"max_additional_minutes": available},
        )

    court = await db.get(Court, booking.court_id)
    # Re-prices the whole session — court *and* kit. This used to carry
    # `equipment_charge` across untouched, which was right when rentals were a flat
    # per-session fee and wrong the moment they became per-hour: a racket out for
    # the extra hour has to be billed for it.
    await service.absorb_into_booking(
        db,
        booking,
        court=court,
        additional_minutes=payload.additional_minutes,
        selections=[],
    )

    await service.ensure_slot_free(
        db,
        court_id=booking.court_id,
        starts_at=booking.starts_at,
        ends_at=booking.ends_at,
        exclude_booking_id=booking.id,
    )
    await db.flush()
    await service.record_event(
        db,
        booking,
        kind=BookingEventKind.EXTENDED,
        label=f"Extended by {payload.additional_minutes} min",
        detail=f"Now ends at {booking.ends_at.isoformat()}",
        actor_user_id=principal.id,
    )
    await db.flush()
    return await _detail(db, booking)


@router.post(
    "/bookings/{booking_id}/cancel",
    response_model=BookingDetail,
    summary="Cancel a booking",
    description=(
        "Cancelling frees the slot immediately: the exclusion constraint excludes "
        "cancelled rows, so the time becomes bookable again in the same transaction."
    ),
)
async def cancel_booking(
    booking_id: uuid.UUID, payload: BookingCancel, db: Db, principal: RequireStaff
) -> BookingDetail:
    booking = await get_or_404(db, Booking, booking_id, label="Booking")
    # release_booking is a no-op on an already-cancelled booking, so pressing cancel
    # twice returns the same booking rather than double-returning its equipment.
    await service.release_booking(
        db, booking, reason=payload.reason, actor_user_id=principal.id
    )
    return await _detail(db, booking)


@router.get(
    "/bookings/{booking_id}/timeline",
    response_model=list[BookingEventOut],
    summary="A booking's activity timeline",
)
async def booking_timeline(booking_id: uuid.UUID, db: Db, _: RequireStaff) -> list[BookingEventOut]:
    await get_or_404(db, Booking, booking_id, label="Booking")
    rows = (
        (
            await db.execute(
                select(BookingEvent)
                .where(BookingEvent.booking_id == booking_id)
                .order_by(BookingEvent.occurred_at)
            )
        )
        .scalars()
        .all()
    )
    return [BookingEventOut.model_validate(row) for row in rows]


async def _detail(db, booking: Booking) -> BookingDetail:
    sport = await db.get(Sport, booking.sport_id)
    court = await db.get(Court, booking.court_id)
    return BookingDetail(
        **BookingOut.model_validate(booking).model_dump(),
        sport_name=sport.name if sport else None,
        court_name=court.name if court else None,
    )
