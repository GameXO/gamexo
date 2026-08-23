"""The tenant, and its per-tenant branding/config — what the frontend's Settings page collects."""

from __future__ import annotations

import re
import uuid
from enum import StrEnum
from typing import Any

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.db.base import Base, TenantScoped, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.types import enum_type

SLUG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$")

# Slugs that must never become a tenant subdomain, because they either collide with
# platform infrastructure or let a tenant impersonate one.
RESERVED_SLUGS = frozenset(
    {"www", "api", "app", "admin", "platform", "static", "assets", "mail", "docs", "status"}
)


class TenantStatus(StrEnum):
    ACTIVE = "active"
    TRIAL = "trial"
    SUSPENDED = "suspended"


class Tenant(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """An academy. My own centre is simply tenant #1.

    Deliberately NOT TenantScoped — this is the table the tenant_id on everything
    else points at, and it carries no RLS policy. Reading it is how a hostname
    becomes a tenant, which necessarily happens before any tenant is bound.
    """

    __tablename__ = "tenant"

    # The one legitimately global UNIQUE in the schema, because it IS the subdomain:
    # myacademy.gamexo.app. Everything else is UNIQUE (tenant_id, ...).
    slug: Mapped[str] = mapped_column(String(63), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[TenantStatus] = mapped_column(
        enum_type(TenantStatus, name="tenant_status"),
        default=TenantStatus.TRIAL,
        nullable=False,
    )
    plan_tier: Mapped[str] = mapped_column(String(50), default="starter", nullable=False)

    # NULL until the owner finishes the onboarding wizard, which is what routes a
    # freshly signed-up account into the wizard instead of an empty dashboard.
    #
    # A timestamp rather than a boolean, and on `tenant` rather than
    # `tenant_settings`: "when did this turf go live" is a question worth being able
    # to answer, and the tenant row is already loaded on the /auth/me path, so
    # surfacing it there costs no extra query.
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # EXTENSION POINT — peeling one enterprise tenant onto its own database is a
    # nullable `database_url` column here plus db.session.engine_for_tenant(). Not
    # built now: pooled only until a paying customer demands otherwise.

    settings: Mapped[TenantSettings] = relationship(
        back_populates="tenant", uselist=False, cascade="all, delete-orphan"
    )

    @property
    def onboarding_completed(self) -> bool:
        return self.onboarding_completed_at is not None

    @validates("slug")
    def _validate_slug(self, _key: str, value: str) -> str:
        value = (value or "").strip().lower()
        if not SLUG_PATTERN.match(value):
            raise ValueError(
                "slug must be a valid DNS label: lowercase letters, digits and hyphens, "
                "not starting or ending with a hyphen"
            )
        if value in RESERVED_SLUGS:
            raise ValueError(f"slug {value!r} is reserved for platform use")
        return value

    def __repr__(self) -> str:
        return f"<Tenant {self.slug}>"


def _default_operating_hours() -> dict[str, Any]:
    """Defaults lifted from the frontend Settings page (06:00–22:00, Mon–Sun)."""
    return {
        "monday_friday": {"open": "06:00", "close": "22:00"},
        "saturday": {"open": "06:00", "close": "22:00"},
        "sunday": {"open": "06:00", "close": "22:00"},
    }


def _default_booking_rules() -> dict[str, Any]:
    """Defaults from Settings.tsx → General → Booking Rules."""
    return {
        "min_duration_minutes": 60,
        "max_advance_days": 30,
        "cancellation_window_hours": 24,
        "peak_start": "17:00",
        "peak_end": "22:00",
    }


def _default_tax_config() -> dict[str, Any]:
    """Defaults from Settings.tsx → Taxes & GST."""
    return {"gst_rate": 18, "cgst": 9, "sgst": 9}


#: Every product surface a turf can switch on, in the order the onboarding wizard
#: and the Settings → Services tab list them. The keys are the contract with the
#: frontend's navigation gate, so adding one here is what makes it appear there.
SERVICE_KEYS = (
    "booking",
    "checkin",
    "membership",
    "shop",
    "inventory",
    "academy",
    "events",
    "advertising",
)


def _default_services() -> dict[str, Any]:
    """What a brand-new turf gets before onboarding asks.

    The four a turf cannot really operate without are on; the rest are off, because
    an empty Academy or Advertising section in the sidebar reads as a broken product
    rather than an available one.

    NOTE — this gates the UI only. The endpoints behind a disabled service stay
    reachable, so this is a "don't show me what I don't use" preference, not an
    authorization boundary. Enforcing it server-side wants a `require_service(...)`
    dependency alongside the role guards in auth/deps.py; deliberately not built yet,
    because turning a service off must never strand data the owner can no longer
    reach, and that needs the read paths thought through separately from the writes.
    """
    return {
        "booking": True,
        "checkin": True,
        "inventory": True,
        "shop": True,
        "membership": False,
        "academy": False,
        "events": False,
        "advertising": False,
    }


def _default_security_flags() -> dict[str, Any]:
    """Defaults from Settings.tsx → Security."""
    return {
        "two_factor_auth": True,
        "auto_logout_on_inactivity": True,
        "log_all_staff_actions": True,
        "require_strong_passwords": False,
    }


class TenantSettings(TenantScoped):
    """Branding and configuration, per academy.

    This is what makes the product white-label: everything the frontend currently
    hardcodes to "XCourt Sports" — business identity, brand colours, GST number,
    invoice address, operating hours, booking rules — reads from here instead.

    Genuinely document-shaped config (hours, rules, tax, flags) is JSONB rather than
    thirty columns. Identity fields stay as columns because they are queried,
    validated and rendered individually.
    """

    __tablename__ = "tenant_settings"
    __table_args__ = (
        # One settings row per tenant. Per-tenant unique, not global — the rule that
        # applies to every unique constraint in this schema.
        CheckConstraint("char_length(business_name) > 0", name="business_name_not_blank"),
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("tenant.id", ondelete="RESTRICT"),
        nullable=False,
        unique=True,
        index=True,
    )

    # ── Business identity (Settings → General → Business Information) ────────
    business_name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(320))
    gst_number: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(120))

    # ── Branding (the white-label surface) ───────────────────────────────────
    logo_url: Mapped[str | None] = mapped_column(Text)
    brand_primary: Mapped[str] = mapped_column(String(9), default="#002E25", nullable=False)
    brand_accent: Mapped[str] = mapped_column(String(9), default="#B5E770", nullable=False)
    brand_background: Mapped[str] = mapped_column(String(9), default="#FDFFE7", nullable=False)

    # ── Locale ───────────────────────────────────────────────────────────────
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    # Leads every human-readable document number: XC-2024-0001, XC-M-0001, XC-C-001.
    # Per-tenant, so a white-label customer's invoices carry their own initials.
    invoice_prefix: Mapped[str] = mapped_column(String(8), default="XC", nullable=False)
    # Load-bearing for reporting: bucketing "peak hours" in UTC would shift an
    # Indian academy's evening peak by 5h30m into the wrong bucket entirely.
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata", nullable=False)

    # ── Document-shaped config ───────────────────────────────────────────────
    operating_hours: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=_default_operating_hours, nullable=False
    )
    booking_rules: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=_default_booking_rules, nullable=False
    )
    tax_config: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=_default_tax_config, nullable=False
    )
    security_flags: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=_default_security_flags, nullable=False
    )
    #: Which product surfaces this turf has switched on — see _default_services.
    #: Set by onboarding, toggled afterwards in Settings → Services.
    enabled_services: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=_default_services, nullable=False
    )

    # ── Notification sender identity ─────────────────────────────────────────
    # Channel *enablement* and per-tenant metering land in Phase 6. Credentials will
    # NOT live here: the Settings page shows a Razorpay key secret in a plain input,
    # and a live payment secret does not belong in a readable config blob next to
    # brand colours. Phase 6 adds an encrypted `tenant_secret` table.
    notification_sender_name: Mapped[str | None] = mapped_column(String(120))
    notification_sender_email: Mapped[str | None] = mapped_column(String(320))

    tenant: Mapped[Tenant] = relationship(back_populates="settings")

    def __repr__(self) -> str:
        return f"<TenantSettings {self.business_name}>"
