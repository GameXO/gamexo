"""Request/response schemas for auth. These shape the OpenAPI the frontend consumes."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)

from app.core.security import BCRYPT_MAX_BYTES, Role
from app.models.tenant import RESERVED_SLUGS, SLUG_PATTERN, PlanTier, TenantStatus
from app.models.user import UserStatus


class _Password(BaseModel):
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def _within_bcrypt_limit(cls, v: str) -> str:
        # bcrypt considers only the first 72 *bytes*. Two distinct long passwords
        # sharing a 72-byte prefix would be interchangeable, so reject rather than
        # silently truncate. Bytes, not characters — a name in Devanagari is 3
        # bytes per character.
        if len(v.encode("utf-8")) > BCRYPT_MAX_BYTES:
            raise ValueError(f"password must be at most {BCRYPT_MAX_BYTES} bytes when UTF-8 encoded")
        return v


class LoginRequest(_Password):
    """Sign in with a username — `admin@navigo-sports`, `rahul.staff@navigo-sports`.

    Not `EmailStr`, and that is the point: a username's domain part is the tenant
    slug, so `admin@navigo-sports` has no dot in it and email validation rejects it
    outright. See auth/usernames.py.

    An email address is still accepted here, because accounts created before
    usernames existed have been signing in with one and must not be locked out on
    deploy. Resolution tries the username first — see
    auth/service.py::tenant_id_for_login.
    """

    username: str = Field(min_length=1, max_length=320)


class SignupRequest(_Password):
    """Self-serve registration. The turf's own details come later, in onboarding."""

    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = Field(description="Access token lifetime in seconds")


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    #: What this person signs in with. Shown on the Staff page, because "what is my
    #: username again" is the single most common thing an admin is asked.
    username: str
    #: Where their mail goes. Not the login — see auth/usernames.py.
    email: EmailStr
    full_name: str
    role: Role
    status: UserStatus
    phone: str | None = None
    avatar_initials: str | None = None
    shift: str | None = None
    joined_on: date | None = None
    last_login_at: datetime | None = None


class TenantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name: str
    status: str
    #: Which plan this academy pays for — `starter`, `growth`, `pro`. Set by
    #: self-serve signup from the plan that was actually charged (see
    #: modules/billing/service.fulfil) and defaulting to `starter` for the academies
    #: that predate it. Here rather than on a billing endpoint of its own because
    #: the shell needs it on boot to know which features to offer at all.
    plan_tier: str = "starter"
    #: False until the owner finishes the onboarding wizard. The frontend gates the
    #: whole dashboard on this, so it rides along on /auth/me rather than costing a
    #: second request on every boot. Reads Tenant.onboarding_completed.
    onboarding_completed: bool = False


class MeOut(BaseModel):
    """Everything the frontend shell needs on boot: who you are and whose app this is."""

    user: UserOut | None = None
    platform_admin: PlatformAdminOut | None = None
    tenant: TenantOut


class PlatformAdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    #: `ops@gamexo`. One account, across every academy on the platform.
    username: str
    email: EmailStr
    full_name: str
    is_active: bool


# ── Platform: tenant provisioning ───────────────────────────────────────────


