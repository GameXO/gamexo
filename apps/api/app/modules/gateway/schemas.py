"""The partner-facing contract.

Separate models from booking/schemas.py rather than reuse, because the difference
IS the security boundary. `Slot` carries `blocked_by_booking_id` and `BookingDetail`
carries the customer's phone, the itemised kit and the outstanding balance — all
correct for our own dashboard, none of it a third party's business. Reusing them and
remembering to strip fields is the kind of thing that survives one review and breaks
at the next.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ORM = ConfigDict(from_attributes=True)


class PartnerSlot(BaseModel):
    """One bookable window.

    Note what is absent: `blocked_by_booking_id`. A partner learns THAT a slot is
    taken, never which booking took it — an internal id handed out here would let
    a platform enumerate our bookings by polling.
    """

    starts_at: datetime
    ends_at: datetime
    available: bool
    rate: Decimal
    is_peak: bool


class PartnerCourtAvailability(BaseModel):
    court_id: uuid.UUID
    court_name: str
    sport_id: uuid.UUID
    sport_name: str
    is_bookable: bool
    slots: list[PartnerSlot]


class PartnerBookingCreate(BaseModel):
    court_id: uuid.UUID
    starts_at: datetime
    duration_min: int = Field(ge=15, le=1440)

    customer_name: str = Field(min_length=1, max_length=200)
    customer_phone: str | None = Field(default=None, max_length=32)

    #: The platform's own booking id. Optional, but strongly recommended: it is what
    #: makes a retried create idempotent instead of double-selling the court, and
    #: what a reconciliation run matches on.
    external_ref: str | None = Field(default=None, max_length=120)

    #: Deliberately absent from this model: `discount`, `equipment` and
    #: `booking_type`. Discounts are the academy's to give, kit is issued at the
    #: counter against real stock, and the source is derived from the API key rather
    #: than claimed in the body.

    @field_validator("starts_at")
    @classmethod
    def _require_timezone(cls, v: datetime) -> datetime:
        # Same rule as the internal schema: a naive datetime is read as UTC by
        # Postgres and silently moves an Indian booking by 5h30m.
        if v.tzinfo is None:
            raise ValueError(
                "starts_at must include a timezone offset, e.g. 2026-08-21T18:00:00+05:30"
            )
        return v


class PartnerBookingOut(BaseModel):
    """What a partner gets back about their own booking.

    The money fields are included because the partner sold the slot and needs to
    reconcile what it costs. The customer's phone is echoed back because they
    supplied it. Nothing here reveals anything about anyone else's booking.
    """

    model_config = ORM

    id: uuid.UUID
    #: Our reference, `XCB0042`. Put it on the customer's confirmation — it is
    #: what the counter will ask them for when they arrive.
    reference: str
    external_ref: str | None
    source_platform: str | None

    court_id: uuid.UUID
    starts_at: datetime
    ends_at: datetime
    duration_min: int
    status: str
    payment_status: str

    customer_name: str
    customer_phone: str | None

    court_charge: Decimal
    taxes: Decimal
    total: Decimal
    amount_paid: Decimal

    created_at: datetime


class PartnerBookingCancel(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


# ── Staff-facing: managing the integrations ─────────────────────────────────


class DialectOut(BaseModel):
    """A wire format the gateway speaks. From `gateway.dialects.DIALECTS`."""

    slug: str
    label: str
    summary: str

    #: Where to point this partner. Relative — the dashboard prefixes the API origin.
    #: The **same for every dialect**, deliberately: the API key says which contract a
    #: partner speaks, so there is one URL to hand out and no wrong one to choose.
    base_path: str

    #: Where `base_path` routes to for this dialect. For reading the API reference and
    #: for debugging a call; a partner never needs it.
    canonical_path: str

    is_default: bool

    #: True for a named third-party platform. The dashboard offers these and only
    #: these — the question it asks is "who is this integration for?".
    is_platform: bool

    #: False for a platform whose spec we do not have yet: shown, but not selectable,
    #: and refused by the API as well as by the form.
    is_ready: bool


class PartnerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=2, max_length=50, pattern=r"^[a-z0-9][a-z0-9_-]*$")

    #: Which contract they speak. `native` is ours and the answer for anyone without
    #: a spec of their own; a partner that dictates one gets its own dialect.
    dialect: str = Field(default="native", max_length=50)

    #: The id the partner knows this venue by, if they have assigned one.
    external_venue_id: str | None = Field(default=None, max_length=120)


class PartnerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None
    dialect: str | None = Field(default=None, max_length=50)
    external_venue_id: str | None = Field(default=None, max_length=120)


class PartnerOut(BaseModel):
    model_config = ORM

    id: uuid.UUID
    name: str
    slug: str
    dialect: str
    external_venue_id: str | None
    key_prefix: str
    is_active: bool
    last_used_at: datetime | None
    created_at: datetime


class PartnerWithKey(PartnerOut):
    """Returned once, at creation and rotation, and never again.

    Only the hash is stored, so this is the single moment the key exists in a form
    anyone can copy. The field name says so, because a partner integration lost to
    "we didn't write it down" costs an afternoon.
    """

    api_key: str = Field(description="Shown once. Store it now — it cannot be recovered.")
