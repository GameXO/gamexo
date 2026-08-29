"""Principals: tenant staff (`app_user`) and platform operators (`platform_admin`)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.security import Role
from app.db.base import Base, TenantScoped, TimestampMixin, UUIDPrimaryKeyMixin
from app.db.types import enum_type


class UserStatus(StrEnum):
    """Mirrors the frontend Staff page's status badge."""

    ACTIVE = "active"
    ON_LEAVE = "on-leave"
    INACTIVE = "inactive"


class User(TenantScoped):
    """A staff member. Also the authentication principal — deliberately one table.

    The frontend's Staff page lists exactly admin/manager/reception with an email
    and a status per person, which is the same set of people who log in. Two tables
    would need to be reconciled by hand and would drift, and "deactivate this staff
    member" and "revoke this login" would become two separate acts that someone
    eventually performs only one of.

    A user belongs to EXACTLY ONE tenant.

    TO RELAX LATER (one user, several academies — e.g. a coach working across two
    franchises, or a group operator): add

        user_tenant_membership(user_id, tenant_id, role, PRIMARY KEY (user_id, tenant_id))

    move `role` onto that table, and keep `user.tenant_id` as the home tenant so the
    NOT NULL and the RLS policy on this table stay intact. Login then resolves the
    membership row for the *resolved* tenant, and the JWT's `tid` claim keeps working
    unchanged because it already names one tenant per token. No other table is affected.
    """

    __tablename__ = "app_user"  # "user" is reserved in Postgres; not worth the quoting
    __table_args__ = (
        # Per-tenant unique, never global: two academies must be able to employ two
        # different people who both use gmail addresses, and one person may work at
        # two academies. Functional index on lower(email) so Priya@x.com and
        # priya@x.com cannot both exist — case-sensitive email uniqueness is a
        # duplicate-account bug waiting to happen.
        Index("uq_app_user_tenant_email", "tenant_id", text("lower(email)"), unique=True),
        # The login identifier. Per-tenant here and globally unique via
        # account_directory — the same split the email column already has.
        Index("uq_app_user_tenant_username", "tenant_id", text("lower(username)"), unique=True),
    )

    #: What this person types to sign in — `admin@navigo-sports`,
    #: `rahul.staff@navigo-sports`, `kiosk@navigo-sports`. Generated once at
    #: creation and stored, never derived from the slug on the fly: a tenant that
    #: renames itself must not invalidate credentials its staff have written down.
    #: See auth/usernames.py.
    username: Mapped[str] = mapped_column(String(200), nullable=False)

    #: Where this account's mail goes, and **not** the login. The distinction is
    #: load-bearing: `admin@navigo-sports` has no MX record, so the welcome message
    #: carrying the generated password has to be addressed here instead.
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)

    #: Bumped whenever every outstanding session for this account must stop working
    #: — today that means a password change.
    #:
    #: It rides in the token claims as `ver` and is compared on every authenticated
    #: request (auth/deps.py) and every refresh (auth/router.py). Anything carrying
    #: an older number is refused.
    #:
    #: This is what makes changing a password *mean* something. Access and refresh
    #: tokens are stateless and signed, so without a value to compare them against,
    #: a session opened with the old password keeps working until its refresh token
    #: expires — and the temporary password people are changing is precisely the one
    #: that was emailed to them in plaintext. An integer on the row beats a denylist:
    #: no extra store, no expiry sweeping, and one UPDATE invalidates everything.
    token_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)

    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[Role] = mapped_column(enum_type(Role, name="user_role"), nullable=False)

    # ── Staff-page profile fields ────────────────────────────────────────────
    phone: Mapped[str | None] = mapped_column(String(32))
    avatar_initials: Mapped[str | None] = mapped_column(String(4))
    shift: Mapped[str | None] = mapped_column(String(64))  # "Morning (6AM–2PM)"
    status: Mapped[UserStatus] = mapped_column(
        enum_type(UserStatus, name="user_status"),
        default=UserStatus.ACTIVE,
        nullable=False,
    )
    joined_on: Mapped[date | None] = mapped_column(Date)

    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def is_active(self) -> bool:
        """Only ACTIVE may authenticate.

        on-leave staff are intentionally locked out: their shift is covered by
        someone else, and an unattended logged-in account is exactly what an
        operations audit flags.
        """
        return self.status is UserStatus.ACTIVE

    def __repr__(self) -> str:
        return f"<User {self.username} role={self.role} tenant={self.tenant_id}>"


