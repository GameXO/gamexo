"""Request/response schemas for auth. These shape the OpenAPI the frontend consumes."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.security import BCRYPT_MAX_BYTES, Role
from app.models.tenant import RESERVED_SLUGS, SLUG_PATTERN
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
    email: EmailStr


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
    email: EmailStr
    full_name: str
    is_active: bool


# ── Platform: tenant provisioning ───────────────────────────────────────────


class TenantAdminSeed(_Password):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)


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


MeOut.model_rebuild()
