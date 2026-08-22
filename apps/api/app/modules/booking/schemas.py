"""Pydantic schemas for the booking domain."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.modules.booking.models import (
    BookingEventKind,
    BookingStatus,
    BookingType,
    EquipmentCondition,
    EquipmentMode,
    EquipmentUnit,
    Gender,
    MemberType,
    MembershipTier,
    MovementKind,
    PaymentStatus,
)

ORM = ConfigDict(from_attributes=True)


# ── Sport ───────────────────────────────────────────────────────────────────


class SportBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    icon: str | None = Field(default=None, max_length=16)
    color: str | None = Field(default=None, max_length=9)
    bg_color: str | None = Field(default=None, max_length=9)
    default_duration_min: int = Field(default=60, ge=15, le=600)
    price_base: Decimal = Field(ge=0)
    price_peak: Decimal = Field(ge=0)
    price_weekend: Decimal = Field(ge=0)
    is_active: bool = True
    display_order: int = 0


class SportCreate(SportBase):
    slug: str | None = Field(default=None, max_length=100, description="Defaults to a slugified name")


class SportUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    icon: str | None = None
    color: str | None = None
    bg_color: str | None = None
    default_duration_min: int | None = Field(default=None, ge=15, le=600)
    price_base: Decimal | None = Field(default=None, ge=0)
    price_peak: Decimal | None = Field(default=None, ge=0)
    price_weekend: Decimal | None = Field(default=None, ge=0)
    is_active: bool | None = None
    display_order: int | None = None


class SportOut(SportBase):
    model_config = ORM
    id: uuid.UUID
    slug: str


class CatalogueSportOut(SportBase):
    """A sport the turf *could* offer. Not a row — see booking/catalogue.py."""

    slug: str


# ── Court ───────────────────────────────────────────────────────────────────


class OperatingHours(BaseModel):
    open: str = "06:00"
    close: str = "22:00"


#: How many photos the court form accepts. Interface policy, not a schema
#: invariant — the column is a JSONB array and does not care.
MAX_COURT_IMAGES = 5


class CourtBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    sport_id: uuid.UUID
    hourly_rate: Decimal = Field(ge=0)
    peak_rate: Decimal = Field(ge=0)
    images: list[str] = Field(default_factory=list, max_length=MAX_COURT_IMAGES)
    operating_hours: OperatingHours = Field(default_factory=OperatingHours)
    amenities: list[str] = Field(default_factory=list)
    rating: Decimal | None = Field(default=None, ge=0, le=5)
    display_order: int = 0
    open_slots_enabled: bool = False
    slot_capacity: int | None = Field(
        default=None,
        ge=1,
        description="How many people may join one session. Required when open_slots_enabled.",
    )
    is_bookable: bool = True
    maintenance_note: str | None = None

    @model_validator(mode="after")
    def _capacity_required_for_open_slots(self) -> CourtBase:
        # Mirrors the open_slots_needs_capacity CHECK. Duplicated deliberately: the
        # constraint is the invariant, this is the interface — the caller gets a 422
        # naming the field instead of an IntegrityError from COMMIT.
        if self.open_slots_enabled and not self.slot_capacity:
            raise ValueError("slot_capacity is required when open slots are enabled")
        return self


class CourtCreate(CourtBase):
    code: str = Field(min_length=1, max_length=50)


class CourtUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    sport_id: uuid.UUID | None = None
    hourly_rate: Decimal | None = Field(default=None, ge=0)
    peak_rate: Decimal | None = Field(default=None, ge=0)
    images: list[str] | None = Field(default=None, max_length=MAX_COURT_IMAGES)
    operating_hours: OperatingHours | None = None
    amenities: list[str] | None = None
    rating: Decimal | None = Field(default=None, ge=0, le=5)
    display_order: int | None = None
    open_slots_enabled: bool | None = None
    slot_capacity: int | None = Field(default=None, ge=1)
    is_bookable: bool | None = None
    maintenance_note: str | None = None

    @model_validator(mode="after")
    def _capacity_required_for_open_slots(self) -> CourtUpdate:
        # Only when the patch is *turning open slots on*. A patch that leaves the
        # flag alone says nothing about capacity, and the CHECK still catches the
        # combination that would be invalid on the stored row.
        if self.open_slots_enabled and not self.slot_capacity:
            raise ValueError("slot_capacity is required when open slots are enabled")
        return self


class CourtOut(CourtBase):
    model_config = ORM
    id: uuid.UUID
    code: str


class CourtWithStatus(CourtOut):
    """A court plus the status the frontend's Courts page renders.

    `status` is computed for the requested instant rather than stored — see the note
    on `Court.status` in models.py. `available|occupied|maintenance` here matches the
    `CourtStatus` union the existing UI already handles.
    """

    status: str = Field(description="available | occupied | maintenance")
    current_booking_id: uuid.UUID | None = None
    sport_name: str | None = None


# ── Availability ────────────────────────────────────────────────────────────


class Slot(BaseModel):
    starts_at: datetime
    ends_at: datetime
    available: bool
    rate: Decimal
    is_peak: bool
    blocked_by_booking_id: uuid.UUID | None = None


class CourtAvailability(BaseModel):
    court_id: uuid.UUID
    court_name: str
    court_code: str
    sport_id: uuid.UUID
    is_bookable: bool
    maintenance_note: str | None = None
    slots: list[Slot]


# ── Equipment ───────────────────────────────────────────────────────────────


class EquipmentBase(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    category: str = Field(min_length=1, max_length=100)
    rental_price: Decimal = Field(default=Decimal("0"), ge=0)
    sale_price: Decimal = Field(default=Decimal("0"), ge=0)
    for_rent: bool = True
    for_sale: bool = False
    pack_size: int = Field(default=1, ge=1, description="Base units in one pack")
    pack_price: Decimal = Field(default=Decimal("0"), ge=0)
    deposit: Decimal = Field(default=Decimal("0"), ge=0)
    condition: EquipmentCondition = EquipmentCondition.GOOD
    low_stock_threshold: int = Field(default=3, ge=0)
    sport_id: uuid.UUID | None = None
    published_to_pos: bool = True
    image_url: str | None = None
    consumable: bool = True

    @model_validator(mode="after")
    def _offered_somehow(self) -> EquipmentBase:
        if not (self.for_rent or self.for_sale):
            raise ValueError("Equipment must be available to rent, to buy, or both.")
        # A pack that is not for sale can never be chosen — packs are bought, not
        # rented — so it is a configuration mistake worth naming at the source.
        if self.pack_size > 1 and not self.for_sale:
            raise ValueError("Pack sizes above 1 require the item to be for sale.")
        return self


class EquipmentCreate(EquipmentBase):
    barcode: str = Field(min_length=1, max_length=64)
    qty_stock: int = Field(default=0, ge=0, description="All units start as available")


class EquipmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    category: str | None = None
    rental_price: Decimal | None = Field(default=None, ge=0)
    sale_price: Decimal | None = Field(default=None, ge=0)
    for_rent: bool | None = None
    for_sale: bool | None = None
    pack_size: int | None = Field(default=None, ge=1)
    pack_price: Decimal | None = Field(default=None, ge=0)
    deposit: Decimal | None = Field(default=None, ge=0)
    condition: EquipmentCondition | None = None
    low_stock_threshold: int | None = Field(default=None, ge=0)
    sport_id: uuid.UUID | None = None
    published_to_pos: bool | None = None
    image_url: str | None = None
    consumable: bool | None = None


class EquipmentOut(EquipmentBase):
    model_config = ORM
    id: uuid.UUID
    barcode: str
    qty_stock: int
    qty_available: int
    qty_issued: int
    qty_maintenance: int
    qty_lost: int
    is_low_stock: bool = False

    @model_validator(mode="after")
    def _flag_low_stock(self) -> EquipmentOut:
        object.__setattr__(self, "is_low_stock", self.qty_available <= self.low_stock_threshold)
        return self


class MovementCreate(BaseModel):
    kind: MovementKind
    qty: int = Field(gt=0)
    booking_id: uuid.UUID | None = None
    note: str | None = None


class MovementOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    equipment_id: uuid.UUID
    booking_id: uuid.UUID | None
    kind: MovementKind
    qty: int
    note: str | None
    occurred_at: datetime


# ── Customer ────────────────────────────────────────────────────────────────


class CustomerBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=4, max_length=32)
    email: EmailStr | None = None
    gender: Gender | None = None
    member_type: MemberType = MemberType.NON_MEMBER
    membership_tier: MembershipTier | None = None
    favorite_sport_id: uuid.UUID | None = None
    date_of_birth: date | None = None
    address: str | None = None
    emergency_contact: str | None = None
    emergency_phone: str | None = None
    notes: str | None = None


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, min_length=4, max_length=32)
    email: EmailStr | None = None
    gender: Gender | None = None
    member_type: MemberType | None = None
    membership_tier: MembershipTier | None = None
    favorite_sport_id: uuid.UUID | None = None
    date_of_birth: date | None = None
    address: str | None = None
    emergency_contact: str | None = None
    emergency_phone: str | None = None
    notes: str | None = None


class CustomerOut(CustomerBase):
    model_config = ORM
    id: uuid.UUID
    join_date: date
    avatar_initials: str | None = None


class CustomerDetail(CustomerOut):
    """Customer plus the rollups the frontend interface stores as columns.

    `total_bookings`, `total_spent` and `outstanding_dues` are aggregated at read
    time from bookings. Stored counters would drift the first time a booking is
    edited, cancelled or refunded — and nothing would be responsible for noticing.
    """

    total_bookings: int
    total_spent: Decimal
    outstanding_dues: Decimal
    favorite_sport: str | None = None


# ── Booking ─────────────────────────────────────────────────────────────────


class EquipmentSelection(BaseModel):
    """One add-on line on a booking.

    `qty` counts whatever `unit` says: two packs, or two loose balls. Defaults keep
    every existing caller working unchanged — renting single units is what the
    booking flow has always done.
    """

    equipment_id: uuid.UUID
    qty: int = Field(gt=0, le=100)
    mode: EquipmentMode = EquipmentMode.RENT
    unit: EquipmentUnit = EquipmentUnit.SINGLE

    @model_validator(mode="after")
    def _packs_are_bought_not_rented(self) -> EquipmentSelection:
        # Renting "a pack" has no meaning the pricing model can honour — a pack has
        # one price and rentals are per unit per session. Rejecting it here beats
        # silently charging the single rate for three balls.
        if self.unit is EquipmentUnit.PACK and self.mode is not EquipmentMode.BUY:
            raise ValueError("Packs can only be bought, not rented.")
        return self


class BookingCreate(BaseModel):
    court_id: uuid.UUID
    starts_at: datetime
    duration_min: int = Field(ge=15, le=1440)
    customer_id: uuid.UUID | None = None
    # Walk-ins are frequently anonymous — someone turns up and pays cash. Name and
    # phone alone are enough to take the booking.
    customer_name: str | None = Field(default=None, max_length=200)
    customer_phone: str | None = Field(default=None, max_length=32)
    booking_type: BookingType = BookingType.WALKIN
    equipment: list[EquipmentSelection] = Field(default_factory=list)
    discount: Decimal = Field(default=Decimal("0"), ge=0)
    notes: str | None = None

    @model_validator(mode="after")
    def _identify_the_customer(self) -> BookingCreate:
        if self.customer_id is None and not (self.customer_name or "").strip():
            raise ValueError("either customer_id or customer_name is required")
        return self

    @field_validator("starts_at")
    @classmethod
    def _require_timezone(cls, v: datetime) -> datetime:
        # A naive datetime would be interpreted as UTC by Postgres and silently
        # shift an Indian booking by 5h30m into a different slot.
        if v.tzinfo is None:
            raise ValueError("starts_at must include a timezone offset, e.g. 2024-08-01T10:00:00+05:30")
        return v


class BookingUpdate(BaseModel):
    """Edits allowed on a booking — mirrors the Edit Booking drawer.

    Every field is optional and distinguishable from "not sent" via
    `exclude_unset`, which the handler relies on: sending `equipment: []` clears the
    kit, whereas omitting it must leave the existing kit alone. Those are different
    intentions and a plain `or` cannot tell them apart.
    """

    court_id: uuid.UUID | None = None
    starts_at: datetime | None = None
    duration_min: int | None = Field(default=None, ge=15, le=1440)
    equipment: list[EquipmentSelection] | None = None
    discount: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None
    status: BookingStatus | None = None

    #: Who actually played. These are the booking's own snapshot columns, not the
    #: customer record — see the Booking model docstring on why the two are separate.
    #: The linked customer row is updated alongside, so a corrected spelling follows
    #: the person to their next visit.
    customer_name: str | None = Field(default=None, min_length=1, max_length=200)
    customer_phone: str | None = Field(default=None, max_length=32)

    @field_validator("customer_name")
    @classmethod
    def _name_not_blank(cls, v: str | None) -> str | None:
        """`min_length=1` still admits "   ", which would blank the name on receipts."""
        if v is None:
            return None
        stripped = v.strip()
        if not stripped:
            raise ValueError("customer_name cannot be blank")
        return stripped


class BookingEquipmentSet(BaseModel):
    """The complete kit list for a booking — a replacement, not an addition.

    Named `set` rather than `add` because that is what it does: both the POS counter
    sheet and the dashboard already merge against the booking's existing lines
    client-side and send the whole list. Making this additive would double every
    quantity they send.
    """

    equipment: list[EquipmentSelection]


class BookingExtend(BaseModel):
    additional_minutes: int = Field(gt=0, le=480, description="e.g. 30, 60, 120")


class BookingCancel(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class EquipmentLineOut(BaseModel):
    name: str
    qty: int
    rate: Decimal
    #: None on bookings written before this was recorded. A client editing a
    #: booking's kit needs the id — names alone cannot identify what to keep.
    equipment_id: uuid.UUID | None = None
    mode: EquipmentMode = EquipmentMode.RENT
    unit: EquipmentUnit = EquipmentUnit.SINGLE


class BookingOut(BaseModel):
    model_config = ORM

    id: uuid.UUID
    #: `XC-B-0042` — what the customer is given and types at the kiosk to check in.
    #: The UUID stays the API's identifier; this is the human one, and every screen
    #: that shows "the booking id" to a person should show this.
    reference: str
    customer_id: uuid.UUID | None
    customer_name: str
    customer_phone: str | None
    sport_id: uuid.UUID
    court_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    duration_min: int
    status: BookingStatus
    payment_status: PaymentStatus
    booking_type: BookingType
    court_charge: Decimal
    equipment_charge: Decimal
    taxes: Decimal
    discount: Decimal
    total: Decimal
    amount_paid: Decimal
    balance_due: Decimal
    payment_method: str | None
    equipment: list[EquipmentLineOut]
    notes: str | None

    #: Which platform sold this, e.g. "playo". NULL means it was taken here — the
    #: counter, the dashboard, or the seed. Denormalised from the partner at creation
    #: so the answer survives the integration being revoked or deleted.
    source_platform: str | None = None
    #: That platform's own booking id, for reconciling their ledger against ours.
    external_ref: str | None = None

    created_at: datetime


class BookingDetail(BookingOut):
    sport_name: str | None = None
    court_name: str | None = None


class BookingEventOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    kind: BookingEventKind
    label: str
    detail: str | None
    occurred_at: datetime


class QuoteRequest(BaseModel):
    """Price a booking without creating it — powers the walk-in wizard's summary."""

    court_id: uuid.UUID
    starts_at: datetime
    duration_min: int = Field(ge=15, le=1440)
    equipment: list[EquipmentSelection] = Field(default_factory=list)
    discount: Decimal = Field(default=Decimal("0"), ge=0)


class QuoteOut(BaseModel):
    court_charge: Decimal
    equipment_charge: Decimal
    discount: Decimal
    taxes: Decimal
    total: Decimal
    is_peak: bool
    is_weekend: bool
    rate_applied: Decimal
    equipment: list[EquipmentLineOut]
