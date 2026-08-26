"""Authentication and tenant provisioning."""

from __future__ import annotations

import secrets  # noqa: F401 — used by signup_tenant's placeholder slug
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import usernames
from app.core.config import settings
from app.core.errors import AuthenticationError, ConflictError
from app.core.security import (
    Audience,
    Role,
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)
from app.db.session import bind_session_to
from app.models.tenant import Tenant, TenantSettings, TenantStatus
from app.models.user import AccountDirectory, PlatformAdmin, User, UserStatus

# A real bcrypt hash of a value nobody will guess. Verifying against it when the
# email is unknown keeps the failure path the same cost as a wrong password, so
# response time does not disclose which emails are registered.
_DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO3Zo7Kx8pJyM0kJZ8kV6jJZ0nZ3f9Zqu"

_CREDENTIALS_REJECTED = "Incorrect username or password."


async def authenticate_user(session: AsyncSession, *, identifier: str, password: str) -> User:
    """Verify a staff login within the already-resolved tenant.

    The session is tenant-bound, so this query cannot match a user from another
    academy even though it filters on the identifier alone.

    Accepts the username or the email, matching `tenant_id_for_login` — the two have
    to agree, or an account resolves to its academy by one and then fails to
    authenticate by the other.
    """
    normalised = usernames.normalise(identifier)
    result = await session.execute(
        select(User).where(
            or_(
                func.lower(User.username) == normalised,
                func.lower(User.email) == normalised,
            )
        )
    )
    user = result.scalars().first()

    if user is None:
        verify_password(password, _DUMMY_HASH)
        raise AuthenticationError(_CREDENTIALS_REJECTED)

    if not verify_password(password, user.password_hash):
        raise AuthenticationError(_CREDENTIALS_REJECTED)

    if not user.is_active:
        # Distinguishable from a bad password on purpose: the credentials were
        # correct, and telling a suspended member of staff to talk to their admin
        # is more useful than letting them believe they mistyped.
        raise AuthenticationError(
            f"This account is {user.status.value}. Contact your academy administrator."
        )

    user.last_login_at = datetime.now(UTC)
    return user


async def authenticate_platform_admin(
    session: AsyncSession, *, identifier: str, password: str
) -> PlatformAdmin:
    normalised = usernames.normalise(identifier)
    result = await session.execute(
        select(PlatformAdmin).where(
            or_(
                func.lower(PlatformAdmin.username) == normalised,
                func.lower(PlatformAdmin.email) == normalised,
            )
        )
    )
    admin = result.scalars().first()

    if admin is None:
        verify_password(password, _DUMMY_HASH)
        raise AuthenticationError(_CREDENTIALS_REJECTED)

    if not verify_password(password, admin.password_hash) or not admin.is_active:
        raise AuthenticationError(_CREDENTIALS_REJECTED)

    admin.last_login_at = datetime.now(UTC)
    return admin


def issue_user_tokens(user: User) -> tuple[str, str]:
    """Mint the access/refresh pair for a staff member.

    `tid` and `role` travel as claims, per the tenancy design. `tid` is not trusted
    as a tenant *selector* — auth/deps.py checks it against the independently
    resolved tenant — but carrying it means a token stolen from academy A cannot be
    replayed against academy B's hostname without that mismatch being detected.
    """
    claims = {"tid": str(user.tenant_id), "role": user.role.value, "email": user.email}
    return (
        create_access_token(subject=str(user.id), audience=Audience.TENANT, claims=claims),
        create_refresh_token(subject=str(user.id), audience=Audience.TENANT, claims=claims),
    )


def issue_platform_tokens(admin: PlatformAdmin) -> tuple[str, str]:
    claims = {"tid": None, "role": "super_admin", "email": admin.email}
    return (
        create_access_token(subject=str(admin.id), audience=Audience.PLATFORM, claims=claims),
        create_refresh_token(subject=str(admin.id), audience=Audience.PLATFORM, claims=claims),
    )


