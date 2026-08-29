"""Platform-operator endpoints: my own control plane, above any single academy."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Request, status
from sqlalchemy import func, select

from app.audit import write_audit
from app.auth import usernames
from app.auth.deps import CurrentPlatformAdmin, revoke_identity
from app.auth.schemas import (
    CreateTenantRequest,
    CreateTenantResponse,
    DeleteTenantRequest,
    DeleteTenantResponse,
    LoginRequest,
    PlatformAdminOut,
    RefreshRequest,
    ResetAdminPasswordRequest,
    ResetAdminPasswordResponse,
    TenantOut,
    TokenPair,
    UpdateTenantRequest,
    UserOut,
)
from app.auth.service import (
    access_token_ttl_seconds,
    authenticate_platform_admin,
    create_kiosk_login,
    issue_platform_tokens,
    provision_tenant,
)
from app.core.errors import AuthenticationError, InvalidInputError, NotFoundError
from app.core.security import Audience, TokenError, decode_token, hash_password
from app.db.session import bind_session_to
from app.models.audit import ActorKind
from app.models.tenant import Tenant
from app.modules.billing.service import generate_password
from app.tenancy.deletion import delete_tenant as perform_delete
from app.tenancy.resolver import invalidate_tenant_cache
from app.models.user import PlatformAdmin, User
from app.tenancy.deps import UntenantedDb

router = APIRouter(prefix="/platform", tags=["platform"])


@router.post(
    "/login",
    response_model=TokenPair,
    summary="Log in as a platform operator",
    description=(
        "No academy is involved, so this endpoint does not resolve a tenant. The "
        "resulting token has a distinct audience and cannot be used as academy staff "
        "credentials; to act inside an academy, send it with `X-Impersonate-Tenant`."
    ),
)
async def platform_login(payload: LoginRequest, db: UntenantedDb) -> TokenPair:
    admin = await authenticate_platform_admin(
        db, identifier=payload.username, password=payload.password
    )
    access, refresh = issue_platform_tokens(admin)
    return TokenPair(
        access_token=access, refresh_token=refresh, expires_in=access_token_ttl_seconds()
    )


@router.post("/refresh", response_model=TokenPair, summary="Refresh a platform token")
async def platform_refresh(payload: RefreshRequest, db: UntenantedDb) -> TokenPair:
    try:
        claims = decode_token(
            payload.refresh_token, audience=Audience.PLATFORM, expected_type="refresh"
        )
    except TokenError as exc:
        raise AuthenticationError(f"Invalid or expired refresh token: {exc}") from exc

    result = await db.execute(
        select(PlatformAdmin).where(PlatformAdmin.id == uuid.UUID(claims["sub"]))
    )
    admin = result.scalar_one_or_none()
    if admin is None or not admin.is_active:
        raise AuthenticationError("This platform account is no longer active.")

    access, refresh = issue_platform_tokens(admin)
    return TokenPair(
        access_token=access, refresh_token=refresh, expires_in=access_token_ttl_seconds()
    )


@router.get("/me", response_model=PlatformAdminOut, summary="The current platform operator")
async def platform_me(admin: CurrentPlatformAdmin) -> PlatformAdminOut:
    return PlatformAdminOut.model_validate(admin)


@router.post(
    "/tenants",
    response_model=CreateTenantResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Onboard an academy",
    description=(
        "Creates the tenant, its default settings and its first admin user in one "
        "transaction. This is the only way an academy comes into existence — there "
        "is deliberately no public self-service registration."
    ),
)
async def create_tenant(
    payload: CreateTenantRequest,
    admin: CurrentPlatformAdmin,
    db: UntenantedDb,
    request: Request,
) -> CreateTenantResponse:
    # Generated unless the caller chose one. Held so it can be returned below: this
    # is the only moment it exists in readable form anywhere.
    generated = payload.admin.password is None
    admin_password = payload.admin.password or generate_password()
    kiosk_password = generate_password()

    tenant, tenant_admin = await provision_tenant(
        db,
        slug=payload.slug,
        name=payload.name,
        admin_email=payload.admin.email,
        admin_password=admin_password,
        admin_full_name=payload.admin.full_name,
        business_name=payload.business_name,
        currency=payload.currency,
        timezone=payload.timezone,
    )

    # The counter login, exactly as self-serve signup creates one. An academy
    # provisioned by an operator that arrives without one is a venue whose front desk
    # cannot sign in — the same gap, reached by the other door.
    kiosk = await create_kiosk_login(
        db, tenant=tenant, password=kiosk_password, contact_email=payload.admin.email
    )

    # provision_tenant leaves the transaction bound to the new tenant, so this
    # tenant-scoped audit row is insertable and lands in the same commit.
    await write_audit(
        db,
        tenant_id=tenant.id,
        action="tenant.provisioned",
        actor_kind=ActorKind.PLATFORM_ADMIN,
        actor_id=admin.id,
        actor_label=admin.email,
        entity_type="tenant",
        entity_id=tenant.id,
        changes={"after": {"slug": tenant.slug, "name": tenant.name}},
        request=request,
    )

    # Resolution caches a tenant snapshot per process. Misses are not cached, so a
    # brand new tenant resolves fine without this — but a slug being *reused* after
    # deletion would otherwise serve the old id until the TTL expired.
    invalidate_tenant_cache(tenant.slug, str(tenant.id))

    return CreateTenantResponse(
        tenant=TenantOut.model_validate(tenant),
        admin=UserOut.model_validate(tenant_admin),
        # Returned only when we made it up. Echoing a caller's own password back at
        # them puts it in a log or a browser cache for no benefit.
        admin_password=admin_password if generated else None,
        kiosk_username=kiosk.username,
        kiosk_password=kiosk_password,
    )


@router.get(
    "/tenants",
    response_model=list[TenantOut],
    summary="List every academy on the platform",
)
async def list_tenants(admin: CurrentPlatformAdmin, db: UntenantedDb) -> list[TenantOut]:
    del admin
    result = await db.execute(select(Tenant).order_by(Tenant.created_at))
    return [TenantOut.model_validate(row) for row in result.scalars()]


async def _get_tenant(db: UntenantedDb, tenant_id: uuid.UUID) -> Tenant:
    """The academy, or a 404. `tenant` carries no RLS, so this reads untenanted."""
    tenant = (
        await db.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one_or_none()
    if tenant is None:
        raise NotFoundError("No academy with that id.")
    return tenant


@router.patch(
    "/tenants/{tenant_id}",
    response_model=TenantOut,
    summary="Change an academy's standing or plan",
    description=(
        "Suspending an academy takes effect on the next request: its staff are "
        "refused at login and every resolution of its subdomain fails. An operator "
        "with `X-Impersonate-Tenant` can still reach it, which is what makes support "
        "possible on a suspended venue."
    ),
)
async def update_tenant(
    tenant_id: uuid.UUID,
    payload: UpdateTenantRequest,
    admin: CurrentPlatformAdmin,
    db: UntenantedDb,
    request: Request,
) -> TenantOut:
    tenant = await _get_tenant(db, tenant_id)
    before = {"status": str(tenant.status), "plan_tier": tenant.plan_tier}

    if payload.status is not None:
        tenant.status = payload.status
    if payload.plan_tier is not None:
        tenant.plan_tier = payload.plan_tier.value

    after = {"status": str(tenant.status), "plan_tier": tenant.plan_tier}
    await db.flush()

    # The audit row belongs to the academy it describes, and `audit_log` is under
    # RLS, so the session has to be bound to write it — this endpoint reads `tenant`,
    # which is not.
    async with bind_session_to(db, tenant.id):
        await write_audit(
            db,
            tenant_id=tenant.id,
            action="tenant.updated",
            actor_kind=ActorKind.PLATFORM_ADMIN,
            actor_id=admin.id,
            actor_label=admin.email,
            entity_type="tenant",
            entity_id=tenant.id,
            changes={"before": before, "after": after},
            request=request,
        )

    # Without this a suspension is invisible for the life of the cached snapshot —
    # the academy keeps serving from every process that already resolved it. The
    # resolver's own docstring calls this out as the case it was written for.
    invalidate_tenant_cache(tenant.slug, str(tenant.id))

    return TenantOut.model_validate(tenant)


@router.delete(
    "/tenants/{tenant_id}",
    response_model=DeleteTenantResponse,
    summary="Permanently delete an academy",
    description=(
        "**Irreversible.** Removes the academy and every row it owned across all "
        "tenant-scoped tables — bookings, customers, invoices, payments, staff, and "
        "its own audit log. There is no undo and no backup taken here.\n\n"
        "`confirm_name` must match the academy's name exactly. To stop an academy "
        "operating without destroying anything, PATCH its status to `suspended` "
        "instead.\n\n"
        "A row is written to `deleted_tenant` recording who did it and how much was "
        "removed, because the academy's own audit log goes with it."
    ),
)
async def delete_tenant_endpoint(
    tenant_id: uuid.UUID,
    payload: DeleteTenantRequest,
    admin: CurrentPlatformAdmin,
    db: UntenantedDb,
) -> DeleteTenantResponse:
    tenant = await _get_tenant(db, tenant_id)

    # Checked server-side as well as in the dialog. Compared with surrounding
    # whitespace stripped but otherwise exactly — an academy called "Arena" and one
    # called "arena" are two different businesses, and this is the last thing
    # standing between a click and their data.
    if payload.confirm_name.strip() != tenant.name.strip():
        raise InvalidInputError(
            "The name you typed does not match this academy's name.",
            details={"field": "confirm_name", "expected": tenant.name},
        )

    # No audit row here: `audit_log` is tenant-scoped, so anything written would be
    # deleted moments later by the cascade. The tombstone is the record.
    tombstone = await perform_delete(
        db,
        tenant_id=tenant.id,
        deleted_by_id=admin.id,
        deleted_by_label=admin.username,
    )

    # The academy is gone but its snapshot is not, and a cached one still resolves
    # its subdomain to an id nothing points at any more.
    invalidate_tenant_cache(tombstone.slug, str(tombstone.tenant_id))

    return DeleteTenantResponse(
        slug=tombstone.slug,
        name=tombstone.name,
        deleted_at=tombstone.deleted_at,
        row_counts=tombstone.row_counts,
    )


@router.post(
    "/tenants/{tenant_id}/admin-password",
    response_model=ResetAdminPasswordResponse,
    summary="Reissue an academy account's password",
    description=(
        "Returns the new password once, in the response body. There is no self-serve "
        "reset yet, so an owner whose welcome email never arrived has no other way "
        "back in. The old password stops working immediately."
    ),
)
async def reset_admin_password(
    tenant_id: uuid.UUID,
    payload: ResetAdminPasswordRequest,
    admin: CurrentPlatformAdmin,
    db: UntenantedDb,
    request: Request,
) -> ResetAdminPasswordResponse:
    tenant = await _get_tenant(db, tenant_id)
    wanted = usernames.normalise(payload.username or usernames.for_admin(tenant.slug))
    password = generate_password()

    # `app_user` is under RLS, so both the lookup and the write happen bound to the
    # academy — an unbound session would find no rows and report "no such account"
    # for an account that plainly exists.
    async with bind_session_to(db, tenant.id):
        user = (
            await db.execute(
                select(User).where(
                    User.tenant_id == tenant.id,
                    func.lower(User.username) == wanted,
                )
            )
        ).scalar_one_or_none()
        if user is None:
            raise NotFoundError(f"No account '{wanted}' at this academy.")

        user.password_hash = hash_password(password)
        # Ends every session this account already has. An operator reset is often an
        # offboarding step — somebody is meant to lose access — and it would be worth
        # very little if the person being reset simply kept the tab they had open.
        # See models/user.py::User.token_version.
        user.token_version += 1
        await db.flush()
        revoke_identity(tenant.id, user.id)

        await write_audit(
            db,
            tenant_id=tenant.id,
            action="user.password_reset",
            actor_kind=ActorKind.PLATFORM_ADMIN,
            actor_id=admin.id,
            actor_label=admin.email,
            entity_type="user",
            entity_id=user.id,
            # The password itself is never written here. What matters for the trail
            # is that an operator reset somebody else's credential, and whose.
            changes={"after": {"username": user.username, "reset_by": "platform"}},
            request=request,
        )

        return ResetAdminPasswordResponse(
            username=user.username, password=password, email=user.email
        )
