"""The login scheme and what each level may actually reach.

Two things are asserted here that nothing else covers:

  * **The username scheme is what the product promises.** `admin@{tenant}`,
    `{name}.staff@{tenant}`, `kiosk@{tenant}`, `ops@gamexo` — written down in
    auth/usernames.py and checked here against the accounts the API really creates.

  * **The levels are boundaries, not labels.** A role is only meaningful if the
    thing it excludes is genuinely refused, so every test below names an operation
    one level can do and the one beneath it cannot.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth import usernames
from app.core.security import Role
from app.db.session import tenant_session, untenanted_session
from app.models.user import AccountDirectory, User
from tests.conftest import PASSWORD, TenantFixture, auth_headers, login, make_user

NO_TENANT: dict[str, str] = {"host": "app.gamexo.app"}


async def token_for(client: AsyncClient, tenant: TenantFixture, role: Role) -> str:
    """A signed-in staff member at `role`, and their access token."""
    user = await make_user(tenant, email=f"{role.value}@{tenant.slug}.example.com", role=role)
    return await login(client, tenant, user.username, PASSWORD)


# ── The scheme ──────────────────────────────────────────────────────────────


def test_the_username_shapes_are_what_the_product_promises() -> None:
    assert usernames.for_admin("navigo-sports") == "admin@navigo-sports"
    assert usernames.for_kiosk("navigo-sports") == "kiosk@navigo-sports"
    assert usernames.for_staff("Rahul Joshi", "navigo-sports") == (
        "rahul-joshi.staff@navigo-sports"
    )
    assert usernames.OPS_USERNAME == "ops@gamexo"


def test_a_staff_member_cannot_claim_a_platform_name() -> None:
    """Somebody genuinely called "Admin" must not collide with the owner."""
    assert usernames.for_staff("Admin", "navigo") == "admin-staff.staff@navigo"
    assert usernames.for_staff("kiosk", "navigo") == "kiosk-staff.staff@navigo"


def test_a_username_is_not_a_deliverable_address() -> None:
    """The part after the @ is a slug. Nothing should ever try to send mail to it."""
    assert not usernames.looks_like_email("admin@navigo-sports")
    assert usernames.looks_like_email("owner@gmail.com")


async def test_the_owner_gets_admin_at_their_slug(tenant_a: TenantFixture) -> None:
    async with tenant_session(tenant_a.id) as session:
        admin = (
            await session.execute(select(User).where(User.role == Role.ADMIN))
        ).scalars().one()
    assert admin.username == f"admin@{tenant_a.slug}"


async def test_staff_usernames_are_generated_not_chosen(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)

    created = await client.post(
        "/api/v1/staff",
        json={
            "email": "rahul@personal.example.com",
            "password": PASSWORD,
            "full_name": "Rahul Joshi",
            "role": "manager",
        },
        headers=auth_headers(token, tenant_a),
    )
    assert created.status_code == 201, created.text
    assert created.json()["username"] == f"rahul-joshi.staff@{tenant_a.slug}"
    # The email is still theirs, and still not what they sign in with.
    assert created.json()["email"] == "rahul@personal.example.com"


async def test_a_second_rahul_is_suffixed_rather_than_refused(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Two people with the same name at one turf is ordinary, not exceptional."""
    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)

    async def add(email: str) -> str:
        response = await client.post(
            "/api/v1/staff",
            json={
                "email": email,
                "password": PASSWORD,
                "full_name": "Rahul Joshi",
                "role": "reception",
            },
            headers=auth_headers(token, tenant_a),
        )
        assert response.status_code == 201, response.text
        return response.json()["username"]

    assert await add("rahul1@example.com") == f"rahul-joshi.staff@{tenant_a.slug}"
    assert await add("rahul2@example.com") == f"rahul-joshi-2.staff@{tenant_a.slug}"


