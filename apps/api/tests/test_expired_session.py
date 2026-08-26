"""What an authenticated request gets when its token is no longer any good.

Both of these are regressions with the same symptom and two different causes, and
the symptom was a dashboard that rendered a whole signed-in shell around an identity
of nobody — never showing a login form, because it never received a status that
means "sign in again".

  * A shared-origin request with an expired token used to answer **400**. There is no
    subdomain to resolve the academy from and an unverifiable token contributes no
    `tid`, so tenant resolution ran out of options and reported *that* — a true
    statement about the wrong problem. See tenancy/deps.py::get_tenant_context.

  * The client, given a status it had no rule for, left `status` at 'authenticated'
    and rethrew into an unhandled rejection. See dashboard AuthProvider.loadMe.

The second is a frontend fix; this file pins the first, and pins that the endpoints
you use to *replace* an expired token stay reachable while holding one.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from httpx import AsyncClient

from app.core.config import settings
from app.core.security import Audience, _create_token
from tests.conftest import PASSWORD, TenantFixture, login

#: A shared origin — no subdomain to fall back on. This is the deployment the bug
#: only ever appeared on: localhost in dev, and one apex domain in production.
SHARED_ORIGIN = {"host": "localhost:8000"}


def _expired_token(tenant_id: uuid.UUID) -> str:
    """A well-formed, correctly-signed tenant token whose expiry is in the past.

    Built through the private `_create_token` because the public helper deliberately
    offers no way to choose an expiry — which is right for production code and
    exactly what this test needs to reach around.
    """
    return _create_token(
        subject=str(uuid.uuid4()),
        audience=Audience.TENANT,
        token_type="access",
        expires_delta=timedelta(minutes=-5),
        claims={"tid": str(tenant_id), "role": "admin"},
    )


async def test_expired_token_on_shared_origin_is_401_not_400(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The regression itself: the status has to be the one that means "sign in"."""
    response = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {_expired_token(tenant_a.id)}", **SHARED_ORIGIN},
    )
    assert response.status_code == 401, response.text
    # And it must not masquerade as a tenant-resolution problem, which is what sent
    # the client looking for a header to add rather than a session to renew.
    assert "X-Tenant-ID" not in response.text


async def test_garbage_bearer_on_shared_origin_is_401(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Not just expiry — anything that fails to verify. A rotated signing secret
    produces exactly this, for every signed-in user at once."""
    response = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer not.a.real.token", **SHARED_ORIGIN},
    )
    assert response.status_code == 401, response.text


async def test_no_token_on_shared_origin_still_reports_tenant_resolution(
    client: AsyncClient,
) -> None:
    """The conversion is scoped to requests that presented a token.

    An anonymous request to a tenant endpoint genuinely has not said which academy it
    means, and 400 remains the honest answer — turning that into 401 would tell a
    caller to authenticate when what they actually forgot was the header.
    """
    response = await client.get("/api/v1/auth/me", headers=SHARED_ORIGIN)
    assert response.status_code == 400, response.text


async def test_login_still_works_while_holding_an_expired_token(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The one that would turn a bad session into an unrecoverable one.

    Login is how you replace a dead token, so a dead token must not be able to block
    it. `get_optional_tenant_context` swallows the 401 for exactly this endpoint.
    """
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": tenant_a.admin_username, "password": PASSWORD},
        headers={"Authorization": f"Bearer {_expired_token(tenant_a.id)}", **SHARED_ORIGIN},
    )
    assert response.status_code == 200, response.text
    assert response.json()["access_token"]


async def test_signup_still_works_while_holding_an_expired_token(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Same reasoning as login: the public signup surface predates any tenant."""
    response = await client.post(
        "/api/v1/signup/intent",
        json={
            "email": f"stale-token-{uuid.uuid4().hex[:8]}@example.com",
            "full_name": "Holding A Dead Token",
        },
        headers={"Authorization": f"Bearer {_expired_token(tenant_a.id)}", **SHARED_ORIGIN},
    )
    assert response.status_code == 201, response.text


async def test_valid_token_on_shared_origin_is_unaffected(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The happy path the conversion must not touch: a good token still resolves its
    own academy from `tid` with no header and no subdomain."""
    token = await login(client, tenant_a, tenant_a.admin_username, PASSWORD)
    response = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}", **SHARED_ORIGIN},
    )
    assert response.status_code == 200, response.text
    assert response.json()["user"]["username"] == tenant_a.admin_username


def test_access_tokens_expire_soon_enough_for_this_to_be_the_common_path() -> None:
    """Context, not behaviour.

    Access tokens last 30 minutes, so this is not an edge case reached by neglected
    sessions — it is what every user meets after lunch. Pinned so that stretching the
    lifetime to make the symptom rarer is a deliberate act with a failing test
    attached, rather than a quiet way to hide it again.
    """
    assert settings.access_token_ttl_minutes <= 60