def access_token_ttl_seconds() -> int:
    return settings.access_token_ttl_minutes * 60


async def provision_tenant(
    session: AsyncSession,
    *,
    slug: str,
    name: str,
    admin_email: str,
    admin_password: str,
    admin_full_name: str,
    business_name: str | None = None,
    currency: str = "INR",
    timezone: str = "Asia/Kolkata",
    tenant_id: uuid.UUID | None = None,
    admin_username: str | None = None,
) -> tuple[Tenant, User]:
    """Create an academy, its settings and its first admin in one transaction.

    `tenant_id` and `admin_username` exist for the self-serve path, which has to
    settle the tenant's final slug *before* provisioning rather than after. Usernames
    embed the slug (`admin@navigo-sports`), and this function is otherwise called
    with a throwaway placeholder that onboarding renames a moment later — which would
    mint `admin@turf-9f3a2b` and leave it there for good. So that caller reserves the
    id, claims the real slug against it, and passes both in. Everyone else omits them
    and gets a fresh id and a username derived from whatever slug they supplied.

    Bootstrapping a tenant is the one flow that has to cross the tenancy boundary,
    and the ordering matters:

    1. Start on an *untenanted* session. `tenant` carries no tenant_id and no RLS
       policy, so it is insertable with nothing bound — which is necessary, because
       the tenant being created is the thing that would do the binding.
    2. Flush, so the row exists and `tenant.id` is real.
    3. Bind the transaction to the new tenant, both layers. Everything after this
       point is ordinary tenant-scoped work: `tenant_settings` and `app_user` are
       under RLS, and inserting them with no tenant bound would be rejected by the
       policy's WITH CHECK — correctly, since nothing should be writing tenant-owned
       rows from an unbound session.

    The binding deliberately outlives this function: the caller writes its audit row
    into the same transaction, and that row is tenant-scoped too.
    """
    existing = await session.execute(select(Tenant.id).where(Tenant.slug == slug))
    if existing.scalar_one_or_none() is not None:
        raise ConflictError(
            f"The subdomain '{slug}' is already taken.", details={"field": "slug"}
        )

    email = admin_email.strip().lower()
    username = usernames.normalise(admin_username or usernames.for_admin(slug))
    # Checked before anything is inserted, so a taken email fails as a clean 409
    # rather than as a unique-violation at COMMIT that has already written a tenant.
    await assert_email_available(session, email)
    if await username_taken(session, username):
        raise ConflictError(
            f"The username '{username}' is already taken.", details={"field": "username"}
        )

    tenant = Tenant(
        id=tenant_id or uuid.uuid4(), slug=slug, name=name, status=TenantStatus.ACTIVE
    )
    session.add(tenant)
    await session.flush()

    # Bind the rest of the transaction to the new tenant, in all three places — see
    # db/session.py::bind_session_to for what each one is read by.
    async with bind_session_to(session, tenant.id):
        session.add(
            TenantSettings(
                tenant_id=tenant.id,
                business_name=business_name or name,
                currency=currency.upper(),
                timezone=timezone,
            )
        )

        admin = User(
            tenant_id=tenant.id,
            username=username,
            email=email,
            password_hash=hash_password(admin_password),
            full_name=admin_full_name,
            role=Role.ADMIN,
            status=UserStatus.ACTIVE,
            avatar_initials=initials(admin_full_name),
            joined_on=datetime.now(UTC).date(),
        )
        session.add(admin)
        session.add(
            AccountDirectory(username=username, email=email, tenant_id=tenant.id)
        )
        await session.flush()

    return tenant, admin


