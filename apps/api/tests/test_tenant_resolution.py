"""How a request becomes a tenant."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from pydantic import ValidationError

from app.core.config import Settings
from app.tenancy.resolver import extract_slug_from_host
from tests.conftest import PASSWORD, TenantFixture, auth_headers, login


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("myacademy.gamexo.app", "myacademy"),
        ("myacademy.gamexo.app:443", "myacademy"),
        ("MyAcademy.GameXO.App", "myacademy"),
        ("myacademy.gamexo.app.", "myacademy"),  # trailing-dot FQDN
        ("alpha.localhost:8000", "alpha"),  # subdomain routing, locally
        ("gamexo.app", None),  # apex
        ("www.gamexo.app", None),
        ("localhost", None),
        ("localhost:8000", None),
        ("127.0.0.1:8000", None),
        ("", None),
        (None, None),
    ],
)
def test_host_to_slug(host: str | None, expected: str | None) -> None:
    assert extract_slug_from_host(host, "gamexo.app") == expected


async def test_subdomain_resolves_the_academy(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The production path, with no X-Tenant-ID header in sight."""
    response = await client.get(
        "/api/v1/health/tenant", headers={"Host": tenant_a.host}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "tenant_id": str(tenant_a.id),
        "slug": tenant_a.slug,
        "resolved_via": "host",
    }


async def test_login_works_over_the_subdomain(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_email, "password": PASSWORD},
        headers={"Host": tenant_a.host},
    )
    assert response.status_code == 200, response.text


async def test_header_beats_host_in_development(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """X-Tenant-ID takes priority, which is why it must be off in production."""
    response = await client.get(
        "/api/v1/health/tenant",
        headers={"Host": tenant_a.host, "X-Tenant-ID": tenant_b.slug},
    )
    assert response.json()["slug"] == tenant_b.slug
    assert response.json()["resolved_via"] == "header"


async def test_the_header_accepts_a_uuid_too(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    response = await client.get(
        "/api/v1/health/tenant", headers={"X-Tenant-ID": str(tenant_a.id)}
    )
    assert response.json()["slug"] == tenant_a.slug


async def test_unknown_and_missing_tenants_are_rejected(client: AsyncClient) -> None:
    unknown = await client.get(
        "/api/v1/health/tenant", headers={"X-Tenant-ID": "no-such-academy"}
    )
    assert unknown.status_code == 400
    assert unknown.json()["error"]["code"] == "tenant_unresolved"

    unresolvable = await client.get("/api/v1/health/tenant", headers={"Host": "localhost"})
    assert unresolvable.status_code == 400
    assert unresolvable.json()["error"]["code"] == "tenant_unresolved"


async def test_impersonation_requires_a_platform_token(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """A staff token cannot impersonate, even with a valid header.

    The header is only honoured after the bearer token is *fully verified* as a
    platform-audience token — signature, expiry and audience. Peeking at unverified
    claims here would make impersonation available to anyone who can craft JSON.
    """
    token = await login(client, tenant_a, tenant_a.admin_email, PASSWORD)
    response = await client.get(
        "/api/v1/health/tenant",
        headers={**auth_headers(token, tenant_a), "X-Impersonate-Tenant": tenant_b.slug},
    )
    assert response.status_code == 403


async def test_anonymous_impersonation_is_rejected(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    response = await client.get(
        "/api/v1/health/tenant", headers={"X-Impersonate-Tenant": tenant_a.slug}
    )
    assert response.status_code == 403


async def test_platform_operator_can_impersonate(
    client: AsyncClient, tenant_a: TenantFixture, platform_admin
) -> None:
    """Support access — and note it is not an RLS bypass.

    The operator gets an ordinary tenant-bound session for that academy, under the
    same policies as its own staff. The app role never holds BYPASSRLS.
    """
    login_response = await client.post(
        "/api/v1/platform/login",
        json={"username": platform_admin.email, "password": PASSWORD},
    )
    token = login_response.json()["access_token"]

    resolved = await client.get(
        "/api/v1/health/tenant",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Impersonate-Tenant": tenant_a.slug,
        },
    )
    assert resolved.status_code == 200
    assert resolved.json()["resolved_via"] == "impersonation"

    me = await client.get(
        "/api/v1/auth/me",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Impersonate-Tenant": tenant_a.slug,
        },
    )
    assert me.status_code == 200
    assert me.json()["user"] is None
    assert me.json()["platform_admin"]["email"] == platform_admin.email
    assert me.json()["tenant"]["slug"] == tenant_a.slug


def test_production_refuses_to_boot_with_the_tenant_header_enabled() -> None:
    """A config mistake that would be an isolation bypass stops the process.

    ALLOW_TENANT_HEADER in production lets any caller name any academy. Failing at
    startup is loud; the alternative is a service that appears healthy while
    isolation is off.
    """
    with pytest.raises(ValidationError, match="ALLOW_TENANT_HEADER must be false"):
        Settings(
            environment="production",
            allow_tenant_header=True,
            database_url="postgresql+asyncpg://app:pw@host/db",
            migration_database_url="postgresql+asyncpg://mig:pw@host/db",
            jwt_secret_key="x" * 40,
        )


def test_production_refuses_identical_app_and_migration_roles() -> None:
    """Same role for both means the API owns its tables and RLS does not apply."""
    with pytest.raises(ValidationError, match="must not equal MIGRATION_DATABASE_URL"):
        Settings(
            environment="production",
            allow_tenant_header=False,
            database_url="postgresql+asyncpg://same:pw@host/db",
            migration_database_url="postgresql+asyncpg://same:pw@host/db",
            jwt_secret_key="x" * 40,
        )


def test_production_refuses_a_weak_jwt_secret() -> None:
    with pytest.raises(ValidationError, match="at least 32 characters"):
        Settings(
            environment="production",
            allow_tenant_header=False,
            database_url="postgresql+asyncpg://app:pw@host/db",
            migration_database_url="postgresql+asyncpg://mig:pw@host/db",
            jwt_secret_key="short",
        )


def test_a_non_asyncpg_url_is_refused() -> None:
    """A sync driver would block the event loop on every query."""
    with pytest.raises(ValidationError, match="asyncpg"):
        Settings(
            environment="local",
            database_url="postgresql://app:pw@host/db",
            migration_database_url="postgresql+asyncpg://mig:pw@host/db",
            jwt_secret_key="x" * 40,
        )
