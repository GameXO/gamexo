"""Switching a counter service on and off, and the tablet seeing it.

`enabled_services` has existed since onboarding wrote it, but until now nothing read
it: the dashboard had no switch and the POS rendered all four tiles unconditionally.
These tests cover the round trip that makes it real — an admin toggles in Settings,
and the counter tablet's own endpoint reports the change.

The merge behaviour is the subtle part. The Settings screen knows about four of the
eight `SERVICE_KEYS`, so a PATCH that replaced the object wholesale would silently
switch off the four it has never heard of.
"""

from __future__ import annotations

from httpx import AsyncClient

from app.core.security import Role
from tests.conftest import PASSWORD, TenantFixture, auth_headers, login, make_user

#: The four the POS home screen renders — see apps/dashboard/src/settings/services.ts.
POS_KEYS = ("checkin", "shop", "academy", "membership")


async def admin_headers(client: AsyncClient, tenant: TenantFixture) -> dict[str, str]:
    return auth_headers(await login(client, tenant, tenant.admin_username, PASSWORD), tenant)


async def test_an_admin_switches_a_counter_service_off(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    headers = await admin_headers(client, tenant_a)

    response = await client.patch(
        "/api/v1/settings",
        json={"enabled_services": {"shop": False}},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["enabled_services"]["shop"] is False

    # And it stuck, rather than only being echoed back.
    fetched = await client.get("/api/v1/settings", headers=headers)
    assert fetched.json()["enabled_services"]["shop"] is False


async def test_switching_one_service_leaves_the_others_alone(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The Settings screen sends four keys; the academy has eight.

    A replace rather than a merge would turn `booking`, `inventory`, `events` and
    `advertising` off the first time anybody touched a switch — and nothing in the UI
    would show it, because that screen does not render them.
    """
    headers = await admin_headers(client, tenant_a)
    before = (await client.get("/api/v1/settings", headers=headers)).json()["enabled_services"]

    await client.patch(
        "/api/v1/settings",
        json={"enabled_services": {key: False for key in POS_KEYS}},
        headers=headers,
    )

    after = (await client.get("/api/v1/settings", headers=headers)).json()["enabled_services"]
    untouched = {k: v for k, v in after.items() if k not in POS_KEYS}
    assert untouched == {k: v for k, v in before.items() if k not in POS_KEYS}
    assert all(after[key] is False for key in POS_KEYS)


async def test_the_counter_tablet_sees_the_change(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The whole point of the switch.

    The kiosk role sits below reception and cannot read `GET /settings`, so it reads
    the branding subset instead. If `enabled_services` ever leaves that payload, the
    tiles stop responding to the switch and nothing else fails.
    """
    kiosk = await make_user(tenant_a, email="counter@example.com", role=Role.KIOSK)
    kiosk_headers = auth_headers(await login(client, tenant_a, kiosk.username, PASSWORD), tenant_a)
    admin = await admin_headers(client, tenant_a)

    # `academy` is off by default, so switch it on first — otherwise "it is off at
    # the end" would pass without the PATCH having done anything at all.
    await client.patch(
        "/api/v1/settings", json={"enabled_services": {"academy": True}}, headers=admin
    )
    seen = await client.get("/api/v1/settings/public", headers=kiosk_headers)
    assert seen.status_code == 200, seen.text
    assert seen.json()["enabled_services"]["academy"] is True

    await client.patch(
        "/api/v1/settings", json={"enabled_services": {"academy": False}}, headers=admin
    )

    after = await client.get("/api/v1/settings/public", headers=kiosk_headers)
    assert after.json()["enabled_services"]["academy"] is False


async def test_the_counter_cannot_read_the_full_settings(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Pinned alongside the above: the tablet gets the subset, never the payload with
    GST numbers and notification addresses in it."""
    kiosk = await make_user(tenant_a, email="counter2@example.com", role=Role.KIOSK)
    headers = auth_headers(await login(client, tenant_a, kiosk.username, PASSWORD), tenant_a)
    assert (await client.get("/api/v1/settings", headers=headers)).status_code == 403


async def test_a_receptionist_cannot_change_which_services_are_offered(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Reading settings is reception and above; changing them is admin only."""
    staff = await make_user(tenant_a, email="desk@example.com", role=Role.RECEPTION)
    headers = auth_headers(await login(client, tenant_a, staff.username, PASSWORD), tenant_a)

    assert (await client.get("/api/v1/settings", headers=headers)).status_code == 200
    refused = await client.patch(
        "/api/v1/settings",
        json={"enabled_services": {"shop": False}},
        headers=headers,
    )
    assert refused.status_code == 403, refused.text


async def test_an_unknown_service_key_is_dropped_not_rejected(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A frontend one deploy ahead of the API must not fail the whole save.

    The website's signup wizard shows a `walkin` tile that is not a SERVICE_KEY; it
    strips it before sending, but the server not depending on that is what keeps a
    version skew from turning into a 422 nobody can act on.
    """
    headers = await admin_headers(client, tenant_a)
    response = await client.patch(
        "/api/v1/settings",
        json={"enabled_services": {"shop": False, "teleportation": True}},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert "teleportation" not in response.json()["enabled_services"]
    assert response.json()["enabled_services"]["shop"] is False


async def test_switching_a_service_does_not_reach_another_academy(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    await client.patch(
        "/api/v1/settings",
        json={"enabled_services": {"shop": False}},
        headers=await admin_headers(client, tenant_a),
    )
    other = await client.get("/api/v1/settings", headers=await admin_headers(client, tenant_b))
    assert other.json()["enabled_services"]["shop"] is True
