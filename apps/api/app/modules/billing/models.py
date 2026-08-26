"""A signup in progress — everything collected before there is a tenant to own it.

── Why this table exists ───────────────────────────────────────────────────────
The wizard on the marketing site asks for a business name, a logo, a list of sports
and a set of POS services, and only then asks for money. None of that can live on
`tenant_settings`, because the whole design decision here is that **no academy is
created until a payment succeeds**. An abandoned checkout must leave nothing behind
but a row in this table; it must never leave a half-built academy that a support
person has to recognise and delete.

So the wizard writes here, the Razorpay order is raised against this row, and
`service.fulfil` reads it once — turning it into a tenant, an admin, a password and
an email, atomically. After that the row is a receipt.

── Not TenantScoped, deliberately ──────────────────────────────────────────────
It cannot be. It is written by an anonymous browser, before any tenant exists to
bind a session to; there is no tenant_id to filter on and no RLS policy that could
be written. It joins `tenant`, `platform_admin` and `account_directory` in
`tests/test_tenant_isolation.py::UNSCOPED_TABLES`, which asserts that this is a
decision somebody made rather than a model that forgot its base class.

What stands in for RLS is the token: `SignupIntent.token` is a 32-byte random
string, it is the only way to address a row, and it is what the browser holds.
Guessing one is the same problem as guessing a session id.

── What is *not* stored here ───────────────────────────────────────────────────
The admin's password. It is generated at fulfilment, hashed into `app_user`, put in
one email, and never written anywhere else — so this table, which is reachable by a
token in a URL, is not a place a password could leak from.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.types import enum_type

__all__ = ["SignupIntent", "SignupStatus"]


class SignupStatus(StrEnum):
    """Where a signup has got to.

    Only `COMPLETED` means an academy exists. The state machine is deliberately
    one-way — see `service.fulfil`, which refuses to run twice.
    """

    #: The wizard is open. Answers are being saved as the owner moves between steps.
    DRAFT = "draft"
    #: A plan is chosen and a Razorpay order is raised. Nothing is paid yet.
    AWAITING_PAYMENT = "awaiting_payment"
    #: Payment confirmed, provisioning in flight. A transient state that exists so a
    #: webhook and a browser callback arriving together cannot both provision.
    PROVISIONING = "provisioning"
    #: Tenant, admin and email all done. Terminal.
    COMPLETED = "completed"
    #: Payment confirmed but provisioning raised. Terminal until someone looks —
    #: the money is real, so this must never be silently retried into a second
    #: academy for the same payment.
    FAILED = "failed"


class SignupIntent(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "signup_intent"
    __table_args__ = (
        # The browser's handle on its own signup. Unique because it is the address.
        Index("uq_signup_intent_token", "token", unique=True),
        # Razorpay's order id, looked up by the webhook — which knows the order and
        # nothing else. Not unique: a failed payment can be retried against a new
        # order on the same intent, and the previous id stays on the row it belongs
        # to only until it is overwritten. See service.start_checkout.
        Index("ix_signup_intent_order_id", "order_id"),
        # "Has this email already started?" on every wizard entry, and the lookup
        # that lets someone resume rather than start a second signup.
        Index("ix_signup_intent_email", "email"),
        # Redeeming a handoff looks a row up by this hash and has no other predicate
        # to lean on — see `service.redeem_handoff`.
        Index("ix_signup_intent_handoff_token_hash", "handoff_token_hash"),
    )

    #: Opaque bearer capability — `secrets.token_urlsafe(32)`. See the module note.
    token: Mapped[str] = mapped_column(String(64), nullable=False)

    status: Mapped[SignupStatus] = mapped_column(
        enum_type(SignupStatus, name="signup_status"),
        default=SignupStatus.DRAFT,
        nullable=False,
    )

    # ── Who is signing up ────────────────────────────────────────────────────
    #
    # Lowercased on write. This becomes the admin's login, and it is checked against
    # `account_directory` at both ends of the flow: once when the wizard starts, so
    # a taken address fails before anyone pays, and again inside the provisioning
    # transaction, which is the check that is actually authoritative.
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(32))

    # ── What the wizard collected ────────────────────────────────────────────
    business_name: Mapped[str | None] = mapped_column(String(200))
    logo_url: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(120))
    address: Mapped[str | None] = mapped_column(Text)
    #: `[{"slug": "badminton", "name": null}, …]` — the shape onboarding takes.
    sports: Mapped[list[Any]] = mapped_column(JSONB, default=list, nullable=False)
    #: `{"checkin": true, "membership": false, …}` over SERVICE_KEYS.
    services: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)
    #: When the Terms & Conditions box was ticked. A timestamp rather than a boolean
    #: because the question a dispute asks is "when did they agree", not "did they".
    accepted_terms_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # ── The money ────────────────────────────────────────────────────────────
    plan_code: Mapped[str | None] = mapped_column(String(50))
    billing_period: Mapped[str | None] = mapped_column(String(16))
    #: Snapshotted at order time, in paise. Never recomputed from `plans.py` after
    #: that: the price list is editable, and what was charged must stay what was
    #: charged even if the catalogue moves underneath.
    amount_paise: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)

    #: `razorpay` or `mock`. Stored so a row provisioned on a laptop is visibly not
    #: a row somebody paid for.
    provider: Mapped[str | None] = mapped_column(String(32))
    order_id: Mapped[str | None] = mapped_column(String(128))
    payment_id: Mapped[str | None] = mapped_column(String(128))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: Which side confirmed the payment first — `webhook` or `callback`. Purely for
    #: diagnosis: if this is always `callback`, the webhook is not reaching us and
    #: signups will start failing the moment a browser is closed too early.
    confirmed_via: Mapped[str | None] = mapped_column(String(16))

    # ── The result ───────────────────────────────────────────────────────────
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True),
        # RESTRICT everywhere else in this schema; here the intent is a receipt for
        # a tenant, and an offboarded tenant should not be un-deletable because of
        # one. SET NULL keeps the payment record and drops the dangling pointer.
        ForeignKey("tenant.id", ondelete="SET NULL"),
    )
    credentials_emailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: Why fulfilment failed, for the operator who has to refund or finish it by hand.
    last_error: Mapped[str | None] = mapped_column(Text)

    # ── The handoff into the dashboard ───────────────────────────────────────
    #
    # Only the SHA-256 is stored. The token itself is returned once, travels in a URL
    # to the dashboard, and is exchanged for a real token pair — so a leaked database
    # yields nothing that can be redeemed. Short-lived and single-use; see
    # `service.redeem_handoff`.
    handoff_token_hash: Mapped[str | None] = mapped_column(String(64))
    handoff_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    handoff_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def is_paid(self) -> bool:
        return self.paid_at is not None

    def __repr__(self) -> str:
        return f"<SignupIntent {self.email} {self.status}>"
