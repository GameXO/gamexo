"""Password hashing and JWT minting/verification.

Hand-rolled rather than delegated to fastapi-users: its UserManager owns session
acquisition and user lookup, which is precisely the seam where tenant_id has to be
injected. Keeping it explicit is ~150 lines and leaves the tenant-scoped session
visible instead of behind a library's abstraction.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any, Literal

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings

# bcrypt considers only the first 72 *bytes* of a password. Enforced at the schema
# layer (auth/schemas.py) rather than discovered at hash time.
BCRYPT_MAX_BYTES = 72

# Cost factor. 12 is ~250ms on current hardware — deliberately slow, since the whole
# point is to make offline cracking of a leaked table expensive.
BCRYPT_ROUNDS = 12

# NOTE ON THE LIBRARY CHOICE
# The plan specified passlib[bcrypt]. passlib 1.7.4 (last released 2020) is broken
# against bcrypt >= 5: initialising its bcrypt backend runs an internal "wrap bug"
# probe that hashes a >72-byte password, which modern bcrypt raises on instead of
# truncating. The failure is at import/first-use, not a deprecation warning — no
# password can be hashed at all. The alternative was pinning bcrypt back to <4.1
# (2022) to satisfy an unmaintained wrapper, which is the wrong direction for a
# credential library.
#
# This is the same algorithm and the same $2b$ hash format passlib would produce,
# so stored hashes stay compatible if passlib is ever revived or swapped in.


class Role(StrEnum):
    """Tenant-scoped roles. admin/manager/reception mirror the Staff page exactly.

    KIOSK is not a person — it is the shared login on the walk-in counter tablet,
    which is physically reachable by anyone standing in front of it. It sits BELOW
    reception on purpose: everything the dashboard exposes (revenue reports, the
    staff list, settings, membership plans) is guarded at reception and above, so
    the counter device cannot read the business out of the API even though it holds
    a valid token for the academy.
    """

    ADMIN = "admin"
    MANAGER = "manager"
    RECEPTION = "reception"
    #: Reads and records the money side — fees, dues, payroll — at the front-desk
    #: level for everything else. Not a rung *above* reception: an accountant has no
    #: business editing a coach or a plan, so the extra reach is granted by name
    #: (see `auth.deps.RequirePayroll`), not by sitting higher in the ladder.
    ACCOUNTANT = "accountant"
    #: A coach's own login. Sits *below* the counter tablet: the tablet takes walk-in
    #: bookings and payments, which are not a coach's job. A coach reaches only the
    #: register endpoints (guarded `RequireRegister`) and their own workspace under
    #: `/academy/me` — nothing that lists the academy's students, fees or staff.
    COACH = "coach"
    KIOSK = "kiosk"


# Ordered most- to least-privileged. `require_roles` treats a higher role as
# satisfying a requirement for a lower one, so an admin never gets 403'd from a
# reception endpoint.
#
# KIOSK is the floor. Guarding an endpoint at KIOSK admits everyone; guarding at
# RECEPTION is what actually excludes the counter tablet. The gap between 10 and 5
# is deliberate — a future "read-only display" role slots in at 7 without renumbering.
ROLE_HIERARCHY: dict[Role, int] = {
    Role.ADMIN: 30,
    Role.MANAGER: 20,
    Role.RECEPTION: 10,
    Role.ACCOUNTANT: 10,
    Role.COACH: 4,
    Role.KIOSK: 5,
}


class Audience(StrEnum):
    """Token audience.

    A tenant user's token and a platform operator's token are not interchangeable.
    Encoding that in `aud` means a stolen tenant token cannot be replayed against
    the platform endpoints even if the roles happened to line up.
    """

    TENANT = "gamexo:tenant"
    PLATFORM = "gamexo:platform"


TokenType = Literal["access", "refresh"]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(
        password.encode("utf-8"), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)
    ).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    """Constant-time comparison against a stored hash.

    Returns False rather than raising on a malformed or over-long input: both are
    reachable from unauthenticated request bodies, and a 500 there is both a poor
    experience and an oracle telling an attacker their input was unusual.
    """
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False


def _create_token(
    *,
    subject: str,
    audience: Audience,
    token_type: TokenType,
    expires_delta: timedelta,
    claims: dict[str, Any] | None = None,
) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": subject,
        "aud": audience.value,
        "typ": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_delta).timestamp()),
        "jti": str(uuid.uuid4()),
        **(claims or {}),
    }
    return jwt.encode(
        payload,
        settings.jwt_secret_key.get_secret_value(),
        algorithm=settings.jwt_algorithm,
    )


def create_access_token(
    *, subject: str, audience: Audience, claims: dict[str, Any] | None = None
) -> str:
    return _create_token(
        subject=subject,
        audience=audience,
        token_type="access",
        expires_delta=timedelta(minutes=settings.access_token_ttl_minutes),
        claims=claims,
    )


def create_refresh_token(
    *, subject: str, audience: Audience, claims: dict[str, Any] | None = None
) -> str:
    return _create_token(
        subject=subject,
        audience=audience,
        token_type="refresh",
        expires_delta=timedelta(days=settings.refresh_token_ttl_days),
        claims=claims,
    )


class TokenError(Exception):
    """Raised for any token that fails to decode, verify, or match expectations."""


def decode_token(
    token: str, *, audience: Audience, expected_type: TokenType = "access"
) -> dict[str, Any]:
    """Decode and fully verify a token.

    Verifies signature, expiry and audience. Rejects a refresh token presented
    where an access token is expected — without the `typ` check, a long-lived
    refresh token would work as a bearer credential for the whole API.
    """
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            audience=audience.value,
        )
    except JWTError as exc:
        raise TokenError(str(exc)) from exc

    if payload.get("typ") != expected_type:
        raise TokenError(f"expected a {expected_type} token, got {payload.get('typ')!r}")

    return payload