class TenantAdminSeed(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)
    #: Optional. Omit it and one is generated and returned once in the response —
    #: which is what the operator console does, because a human inventing a password
    #: for somebody else's account produces a weaker one they then have to transmit
    #: anyway. Kept accepting an explicit value so scripted provisioning that already
    #: passes one is unaffected.
    password: str | None = Field(default=None, min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def _within_bcrypt_limit(cls, v: str | None) -> str | None:
        # Same reasoning as _Password: bcrypt reads only the first 72 bytes, so two
        # long passwords sharing a prefix would be interchangeable.
        if v is not None and len(v.encode("utf-8")) > BCRYPT_MAX_BYTES:
            raise ValueError(
                f"password must be at most {BCRYPT_MAX_BYTES} bytes when UTF-8 encoded"
            )
        return v


class CreateTenantRequest(BaseModel):
    """Onboard an academy: the tenant, its settings, and its first admin, atomically."""

    slug: str = Field(
        min_length=2,
        max_length=63,
        description="Subdomain label, e.g. 'myacademy' for myacademy.gamexo.app",
    )
    name: str = Field(min_length=1, max_length=200)
    admin: TenantAdminSeed
    business_name: str | None = None
    currency: str = Field(default="INR", min_length=3, max_length=3)
    timezone: str = "Asia/Kolkata"

    @field_validator("slug")
    @classmethod
    def _valid_slug(cls, v: str) -> str:
        # Mirrors the validator on the Tenant model. Duplicated deliberately: the
        # model check is the invariant (nothing writes a bad slug, ever), and this
        # one is the interface (the caller gets a 422 naming the field, rather than
        # an unhandled error from deep in the ORM).
        v = v.strip().lower()
        if not SLUG_PATTERN.match(v):
            raise ValueError(
                "slug must be a valid DNS label: lowercase letters, digits and hyphens, "
                "not starting or ending with a hyphen"
            )
        if v in RESERVED_SLUGS:
            raise ValueError(
                f"'{v}' is reserved for platform use and cannot be an academy subdomain"
            )
        return v


class CreateTenantResponse(BaseModel):
    tenant: TenantOut
    admin: UserOut
    #: The admin's generated password, returned exactly once and never stored in
    #: readable form. Present only when the operator did not choose one — see
    #: platform_router.create_tenant.
    admin_password: str | None = None
    #: The counter login created alongside the owner, same one-time rule.
    kiosk_username: str | None = None
    kiosk_password: str | None = None


# ── Platform: managing an academy after it exists ───────────────────────────


class UpdateTenantRequest(BaseModel):
    """Change an academy's standing or its plan. Both optional, at least one required.

    Deliberately narrow. An operator editing an academy's *name* or *slug* from here
    would be editing somebody else's business identity behind their back, and the
    slug is a DNS label other things point at. Those stay where they belong — inside
    the academy, where the audit trail names the person who did it.
    """

    status: TenantStatus | None = None
    plan_tier: PlanTier | None = None

    @model_validator(mode="after")
    def _at_least_one(self) -> UpdateTenantRequest:
        if self.status is None and self.plan_tier is None:
            raise ValueError("Provide status, plan_tier, or both.")
        return self


class ResetAdminPasswordRequest(BaseModel):
    """Reissue one academy account's password.

    `username` is optional and defaults to the academy's `admin@{slug}`, which is the
    account that actually goes missing: it is the one created by provisioning, the one
    the welcome email named, and the one nobody can reset for themselves because
    there is no self-serve reset flow yet.
    """

    username: str | None = None


class ChangePasswordRequest(BaseModel):
    """Replace your own password. Not anyone else's — see auth/router.py.

    `current_password` is required even though the caller is already authenticated.
    A bearer token proves the session was opened by this account at some point; it
    does not prove the person holding the laptop right now is the owner. Without
    this field an unattended dashboard is a permanent account takeover, and the
    account being protected is the one that can delete every booking in the academy.
    """

    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _within_bcrypt_limit(cls, v: str) -> str:
        # Same rule as _Password: bcrypt reads only the first 72 bytes, so two long
        # passwords sharing a prefix would be interchangeable.
        if len(v.encode("utf-8")) > BCRYPT_MAX_BYTES:
            raise ValueError(
                f"password must be at most {BCRYPT_MAX_BYTES} bytes when UTF-8 encoded"
            )
        return v

    @model_validator(mode="after")
    def _actually_a_change(self) -> ChangePasswordRequest:
        if self.current_password == self.new_password:
            raise ValueError("The new password must be different from the current one.")
        return self


class DeleteTenantRequest(BaseModel):
    """Hard-delete an academy. Irreversible, and it takes everything with it.

    `confirm_name` must equal the academy's own name, exactly. The dialog in the
    console asks the operator to type it, and the server checks it again rather than
    trusting that it did — a DELETE that only needs an id is one stray curl from an
    academy that no longer exists, and there is nothing to undo it with.
    """

    confirm_name: str = Field(min_length=1, max_length=200)


class DeleteTenantResponse(BaseModel):
    """What was destroyed. Mirrors the tombstone row left behind."""

    slug: str
    name: str
    deleted_at: datetime
    #: Rows removed per table, and only the tables that held any — the surviving
    #: measure of how much this actually was.
    row_counts: dict[str, int]


class ResetAdminPasswordResponse(BaseModel):
    """Shown once, in the browser, and never retrievable again.

    Returned in the response rather than emailed because the situation this exists
    for *is* email not arriving. The operator reads it out or pastes it into whatever
    channel they already have with the owner.
    """

    username: str
    password: str
    #: Where the credential would have been sent, so the operator can say "check
    #: this address" without opening the academy.
    email: EmailStr


MeOut.model_rebuild()
