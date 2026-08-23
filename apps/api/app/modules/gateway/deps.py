"""Authenticating an external platform.

Deliberately NOT part of auth/deps.py's Principal machinery. A partner is not a
person with a role, and `require_roles` must never be satisfiable by one: keeping
the two dependency trees separate means no future endpoint can accidentally admit
Playo by loosening a role guard.
"""

from __future__ import annotations

import hmac
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy import func, select

from app.core.errors import AuthenticationError
from app.modules.gateway.models import IntegrationPartner, hash_api_key, split_api_key
from app.tenancy.deps import Db

API_KEY_HEADER = "X-API-Key"


async def get_current_partner(
    db: Db,
    x_api_key: Annotated[str | None, Header(alias=API_KEY_HEADER)] = None,
) -> IntegrationPartner:
    """Resolve the platform behind this request, or refuse it.

    The tenant is already resolved (from the host, or the dev header) before this
    runs, and the query below is tenant-scoped by RLS. So a key issued by academy A
    presented on academy B's hostname finds nothing and is rejected — the same
    cross-tenant replay defence the JWT path gets from checking `tid`, arrived at
    here for free because the lookup itself cannot see other academies' rows.
    """
    if not x_api_key:
        raise AuthenticationError(f"Missing {API_KEY_HEADER}.")

    parts = split_api_key(x_api_key)
    if parts is None:
        raise AuthenticationError("Malformed API key.")
    prefix, _ = parts

    result = await db.execute(
        select(IntegrationPartner).where(IntegrationPartner.key_prefix == prefix)
    )
    partner = result.scalar_one_or_none()

    # One message for "no such prefix", "wrong secret" and "revoked". Distinguishing
    # them tells an attacker which half of a guessed key was right.
    if partner is None or not partner.is_active:
        raise AuthenticationError("Invalid or revoked API key.")

    # compare_digest, not `==`: string comparison short-circuits on the first
    # differing byte, which leaks how much of a forged hash was correct.
    if not hmac.compare_digest(partner.key_hash, hash_api_key(x_api_key)):
        raise AuthenticationError("Invalid or revoked API key.")

    # Coarse on purpose. This is "is the integration alive?", not an access log, and
    # writing a timestamp on every availability poll would make each read a write.
    # The audit trail proper is the booking rows and their events.
    now = datetime.now(UTC)
    if partner.last_used_at is None or (now - partner.last_used_at).total_seconds() > 300:
        partner.last_used_at = now

    return partner


CurrentPartner = Annotated[IntegrationPartner, Depends(get_current_partner)]


def speaking(dialect: str):
    """Refuse a key issued for a different dialect.

    A partner driving the wrong contract produces results that look almost right —
    a create that succeeds but prices differently, a cancel that 404s for a reason
    nobody can see — which is far worse to diagnose than a flat refusal. The key
    already says which contract they were onboarded onto, so this is free to check.

    Not a security boundary: both dialects reach the same core and are scoped to the
    same partner. It is a misconfiguration alarm.
    """

    async def dependency(partner: CurrentPartner) -> IntegrationPartner:
        if partner.dialect != dialect:
            raise AuthenticationError(
                f"This API key is registered for the {partner.dialect!r} integration, "
                f"not {dialect!r}. Use the matching base URL, or change the "
                "integration's dialect in the dashboard."
            )
        return partner

    return dependency


async def partner_by_slug(db: Db, slug: str) -> IntegrationPartner | None:
    """Case-insensitive lookup, matching the functional unique index on the table."""
    result = await db.execute(
        select(IntegrationPartner).where(func.lower(IntegrationPartner.slug) == slug.lower())
    )
    return result.scalar_one_or_none()
