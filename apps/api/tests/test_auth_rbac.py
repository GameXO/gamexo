"""Authentication, token handling and role-based access."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.errors import PermissionDeniedError
from app.core.security import Audience, Role, create_access_token, decode_token
from app.models.user import PlatformAdmin, UserStatus
from tests.conftest import PASSWORD, TenantFixture, auth_headers, login, make_user


async def test_login_returns_a_token_pair(client: AsyncClient, tenant_a: TenantFixture) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_email, "password": PASSWORD},
        headers=tenant_a.headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] == 30 * 60

    claims = decode_token(body["access_token"], audience=Audience.TENANT)
    assert claims["tid"] == str(tenant_a.id)
    assert claims["role"] == Role.ADMIN.value


async def test_wrong_password_and_unknown_email_are_indistinguishable(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Neither response discloses whether the email is registered."""
    wrong_password = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_email, "password": "not-the-password"},
        headers=tenant_a.headers,
    )
    unknown_email = await client.post(
        "/api/v1/auth/login",
        json={"username": "nobody@nowhere.example.com", "password": PASSWORD},
        headers=tenant_a.headers,
    )

    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()


async def test_credentials_do_not_work_against_another_academy(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """Tenant A's admin cannot log in through tenant B's hostname.

    The password is correct — it is simply not a credential at that academy. The
    tenant-bound session means the user lookup cannot even see the row.
    """
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_email, "password": PASSWORD},
        headers=tenant_b.headers,
    )
    assert response.status_code == 401


async def test_token_from_one_academy_is_rejected_at_another(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """Cross-tenant token replay.

    The token is valid, unexpired and correctly signed. It is refused because the
    tenant resolved from the request disagrees with the token's `tid` claim — which
    only works because the tenant is resolved independently of the token.
    """
    token = await login(client, tenant_a, tenant_a.admin_email, PASSWORD)

    ok = await client.get("/api/v1/auth/me", headers=auth_headers(token, tenant_a))
    assert ok.status_code == 200

    replayed = await client.get("/api/v1/auth/me", headers=auth_headers(token, tenant_b))
    assert replayed.status_code == 403
    assert "different academy" in replayed.json()["error"]["message"]


async def test_me_returns_the_user_and_their_academy(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    token = await login(client, tenant_a, tenant_a.admin_email, PASSWORD)
    response = await client.get("/api/v1/auth/me", headers=auth_headers(token, tenant_a))

    assert response.status_code == 200
    body = response.json()
    assert body["user"]["email"] == tenant_a.admin_email
    assert body["user"]["role"] == Role.ADMIN.value
    assert body["tenant"]["slug"] == tenant_a.slug
    assert body["platform_admin"] is None


async def test_on_leave_staff_cannot_log_in(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """An unattended logged-in account is exactly what an operations audit flags."""
    await make_user(
        tenant_a,
        email="onleave@alpha.example.com",
        role=Role.RECEPTION,
        status=UserStatus.ON_LEAVE,
    )
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": "onleave@alpha.example.com", "password": PASSWORD},
        headers=tenant_a.headers,
    )
    assert response.status_code == 401
    assert "on-leave" in response.json()["error"]["message"]


async def test_refresh_returns_a_new_pair(client: AsyncClient, tenant_a: TenantFixture) -> None:
    login_response = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_email, "password": PASSWORD},
        headers=tenant_a.headers,
    )
    refresh_token = login_response.json()["refresh_token"]

    response = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
        headers=tenant_a.headers,
    )
    assert response.status_code == 200
    assert decode_token(response.json()["access_token"], audience=Audience.TENANT)


async def test_an_access_token_cannot_be_used_to_refresh(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The `typ` claim check.

    Without it the two token types are interchangeable, and the long-lived refresh
    token becomes a bearer credential for the entire API.
    """
    access = await login(client, tenant_a, tenant_a.admin_email, PASSWORD)
    response = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": access},
        headers=tenant_a.headers,
    )
    assert response.status_code == 401


async def test_a_refresh_token_is_not_a_bearer_credential(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    login_response = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_email, "password": PASSWORD},
        headers=tenant_a.headers,
    )
    refresh_token = login_response.json()["refresh_token"]

    response = await client.get(
        "/api/v1/auth/me", headers=auth_headers(refresh_token, tenant_a)
    )
    assert response.status_code == 401


async def test_unauthenticated_and_garbage_tokens_are_rejected(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    anonymous = await client.get("/api/v1/auth/me", headers=tenant_a.headers)
    assert anonymous.status_code == 401

    garbage = await client.get(
        "/api/v1/auth/me", headers=auth_headers("not.a.token", tenant_a)
    )
    assert garbage.status_code == 401


async def test_validation_errors_do_not_echo_the_submitted_password(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A 422 must not reflect the credential back.

    Pydantic includes the offending `input` in every error entry. On a login that
    is the password, returned in a body that ends up in browser consoles, proxy
    logs and error trackers.
    """
    # 7 characters, so it fails the min_length rule and the whole value becomes the
    # "input" Pydantic would echo. Deliberately not a word that occurs in Pydantic's
    # own error type names, or the assertion below passes for the wrong reason.
    secret = "hunter2"
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_email, "password": secret},
        headers=tenant_a.headers,
    )
    assert response.status_code == 422
    assert secret not in response.text
    assert "input" not in response.text


