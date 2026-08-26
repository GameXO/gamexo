"""Hard-deleting an academy: that it is complete, guarded, and leaves a record.

Three things have to hold at once, and each one has failed at least once while this
was being built:

  * **Complete.** Every tenant-owned table is emptied. The order comes from
    SQLAlchemy's foreign-key graph rather than a hand-written list, so the test that
    matters most is the one asserting nothing survives — including the two
    append-only ledgers the app role holds no DELETE grant on.
  * **Guarded.** The typed name is checked server-side, not just in the dialog.
  * **Recorded.** `audit_log` is tenant-scoped, so it goes with the academy. Without
    the tombstone there would be no evidence the academy ever existed.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import func, select, text

from app.core.security import Role
from app.db.base import Base
from app.db.session import tenant_session, untenanted_session
from app.models.tenant import DeletedTenant, Tenant
from app.models.user import PlatformAdmin
from app.tenancy.deletion import tables_to_clear
from tests.conftest import PASSWORD, TenantFixture, login, make_user
from tests.test_platform_operations import SHARED_ORIGIN, ops_headers, ops_token


async def remaining_rows(tenant_id: uuid.UUID) -> dict[str, int]:
    """Anything at all still carrying this tenant's id, across every owned table.

    Read with the session bound to the deleted tenant: RLS would otherwise hide
    exactly the rows this is looking for and report a clean sweep either way.
    """
    left: dict[str, int] = {}
    async with tenant_session(tenant_id) as session:
        for name in tables_to_clear():
            table = Base.metadata.tables[name]
            count = (
                await session.execute(
                    select(func.count()).select_from(table).where(table.c.tenant_id == tenant_id)
                )
            ).scalar_one()
            if count:
                left[name] = count
    return left


async def test_deleting_an_academy_leaves_nothing_behind(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    """The whole point, asserted against every tenant-owned table at once."""
    # Give it more than the bare provisioning rows, including an audit row — logging
    # in writes one, and `audit_log` is append-only, which is the case that broke.
    await make_user(tenant_a, email="staff@example.com", role=Role.RECEPTION)
    await login(client, tenant_a, tenant_a.admin_username, PASSWORD)

    before = await remaining_rows(tenant_a.id)
    assert before, "the fixture should have rows to delete"
    assert "audit_log" in before, "logging in should have written an audit row"

    token = await ops_token(client, platform_admin)
    response = await client.request(
        "DELETE",
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"confirm_name": tenant_a.name},
        headers=ops_headers(token),
    )
    assert response.status_code == 200, response.text

    assert await remaining_rows(tenant_a.id) == {}
    async with untenanted_session() as session:
        assert (await session.get(Tenant, tenant_a.id)) is None


async def test_the_tenant_row_itself_is_gone_from_the_list(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    token = await ops_token(client, platform_admin)
    await client.request(
        "DELETE",
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"confirm_name": tenant_a.name},
        headers=ops_headers(token),
    )
    listed = await client.get("/api/v1/platform/tenants", headers=ops_headers(token))
    assert tenant_a.slug not in [row["slug"] for row in listed.json()]


async def test_nobody_can_sign_in_to_a_deleted_academy(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    """Including through the directory, which is a separate table with its own FK."""
    token = await ops_token(client, platform_admin)
    await client.request(
        "DELETE",
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"confirm_name": tenant_a.name},
        headers=ops_headers(token),
    )

    response = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers=SHARED_ORIGIN,
    )
    assert response.status_code == 401, response.text


async def test_a_tombstone_records_who_and_how_much(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    """The academy's own audit log is destroyed with it, so this is the only record."""
    token = await ops_token(client, platform_admin)
    response = await client.request(
        "DELETE",
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"confirm_name": tenant_a.name},
        headers=ops_headers(token),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["slug"] == tenant_a.slug
    assert body["row_counts"]["app_user"] >= 1

    async with untenanted_session() as session:
        tomb = (
            await session.execute(
                select(DeletedTenant).where(DeletedTenant.tenant_id == tenant_a.id)
            )
        ).scalar_one()
    assert tomb.slug == tenant_a.slug
    assert tomb.name == tenant_a.name
    assert tomb.deleted_by_id == platform_admin.id
    assert tomb.deleted_by_label == platform_admin.username
    # Only tables that held something, so the record stays readable.
    assert all(count > 0 for count in tomb.row_counts.values())


