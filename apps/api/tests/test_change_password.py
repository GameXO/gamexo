"""Changing your own password, and the sessions it has to end.

An owner is provisioned with a generated password that arrives by email in
plaintext. Changing it is only meaningful if it actually cuts off anyone who read
that email — so the interesting assertions here are not "the new password works",
they are "the old one stops" and "the session already open with it stops too".

Before `token_version`, tokens were stateless and signed: nothing about a password
change invalidated them, so an attacker who had already signed in kept working until
their refresh token expired. Half of this file exists to keep that from coming back.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.auth.deps import clear_identity_cache
from app.core.security import Role
from tests.conftest import PASSWORD, TenantFixture, auth_headers, login, make_user

NEW_PASSWORD = "a-password-of-my-own"


async def change(
    client: AsyncClient,
    tenant: TenantFixture,
    token: str,
    *,
    current: str = PASSWORD,
    new: str = NEW_PASSWORD,
):
    return await client.post(
        "/api/v1/auth/password",
        json={"current_password": current, "new_password": new},
        headers=auth_headers(token, tenant),
    )


# ── The change itself ───────────────────────────────────────────────────────


async def test_an_admin_changes_their_own_password(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)
    response = await change(client, tenant_a, token)
    assert response.status_code == 200, response.text

    # A fresh pair comes back, because the bump just invalidated the one the caller
    # sent. Without this the UI would sign itself out on its own success.
    body = response.json()
    assert body["access_token"] and body["refresh_token"]

    signed_in = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": NEW_PASSWORD},
        headers=tenant_a.headers,
    )
    assert signed_in.status_code == 200, signed_in.text


async def test_the_old_password_stops_working(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)
    await change(client, tenant_a, token)

    refused = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers=tenant_a.headers,
    )
    assert refused.status_code == 401


async def test_the_wrong_current_password_is_refused(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A bearer token proves a session was opened, not that the owner is at the
    keyboard. Without this an unattended dashboard is an account takeover."""
    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)
    response = await change(client, tenant_a, token, current="not-my-password")
    assert response.status_code == 401

    # And nothing moved: the original password still works.
    still_works = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers=tenant_a.headers,
    )
    assert still_works.status_code == 200


async def test_reusing_the_same_password_is_refused(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)
    response = await change(client, tenant_a, token, new=PASSWORD)
    assert response.status_code == 422, response.text


async def test_a_short_password_is_refused(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)
    response = await change(client, tenant_a, token, new="short")
    assert response.status_code == 422, response.text


# ── The sessions it must end ────────────────────────────────────────────────


async def test_another_session_is_signed_out_immediately(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The reason token_version exists.

    Two sessions, as if the owner is on a laptop and whoever read the emailed
    password is elsewhere. Changing it from one must kill the other on its very next
    request — not in thirty minutes when the access token happens to expire.
    """
    attacker = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)
    owner = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)

    working = await client.get("/api/v1/auth/me", headers=auth_headers(attacker, tenant_a))
    assert working.status_code == 200, "precondition: both sessions are live"

    assert (await change(client, tenant_a, owner)).status_code == 200

    # The identity snapshot is per-process and caches token_version; the endpoint
    # revokes it for this process. Cleared here too so the test asserts the token
    # check rather than cache timing.
    clear_identity_cache()

    evicted = await client.get("/api/v1/auth/me", headers=auth_headers(attacker, tenant_a))
    assert evicted.status_code == 401, evicted.text


async def test_another_session_cannot_refresh_its_way_back(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Killing the access token is not enough on its own — a stale refresh token
    would simply mint a new pair and carry on past the password change."""
    stale = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers=tenant_a.headers,
    )
    stale_refresh = stale.json()["refresh_token"]

    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)
    assert (await change(client, tenant_a, token)).status_code == 200

    refused = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": stale_refresh},
        headers=tenant_a.headers,
    )
    assert refused.status_code == 401, refused.text


async def test_the_caller_keeps_working_with_the_returned_tokens(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The one session that must survive is the one that made the change."""
    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)
    issued = (await change(client, tenant_a, token)).json()
    clear_identity_cache()

    still_in = await client.get(
        "/api/v1/auth/me", headers=auth_headers(issued["access_token"], tenant_a)
    )
    assert still_in.status_code == 200, still_in.text

    renewed = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": issued["refresh_token"]},
        headers=tenant_a.headers,
    )
    assert renewed.status_code == 200, renewed.text


async def test_an_operator_reset_also_ends_the_sessions(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin
) -> None:
    """Same guarantee through the other door.

    Reissuing a password from the operator console is often an offboarding step —
    somebody has to lose access. It would be worth very little if the account being
    reset kept its live session.
    """
    from tests.test_platform_operations import ops_headers, ops_token

    victim = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)
    ops = await ops_token(client, platform_admin)

    reset = await client.post(
        f"/api/v1/platform/tenants/{tenant_a.id}/admin-password",
        json={},
        headers=ops_headers(ops),
    )
    assert reset.status_code == 200, reset.text
    clear_identity_cache()

    evicted = await client.get("/api/v1/auth/me", headers=auth_headers(victim, tenant_a))
    assert evicted.status_code == 401, evicted.text


# ── Who may call it ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("role", [Role.MANAGER, Role.RECEPTION, Role.KIOSK])
async def test_only_an_admin_may_use_this_endpoint(
    client: AsyncClient, tenant_a: TenantFixture, role: Role
) -> None:
    """Admin-only for now, by request. Staff passwords are set for them on the staff
    form and there is no screen for a staff member to change their own — when there
    is, this restriction is the thing to revisit."""
    user = await make_user(tenant_a, email=f"{role.value}@example.com", role=role)
    token = await login(client, tenant_a, user.username, PASSWORD)
    response = await change(client, tenant_a, token)
    assert response.status_code == 403, response.text


async def test_an_anonymous_caller_is_refused(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    response = await client.post(
        "/api/v1/auth/password",
        json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
        headers=tenant_a.headers,
    )
    assert response.status_code == 401


async def test_changing_a_password_cannot_reach_another_academy(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """The endpoint names no account, so there is nothing to point elsewhere — this
    pins that it stays that way, and that tenant_b is untouched."""
    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)
    assert (await change(client, tenant_a, token)).status_code == 200

    unaffected = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_b.admin_username, "password": PASSWORD},
        headers=tenant_b.headers,
    )
    assert unaffected.status_code == 200, unaffected.text