async def test_a_kiosk_cannot_be_added_through_the_staff_form(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The counter login ships with the academy. A second one is two credentials
    for one device and no way to tell which is in use."""
    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)

    refused = await client.post(
        "/api/v1/staff",
        json={
            "email": "counter2@example.com",
            "password": PASSWORD,
            "full_name": "Second Counter",
            "role": "kiosk",
        },
        headers=auth_headers(token, tenant_a),
    )
    assert refused.status_code == 409, refused.text


async def test_every_login_lands_in_the_directory(tenant_a: TenantFixture) -> None:
    """Without a directory row a user authenticates on a subdomain and is invisible
    on the shared origin — which is where every self-serve academy lives."""
    await make_user(tenant_a, email="dir@example.com", role=Role.MANAGER)

    async with tenant_session(tenant_a.id) as session:
        users = {u.username for u in (await session.execute(select(User))).scalars()}
    async with untenanted_session() as session:
        listed = {
            row.username
            for row in (
                await session.execute(
                    select(AccountDirectory).where(
                        AccountDirectory.tenant_id == tenant_a.id
                    )
                )
            ).scalars()
        }
    assert users <= listed


async def test_directory_username_must_equal_the_users_own(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A directory row that names the right academy but the wrong username is worse
    than a missing one, because everything downstream looks healthy.

    This is the shape revision c3b81d47f602 left behind: `account_directory.username`
    stamped with the email address instead of the user's username. The column was
    NOT NULL, unique and populated; the account existed; the password was right — and
    the username the owner had been emailed resolved to no academy at all, so a
    correct credential came back "Incorrect username or password".

    Reproduced here rather than described, because the only thing that makes it
    visible is signing in.
    """
    async with untenanted_session() as session:
        entry = (
            await session.execute(
                select(AccountDirectory).where(
                    AccountDirectory.username == tenant_a.admin_username
                )
            )
        ).scalar_one()
        entry.username = tenant_a.admin_email  # what the broken backfill wrote
        await session.commit()

    # The username still authenticates *if* the academy is named some other way —
    # a subdomain, say — which is why this survived testing on a per-tenant host.
    on_subdomain = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers={"host": tenant_a.host},
    )
    assert on_subdomain.status_code == 200, on_subdomain.text

    # On the shared origin the directory is the only way to find the academy, and
    # this is the failure the owner actually hit.
    on_shared_origin = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers=NO_TENANT,
    )
    assert on_shared_origin.status_code == 401

    # Restoring the invariant restores the login, with nothing else changed.
    async with untenanted_session() as session:
        entry = (
            await session.execute(
                select(AccountDirectory).where(
                    AccountDirectory.email == tenant_a.admin_email
                )
            )
        ).scalar_one()
        entry.username = tenant_a.admin_username
        await session.commit()

    repaired = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers=NO_TENANT,
    )
    assert repaired.status_code == 200, repaired.text


# ── Signing in ──────────────────────────────────────────────────────────────


async def test_signing_in_with_a_username_on_a_shared_origin(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """No host, no header — the academy comes from the username alone."""
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers=NO_TENANT,
    )
    assert response.status_code == 200, response.text


async def test_a_username_is_case_insensitive(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username.upper(), "password": PASSWORD},
        headers=NO_TENANT,
    )
    assert response.status_code == 200, response.text


async def test_one_academys_username_does_not_open_another(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """`admin@alpha-academy` and `admin@beta-sports` differ only after the @, which
    is exactly the case a slug-embedded scheme has to get right."""
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers={"host": tenant_b.host},
    )
    assert response.status_code == 401, response.text


async def test_the_error_message_names_a_username_not_an_email(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": f"nobody@{tenant_a.slug}", "password": PASSWORD},
        headers=NO_TENANT,
    )
    assert response.status_code == 401
    assert "username" in response.json()["error"]["message"].lower()


async def test_renaming_the_academy_carries_its_logins_with_it(
    client: AsyncClient,
) -> None:
    """`/auth/signup` provisions under a placeholder and names the turf afterwards.

    Without a rebase the owner would sign in as `admin@turf-9f3a2b` for good —
    a credential nobody would recognise and nobody chose.
    """
    signed_up = await client.post(
        "/api/v1/auth/signup",
        json={
            "email": "rename@example.com",
            "password": PASSWORD,
            "full_name": "Rename Owner",
        },
        headers=NO_TENANT,
    )
    assert signed_up.status_code == 201, signed_up.text
    bearer = {
        "Authorization": f"Bearer {signed_up.json()['access_token']}",
        **NO_TENANT,
    }

    before = (await client.get("/api/v1/auth/me", headers=bearer)).json()
    assert before["user"]["username"].endswith("@" + before["tenant"]["slug"])
    assert before["tenant"]["slug"].startswith("turf-")

    done = await client.post(
        "/api/v1/onboarding/complete",
        json={"business_name": "Renamed Arena", "sports": [{"slug": "badminton"}]},
        headers=bearer,
    )
    assert done.status_code == 200, done.text

    after = (await client.get("/api/v1/auth/me", headers=bearer)).json()
    assert after["tenant"]["slug"] == "renamed-arena"
    assert after["user"]["username"] == "admin@renamed-arena"

    # And the new name is what actually authenticates.
    signed_in = await client.post(
        "/api/v1/auth/login",
        json={"username": "admin@renamed-arena", "password": PASSWORD},
        headers=NO_TENANT,
    )
    assert signed_in.status_code == 200, signed_in.text