async def create_kiosk_login(
    session: AsyncSession,
    *,
    tenant: Tenant,
    password: str,
    contact_email: str,
) -> User:
    """The shared counter tablet's login: `kiosk@{slug}`.

    Created alongside the owner rather than left for them to discover, because the
    wizard's last question is literally which services they want on their POS — and
    a counter with no credential is not a configurable option, it is a broken one.

    Not a person, so it holds the lowest role in the hierarchy. Everything the
    dashboard exposes — revenue, staff, settings, membership plans — is guarded at
    reception and above, which is what stops a tablet on a public counter from
    reading the business out of the API. See core/security.py::Role.

    `contact_email` is the owner's address, deliberately: the device has no mailbox,
    and mail about the counter account belongs with whoever is responsible for it.
    The per-tenant unique index is on the email, so this is only reachable because
    the address is suffixed below.
    """
    username = usernames.for_kiosk(tenant.slug)
    # `owner+kiosk@…` — a plus-address, so it still delivers to the owner while
    # staying distinct under the per-tenant unique index on lower(email).
    local, _, domain = contact_email.partition("@")
    email = f"{local}+kiosk@{domain}".lower()

    kiosk = User(
        tenant_id=tenant.id,
        username=username,
        email=email,
        password_hash=hash_password(password),
        full_name="Front Counter",
        role=Role.KIOSK,
        status=UserStatus.ACTIVE,
        avatar_initials="FC",
        joined_on=datetime.now(UTC).date(),
    )
    session.add(kiosk)
    session.add(AccountDirectory(username=username, email=email, tenant_id=tenant.id))
    await session.flush()
    return kiosk


async def signup_tenant(
    session: AsyncSession, *, email: str, password: str, full_name: str
) -> tuple[Tenant, User]:
    """Self-serve registration: an owner, and the empty academy they own.

    The turf has no name yet — that is the first thing onboarding asks for — so the
    tenant is created under a placeholder slug and renamed when onboarding completes
    (see modules/onboarding). A random slug rather than one derived from the email:
    the slug is a DNS label that may become a public subdomain, and deriving it from
    a personal address would publish one.

    `onboarding_completed_at` is left NULL, which is what routes the new owner into
    the wizard instead of the dashboard.
    """
    placeholder = f"turf-{secrets.token_hex(4)}"
    return await provision_tenant(
        session,
        slug=placeholder,
        # Shown nowhere before onboarding overwrites it, but the column is NOT NULL
        # and a blank name in an audit row is worse than a dull one.
        name=full_name.strip() or email.split("@")[0],
        admin_email=email,
        admin_password=password,
        admin_full_name=full_name,
    )


# ── The login directory ─────────────────────────────────────────────────────
#
# See models/user.py::AccountDirectory for why this table exists. These helpers are
# the whole of its maintenance: every path that creates or renames a User must go
# through them, or that user will authenticate on a subdomain and be invisible on
# the shared origin.


async def assert_email_available(session: AsyncSession, email: str) -> None:
    """Raise if this email already signs in somewhere on the platform."""
    taken = await session.execute(
        select(AccountDirectory.id).where(
            func.lower(AccountDirectory.email) == email.strip().lower()
        )
    )
    if taken.scalar_one_or_none() is not None:
        raise ConflictError(
            "That email is already registered.", details={"field": "email"}
        )


async def username_taken(session: AsyncSession, username: str) -> bool:
    result = await session.execute(
        select(AccountDirectory.id).where(
            func.lower(AccountDirectory.username) == usernames.normalise(username)
        )
    )
    return result.scalar_one_or_none() is not None


async def claim_staff_username(
    session: AsyncSession, *, full_name: str, tenant_slug: str
) -> str:
    """A free `{name}.staff@{tenant}`, suffixing on a clash.

    Two people called Rahul at one academy is ordinary, not exceptional, so the
    second becomes `rahul-2.staff@…` rather than failing. Suffixes rather than
    random noise for the same reason slugs use them: somebody has to read this
    down a phone line.
    """
    for suffix in (None, *range(2, 100)):
        candidate = usernames.for_staff(full_name, tenant_slug, suffix=suffix)
        if not await username_taken(session, candidate):
            return candidate
    # 99 people with the same name at one turf is not worth a cleverer algorithm.
    return usernames.for_staff(
        f"{full_name}-{secrets.token_hex(2)}", tenant_slug
    )