class PlatformAdmin(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Me, the SaaS operator. Acts across tenants for support and provisioning.

    A separate table rather than a `super_admin` role on `app_user` with a nullable
    tenant_id. The nullable-column version would force `tenant_id` to be NULL-able on
    a table under RLS, which means the isolation policy needs a bypass branch for
    exactly the rows permitted to see everything — the single worst place in the
    schema to introduce a special case. Here, `tenant_id NOT NULL` holds on every
    tenant-scoped table with zero exceptions.

    Cross-tenant access is NOT a policy bypass: a platform admin acquires an ordinary
    tenant-bound session for the tenant being impersonated, with the same GUC and the
    same policies as that tenant's own staff. The app role never gets BYPASSRLS. Every
    impersonated request writes an audit_log row.
    """

    __tablename__ = "platform_admin"

    #: `ops@gamexo`. Global unique is correct here: platform admins belong to no
    #: tenant, so there is no tenant to scope the name to.
    username: Mapped[str] = mapped_column(String(200), unique=True, nullable=False, index=True)
    # Global unique is correct here: platform admins belong to no tenant.
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def __repr__(self) -> str:
        return f"<PlatformAdmin {self.username}>"


class AccountDirectory(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """email -> tenant, so a login can find its academy before one is resolved.

    Deliberately NOT TenantScoped and carrying no RLS policy — the same exception
    PlatformAdmin is, for the same reason: it has to be readable from a session with
    nothing bound. On a shared origin (one hostname for every academy) there is no
    subdomain to resolve from, and `app_user` is invisible to an unbound session
    because RLS evaluates `tenant_id = NULL`. Something outside the policy has to
    answer "which academy owns this email", and this is the smallest such thing:
    two columns, no credentials, no profile.

    Nothing here is secret — an email and an opaque tenant id — so a leak of this
    table discloses which addresses have accounts, not what they can reach.

    THE TRADE-OFF, stated plainly: a login email is now globally unique across the
    platform. `app_user` keeps its per-tenant uniqueness, so the same person can
    still be *employed* by two academies, but they cannot sign in to both with one
    address. Relaxing that is the same migration described on User: this table grows
    to (email, tenant_id) unique-together, and login gains an academy picker when an
    email matches more than one row.
    """

    __tablename__ = "account_directory"
    __table_args__ = (
        Index("uq_account_directory_email", text("lower(email)"), unique=True),
        # The identifier logins are actually resolved by, now that usernames rather
        # than addresses are typed into the form. Unique platform-wide for the same
        # reason the email index is: it is what makes "which academy owns this
        # login" answerable from a session with no tenant bound.
        Index("uq_account_directory_username", text("lower(username)"), unique=True),
    )

    #: `admin@navigo-sports`. What is typed into the sign-in form.
    username: Mapped[str] = mapped_column(String(200), nullable=False)

    #: The contact address, kept here so a login by legacy email still resolves —
    #: accounts created before usernames existed had their address typed into the
    #: form for months, and breaking those on deploy would lock out every academy
    #: at once. See auth/service.py::resolve_login_tenant.
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True),
        # CASCADE, unlike the RESTRICT everywhere else: this row is a lookup index,
        # not a record. A deleted tenant's directory entries are noise that would
        # otherwise block the delete and squat on the email.
        ForeignKey("tenant.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    def __repr__(self) -> str:
        return f"<AccountDirectory {self.username} -> {self.tenant_id}>"