# ── What each level may reach ───────────────────────────────────────────────
#
# The spec, restated as boundaries:
#
#   kiosk  — the counter: bookings, check-in, add-ons. Nothing else.
#   staff  — the above, plus inventory, courts, membership, academy.
#            NOT staff management, NOT integrations.
#   admin  — everything, including those two.
#   ops    — everything, across every academy.


@pytest.mark.parametrize("role", [Role.KIOSK, Role.RECEPTION, Role.MANAGER])
async def test_only_an_admin_manages_staff(
    client: AsyncClient, tenant_a: TenantFixture, role: Role
) -> None:
    """The line the spec draws hardest: staff management is admin-only."""
    token = await token_for(client, tenant_a, role)

    refused = await client.post(
        "/api/v1/staff",
        json={
            "email": f"new-{role.value}@example.com",
            "password": PASSWORD,
            "full_name": "Someone New",
            "role": "reception",
        },
        headers=auth_headers(token, tenant_a),
    )
    assert refused.status_code == 403, refused.text


@pytest.mark.parametrize("role", [Role.KIOSK, Role.RECEPTION, Role.MANAGER])
async def test_only_an_admin_reaches_integrations(
    client: AsyncClient, tenant_a: TenantFixture, role: Role
) -> None:
    """The other half of that line — and the more dangerous one, since these are
    the credentials that move an academy's money."""
    token = await token_for(client, tenant_a, role)

    gateways = await client.get(
        "/api/v1/payments/providers", headers=auth_headers(token, tenant_a)
    )
    partners = await client.get(
        "/api/v1/partners", headers=auth_headers(token, tenant_a)
    )
    assert gateways.status_code == 403, gateways.text
    assert partners.status_code == 403, partners.text


async def test_staff_manage_inventory_and_courts(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Everything the spec grants the staff level, asserted as reachable."""
    token = await token_for(client, tenant_a, Role.MANAGER)
    headers = auth_headers(token, tenant_a)

    for path in ("/api/v1/equipment", "/api/v1/courts", "/api/v1/sports",
                 "/api/v1/bookings", "/api/v1/customers"):
        response = await client.get(path, headers=headers)
        assert response.status_code == 200, f"{path}: {response.text}"


async def test_the_counter_cannot_read_the_business(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The kiosk credential sits on a tablet anyone can walk up to.

    It holds a valid token for the academy, so what protects the business is that
    everything worth reading is guarded above it.
    """
    token = await token_for(client, tenant_a, Role.KIOSK)
    headers = auth_headers(token, tenant_a)

    for path in ("/api/v1/settings", "/api/v1/staff", "/api/v1/payments/providers"):
        response = await client.get(path, headers=headers)
        assert response.status_code == 403, f"{path} was reachable: {response.text}"


async def test_the_counter_can_still_run_the_counter(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Locked down is not the same as useless — the tablet has a job to do."""
    token = await token_for(client, tenant_a, Role.KIOSK)
    headers = auth_headers(token, tenant_a)

    for path in ("/api/v1/courts", "/api/v1/sports", "/api/v1/settings/public"):
        response = await client.get(path, headers=headers)
        assert response.status_code == 200, f"{path}: {response.text}"


async def test_the_ops_account_sees_every_academy(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture, platform_admin
) -> None:
    """The one account with a view across the platform, and its username."""
    assert platform_admin.username == "ops@gamexo"

    signed_in = await client.post(
        "/api/v1/platform/login",
        json={"username": "ops@gamexo", "password": PASSWORD},
        headers=NO_TENANT,
    )
    assert signed_in.status_code == 200, signed_in.text

    listed = await client.get(
        "/api/v1/platform/tenants",
        headers={"Authorization": f"Bearer {signed_in.json()['access_token']}"},
    )
    assert listed.status_code == 200, listed.text
    slugs = {t["slug"] for t in listed.json()}
    assert {tenant_a.slug, tenant_b.slug} <= slugs


async def test_an_academy_admin_is_not_an_ops_account(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A tenant token must not open the platform control plane, however senior."""
    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)

    refused = await client.get(
        "/api/v1/platform/tenants", headers={"Authorization": f"Bearer {token}"}
    )
    assert refused.status_code in (401, 403), refused.text
