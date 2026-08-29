"""Tenant-scoped auth: login, refresh, me."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.audit import write_audit
from app.auth.deps import CurrentPrincipal, RequireAdmin, load_user, revoke_identity
from app.auth.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    MeOut,
    PlatformAdminOut,
    RefreshRequest,
    SignupRequest,
    TenantOut,
    TokenPair,
    UserOut,
)
from app.auth.service import (
    access_token_ttl_seconds,
    authenticate_user,
    issue_user_tokens,
    resolve_login_tenant,
    signup_tenant,
)
from app.core.errors import AuthenticationError, PermissionDeniedError
from app.core.security import Audience, TokenError, decode_token, hash_password, verify_password
from app.db.session import bind_session_to
from app.models.audit import ActorKind
from app.models.tenant import Tenant
from app.models.user import PlatformAdmin, User
from app.modules.billing import service as billing_service
from app.tenancy.deps import Db, OptionalTenantCtx, TenantCtx, UntenantedDb
from app.tenancy.resolver import assert_tenant_usable

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/signup",
    response_model=TokenPair,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new turf",
    description=(
        "Self-serve registration. Creates the academy, its default settings and its "
        "first admin in one transaction, and signs the owner straight in.\n\n"
        "The academy has no name yet — onboarding collects that — so it is created "
        "under a placeholder slug with `onboarding_completed` false, which is what "
        "routes the new owner into the wizard rather than the dashboard.\n\n"
        "The email must be unused across the whole platform; see "
        "`models/user.py::AccountDirectory` for why login emails are globally unique."
    ),
)
async def signup(payload: SignupRequest, db: UntenantedDb, request: Request) -> TokenPair:
    # TODO: unauthenticated and cheap to call in a loop. Before this is public,
    # put a per-IP rate limit in front of it — an attacker cannot read anything,
    # but they can fill the tenant table and burn bcrypt rounds.
    tenant, admin = await signup_tenant(
        db,
        email=payload.email,
        password=payload.password,
        full_name=payload.full_name,
    )

    # signup_tenant leaves the transaction bound to the new tenant, so this
    # tenant-scoped audit row is insertable and lands in the same commit.
    await write_audit(
        db,
        tenant_id=tenant.id,
        action="tenant.signed_up",
        actor_kind=ActorKind.USER,
        actor_id=admin.id,
        actor_label=admin.email,
        entity_type="tenant",
        entity_id=tenant.id,
        changes={"after": {"slug": tenant.slug}},
        request=request,
    )

    access, refresh = issue_user_tokens(admin)
    return TokenPair(
        access_token=access, refresh_token=refresh, expires_in=access_token_ttl_seconds()
    )


@router.post(
    "/login",
    response_model=TokenPair,
    summary="Log in as academy staff",
    description=(
        "Sign in with a **username** — `admin@navigo-sports`, "
        "`rahul.staff@navigo-sports`, `kiosk@navigo-sports`. The part after the `@` "
        "is the academy's slug, not a domain; see `auth/usernames.py`.\n\n"
        "Authenticates against the academy resolved from the request host (or "
        "`X-Tenant-ID` in development). When the request names no academy — the "
        "shared-origin deployment, where every turf answers on one hostname — the "
        "academy is looked up from the username instead.\n\n"
        "An email address is still accepted, so accounts created before usernames "
        "existed keep working."
    ),
)
async def login(
    payload: LoginRequest, tenant: OptionalTenantCtx, db: UntenantedDb, request: Request
) -> TokenPair:
    # A resolved host still wins. On a per-academy subdomain the hostname is the
    # authority on which academy you are signing in to, and the directory lookup
    # must not be able to send you somewhere else.
    tenant_id = (
        tenant.id if tenant else await resolve_login_tenant(db, identifier=payload.username)
    )

    async with bind_session_to(db, tenant_id):
        user = await authenticate_user(
            db, identifier=payload.username, password=payload.password
        )
        # After the password, never before — see resolver.assert_tenant_usable. On a
        # subdomain the resolver has already refused a suspended academy; on a shared
        # origin nothing has, because the academy came from the directory rather than
        # from resolution, and without this a suspension would not actually keep
        # anybody out.
        await assert_tenant_usable(db, tenant_id)
        access, refresh = issue_user_tokens(user)

        await write_audit(
            db,
            tenant_id=tenant_id,
            action="auth.login",
            actor_kind=ActorKind.USER,
            actor_id=user.id,
            actor_label=user.email,
            entity_type="app_user",
            entity_id=user.id,
            request=request,
            tenant_context=tenant,
        )

    return TokenPair(
        access_token=access, refresh_token=refresh, expires_in=access_token_ttl_seconds()
    )


class HandoffRequest(BaseModel):
    token: str = Field(min_length=1, max_length=128)


@router.post(
    "/handoff",
    response_model=TokenPair,
    summary="Exchange a one-time signup token for a session",
    description=(
        "The last step of self-serve signup. The website receives this token when a "
        "payment is confirmed and sends the browser to "
        "`{dashboard_url}/?handoff={token}` — the dashboard posts it here and the "
        "owner is signed in without ever seeing a login form.\n\n"
        "**Single use, and short-lived.** It travels in a URL, so a copy of it is in "
        "browser history and in the referrer of whatever the dashboard loads next. "
        "Burning it on first use is what makes those copies inert.\n\n"
        "401 for expired, already-used and never-existed alike — the differences are "
        "only useful to somebody testing which of their guesses is closest."
    ),
)
async def handoff(payload: HandoffRequest, db: UntenantedDb) -> TokenPair:
    access, refresh, expires_in = await billing_service.redeem_handoff(db, payload.token)
    return TokenPair(access_token=access, refresh_token=refresh, expires_in=expires_in)


@router.post(
    "/refresh",
    response_model=TokenPair,
    summary="Exchange a refresh token for a new pair",
)
async def refresh_tokens(
    payload: RefreshRequest, tenant: OptionalTenantCtx, db: UntenantedDb
) -> TokenPair:
    try:
        claims = decode_token(
            payload.refresh_token, audience=Audience.TENANT, expected_type="refresh"
        )
    except TokenError as exc:
        raise AuthenticationError(f"Invalid or expired refresh token: {exc}") from exc

    claimed_tenant = claims.get("tid")
    if not claimed_tenant:
        raise AuthenticationError("This refresh token names no academy.")

    # Same rule as the access path: where the request independently resolves an
    # academy, a token issued for a different one is refused. With no host to
    # resolve from, the signed claim is the academy — see tenancy/resolver.py.
    if tenant is not None and claimed_tenant != str(tenant.id):
        raise PermissionDeniedError("This token was issued for a different academy.")

    async with bind_session_to(db, uuid.UUID(claimed_tenant)):
        result = await db.execute(select(User).where(User.id == uuid.UUID(claims["sub"])))
        user = result.scalar_one_or_none()
        if user is None or not user.is_active:
            raise AuthenticationError("This account is no longer active.")

        # The token is proof enough to be told why this is refused. Without it, a
        # session that predates a suspension renews itself forever on a shared
        # origin, and the academy is only locked out once whoever holds it signs out.
        await assert_tenant_usable(db, uuid.UUID(claimed_tenant))

        # Refresh tokens are stateless and long-lived, so this comparison is what
        # stops one outliving the password it was issued under. Without it, changing
        # a leaked temporary password would lock nobody out: whoever used it would
        # simply refresh their way past the change until the token expired on its
        # own. See models/user.py::User.token_version.
        if claims.get("ver") != user.token_version:
            raise AuthenticationError("Your password was changed. Please sign in again.")

        access, refresh = issue_user_tokens(user)

    return TokenPair(
        access_token=access, refresh_token=refresh, expires_in=access_token_ttl_seconds()
    )


@router.post(
    "/password",
    response_model=TokenPair,
    summary="Change your own password",
    description=(
        "For the owner who was sent a generated password and wants one of their "
        "own. Requires the current password, and replaces only the caller's own "
        "credential — there is no way to name another account here.\n\n"
        "**Every other session for this account is signed out.** The password being "
        "replaced is usually the one that arrived by email in plaintext, so leaving "
        "sessions opened with it alive would defeat the point. The caller keeps "
        "working: a fresh token pair comes back in the response and must replace the "
        "stored one, or the very next request will 401.\n\n"
        "Admin only, for now. Staff passwords are set for them by an admin on the "
        "staff form and there is no screen for a staff member to change their own."
    ),
)
async def change_password(
    payload: ChangePasswordRequest,
    principal: RequireAdmin,
    tenant: TenantCtx,
    db: Db,
    request: Request,
) -> TokenPair:
    user = await load_user(db, principal)

    # Deliberately the same generic message as a failed login, and deliberately not
    # "that is not your current password" — this endpoint is reachable with a stolen
    # session, and confirming a guessed password is worth more to an attacker than
    # the marginal clarity is worth to the owner.
    if not verify_password(payload.current_password, user.password_hash):
        raise AuthenticationError("Incorrect password.")

    user.password_hash = hash_password(payload.new_password)
    # The bump is the sign-out. Everything already issued for this account carries
    # the old number and is refused from here on — see models/user.py.
    user.token_version += 1
    await db.flush()

    # The identity snapshot caches token_version, so without this the old tokens
    # would keep working in *this* process for the rest of the TTL. Other worker
    # processes still expire on their own TTL; that window is seconds, and is the
    # trade-off already documented on the cache.
    revoke_identity(tenant.id, user.id)

    await write_audit(
        db,
        tenant_id=tenant.id,
        action="user.password_changed",
        actor_kind=ActorKind.USER,
        actor_id=user.id,
        actor_label=user.email,
        entity_type="app_user",
        entity_id=user.id,
        # Neither password is recorded, obviously. What matters for the trail is
        # that the account's own holder rotated it, as against an operator reset.
        changes={"after": {"token_version": user.token_version, "by": "self"}},
        request=request,
        tenant_context=tenant,
    )

    # Minted after the bump, so this pair carries the new version and is the only
    # one that still works.
    access, refresh = issue_user_tokens(user)
    return TokenPair(
        access_token=access, refresh_token=refresh, expires_in=access_token_ttl_seconds()
    )


@router.get(
    "/me",
    response_model=MeOut,
    status_code=status.HTTP_200_OK,
    summary="The current principal and the academy they are acting in",
    description=(
        "Returns the academy alongside the principal, because the frontend needs "
        "the tenant's branding to render the shell. A platform operator "
        "impersonating an academy gets `platform_admin` populated and `user` null."
    ),
)
async def me(principal: CurrentPrincipal, tenant: TenantCtx, db: Db) -> MeOut:
    result = await db.execute(select(Tenant).where(Tenant.id == tenant.id))
    tenant_row = result.scalar_one()

    if principal.is_platform_admin:
        admin_result = await db.execute(
            select(PlatformAdmin).where(PlatformAdmin.id == principal.id)
        )
        return MeOut(
            user=None,
            platform_admin=PlatformAdminOut.model_validate(admin_result.scalar_one()),
            tenant=TenantOut.model_validate(tenant_row),
        )

    return MeOut(
        user=UserOut.model_validate(await load_user(db, principal)),
        platform_admin=None,
        tenant=TenantOut.model_validate(tenant_row),
    )