async def test_the_typed_name_must_match(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    """Server-side, not only in the dialog — a DELETE needing just an id is one
    stray request from an academy that no longer exists."""
    token = await ops_token(client, platform_admin)
    for wrong in ("", "  ", "not the name", tenant_a.slug, tenant_a.name.upper() + "x"):
        response = await client.request(
        "DELETE",
            f"/api/v1/platform/tenants/{tenant_a.id}",
            json={"confirm_name": wrong},
            headers=ops_headers(token),
        )
        assert response.status_code in (400, 422), f"{wrong!r} -> {response.status_code}"

    async with untenanted_session() as session:
        assert (await session.get(Tenant, tenant_a.id)) is not None


async def test_the_slug_is_not_accepted_in_place_of_the_name(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    """`alpha-academy` is easier to type than `Alpha Academy`, and being easier to
    type is the opposite of what this field is for."""
    token = await ops_token(client, platform_admin)
    response = await client.request(
        "DELETE",
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"confirm_name": tenant_a.slug},
        headers=ops_headers(token),
    )
    assert response.status_code == 400
    assert response.json()["error"]["details"]["expected"] == tenant_a.name


async def test_deleting_one_academy_does_not_touch_another(
    client: AsyncClient,
    tenant_a: TenantFixture,
    tenant_b: TenantFixture,
    platform_admin: PlatformAdmin,
) -> None:
    """The cascade filters on tenant_id in 31 statements. One missing WHERE clause
    would empty the platform, and it would look exactly like success."""
    await make_user(tenant_b, email="keeper@example.com", role=Role.RECEPTION)
    before = await remaining_rows(tenant_b.id)

    token = await ops_token(client, platform_admin)
    await client.request(
        "DELETE",
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"confirm_name": tenant_a.name},
        headers=ops_headers(token),
    )

    assert await remaining_rows(tenant_b.id) == before
    signed_in = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_b.admin_username, "password": PASSWORD},
        headers=SHARED_ORIGIN,
    )
    assert signed_in.status_code == 200, signed_in.text


async def test_a_failed_delete_leaves_the_academy_whole(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    """One transaction, so a refusal partway cannot leave a half-deleted academy."""
    token = await ops_token(client, platform_admin)
    before = await remaining_rows(tenant_a.id)

    refused = await client.request(
        "DELETE",
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"confirm_name": "wrong"},
        headers=ops_headers(token),
    )
    assert refused.status_code == 400

    assert await remaining_rows(tenant_a.id) == before
    works = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers=SHARED_ORIGIN,
    )
    assert works.status_code == 200


async def test_an_academy_admin_cannot_delete_anything(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Not even its own academy, with the correct name typed."""
    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)
    response = await client.request(
        "DELETE",
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"confirm_name": tenant_a.name},
        headers={"Authorization": f"Bearer {token}", **tenant_a.headers},
    )
    assert response.status_code == 401

    async with untenanted_session() as session:
        assert (await session.get(Tenant, tenant_a.id)) is not None


async def test_deleting_an_academy_that_does_not_exist_is_404(
    client: AsyncClient, platform_admin: PlatformAdmin
) -> None:
    token = await ops_token(client, platform_admin)
    response = await client.request(
        "DELETE",
        f"/api/v1/platform/tenants/{uuid.uuid4()}",
        json={"confirm_name": "anything"},
        headers=ops_headers(token),
    )
    assert response.status_code == 404


async def test_the_delete_order_covers_every_tenant_owned_table() -> None:
    """The list is derived from the mapper registry, so a new model is included the
    moment it exists. This pins that the derivation still works — if it ever returned
    a subset, the deletions would fail on RESTRICT rather than silently orphan, but
    finding that out from a failed deletion is the expensive way."""
    from app.db.base import TenantScoped

    owned = {
        mapper.class_.__tablename__
        for mapper in Base.registry.mappers
        if issubclass(mapper.class_, TenantScoped)
    }
    assert set(tables_to_clear()) == owned
    assert len(owned) > 25, "suspiciously few tenant-owned tables — is the registry loaded?"


async def test_the_append_only_ledgers_are_still_append_only() -> None:
    """Deletion runs through a SECURITY DEFINER function precisely so the app role
    never gains a general DELETE on these. If it ever does, this feature has quietly
    made the audit trail editable from every other code path too."""
    async with untenanted_session() as session:
        granted = {
            row[0]
            for row in (
                await session.execute(
                    text(
                        "select table_name from information_schema.table_privileges "
                        "where grantee = current_user and privilege_type = 'DELETE'"
                    )
                )
            ).all()
        }
    assert "audit_log" not in granted
    assert "equipment_movement" not in granted
