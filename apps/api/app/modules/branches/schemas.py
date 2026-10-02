"""Pydantic schemas for branches."""

from __future__ import annotations

import re
import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

ORM = ConfigDict(from_attributes=True)

# Format only — 2-digit state code, 10-char PAN, entity digit, 'Z', checksum. Whether
# the number is *registered* is the tax portal's business; this exists so a typo like
# a dropped digit is caught at the form instead of printed on a tax invoice.
GSTIN_PATTERN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")

_OPTIONAL_TEXT = ("address", "city", "state", "pincode", "phone", "gstin")


def _blank_to_none(value: object) -> object:
    """An empty form field arrives as "" and means "nothing", not an empty string."""
    if isinstance(value, str):
        value = value.strip()
        return value or None
    return value


def _check_gstin(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.upper()
    if not GSTIN_PATTERN.match(value):
        raise ValueError("GSTIN must be 15 characters, e.g. 36AABCN1234K1Z9")
    return value


class BranchBase(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    address: str | None = None
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    pincode: str | None = Field(default=None, max_length=12)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    gstin: str | None = Field(
        default=None,
        max_length=20,
        description="Leave empty to print the academy's own GSTIN from Settings.",
    )

    @field_validator("name", "email", *_OPTIONAL_TEXT, mode="before")
    @classmethod
    def _clean(cls, v: object) -> object:
        return _blank_to_none(v) if v is not None else v

    @field_validator("gstin")
    @classmethod
    def _gstin_shape(cls, v: str | None) -> str | None:
        return _check_gstin(v)


class BranchCreate(BranchBase):
    pass


class BranchUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    address: str | None = None
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=120)
    pincode: str | None = Field(default=None, max_length=12)
    phone: str | None = Field(default=None, max_length=32)
    email: EmailStr | None = None
    gstin: str | None = Field(default=None, max_length=20)
    is_active: bool | None = None
    is_default: bool | None = None

    @field_validator("name", "email", *_OPTIONAL_TEXT, mode="before")
    @classmethod
    def _clean(cls, v: object) -> object:
        return _blank_to_none(v) if v is not None else v

    @field_validator("gstin")
    @classmethod
    def _gstin_shape(cls, v: str | None) -> str | None:
        return _check_gstin(v)


class BranchOut(BaseModel):
    model_config = ORM

    id: uuid.UUID
    name: str
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    phone: str | None = None
    email: str | None = None
    gstin: str | None = None
    #: What actually prints on this branch's invoices: its own GSTIN, or the academy's
    #: when it has none. Read-only. The counter tablet cannot read `/settings`, so
    #: without this it could not show a GSTIN for a branch that inherits one.
    effective_gstin: str | None = None
    is_default: bool
    is_active: bool


class BranchInfo(BaseModel):
    """A branch as it prints on a bill.

    Carried inside booking and invoice responses so the POS and the dashboard render
    the issuing site from the server's own record instead of a constant baked into the
    bundle. `gstin` is already resolved: the branch's own when it has one, otherwise
    the academy's — a client never has to know there was a fallback.
    """

    model_config = ORM

    id: uuid.UUID
    name: str
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    phone: str | None = None
    email: str | None = None
    gstin: str | None = None