async def rebase_usernames(
    session: AsyncSession, *, tenant_id: uuid.UUID, old_slug: str, new_slug: str
) -> int:
    """Move every login at this academy onto a new slug. Returns how many moved.

    Usernames embed the slug, so renaming the academy without this leaves
    `admin@turf-9f3a2b` behind forever — which is exactly what `/auth/signup`
    produces, since it provisions under a placeholder and lets onboarding name the
    turf afterwards.

    The local part is preserved verbatim: `rahul-joshi.staff@turf-9f3a2b` becomes
    `rahul-joshi.staff@navigo-sports`, and the person's name, level and any
    collision suffix all survive.

    Both tables are updated together. `app_user` is what authenticates and
    `account_directory` is what finds the academy in the first place; leaving either
    behind produces an account that resolves and then fails, or fails to resolve at
    all. The session must already be bound to this tenant — `app_user` is under RLS.
    """
    if old_slug == new_slug:
        return 0

    users = (await session.execute(select(User).where(User.tenant_id == tenant_id))).scalars().all()
    directory = {
        row.username: row
        for row in (
            await session.execute(
                select(AccountDirectory).where(AccountDirectory.tenant_id == tenant_id)
            )
        ).scalars()
    }

    moved = 0
    for user in users:
        local, sep, slug_part = user.username.rpartition("@")
        if not sep or slug_part != old_slug:
            # Not on the old slug — a hand-made username, or one already moved.
            # Left alone rather than rewritten to something nobody has been told.
            continue
        renamed = f"{local}@{new_slug}"
        entry = directory.get(user.username)
        user.username = renamed
        if entry is not None:
            entry.username = renamed
        moved += 1

    await session.flush()
    return moved


async def register_login(
    session: AsyncSession, *, username: str, email: str, tenant_id: uuid.UUID
) -> AccountDirectory:
    """Claim a username and an email for a tenant. Call whenever a User is created."""
    email = email.strip().lower()
    username = usernames.normalise(username)
    await assert_email_available(session, email)
    if await username_taken(session, username):
        raise ConflictError(
            f"The username '{username}' is already taken.", details={"field": "username"}
        )
    entry = AccountDirectory(username=username, email=email, tenant_id=tenant_id)
    session.add(entry)
    return entry


async def tenant_id_for_login(session: AsyncSession, identifier: str) -> uuid.UUID | None:
    """Which academy this login belongs to, or None if it is unknown.

    Matches the username first and the email second. The fallback is not
    generosity — it is what stops the switch to usernames locking out every account
    that predates it, whose owners have been typing an address into this form for
    months. A username and an email can never collide: usernames have no dot in the
    part after the `@`.

    Returns None rather than raising so the caller can fall through to the same
    "incorrect username or password" it gives for a wrong password — an endpoint
    that 404s on unknown logins is an account-enumeration oracle.
    """
    normalised = usernames.normalise(identifier)
    result = await session.execute(
        select(AccountDirectory.tenant_id).where(
            or_(
                func.lower(AccountDirectory.username) == normalised,
                func.lower(AccountDirectory.email) == normalised,
            )
        )
    )
    return result.scalars().first()


async def resolve_login_tenant(session: AsyncSession, *, identifier: str) -> uuid.UUID:
    """The academy a login belongs to, when the request named none.

    Raises the ordinary credentials error for an unknown login, having first burned
    the same bcrypt round a real verification would — so "no such account" and
    "wrong password" cost the same and the endpoint discloses nothing by timing.
    """
    tenant_id = await tenant_id_for_login(session, identifier)
    if tenant_id is None:
        verify_password("", _DUMMY_HASH)
        raise AuthenticationError(_CREDENTIALS_REJECTED)
    return tenant_id


def initials(full_name: str) -> str:
    """"Rahul Joshi" -> "RJ". The frontend renders these as avatars everywhere."""
    parts = [p for p in full_name.strip().split() if p]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()