async def test_a_token_signed_with_the_wrong_key_is_rejected(
    client: AsyncClient, tenant_a: TenantFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core import security

    forged = create_access_token(
        subject=str(tenant_a.admin_id),
        audience=Audience.TENANT,
        claims={"tid": str(tenant_a.id), "role": "admin"},
    )
    monkeypatch.setattr(security.settings.jwt_secret_key, "_secret_value", "different-key")

    response = await client.get("/api/v1/auth/me", headers=auth_headers(forged, tenant_a))
    assert response.status_code == 401


# ── Role hierarchy ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("actual", "required", "allowed"),
    [
        (Role.ADMIN, Role.ADMIN, True),
        (Role.ADMIN, Role.MANAGER, True),
        (Role.ADMIN, Role.RECEPTION, True),
        (Role.MANAGER, Role.ADMIN, False),
        (Role.MANAGER, Role.MANAGER, True),
        (Role.MANAGER, Role.RECEPTION, True),
        (Role.RECEPTION, Role.ADMIN, False),
        (Role.RECEPTION, Role.MANAGER, False),
        (Role.RECEPTION, Role.RECEPTION, True),
        # The counter tablet. Everything the dashboard exposes is guarded at
        # RECEPTION or above, so these three False cases ARE the kiosk's blast
        # radius — reporting, staff, settings and finance all sit behind them.
        (Role.KIOSK, Role.ADMIN, False),
        (Role.KIOSK, Role.MANAGER, False),
        (Role.KIOSK, Role.RECEPTION, False),
        (Role.KIOSK, Role.KIOSK, True),
        # ...and every real person can still work the counter.
        (Role.RECEPTION, Role.KIOSK, True),
        (Role.MANAGER, Role.KIOSK, True),
        (Role.ADMIN, Role.KIOSK, True),
    ],
)
def test_role_hierarchy(actual: Role, required: Role, allowed: bool) -> None:
    """Higher roles satisfy lower requirements.

    A flat role set means every admin-facing endpoint has to remember to list all
    three roles, and the one that forgets locks the owner out of their own academy.
    """
    from app.auth.deps import Principal, require_roles

    principal = Principal(
        id=tenant_uuid(), kind="user", email="x@y.example.com", tenant_id=tenant_uuid(), role=actual
    )
    guard = require_roles(required)

    if allowed:
        assert guard(principal) is principal
    else:
        with pytest.raises(PermissionDeniedError):
            guard(principal)


def test_platform_admin_passes_every_role_guard() -> None:
    from app.auth.deps import Principal, require_roles

    operator = Principal(
        id=tenant_uuid(),
        kind="platform_admin",
        email="ops@gamexo.example.com",
        tenant_id=tenant_uuid(),
        role=None,
    )
    assert require_roles(Role.ADMIN)(operator) is operator


def tenant_uuid():
    import uuid

    return uuid.uuid4()


# ── Platform operators ──────────────────────────────────────────────────────


async def test_platform_login_and_tenant_provisioning(
    client: AsyncClient, platform_admin: PlatformAdmin
) -> None:
    login_response = await client.post(
        "/api/v1/platform/login",
        json={"username": platform_admin.email, "password": PASSWORD},
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]

    created = await client.post(
        "/api/v1/platform/tenants",
        json={
            "slug": "gamma-club",
            "name": "Gamma Club",
            "admin": {
                "email": "owner@gamma.example.com",
                "password": PASSWORD,
                "full_name": "Gamma Owner",
            },
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["tenant"]["slug"] == "gamma-club"
    assert created.json()["admin"]["role"] == Role.ADMIN.value

    # The provisioned admin can immediately log in to the new academy.
    staff_login = await client.post(
        "/api/v1/auth/login",
        json={"username": "owner@gamma.example.com", "password": PASSWORD},
        headers={"X-Tenant-ID": "gamma-club"},
    )
    assert staff_login.status_code == 200


async def test_a_tenant_token_cannot_reach_platform_endpoints(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Audience separation: staff credentials are not operator credentials."""
    token = await login(client, tenant_a, tenant_a.admin_email, PASSWORD)
    response = await client.get(
        "/api/v1/platform/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 401


async def test_duplicate_slug_is_rejected(
    client: AsyncClient, platform_admin: PlatformAdmin, tenant_a: TenantFixture
) -> None:
    login_response = await client.post(
        "/api/v1/platform/login",
        json={"username": platform_admin.email, "password": PASSWORD},
    )
    token = login_response.json()["access_token"]

    response = await client.post(
        "/api/v1/platform/tenants",
        json={
            "slug": tenant_a.slug,
            "name": "Impostor",
            "admin": {
                "email": "impostor@x.example.com",
                "password": PASSWORD,
                "full_name": "Impostor",
            },
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 409


async def test_reserved_slugs_are_refused(
    client: AsyncClient, platform_admin: PlatformAdmin
) -> None:
    """`api.gamexo.app` must not become somebody's academy."""
    login_response = await client.post(
        "/api/v1/platform/login",
        json={"username": platform_admin.email, "password": PASSWORD},
    )
    token = login_response.json()["access_token"]

    response = await client.post(
        "/api/v1/platform/tenants",
        json={
            "slug": "api",
            "name": "Reserved",
            "admin": {"email": "a@b.example.com", "password": PASSWORD, "full_name": "A B"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code >= 400
