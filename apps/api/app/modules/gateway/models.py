"""Third-party booking platforms — Playo, Hudle, and anyone else selling our courts.

The whole point of this module is that a court cannot be sold twice. That guarantee
does NOT live here: it is the `booking_no_overlap` exclusion constraint in
booking/models.py, which Postgres enforces regardless of which client is asking.
This module only gives an outside platform a way to read what is free and claim it,
under an identity we can revoke.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TenantScoped, TimestampMixin, UUIDPrimaryKeyMixin

#: Length of the public, non-secret half of an API key. Long enough to identify one
#: key among an academy's handful, short enough to paste into a support ticket.
KEY_PREFIX_LENGTH = 12


class IntegrationPartner(TenantScoped):
    """One external platform, holding one API key, scoped to one academy.

    ── On hashing with SHA-256 rather than bcrypt ──────────────────────────────
    Passwords need a deliberately slow hash because humans pick guessable ones, so
    the defence is making each guess expensive. An API key is 32 bytes from
    `secrets.token_urlsafe` — there is no dictionary to try, and brute force is
    already infeasible. What matters instead is speed: this hash is computed on
    EVERY gateway request, and bcrypt at cost 12 (~250ms, see core/security.py)
    would add a quarter-second to every availability poll. SHA-256 is the right
    tool for a high-entropy secret.

    The stored value is still a hash, not the key: a leaked database must not hand
    someone a working credential for every academy's Playo integration.
    """

    __tablename__ = "integration_partner"
    __table_args__ = (
        # One integration per platform per academy. Functional lower() index for the
        # same reason app_user uses one: "Playo" and "playo" must not both exist.
        Index("uq_partner_tenant_slug", "tenant_id", text("lower(slug)"), unique=True),
        # Globally unique, not per-tenant: the prefix is how an inbound key is looked
        # up, and that lookup must resolve to exactly one row. A collision across two
        # academies would make authentication ambiguous.
        Index("uq_partner_key_prefix", "key_prefix", unique=True),
    )

    #: Shown to staff. "Playo"
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    #: Machine-readable, and the value stamped onto every booking this partner makes
    #: as `Booking.source_platform`. "playo"
    slug: Mapped[str] = mapped_column(String(50), nullable=False)

    key_prefix: Mapped[str] = mapped_column(String(32), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    #: Which wire format this partner speaks — a key in `gateway.dialects.DIALECTS`.
    #: `native` is our own contract and the answer for anyone without a spec of
    #: their own; `playo` is theirs, which they dictate.
    #:
    #: A plain string rather than an enum: the set of dialects is a code-level
    #: registry, and adding a partner should never need a migration. Validated
    #: against the registry when a partner is created.
    dialect: Mapped[str] = mapped_column(String(50), default="native", nullable=False)

    #: The id the partner knows this venue by, echoed back in every Playo request as
    #: `venueId`. Optional: it only exists once an integration has been set up on
    #: their side, and our own gateway does not use it at all.
    #:
    #: Checked rather than trusted. The API key already establishes which academy is
    #: being addressed, so this is a second, independent assertion of the same fact —
    #: and a mismatch means someone has pointed a venue's configuration at the wrong
    #: key, which would otherwise write one academy's bookings into another's diary.
    external_venue_id: Mapped[str | None] = mapped_column(String(120))

    #: Whether this key is assumed to be public.
    #:
    #: `secret` is a key that lives on a partner's server and can do everything the
    #: contract allows. `publishable` is a key that lives in a *browser* — a partner
    #: with no backend has nowhere else to put it — and is therefore readable by
    #: anyone who opens devtools.
    #:
    #: The distinction is not cosmetic and it is not a trust level: it is an
    #: admission that the credential is public, and the endpoints it may reach are
    #: narrowed to match. See `SCOPES` below and `deps.py::publishable_allows`.
    key_kind: Mapped[str] = mapped_column(String(16), default="secret", nullable=False)

    #: Origins allowed to call with this key, for a browser to get a response at all.
    #:
    #: **Functional, not a security control.** Without a matching
    #: `Access-Control-Allow-Origin` the browser discards our reply and the
    #: integration simply does not work; with one, anybody who is not using a
    #: browser is entirely unaffected, because `Origin` is a header and headers are
    #: typed by whoever is sending them. It stops a stolen key being used from
    #: another *website*, which is worth something, and nothing more than that.
    allowed_origins: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)

    #: Revocation. Deactivating is preferred over deleting: the bookings a partner
    #: made outlive the integration, and their `created_by_partner_id` must still
    #: resolve to a name months later when someone asks where a booking came from.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    #: Answers "is this integration actually live?" without trawling logs — the first
    #: question asked when a partner reports that bookings have stopped arriving.
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PartnerKeyDirectory(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """key prefix -> academy, so a partner call can find its tenant before one is resolved.

    The same exception, for the same reason, as `AccountDirectory`. A platform has
    no login and no per-academy subdomain, so on a shared origin nothing tells us
    which academy a gateway request is for — and `integration_partner` is invisible
    to an unbound session, because RLS evaluates `tenant_id = NULL` and matches
    zero rows. Something outside the policy has to answer "which academy owns this
    key prefix", and this is the smallest such thing.

    Deliberately NOT TenantScoped and carrying no RLS policy.

    Nothing here is secret. `key_prefix` is the *public* half of the key — it is
    printed in logs and bug reports on purpose (see `generate_api_key`) — and
    `tenant_id` is opaque. The secret half never appears, so a leak of this table
    discloses which integrations exist, not how to use one. Authentication still
    happens afterwards in `deps.get_current_partner`, against the hashed secret on
    a row read *inside* the resolved tenant.

    Kept in step by a database trigger rather than by application code. Four places
    change a prefix — create, rotate, re-point, delete — and a mirror that depends
    on all four remembering is a mirror that will eventually be wrong; the failure
    mode is a live integration that cannot resolve its academy, which reads as an
    outage.
    """

    __tablename__ = "partner_key_directory"

    key_prefix: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("tenant.id", ondelete="CASCADE"), nullable=False
    )
    #: Mirrored too, so routing and tenant resolution are one read rather than two.
    dialect: Mapped[str] = mapped_column(String(50), nullable=False)
    #: Mirrored for the same reason: CORS headers have to be decided before any
    #: tenant is bound, and re-reading the scoped table to get them is impossible.
    allowed_origins: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)


def generate_api_key(slug: str, *, kind: str = "secret") -> tuple[str, str, str]:
    """Mint a key. Returns `(full_key, prefix, hash)`.

    The full key is returned to the caller exactly once, at creation, and is never
    recoverable afterwards — only its hash is stored. Rotation issues a new one.

    The slug is embedded in the readable part so a key found in a partner's config
    file, or pasted into a bug report, identifies itself without a database lookup.

    A publishable key leads with `gxp_` rather than `gx_`, so the two are told apart
    on sight. That is the point: a secret key pasted into frontend code is the
    mistake this whole distinction exists to prevent, and it should be obvious in a
    diff, a log line or a screenshot — not only after someone checks the database.
    """
    secret = secrets.token_urlsafe(32)
    lead = "gxp" if kind == "publishable" else "gx"
    prefix = f"{lead}_{slug[:8]}_{secrets.token_hex(4)}"[:KEY_PREFIX_LENGTH + 12]
    full_key = f"{prefix}.{secret}"
    return full_key, prefix, hash_api_key(full_key)


def hash_api_key(full_key: str) -> str:
    """SHA-256 hex of the whole key, prefix included.

    Hashing the full string rather than just the secret half means a tampered prefix
    produces a different hash, so a key cannot be replayed against another row by
    editing the part that is used for lookup.
    """
    return hashlib.sha256(full_key.encode("utf-8")).hexdigest()


def split_api_key(full_key: str) -> tuple[str, str] | None:
    """`(prefix, secret)`, or None if this is not shaped like one of our keys.

    Returning None rather than raising: the input is an unauthenticated request
    header, and malformed values are the normal case for scanners and typos, not an
    exceptional one.
    """
    prefix, _, secret = full_key.strip().partition(".")
    if not prefix or not secret:
        return None
    return prefix, secret
