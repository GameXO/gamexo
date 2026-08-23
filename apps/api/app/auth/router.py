"""Tenant-scoped auth: login, refresh, me."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Request, status
from sqlalchemy import select

from app.audit import write_audit
from app.auth.deps import CurrentPrincipal, load_user
from app.auth.schemas import (
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
from app.core.security import Audience, TokenError, decode_token
from app.db.session import bind_session_to
from app.models.audit import ActorKind
from app.models.tenant import Tenant
from app.models.user import PlatformAdmin, User
from app.tenancy.deps import Db, OptionalTenantCtx, TenantCtx, UntenantedDb

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
        "Authenticates against the academy resolved from the request host (or "
        "`X-Tenant-ID` in development). When the request names no academy — the "
        "shared-origin deployment, where every turf answers on one hostname — the "
        "academy is looked up from the email instead."
    ),
)
async def login(
    payload: LoginRequest, tenant: OptionalTenantCtx, db: UntenantedDb, request: Request
) -> TokenPair:
    # A resolved host still wins. On a per-academy subdomain the hostname is the
    # authority on which academy you are signing in to, and the directory lookup
    # must not be able to send you somewhere else.
    tenant_id = (
        tenant.id if tenant else await resolve_login_tenant(db, email=payload.email)
    )

    async with bind_session_to(db, tenant_id):
        user = await authenticate_user(db, email=payload.email, password=payload.password)
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

        # NOTE: refresh tokens are stateless for now, so a refresh token stays valid
        # until it expires even after a password change. When that matters, add a
        # `token_version` integer to app_user, put it in the claims, and compare here —
        # bumping it invalidates every outstanding token for that user without needing
        # a denylist or Redis.
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
