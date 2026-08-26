"""What `ops@gamexo` can do to an academy, and what nobody else can.

The operator console is the one surface that acts *on* academies rather than inside
one, so every test here names both halves: the thing an operator can do, and the
same thing refused to the academy's own admin. A platform capability that a tenant
admin can also reach is not a capability, it is a hole.

The suspension tests are the load-bearing ones. Suspension is enforced by the tenant
resolver, and login is the one endpoint that never goes through it — on a shared
origin the academy is found in `account_directory` from the typed username, so a
suspended academy would otherwise sign in exactly as before. Every deployment that
matters is a shared origin.
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient

from app.auth import usernames
from app.db.session import untenanted_session
from app.models.tenant import Tenant, TenantStatus
from app.models.user import PlatformAdmin
from tests.conftest import PASSWORD, TenantFixture, login

#: No subdomain to resolve from — the deployment shape this all runs on.
SHARED_ORIGIN = {"host": "app.gamexo.app"}


async def ops_token(client: AsyncClient, admin: PlatformAdmin) -> str:
    response = await client.post(
        "/api/v1/platform/login",
        json={"username": admin.username, "password": PASSWORD},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def ops_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def status_of(tenant_id: uuid.UUID) -> TenantStatus:
    async with untenanted_session() as session:
        return (await session.get(Tenant, tenant_id)).status


# ── Standing and plan ───────────────────────────────────────────────────────


async def test_an_operator_suspends_and_reactivates_an_academy(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    token = await ops_token(client, platform_admin)

    suspended = await client.patch(
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"status": "suspended"},
        headers=ops_headers(token),
    )
    assert suspended.status_code == 200, suspended.text
    assert suspended.json()["status"] == "suspended"
    assert await status_of(tenant_a.id) is TenantStatus.SUSPENDED

    reactivated = await client.patch(
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"status": "active"},
        headers=ops_headers(token),
    )
    assert reactivated.status_code == 200, reactivated.text
    assert await status_of(tenant_a.id) is TenantStatus.ACTIVE


async def test_suspension_actually_refuses_the_login(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    """The regression this feature would otherwise have shipped with.

    Login resolves its academy from the directory, not from the resolver, so nothing
    on this path had ever looked at `tenant.status`. Suspending an academy changed a
    column and locked out precisely nobody.
    """
    token = await ops_token(client, platform_admin)

    before = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers=SHARED_ORIGIN,
    )
    assert before.status_code == 200, before.text

    await client.patch(
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"status": "suspended"},
        headers=ops_headers(token),
    )

    after = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers=SHARED_ORIGIN,
    )
    assert after.status_code == 403, after.text
    assert "suspended" in after.text.lower()


async def test_a_wrong_password_at_a_suspended_academy_still_says_wrong_password(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    """The suspension check runs *after* the credential, so it is not an oracle.

    Told "that academy is suspended" before proving the password, anyone could
    confirm which usernames exist by watching the error change.
    """
    token = await ops_token(client, platform_admin)
    await client.patch(
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"status": "suspended"},
        headers=ops_headers(token),
    )

    response = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": "not-the-password"},
        headers=SHARED_ORIGIN,
    )
    assert response.status_code == 401
    assert "suspended" not in response.text.lower()


async def test_a_suspended_academy_cannot_renew_its_session(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    """A session that predates the suspension must not refresh its way past it."""
    signed_in = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers=SHARED_ORIGIN,
    )
    refresh_token = signed_in.json()["refresh_token"]

    token = await ops_token(client, platform_admin)
    await client.patch(
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"status": "suspended"},
        headers=ops_headers(token),
    )

    response = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
        headers=SHARED_ORIGIN,
    )
    assert response.status_code == 403, response.text


async def test_an_operator_changes_the_plan_tier(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    token = await ops_token(client, platform_admin)
    response = await client.patch(
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"plan_tier": "pro"},
        headers=ops_headers(token),
    )
    assert response.status_code == 200, response.text
    assert response.json()["plan_tier"] == "pro"
    # Unspecified fields are left alone rather than reset to a default.
    assert response.json()["status"] == "active"


async def test_an_unknown_plan_tier_is_refused(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    """The enum is the contract — a typo must not become a tenant's plan."""
    token = await ops_token(client, platform_admin)
    response = await client.patch(
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={"plan_tier": "enterprise"},
        headers=ops_headers(token),
    )
    assert response.status_code == 422, response.text


