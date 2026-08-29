"""Authentication and RBAC dependencies."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Annotated, Any, Callable, Literal

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AuthenticationError, PermissionDeniedError
from app.core.security import (
    ROLE_HIERARCHY,
    Audience,
    Role,
    TokenError,
    decode_token,
)
from app.models.user import PlatformAdmin, User
from app.tenancy.context import TenantContext
from app.tenancy.deps import BearerToken, Db, TenantCtx, UntenantedDb


@dataclass(frozen=True, slots=True)
class Principal:
    """Whoever is making this request — a staff member or a platform operator."""

    id: uuid.UUID
    kind: Literal["user", "platform_admin"]
    email: str
    tenant_id: uuid.UUID | None
    role: Role | None
    user: User | None = None

    @property
    def is_platform_admin(self) -> bool:
        return self.kind == "platform_admin"

    @property
    def actor_label(self) -> str:
        return self.email


# ── Identity snapshot cache ─────────────────────────────────────────────────
#
# Authorising a request needs id, email, role and "is this account still usable".
# That was a SELECT per request. Cached briefly instead — see the note in
# get_current_principal for the security trade-off this buys and what it costs.

_IDENTITY_TTL_SECONDS = 30.0


@dataclass(frozen=True, slots=True)
class _Identity:
    id: uuid.UUID
    email: str
    tenant_id: uuid.UUID | None
    role: Role | None
    #: Compared against the token's `ver` claim on every request. Cached alongside
    #: the rest of the snapshot, so a password change is only guaranteed to evict
    #: other sessions once the TTL lapses in each worker process — `revoke_identity`
    #: makes it immediate in the process that handled the change.
    token_version: int = 1


# (tenant_id, user_id) -> (expires_at, identity). Keyed on the tenant too so a
# cached identity can never satisfy a request resolved to a different academy.
_identities: dict[tuple[uuid.UUID, uuid.UUID], tuple[float, _Identity]] = {}


def _identity_get(tenant_id: uuid.UUID, user_id: uuid.UUID) -> _Identity | None:
    entry = _identities.get((tenant_id, user_id))
    if entry is None:
        return None
    expires_at, identity = entry
    if expires_at < time.monotonic():
        _identities.pop((tenant_id, user_id), None)
        return None
    return identity


def _identity_put(tenant_id: uuid.UUID, identity: _Identity) -> None:
    _identities[(tenant_id, identity.id)] = (
        time.monotonic() + _IDENTITY_TTL_SECONDS,
        identity,
    )


def revoke_identity(tenant_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Force the next request from this user to re-read the row.

    Call from anything that deactivates, deletes or re-roles a staff member, so the
    change lands on the next request instead of within the TTL.
    """
    _identities.pop((tenant_id, user_id), None)


def clear_identity_cache() -> None:
    """Drop every cached identity.

    For tests, which truncate the database between cases: process-local caches
    outlive a TRUNCATE and would otherwise answer for rows that no longer exist.
    """
    _identities.clear()


def _assert_current_version(payload: dict[str, Any], snapshot: _Identity) -> None:
    """Refuse a token minted before the account's last password change.

    The claim is compared, not merely required, so a token from *any* earlier
    version is refused rather than only the immediately preceding one.

    A token with no `ver` at all predates this mechanism and is refused too — the
    alternative, treating a missing claim as "fine", would let anyone strip the claim
    to opt out of the check. That does sign everyone out once, at the deploy that
    adds the column, which is the correct trade and is noted in the migration.
    """
    if payload.get("ver") != snapshot.token_version:
        raise AuthenticationError(
            "Your password was changed. Please sign in again."
        )


async def load_user(session: AsyncSession, principal: Principal) -> User:
    """The full ORM row for a principal, fetched only if it is not already loaded.

    `Principal.user` is populated on the request that filled the identity cache and
    None on the ones served from it, so anything needing the whole row — rather than
    just id/email/role — goes through here.
    """
    if principal.user is not None:
        return principal.user
    result = await session.execute(select(User).where(User.id == principal.id))
    user = result.scalar_one_or_none()
    if user is None:
        raise AuthenticationError("This account no longer exists.")
    return user


async def _load_platform_admin(session: AsyncSession, admin_id: uuid.UUID) -> PlatformAdmin:
    """Fetch a platform operator.

    Works on a tenant-bound session because `platform_admin` carries no tenant_id
    and therefore no RLS policy — it is one of exactly two such tables.
    """
    result = await session.execute(select(PlatformAdmin).where(PlatformAdmin.id == admin_id))
    admin = result.scalar_one_or_none()
    if admin is None or not admin.is_active:
        raise AuthenticationError("This platform account is no longer active.")
    return admin


