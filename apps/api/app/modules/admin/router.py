"""Admin endpoints: settings, staff, notifications, channel config, jobs."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import func, select

from app.api_utils import Page, Params, get_or_404, paginate
from app.auth.deps import (
    RequireAdmin,
    RequireKiosk,
    RequireManager,
    RequireStaff,
    revoke_identity,
)
from app.auth.schemas import UserOut
from app.auth.service import initials, register_email
from app.core.errors import ConflictError
from app.core.security import Role, hash_password
from app.models.tenant import SERVICE_KEYS, TenantSettings
from app.models.user import User, UserStatus
from app.modules.admin.models import (
    Channel,
    Job,
    JobState,
    Notification,
    NotificationChannelConfig,
    NotificationDelivery,
    NotificationKind,
)
from app.tenancy.deps import Db, TenantCtx

router = APIRouter(tags=["admin"])

ORM = ConfigDict(from_attributes=True)

# The event keys the frontend's Settings → Notifications matrix lists, plus the
# lifecycle events the Phase 6 worker fires.
DEFAULT_EVENT_KEYS = (
    "booking_confirmation",
    "booking_reminder",
    "booking_started",
    "booking_ending_soon",
    "invoice_sent",
    "payment_receipt",
    "payment_reminder",
    "membership_expiring",
    "fee_due",
    "ad_contract_expiring",
)


# ── Settings ────────────────────────────────────────────────────────────────


class SettingsOut(BaseModel):
    model_config = ORM

    id: uuid.UUID
    business_name: str
    phone: str | None
    email: str | None
    gst_number: str | None
    address: str | None
    city: str | None
    logo_url: str | None
    brand_primary: str
    brand_accent: str
    brand_background: str
    currency: str
    timezone: str
    invoice_prefix: str
    operating_hours: dict[str, Any]
    booking_rules: dict[str, Any]
    tax_config: dict[str, Any]
    security_flags: dict[str, Any]
    enabled_services: dict[str, Any]
    notification_sender_name: str | None
    notification_sender_email: str | None


class SettingsUpdate(BaseModel):
    business_name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = None
    email: EmailStr | None = None
    gst_number: str | None = Field(default=None, max_length=20)
    address: str | None = None
    city: str | None = None
    logo_url: str | None = None
    brand_primary: str | None = Field(default=None, max_length=9)
    brand_accent: str | None = Field(default=None, max_length=9)
    brand_background: str | None = Field(default=None, max_length=9)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    timezone: str | None = None
    invoice_prefix: str | None = Field(default=None, min_length=1, max_length=8)
    operating_hours: dict[str, Any] | None = None
    booking_rules: dict[str, Any] | None = None
    tax_config: dict[str, Any] | None = None
    security_flags: dict[str, Any] | None = None
    enabled_services: dict[str, bool] | None = None
    notification_sender_name: str | None = None
    notification_sender_email: EmailStr | None = None

    @field_validator("enabled_services")
    @classmethod
    def _known_services(cls, v: dict[str, bool] | None) -> dict[str, bool] | None:
        # Same rule as onboarding: unknown keys are dropped, not rejected, so a
        # frontend one deploy ahead of the API cannot fail a settings save.
        if v is None:
            return None
        return {key: bool(value) for key, value in v.items() if key in SERVICE_KEYS}


@router.get(
    "/settings",
    response_model=SettingsOut,
    summary="This academy's settings",
    description=(
        "Everything the Settings page collects, now per-tenant instead of hardcoded "
        "to 'XCourt Sports'. This is the white-label surface: brand colours, logo, "
        "currency, timezone, GST and invoice identity all read from here."
    ),
)
async def get_settings(db: Db, _: RequireStaff) -> SettingsOut:
    settings = (await db.execute(select(TenantSettings))).scalar_one()
    return SettingsOut.model_validate(settings)


@router.patch(
    "/settings",
    response_model=SettingsOut,
    summary="Update settings",
    description=(
        "Admin only. Payment-gateway and messaging credentials are deliberately "
        "**not** accepted here — the Settings page shows a Razorpay key secret in a "
        "plain input, and a live payment secret does not belong in a readable config "
        "blob next to brand colours. They will land in an encrypted `tenant_secret` "
        "table with a write-only API."
    ),
)
async def update_settings(payload: SettingsUpdate, db: Db, _: RequireAdmin) -> SettingsOut:
    settings = (await db.execute(select(TenantSettings))).scalar_one()
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if field in {"email", "notification_sender_email"} and value is not None:
            value = str(value)
        if field == "currency" and value is not None:
            value = value.upper()
        if field == "enabled_services" and value is not None:
            # Merged, so a client that renders only the services it knows about
            # cannot silently clear the ones it has never heard of.
            value = {**settings.enabled_services, **value}
        setattr(settings, field, value)
    await db.flush()
    return SettingsOut.model_validate(settings)


class PublicSettingsOut(BaseModel):
    """What the counter tablet is allowed to know about the academy it belongs to.

    `GET /settings` is RequireStaff and the kiosk role sits below reception, so the
    POS cannot read it — deliberately, since the tablet login is the most exposed
    credential in the academy and that payload carries GST numbers, invoice identity
    and notification addresses. This is the branding subset, and nothing else.
    """

    model_config = ORM

    business_name: str
    logo_url: str | None
    brand_primary: str
    brand_accent: str
    brand_background: str
    currency: str
    enabled_services: dict[str, Any]


@router.get(
    "/settings/public",
    response_model=PublicSettingsOut,
    summary="Branding and enabled services, for the counter tablet",
)
async def get_public_settings(db: Db, _: RequireKiosk) -> PublicSettingsOut:
    settings = (await db.execute(select(TenantSettings))).scalar_one()
    return PublicSettingsOut.model_validate(settings)


# ── Staff ───────────────────────────────────────────────────────────────────


class StaffCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    full_name: str = Field(min_length=1, max_length=200)
    role: Role = Role.RECEPTION
    phone: str | None = None
    shift: str | None = None
    joined_on: date | None = None


class StaffUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    role: Role | None = None
    phone: str | None = None
    shift: str | None = None
    status: UserStatus | None = None


@router.get(
    "/staff",
    response_model=Page[UserOut],
    summary="List staff",
    description="`app_user` is both the staff record and the login — see models/user.py.",
)
async def list_staff(
    db: Db, _: RequireStaff, params: Params, search: str | None = None
) -> Page[UserOut]:
    stmt = select(User).order_by(User.full_name)
    if search:
        like = f"%{search.lower()}%"
        stmt = stmt.where(User.full_name.ilike(like) | User.email.ilike(like))
    return await paginate(db, stmt, params, UserOut)


@router.post(
    "/staff", response_model=UserOut, status_code=status.HTTP_201_CREATED, summary="Add a staff member"
)
async def create_staff(
    payload: StaffCreate, db: Db, tenant: TenantCtx, _: RequireAdmin
) -> UserOut:
    existing = await db.scalar(
        select(User.id).where(func.lower(User.email) == payload.email.lower())
    )
    if existing is not None:
        raise ConflictError(
            "Someone at this academy already uses that email.", details={"field": "email"}
        )

    # Claims the email platform-wide, so this person can sign in on the shared
    # origin where there is no subdomain to say which academy they belong to.
    # Raises ConflictError if it is taken at another academy — see AccountDirectory
    # on why login emails are globally unique.
    await register_email(db, email=payload.email, tenant_id=tenant.id)

    user = User(
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        role=payload.role,
        phone=payload.phone,
        shift=payload.shift,
        joined_on=payload.joined_on or date.today(),
        avatar_initials=initials(payload.full_name),
    )
    db.add(user)
    await db.flush()
    return UserOut.model_validate(user)


@router.patch("/staff/{user_id}", response_model=UserOut, summary="Update a staff member")
async def update_staff(
    user_id: uuid.UUID, payload: StaffUpdate, db: Db, principal: RequireAdmin
) -> UserOut:
    user = await get_or_404(db, User, user_id, label="Staff member")

    # Admins demoting or deactivating themselves is the classic way to lock an
    # academy out of its own account entirely.
    if user.id == principal.id:
        if payload.role is not None and payload.role is not Role.ADMIN:
            raise ConflictError("You cannot remove your own admin role.")
        if payload.status is not None and payload.status is not UserStatus.ACTIVE:
            raise ConflictError("You cannot deactivate your own account.")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    if payload.full_name:
        user.avatar_initials = initials(user.full_name)
    await db.flush()

    # Authorisation reads a short-lived identity snapshot rather than the row. Drop
    # it so a demotion or deactivation applies to the very next request instead of
    # whenever the TTL happens to expire.
    revoke_identity(user.tenant_id, user.id)

    return UserOut.model_validate(user)


# ── Notifications ───────────────────────────────────────────────────────────


class NotificationOut(BaseModel):
    model_config = ORM

    id: uuid.UUID
    kind: NotificationKind
    title: str
    body: str | None
    severity_color: str | None
    entity_type: str | None
    entity_id: uuid.UUID | None
    read_at: datetime | None
    created_at: datetime


class NotificationCreate(BaseModel):
    kind: NotificationKind
    title: str = Field(min_length=1, max_length=200)
    body: str | None = None
    severity_color: str | None = Field(default=None, max_length=9)
    target_user_id: uuid.UUID | None = None
    entity_type: str | None = None
    entity_id: uuid.UUID | None = None


@router.get("/notifications", response_model=Page[NotificationOut], summary="List notifications")
async def list_notifications(
    db: Db, _: RequireStaff, params: Params, unread_only: bool = False
) -> Page[NotificationOut]:
    stmt = select(Notification).order_by(Notification.created_at.desc())
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    return await paginate(db, stmt, params, NotificationOut)


@router.get("/notifications/unread-count", summary="Unread badge count")
async def unread_count(db: Db, _: RequireStaff) -> dict[str, int]:
    count = await db.scalar(
        select(func.count(Notification.id)).where(Notification.read_at.is_(None))
    )
    return {"unread": int(count or 0)}


@router.post(
    "/notifications",
    response_model=NotificationOut,
    status_code=status.HTTP_201_CREATED,
    summary="Raise a notification",
)
async def create_notification(
    payload: NotificationCreate, db: Db, _: RequireStaff
) -> NotificationOut:
    notification = Notification(**payload.model_dump())
    db.add(notification)
    await db.flush()
    return NotificationOut.model_validate(notification)


@router.post(
    "/notifications/{notification_id}/read",
    response_model=NotificationOut,
    summary="Mark one as read",
)
async def mark_read(notification_id: uuid.UUID, db: Db, _: RequireStaff) -> NotificationOut:
    notification = await get_or_404(db, Notification, notification_id, label="Notification")
    notification.read_at = notification.read_at or datetime.now(UTC)
    await db.flush()
    return NotificationOut.model_validate(notification)


@router.post("/notifications/read-all", summary="Mark all as read")
async def mark_all_read(db: Db, _: RequireStaff) -> dict[str, int]:
    rows = (
        (await db.execute(select(Notification).where(Notification.read_at.is_(None))))
        .scalars()
        .all()
    )
    now = datetime.now(UTC)
    for row in rows:
        row.read_at = now
    await db.flush()
    return {"marked": len(rows)}


# ── Notification channels ───────────────────────────────────────────────────


class ChannelConfigOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    event_key: str
    email_enabled: bool
    whatsapp_enabled: bool
    sms_enabled: bool
    lead_time_minutes: int


class ChannelConfigUpdate(BaseModel):
    email_enabled: bool | None = None
    whatsapp_enabled: bool | None = None
    sms_enabled: bool | None = None
    lead_time_minutes: int | None = Field(default=None, ge=-10080, le=10080)


@router.get(
    "/notification-channels",
    response_model=list[ChannelConfigOut],
    summary="Per-event channel configuration",
    description=(
        "The Settings → Notifications matrix. Rows are created on first read so the "
        "academy always sees the full event list. Per-tenant from the start, because "
        "WhatsApp and SMS cost real money per message."
    ),
)
async def list_channel_config(db: Db, _: RequireStaff) -> list[ChannelConfigOut]:
    existing = {
        row.event_key: row
        for row in (await db.execute(select(NotificationChannelConfig))).scalars().all()
    }
    for event_key in DEFAULT_EVENT_KEYS:
        if event_key not in existing:
            row = NotificationChannelConfig(event_key=event_key)
            db.add(row)
            existing[event_key] = row
    await db.flush()

    return [
        ChannelConfigOut.model_validate(existing[key])
        for key in DEFAULT_EVENT_KEYS
        if key in existing
    ]


@router.patch(
    "/notification-channels/{event_key}",
    response_model=ChannelConfigOut,
    summary="Toggle channels for an event",
)
async def update_channel_config(
    event_key: str, payload: ChannelConfigUpdate, db: Db, _: RequireManager
) -> ChannelConfigOut:
    row = (
        await db.execute(
            select(NotificationChannelConfig).where(
                NotificationChannelConfig.event_key == event_key
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = NotificationChannelConfig(event_key=event_key)
        db.add(row)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    await db.flush()
    return ChannelConfigOut.model_validate(row)


class ChannelSpend(BaseModel):
    channel: Channel
    messages: int
    cost: Decimal


@router.get(
    "/notification-usage",
    response_model=list[ChannelSpend],
    summary="Metered messaging spend",
    description=(
        "What this academy's notifications cost, per channel. WhatsApp and SMS are "
        "billed per message, so usage is attributable from day one — this is what a "
        "usage-based plan would bill on."
    ),
)
async def notification_usage(
    db: Db,
    _: RequireStaff,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[ChannelSpend]:
    stmt = select(
        NotificationDelivery.channel,
        func.count(NotificationDelivery.id),
        func.coalesce(func.sum(NotificationDelivery.cost), 0),
    ).group_by(NotificationDelivery.channel)
    if date_from is not None:
        stmt = stmt.where(NotificationDelivery.created_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(NotificationDelivery.created_at < date_to)

    rows = (await db.execute(stmt)).all()
    return [
        ChannelSpend(channel=channel, messages=int(count), cost=Decimal(cost))
        for channel, count, cost in rows
    ]


# ── Jobs ────────────────────────────────────────────────────────────────────


class JobOut(BaseModel):
    model_config = ORM
    id: uuid.UUID
    kind: str
    payload: dict[str, Any]
    run_at: datetime
    state: JobState
    attempts: int
    last_error: str | None
    completed_at: datetime | None


class JobCreate(BaseModel):
    kind: str = Field(min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    run_at: datetime | None = None


@router.get("/jobs", response_model=Page[JobOut], summary="Background job queue")
async def list_jobs(
    db: Db,
    _: RequireManager,
    params: Params,
    job_state: Annotated[JobState | None, Query(alias="state")] = None,
) -> Page[JobOut]:
    stmt = select(Job).order_by(Job.run_at.desc())
    if job_state is not None:
        stmt = stmt.where(Job.state == job_state)
    return await paginate(db, stmt, params, JobOut)


@router.post(
    "/jobs",
    response_model=JobOut,
    status_code=status.HTTP_201_CREATED,
    summary="Queue a background job",
    description=(
        "Postgres-backed rather than Celery: renewal reminders and expiry sweeps are "
        "a handful of rows a day, and a Redis worker fleet is infrastructure to pay "
        "for before a customer has asked for it. Run with `python -m app.jobs.worker`."
    ),
)
async def create_job(payload: JobCreate, db: Db, _: RequireManager) -> JobOut:
    job = Job(
        kind=payload.kind,
        payload=payload.payload,
        run_at=payload.run_at or datetime.now(UTC),
    )
    db.add(job)
    await db.flush()
    return JobOut.model_validate(job)