async def test_an_empty_update_is_refused(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    token = await ops_token(client, platform_admin)
    response = await client.patch(
        f"/api/v1/platform/tenants/{tenant_a.id}",
        json={},
        headers=ops_headers(token),
    )
    assert response.status_code == 422, response.text


async def test_updating_an_academy_that_does_not_exist_is_404(
    client: AsyncClient, platform_admin: PlatformAdmin
) -> None:
    token = await ops_token(client, platform_admin)
    response = await client.patch(
        f"/api/v1/platform/tenants/{uuid.uuid4()}",
        json={"status": "active"},
        headers=ops_headers(token),
    )
    assert response.status_code == 404, response.text


# ── Reissuing a credential ──────────────────────────────────────────────────


async def test_an_operator_reissues_the_admin_password(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    """The whole point: the new password works and the old one stops."""
    token = await ops_token(client, platform_admin)

    response = await client.post(
        f"/api/v1/platform/tenants/{tenant_a.id}/admin-password",
        json={},
        headers=ops_headers(token),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["username"] == tenant_a.admin_username
    assert body["email"] == tenant_a.admin_email
    new_password = body["password"]
    assert new_password and new_password != PASSWORD

    works = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": new_password},
        headers=SHARED_ORIGIN,
    )
    assert works.status_code == 200, works.text

    old = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers=SHARED_ORIGIN,
    )
    assert old.status_code == 401


async def test_a_reissue_can_name_any_account_at_the_academy(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    """Not only the owner — a counter tablet loses its password just as often."""
    token = await ops_token(client, platform_admin)
    kiosk_username = usernames.for_kiosk(tenant_a.slug)

    # tenant_a has no kiosk (provision_tenant alone does not make one), so this is
    # also the "named account does not exist" case.
    missing = await client.post(
        f"/api/v1/platform/tenants/{tenant_a.id}/admin-password",
        json={"username": kiosk_username},
        headers=ops_headers(token),
    )
    assert missing.status_code == 404, missing.text
    assert kiosk_username in missing.text


async def test_reissuing_at_an_academy_that_does_not_exist_is_404(
    client: AsyncClient, platform_admin: PlatformAdmin
) -> None:
    token = await ops_token(client, platform_admin)
    response = await client.post(
        f"/api/v1/platform/tenants/{uuid.uuid4()}/admin-password",
        json={},
        headers=ops_headers(token),
    )
    assert response.status_code == 404, response.text


# ── Creating an academy ─────────────────────────────────────────────────────


async def test_an_operator_created_academy_arrives_with_a_counter_login(
    client: AsyncClient, platform_admin: PlatformAdmin
) -> None:
    """Same shape as a self-serve signup.

    An academy provisioned by an operator used to arrive with an owner and no counter
    account, so its front desk could not sign in to the POS at all — the same gap
    self-serve signup had, reached through the other door.
    """
    token = await ops_token(client, platform_admin)
    response = await client.post(
        "/api/v1/platform/tenants",
        json={
            "slug": "operator-made",
            "name": "Operator Made",
            "admin": {"email": "owner@operator-made.example.com", "full_name": "Owner Person"},
        },
        headers=ops_headers(token),
    )
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["admin"]["username"] == "admin@operator-made"
    assert body["kiosk_username"] == "kiosk@operator-made"
    # Both passwords are returned exactly once, and they are not the same one.
    assert body["admin_password"] and body["kiosk_password"]
    assert body["admin_password"] != body["kiosk_password"]

    for username, password in (
        (body["admin"]["username"], body["admin_password"]),
        (body["kiosk_username"], body["kiosk_password"]),
    ):
        signed_in = await client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": password},
            headers=SHARED_ORIGIN,
        )
        assert signed_in.status_code == 200, f"{username}: {signed_in.text}"


async def test_a_chosen_password_is_not_echoed_back(
    client: AsyncClient, platform_admin: PlatformAdmin
) -> None:
    """Only a generated password is returned. Reflecting the caller's own puts it in
    a log and a browser cache for no benefit."""
    token = await ops_token(client, platform_admin)
    response = await client.post(
        "/api/v1/platform/tenants",
        json={
            "slug": "chosen-password",
            "name": "Chosen Password",
            "admin": {
                "email": "owner@chosen-password.example.com",
                "full_name": "Owner Person",
                "password": "a-password-they-picked",
            },
        },
        headers=ops_headers(token),
    )
    assert response.status_code == 201, response.text
    assert response.json()["admin_password"] is None


# ── Nobody else ─────────────────────────────────────────────────────────────


async def test_an_academy_admin_cannot_touch_any_of_this(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin: PlatformAdmin
) -> None:
    """The highest role inside an academy is still not a platform operator.

    Its own id is used deliberately: this is not "you may not edit somebody else's
    academy", it is "this control plane is not yours at all".
    """
    del platform_admin
    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)
    headers = {"Authorization": f"Bearer {token}", **tenant_a.headers}

    refused = [
        await client.patch(
            f"/api/v1/platform/tenants/{tenant_a.id}", json={"status": "active"}, headers=headers
        ),
        await client.post(
            f"/api/v1/platform/tenants/{tenant_a.id}/admin-password", json={}, headers=headers
        ),
        await client.get("/api/v1/platform/tenants", headers=headers),
        await client.post(
            "/api/v1/platform/tenants",
            json={
                "slug": "self-promoted",
                "name": "Self Promoted",
                "admin": {"email": "x@example.com", "full_name": "X"},
            },
            headers=headers,
        ),
    ]
    assert [r.status_code for r in refused] == [401, 401, 401, 401]


async def test_an_anonymous_caller_cannot_touch_any_of_this(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    refused = [
        await client.patch(
            f"/api/v1/platform/tenants/{tenant_a.id}", json={"status": "active"}
        ),
        await client.post(f"/api/v1/platform/tenants/{tenant_a.id}/admin-password", json={}),
        await client.get("/api/v1/platform/tenants"),
    ]
    assert all(r.status_code == 401 for r in refused), [r.status_code for r in refused]