async def get_current_principal(
    tenant: TenantCtx, db: Db, credentials: BearerToken = None
) -> Principal:
    """Authenticate the caller against the already-resolved tenant."""
    if credentials is None:
        raise AuthenticationError("Not authenticated.")

    token = credentials.credentials

    # Platform operators first: their token has a different audience, so this is a
    # cheap, unambiguous discrimination rather than a guess.
    try:
        payload = decode_token(token, audience=Audience.PLATFORM)
    except TokenError:
        pass
    else:
        admin = await _load_platform_admin(db, uuid.UUID(payload["sub"]))
        return Principal(
            id=admin.id,
            kind="platform_admin",
            email=admin.email,
            tenant_id=tenant.id,
            role=None,
        )

    try:
        payload = decode_token(token, audience=Audience.TENANT)
    except TokenError as exc:
        raise AuthenticationError(f"Invalid or expired token: {exc}") from exc

    claimed_tenant = payload.get("tid")

    # The check the whole design rests on. The tenant was resolved from the host
    # (or the dev header) *independently* of this token. If a token minted for
    # academy A arrives on academy B's hostname, both values exist and disagree,
    # and the request is refused. Trusting `tid` as the selector instead would make
    # exactly that replay indistinguishable from normal traffic.
    if claimed_tenant != str(tenant.id):
        raise PermissionDeniedError(
            "This token was issued for a different academy.",
            details={"resolved_tenant": tenant.slug},
        )

    user_id = uuid.UUID(payload["sub"])

    # Most endpoints only need id/email/role to authorise. Re-reading the row for
    # every request costs a round trip that is invisible on localhost and ~45 ms
    # across an ocean, so a short-lived identity snapshot stands in.
    #
    # The trade-off, stated plainly: deactivating or deleting an account takes up
    # to _IDENTITY_TTL_SECONDS to take effect on an already-issued token. That is
    # why the TTL is seconds rather than minutes, and why `revoke_identity` exists
    # for the paths that must be immediate.
    snapshot = _identity_get(tenant.id, user_id)
    if snapshot is None:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user is None:
            # RLS also guarantees a user from another tenant is invisible here, so
            # this covers deletion and cross-tenant lookup alike.
            raise AuthenticationError("This account no longer exists.")
        if not user.is_active:
            raise AuthenticationError(f"This account is {user.status.value}.")
        snapshot = _Identity(
            id=user.id,
            email=user.email,
            tenant_id=user.tenant_id,
            role=user.role,
            token_version=user.token_version,
        )
        _identity_put(tenant.id, snapshot)
        _assert_current_version(payload, snapshot)
        # `user` is handed on so handlers needing the ORM object still get it
        # without a second read on the request that populated the cache.
        return Principal(
            id=user.id,
            kind="user",
            email=user.email,
            tenant_id=user.tenant_id,
            role=user.role,
            user=user,
        )

    _assert_current_version(payload, snapshot)
    return Principal(
        id=snapshot.id,
        kind="user",
        email=snapshot.email,
        tenant_id=snapshot.tenant_id,
        role=snapshot.role,
        user=None,
    )


CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]


def require_roles(*allowed: Role) -> Callable[[Principal], Principal]:
    """Guard an endpoint behind one or more tenant roles.

    Roles are hierarchical: requiring RECEPTION admits MANAGER and ADMIN too. Flat
    role sets mean every new admin-facing endpoint has to remember to list all three,
    and the one that forgets locks the owner out of their own academy.

    Platform operators pass every guard. That is the point of the role — they are
    acting on a tenant's behalf for support — and every such request is audited.
    """
    required = min(ROLE_HIERARCHY[role] for role in allowed)

    def dependency(principal: CurrentPrincipal) -> Principal:
        if principal.is_platform_admin:
            return principal
        if principal.role is None or ROLE_HIERARCHY[principal.role] < required:
            raise PermissionDeniedError(
                "Your role does not permit this action.",
                details={
                    "required": sorted(role.value for role in allowed),
                    "actual": principal.role.value if principal.role else None,
                },
            )
        return principal

    return dependency


RequireAdmin = Annotated[Principal, Depends(require_roles(Role.ADMIN))]
RequireManager = Annotated[Principal, Depends(require_roles(Role.MANAGER))]
RequireStaff = Annotated[Principal, Depends(require_roles(Role.RECEPTION))]

#: The counter tablet, and everyone above it. Use this ONLY on endpoints the POS
#: genuinely needs — it is the weakest guard in the system, and the shared kiosk
#: login is the most exposed credential in the academy.
#:
#: The decision of which endpoints carry this is the whole of the kiosk's blast
#: radius: anything left at RequireStaff is invisible to the tablet. When adding an
#: endpoint, default to RequireStaff and move it down only if the POS breaks.
RequireKiosk = Annotated[Principal, Depends(require_roles(Role.KIOSK))]


async def get_current_platform_admin(
    db: UntenantedDb, credentials: BearerToken = None
) -> PlatformAdmin:
    """Authenticate a platform operator on an endpoint with no tenant at all.

    Used by /platform/* (listing and creating tenants), which by definition cannot
    resolve a tenant from the host.
    """
    if credentials is None:
        raise AuthenticationError("Not authenticated.")
    try:
        payload = decode_token(credentials.credentials, audience=Audience.PLATFORM)
    except TokenError as exc:
        raise AuthenticationError(f"Invalid or expired platform token: {exc}") from exc

    return await _load_platform_admin(db, uuid.UUID(payload["sub"]))


CurrentPlatformAdmin = Annotated[PlatformAdmin, Depends(get_current_platform_admin)]


def tenant_context_of(principal: Principal, tenant: TenantContext) -> TenantContext:
    """Convenience for audit writes."""
    del principal
    return tenant
