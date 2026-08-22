"""Proof that one academy cannot reach another's data.

These are the tests the whole design exists for. Each one attacks a different
layer, and several deliberately bypass the ORM so that only PostgreSQL is left
standing between the query and the data — an isolation test that goes through the
application's own filtering proves only that the filter works, not that the
database refuses.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import ProgrammingError

from app.db.base import Base, TenantScoped
from app.db.rls import get_current_tenant
from app.db.session import tenant_session, untenanted_session
from app.models.user import User
from tests.conftest import TenantFixture

# The three tables that legitimately have no tenant_id.
#   tenant            — reading it is how a hostname becomes a tenant, which must
#                       work before any tenant is bound
#   platform_admin    — platform operators belong to no academy
#   account_directory — email -> tenant, read by login before a tenant exists to
#                       bind. Holds no credentials: an email and a tenant id.
UNSCOPED_TABLES = {"tenant", "platform_admin", "account_directory"}


async def test_raw_select_cannot_see_another_tenant(
    tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """The database refuses, not the ORM.

    A bare `SELECT * FROM app_user` with no WHERE clause at all — exactly what a
    query that forgot its tenant filter looks like. Raw SQL means the ORM's
    with_loader_criteria never runs, so anything returned here came past RLS.
    """
    async with tenant_session(tenant_a.id) as session:
        rows = (await session.execute(text("SELECT tenant_id FROM app_user"))).all()

    assert rows, "tenant A should still see its own staff"
    assert {row.tenant_id for row in rows} == {tenant_a.id}
    assert tenant_b.id not in {row.tenant_id for row in rows}


async def test_raw_select_by_primary_key_cannot_fetch_another_tenants_row(
    tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """Knowing the exact UUID of another academy's row is not enough.

    The realistic attack: an id leaked through a log, a URL or a support ticket,
    replayed against your own authenticated session.
    """
    async with tenant_session(tenant_a.id) as session:
        result = await session.execute(
            text("SELECT id FROM app_user WHERE id = :id"), {"id": tenant_b.admin_id}
        )
        assert result.scalar_one_or_none() is None


async def test_orm_query_is_scoped_without_an_explicit_filter(
    tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """The application layer scopes reads too, so both layers agree."""
    async with tenant_session(tenant_b.id) as session:
        users = (await session.execute(select(User))).scalars().all()

    assert users, "tenant B should see its own staff"
    assert all(user.tenant_id == tenant_b.id for user in users)


async def test_update_cannot_touch_another_tenants_row(
    tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """A cross-tenant UPDATE matches nothing rather than succeeding silently.

    Zero rows affected, not an error: RLS makes the row invisible, and an invisible
    row cannot be updated. It also means the failure does not disclose that the row
    exists.
    """
    async with tenant_session(tenant_a.id) as session:
        result = await session.execute(
            text("UPDATE app_user SET full_name = 'pwned' WHERE id = :id"),
            {"id": tenant_b.admin_id},
        )
        assert result.rowcount == 0

    async with tenant_session(tenant_b.id) as session:
        victim = (
            await session.execute(select(User).where(User.id == tenant_b.admin_id))
        ).scalar_one()
        assert victim.full_name != "pwned"


async def test_delete_cannot_touch_another_tenants_row(
    tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    async with tenant_session(tenant_a.id) as session:
        result = await session.execute(
            text("DELETE FROM app_user WHERE id = :id"), {"id": tenant_b.admin_id}
        )
        assert result.rowcount == 0

    async with tenant_session(tenant_b.id) as session:
        still_there = (
            await session.execute(select(User).where(User.id == tenant_b.admin_id))
        ).scalar_one_or_none()
        assert still_there is not None


async def test_insert_stamped_with_another_tenant_is_rejected(
    tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """The WITH CHECK half of the policy.

    Without WITH CHECK, reads would be isolated while a tenant could still plant
    rows inside another academy — the half-implemented RLS that looks correct in a
    read-only test. Raw SQL again, so the application's own guard is not what fails.
    """
    with pytest.raises(ProgrammingError, match="row-level security"):
        async with tenant_session(tenant_a.id) as session:
            await session.execute(
                text(
                    "INSERT INTO app_user "
                    "(id, tenant_id, email, password_hash, full_name, role, status, "
                    " created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :tid, 'planted@evil.example.com', 'x', "
                    "'Planted', 'admin', 'active', now(), now())"
                ),
                {"tid": tenant_b.id},
            )


async def test_orm_refuses_cross_tenant_insert_before_the_database_does(
    tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """The application layer fails first, with a message that names the object.

    RLS would also catch this, but as an opaque driver error at COMMIT. Failing in
    before_flush keeps the stack trace pointing at the code that built the row.
    """
    with pytest.raises(PermissionError, match="Refusing to insert"):
        async with tenant_session(tenant_a.id) as session:
            session.add(
                User(
                    tenant_id=tenant_b.id,
                    email="planted@evil.example.com",
                    password_hash="x",
                    full_name="Planted",
                    role="admin",
                )
            )
            await session.flush()


async def test_unbound_session_sees_nothing(
    tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """With no tenant bound, every tenant-scoped table is empty.

    This is the `current_setting('app.current_tenant', true)` design paying off: the
    two-argument form yields NULL instead of raising, `tenant_id = NULL` is never
    true, and a connection that forgot to bind fails closed. Fail-open here would
    mean any unbound code path sees the entire platform.
    """
    async with untenanted_session() as session:
        for table in ("app_user", "tenant_settings", "audit_log"):
            count = (await session.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one()
            assert count == 0, f"{table} leaked rows to an unbound session"

        # …while the two intentionally unscoped tables remain readable.
        tenants = (await session.execute(text("SELECT count(*) FROM tenant"))).scalar_one()
        assert tenants == 2


async def test_tenant_setting_does_not_survive_connection_reuse(
    tenant_a: TenantFixture,
) -> None:
    """The GUC must not outlive its transaction.

    This is what makes a shared connection pool safe. `set_config(..., is_local =>
    true)` is discarded at COMMIT, so the next request to borrow the connection
    starts unbound. Were it session-scoped instead, request N+1 would silently
    inherit request N's academy — the worst possible failure, because everything
    still appears to work.
    """
    async with tenant_session(tenant_a.id) as session:
        assert await get_current_tenant(session) == tenant_a.id

    # Re-acquire from the same pool; the previous binding must be gone.
    async with untenanted_session() as session:
        assert await get_current_tenant(session) is None


async def test_app_role_cannot_bypass_rls() -> None:
    """The property every other test in this file silently depends on.

    If the API's role were a superuser, held BYPASSRLS, or owned the tables without
    FORCE, every assertion above would pass while isolating nothing. Asserted
    explicitly because it is invisible until the day it is wrong.
    """
    async with untenanted_session() as session:
        role = (
            await session.execute(
                text(
                    "SELECT rolsuper, rolbypassrls, rolcreatedb "
                    "FROM pg_roles WHERE rolname = current_user"
                )
            )
        ).one()
        assert role.rolsuper is False, "the API role must not be a superuser"
        assert role.rolbypassrls is False, "the API role must not hold BYPASSRLS"

        owner = (
            await session.execute(
                text("SELECT tableowner FROM pg_tables WHERE tablename = 'app_user'")
            )
        ).scalar_one()
        current = (await session.execute(text("SELECT current_user"))).scalar_one()
        assert owner != current, "the API role must not own the tables it queries"


async def test_rls_is_enabled_and_forced_on_every_tenant_table() -> None:
    """ENABLE without FORCE leaves the owner exempt — check both flags."""
    async with untenanted_session() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                    "WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'"
                )
            )
        ).all()

    flags = {row.relname: (row.relrowsecurity, row.relforcerowsecurity) for row in rows}

    for table_name, table in Base.metadata.tables.items():
        # Keyed on the column, not on TenantScoped, so a table that grows a
        # tenant_id without inheriting the base is still caught. account_directory
        # is the one table that legitimately has the column and no policy — it is
        # read by an unbound session, before a tenant is known.
        if "tenant_id" not in table.columns or table_name in UNSCOPED_TABLES:
            continue
        enabled, forced = flags[table_name]
        assert enabled, f"{table_name} has no row-level security"
        assert forced, f"{table_name} has RLS but not FORCE — its owner is exempt"


async def test_every_business_table_is_tenant_scoped() -> None:
    """A guard for every phase after this one.

    A new model that forgets to inherit TenantScoped gets no tenant_id, no RLS
    policy and no automatic filtering — and nothing else would notice until it
    leaked. This fails the build instead. Adding a genuinely unscoped table means
    adding it to UNSCOPED_TABLES deliberately.
    """
    mapped = {
        mapper.class_.__tablename__
        for mapper in Base.registry.mappers
        if hasattr(mapper.class_, "__tablename__")
    }
    scoped = {
        mapper.class_.__tablename__
        for mapper in Base.registry.mappers
        if issubclass(mapper.class_, TenantScoped)
    }

    unaccounted = mapped - scoped - UNSCOPED_TABLES
    assert not unaccounted, (
        f"These tables are neither TenantScoped nor listed as intentionally "
        f"unscoped: {sorted(unaccounted)}"
    )


async def test_audit_log_is_append_only_for_the_app_role(tenant_a: TenantFixture) -> None:
    """The API physically cannot rewrite history.

    An audit log the application can edit is evidence of nothing. Enforced by
    withholding the grant rather than by convention, so a bug or an injected
    statement cannot erase the record of itself.
    """
    async with tenant_session(tenant_a.id) as session:
        await session.execute(
            text(
                "INSERT INTO audit_log (id, tenant_id, actor_kind, action, created_at, updated_at) "
                "VALUES (gen_random_uuid(), :tid, 'system', 'test.event', now(), now())"
            ),
            {"tid": tenant_a.id},
        )

    with pytest.raises(ProgrammingError, match="permission denied"):
        async with tenant_session(tenant_a.id) as session:
            await session.execute(text("UPDATE audit_log SET action = 'tampered'"))

    with pytest.raises(ProgrammingError, match="permission denied"):
        async with tenant_session(tenant_a.id) as session:
            await session.execute(text("DELETE FROM audit_log"))


async def test_tenant_id_is_stamped_automatically(tenant_a: TenantFixture) -> None:
    """Endpoints never have to thread tenant_id by hand."""
    async with tenant_session(tenant_a.id) as session:
        user = User(
            email="auto@alpha.example.com",
            password_hash="x",
            full_name="Auto Stamped",
            role="reception",
        )
        session.add(user)
        await session.flush()
        assert user.tenant_id == tenant_a.id


async def test_nonexistent_tenant_binding_yields_no_rows(tenant_a: TenantFixture) -> None:
    """Binding to a tenant that does not exist reveals nothing."""
    async with tenant_session(uuid.uuid4()) as session:
        count = (await session.execute(text("SELECT count(*) FROM app_user"))).scalar_one()
        assert count == 0
