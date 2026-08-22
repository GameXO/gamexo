"""Self-serve signup, first-run onboarding, and the shared-origin tenancy it needs.

The tests worth having here are the ones about the *new* way a request finds its
academy. Signup and onboarding are ordinary CRUD; what is genuinely new — and what
would be catastrophic to get wrong — is that a turf can now be reached without a
subdomain, from a claim inside a token. Half this file is about proving that opened
no hole.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

from app.db.session import untenanted_session
from app.models.user import AccountDirectory
from tests.conftest import PASSWORD, TenantFixture, auth_headers, login

IST = ZoneInfo("Asia/Kolkata")

# No Host header that resolves to anything, and no X-Tenant-ID. This is the
# shared-origin deployment: one hostname, every academy behind it.
NO_TENANT: dict[str, str] = {"host": "app.gamexo.app"}


async def signup(client: AsyncClient, email: str, name: str = "Turf Owner") -> dict:
    response = await client.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": PASSWORD, "full_name": name},
        headers=NO_TENANT,
    )
    assert response.status_code == 201, response.text
    return response.json()


def bearer(tokens: dict) -> dict[str, str]:
    """Auth headers with *no* tenant header — the token has to carry the academy."""
    return {"Authorization": f"Bearer {tokens['access_token']}", **NO_TENANT}


# ── Signup ──────────────────────────────────────────────────────────────────


async def test_signup_creates_an_academy_and_signs_the_owner_in(client: AsyncClient) -> None:
    tokens = await signup(client, "owner@newturf.example.com")

    me = await client.get("/api/v1/auth/me", headers=bearer(tokens))
    assert me.status_code == 200, me.text
    body = me.json()

    assert body["user"]["email"] == "owner@newturf.example.com"
    assert body["user"]["role"] == "admin"
    # The turf has no name yet, so it sits under a placeholder until onboarding.
    assert body["tenant"]["slug"].startswith("turf-")
    assert body["tenant"]["onboarding_completed"] is False


async def test_signup_gives_the_new_academy_its_own_settings_row(client: AsyncClient) -> None:
    tokens = await signup(client, "owner@settings.example.com")

    settings = await client.get("/api/v1/settings", headers=bearer(tokens))
    assert settings.status_code == 200, settings.text
    assert settings.json()["enabled_services"]["booking"] is True
    assert settings.json()["enabled_services"]["academy"] is False


async def test_a_second_signup_with_the_same_email_is_refused(client: AsyncClient) -> None:
    await signup(client, "taken@example.com")

    again = await client.post(
        "/api/v1/auth/signup",
        json={"email": "taken@example.com", "password": PASSWORD, "full_name": "Someone Else"},
        headers=NO_TENANT,
    )
    assert again.status_code == 409, again.text
    assert "already registered" in again.json()["error"]["message"]


async def test_a_refused_signup_leaves_no_half_built_academy(client: AsyncClient) -> None:
    """The conflict must roll back the tenant, not just the user.

    provision_tenant inserts the tenant first and the admin last. If the email
    collision were detected only at COMMIT, the tenant row would already exist and
    the platform would accumulate an empty academy per failed signup.
    """
    await signup(client, "rollback@example.com")

    async with untenanted_session() as session:
        before = (await session.execute(text("SELECT count(*) FROM tenant"))).scalar_one()

    await client.post(
        "/api/v1/auth/signup",
        json={"email": "rollback@example.com", "password": PASSWORD, "full_name": "Dup"},
        headers=NO_TENANT,
    )

    async with untenanted_session() as session:
        after = (await session.execute(text("SELECT count(*) FROM tenant"))).scalar_one()
    assert after == before


async def test_signup_registers_the_email_in_the_directory(client: AsyncClient) -> None:
    await signup(client, "directory@example.com")

    async with untenanted_session() as session:
        row = (
            await session.execute(
                select(AccountDirectory).where(AccountDirectory.email == "directory@example.com")
            )
        ).scalar_one()
        assert row.tenant_id is not None


# ── Login without a host ────────────────────────────────────────────────────


async def test_login_finds_the_academy_from_the_email(client: AsyncClient) -> None:
    """The whole point of the directory: no subdomain, no header, still signs in."""
    await signup(client, "shared@origin.example.com")

    response = await client.post(
        "/api/v1/auth/login",
        json={"email": "shared@origin.example.com", "password": PASSWORD},
        headers=NO_TENANT,
    )
    assert response.status_code == 200, response.text
    assert response.json()["access_token"]


async def test_an_unknown_email_is_rejected_like_a_wrong_password(client: AsyncClient) -> None:
    """No 404, and the same message — the endpoint must not enumerate accounts."""
    await signup(client, "known@example.com")

    unknown = await client.post(
        "/api/v1/auth/login",
        json={"email": "nobody@example.com", "password": PASSWORD},
        headers=NO_TENANT,
    )
    wrong_password = await client.post(
        "/api/v1/auth/login",
        json={"email": "known@example.com", "password": "not-the-password"},
        headers=NO_TENANT,
    )

    assert unknown.status_code == wrong_password.status_code == 401
    assert unknown.json()["error"]["message"] == wrong_password.json()["error"]["message"]


async def test_login_still_works_over_a_subdomain(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The existing path is untouched: a resolved host still names the academy."""
    response = await client.post(
        "/api/v1/auth/login",
        json={"email": tenant_a.admin_email, "password": PASSWORD},
        headers={"host": tenant_a.host},
    )
    assert response.status_code == 200, response.text


async def test_refresh_works_without_a_host(client: AsyncClient) -> None:
    tokens = await signup(client, "refresh@example.com")

    response = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": tokens["refresh_token"]},
        headers=NO_TENANT,
    )
    assert response.status_code == 200, response.text
    assert response.json()["access_token"] != tokens["access_token"]


# ── Isolation, under the new resolution path ────────────────────────────────


async def test_a_token_reaches_only_its_own_academy(client: AsyncClient) -> None:
    """Two self-serve turfs on one origin cannot see each other.

    This is the test the JWT-tid resolution path exists to survive. Each token names
    its own academy and nothing else; the sports one turf creates are invisible to
    the other even though both requests arrive on the same hostname with no header
    to tell them apart.
    """
    first = await signup(client, "first@turf.example.com")
    second = await signup(client, "second@turf.example.com")

    created = await client.post(
        "/api/v1/sports",
        json={
            "name": "Turf Football",
            "price_base": "1200",
            "price_peak": "1500",
            "price_weekend": "1700",
        },
        headers=bearer(first),
    )
    assert created.status_code == 201, created.text

    assert [s["name"] for s in (await client.get("/api/v1/sports", headers=bearer(first))).json()] == [
        "Turf Football"
    ]
    assert (await client.get("/api/v1/sports", headers=bearer(second))).json() == []


async def test_a_token_cannot_be_replayed_onto_another_academys_host(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """Where a subdomain *does* exist it still wins, and the mismatch is still caught.

    Adding token-based resolution must not weaken the hostname path: a token minted
    for academy A, presented to academy B's host, is refused exactly as before.
    """
    token = await login(client, tenant_a, tenant_a.admin_email, PASSWORD)

    response = await client.get(
        "/api/v1/sports",
        headers={"Authorization": f"Bearer {token}", "host": tenant_b.host},
    )
    assert response.status_code == 403, response.text
    assert "different academy" in response.json()["error"]["message"]


async def test_an_anonymous_request_with_no_host_still_fails_to_resolve(
    client: AsyncClient,
) -> None:
    """No token means no academy. The shared origin must not fall back to *any* turf."""
    response = await client.get("/api/v1/sports", headers=NO_TENANT)
    assert response.status_code in (400, 401), response.text


# ── Onboarding ──────────────────────────────────────────────────────────────


ONBOARDING = {
    "business_name": "Navigo Sports Arena",
    "city": "Hyderabad",
    "phone": "+91 90000 11111",
    "sports": [{"slug": "turf-football"}, {"slug": "badminton"}],
    "services": {"shop": False, "academy": True},
}


async def test_onboarding_names_the_turf_and_creates_its_sports(client: AsyncClient) -> None:
    tokens = await signup(client, "onboard@example.com")

    done = await client.post(
        "/api/v1/onboarding/complete", json=ONBOARDING, headers=bearer(tokens)
    )
    assert done.status_code == 200, done.text
    assert done.json()["sports_created"] == 2
    assert done.json()["tenant"]["onboarding_completed"] is True
    assert done.json()["tenant"]["slug"] == "navigo-sports-arena"

    sports = (await client.get("/api/v1/sports", headers=bearer(tokens))).json()
    assert {s["name"] for s in sports} == {"Turf Football", "Badminton"}
    # Priced from the catalogue, so a new turf can take a booking immediately.
    assert all(float(s["price_base"]) > 0 for s in sports)


async def test_onboarding_creates_no_courts(client: AsyncClient) -> None:
    """A fresh turf has none — that empty state is what drives the dashboard CTA."""
    tokens = await signup(client, "nocourts@example.com")
    await client.post("/api/v1/onboarding/complete", json=ONBOARDING, headers=bearer(tokens))

    assert (await client.get("/api/v1/courts", headers=bearer(tokens))).json() == []


async def test_onboarding_saves_identity_and_services(client: AsyncClient) -> None:
    tokens = await signup(client, "identity@example.com")
    await client.post("/api/v1/onboarding/complete", json=ONBOARDING, headers=bearer(tokens))

    settings = (await client.get("/api/v1/settings", headers=bearer(tokens))).json()
    assert settings["business_name"] == "Navigo Sports Arena"
    assert settings["city"] == "Hyderabad"
    assert settings["enabled_services"]["academy"] is True
    assert settings["enabled_services"]["shop"] is False
    # Merged, not replaced: a key the wizard never sent keeps its default.
    assert settings["enabled_services"]["booking"] is True


async def test_onboarding_is_idempotent(client: AsyncClient) -> None:
    """A retry after a dropped connection must not double the sports."""
    tokens = await signup(client, "retry@example.com")

    await client.post("/api/v1/onboarding/complete", json=ONBOARDING, headers=bearer(tokens))
    again = await client.post(
        "/api/v1/onboarding/complete", json=ONBOARDING, headers=bearer(tokens)
    )

    assert again.status_code == 200, again.text
    assert again.json()["sports_created"] == 0
    assert len((await client.get("/api/v1/sports", headers=bearer(tokens))).json()) == 2


async def test_two_turfs_with_the_same_name_get_distinct_slugs(client: AsyncClient) -> None:
    first = await signup(client, "arena1@example.com")
    second = await signup(client, "arena2@example.com")

    a = await client.post("/api/v1/onboarding/complete", json=ONBOARDING, headers=bearer(first))
    b = await client.post("/api/v1/onboarding/complete", json=ONBOARDING, headers=bearer(second))

    assert a.json()["tenant"]["slug"] == "navigo-sports-arena"
    assert b.json()["tenant"]["slug"] == "navigo-sports-arena-2"


async def test_a_custom_sport_is_accepted(client: AsyncClient) -> None:
    """Something the catalogue does not stock, priced at zero for the owner to set."""
    tokens = await signup(client, "custom@example.com")

    await client.post(
        "/api/v1/onboarding/complete",
        json={**ONBOARDING, "sports": [{"slug": "sepak-takraw", "name": "Sepak Takraw"}]},
        headers=bearer(tokens),
    )

    sports = (await client.get("/api/v1/sports", headers=bearer(tokens))).json()
    assert sports[0]["name"] == "Sepak Takraw"
    assert float(sports[0]["price_base"]) == 0


async def test_the_renamed_slug_resolves_immediately(client: AsyncClient) -> None:
    """The resolver caches tenants for five minutes, keyed by slug.

    Without an explicit invalidation the old placeholder would keep resolving, and
    the new name would 404 for the rest of the TTL.
    """
    tokens = await signup(client, "cache@example.com")
    await client.post("/api/v1/onboarding/complete", json=ONBOARDING, headers=bearer(tokens))

    over_the_subdomain = await client.get(
        "/api/v1/sports",
        headers={
            "Authorization": f"Bearer {tokens['access_token']}",
            "host": "navigo-sports-arena.gamexo.app",
        },
    )
    assert over_the_subdomain.status_code == 200, over_the_subdomain.text


async def test_the_sport_catalogue_is_served(client: AsyncClient) -> None:
    tokens = await signup(client, "catalogue@example.com")

    body = (await client.get("/api/v1/sports/catalogue", headers=bearer(tokens))).json()
    slugs = {entry["slug"] for entry in body}
    assert {"turf-football", "box-cricket", "badminton"} <= slugs
    # Peak is derived as an uplift on base, never below it.
    assert all(float(e["price_peak"]) >= float(e["price_base"]) for e in body)


# ── Court configuration ─────────────────────────────────────────────────────


async def onboarded(client: AsyncClient, email: str) -> tuple[dict, str]:
    """A turf past onboarding, plus the id of its first sport."""
    tokens = await signup(client, email)
    await client.post("/api/v1/onboarding/complete", json=ONBOARDING, headers=bearer(tokens))
    sports = (await client.get("/api/v1/sports", headers=bearer(tokens))).json()
    return tokens, sports[0]["id"]


COURT = {
    "name": "Court 1",
    "code": "C1",
    "hourly_rate": "1200",
    "peak_rate": "1500",
    "operating_hours": {"open": "06:00", "close": "23:00"},
}


async def test_a_court_carries_photos_rating_and_facility_chips(client: AsyncClient) -> None:
    tokens, sport_id = await onboarded(client, "court@example.com")

    response = await client.post(
        "/api/v1/courts",
        json={
            **COURT,
            "sport_id": sport_id,
            "images": ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"],
            "rating": "4.5",
            "amenities": ["Floodlights", "Washroom", "Parking"],
        },
        headers=bearer(tokens),
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert len(body["images"]) == 2
    assert float(body["rating"]) == 4.5
    assert body["amenities"] == ["Floodlights", "Washroom", "Parking"]
    assert body["operating_hours"] == {"open": "06:00", "close": "23:00"}


async def test_a_sixth_photo_is_refused(client: AsyncClient) -> None:
    tokens, sport_id = await onboarded(client, "sixphotos@example.com")

    response = await client.post(
        "/api/v1/courts",
        json={
            **COURT,
            "sport_id": sport_id,
            "images": [f"https://cdn.example.com/{n}.jpg" for n in range(6)],
        },
        headers=bearer(tokens),
    )
    assert response.status_code == 422, response.text


async def test_open_slots_without_a_capacity_is_refused(client: AsyncClient) -> None:
    """422 naming the field, not an IntegrityError from the CHECK at COMMIT."""
    tokens, sport_id = await onboarded(client, "nocapacity@example.com")

    response = await client.post(
        "/api/v1/courts",
        json={**COURT, "sport_id": sport_id, "open_slots_enabled": True},
        headers=bearer(tokens),
    )
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("rating", ["5.5", "-1"])
async def test_a_rating_outside_zero_to_five_is_refused(
    client: AsyncClient, rating: str
) -> None:
    tokens, sport_id = await onboarded(client, f"rating{rating.replace('.', '')}@example.com")

    response = await client.post(
        "/api/v1/courts",
        json={**COURT, "sport_id": sport_id, "rating": rating},
        headers=bearer(tokens),
    )
    assert response.status_code == 422, response.text


async def test_an_unused_court_can_be_deleted(client: AsyncClient) -> None:
    tokens, sport_id = await onboarded(client, "deletecourt@example.com")
    court = (
        await client.post(
            "/api/v1/courts", json={**COURT, "sport_id": sport_id}, headers=bearer(tokens)
        )
    ).json()

    deleted = await client.delete(f"/api/v1/courts/{court['id']}", headers=bearer(tokens))
    assert deleted.status_code == 204, deleted.text
    assert (await client.get("/api/v1/courts", headers=bearer(tokens))).json() == []


async def test_a_sport_with_courts_cannot_be_deleted(client: AsyncClient) -> None:
    tokens, sport_id = await onboarded(client, "deletesport@example.com")
    await client.post(
        "/api/v1/courts", json={**COURT, "sport_id": sport_id}, headers=bearer(tokens)
    )

    refused = await client.delete(f"/api/v1/sports/{sport_id}", headers=bearer(tokens))
    assert refused.status_code == 409, refused.text
    assert "court" in refused.json()["error"]["message"].lower()


# ── Open slots ──────────────────────────────────────────────────────────────


def tomorrow_at(hour: int) -> str:
    return (datetime.now(IST) + timedelta(days=1)).replace(
        hour=hour, minute=0, second=0, microsecond=0
    ).isoformat()


async def make_court(client: AsyncClient, tokens: dict, sport_id: str, **overrides) -> str:
    response = await client.post(
        "/api/v1/courts",
        json={**COURT, "sport_id": sport_id, **overrides},
        headers=bearer(tokens),
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def join(client: AsyncClient, tokens: dict, court_id: str, name: str, when: str):
    return await client.post(
        "/api/v1/bookings",
        json={
            "court_id": court_id,
            "starts_at": when,
            "duration_min": 60,
            "customer_name": name,
            "customer_phone": "9800000000",
        },
        headers=bearer(tokens),
    )


async def test_an_open_slot_court_takes_players_up_to_its_capacity(
    client: AsyncClient,
) -> None:
    """Three people join one session on a court configured for three."""
    tokens, sport_id = await onboarded(client, "openslots@example.com")
    court_id = await make_court(
        client, tokens, sport_id, code="OS1", open_slots_enabled=True, slot_capacity=3
    )
    when = tomorrow_at(19)

    for name in ("Arjun", "Bhavna", "Chetan"):
        response = await join(client, tokens, court_id, name, when)
        assert response.status_code == 201, f"{name}: {response.text}"

    full = await join(client, tokens, court_id, "Divya", when)
    assert full.status_code == 409, full.text
    assert "full" in full.json()["error"]["message"].lower()
    assert full.json()["error"]["details"]["capacity"] == 3


async def test_an_ordinary_court_still_refuses_a_second_booking(client: AsyncClient) -> None:
    """The exclusion constraint's predicate narrowed; its behaviour here did not."""
    tokens, sport_id = await onboarded(client, "normalcourt@example.com")
    court_id = await make_court(client, tokens, sport_id, code="N1")
    when = tomorrow_at(19)

    assert (await join(client, tokens, court_id, "Arjun", when)).status_code == 201
    clash = await join(client, tokens, court_id, "Bhavna", when)
    assert clash.status_code == 409, clash.text
    assert "already booked" in clash.json()["error"]["message"]


async def test_a_cancelled_join_frees_its_place(client: AsyncClient) -> None:
    tokens, sport_id = await onboarded(client, "cancelslot@example.com")
    court_id = await make_court(
        client, tokens, sport_id, code="OS2", open_slots_enabled=True, slot_capacity=1
    )
    when = tomorrow_at(20)

    first = (await join(client, tokens, court_id, "Arjun", when)).json()
    assert (await join(client, tokens, court_id, "Bhavna", when)).status_code == 409

    cancelled = await client.post(
        f"/api/v1/bookings/{first['id']}/cancel",
        json={"reason": "Changed plans"},
        headers=bearer(tokens),
    )
    assert cancelled.status_code == 200, cancelled.text

    assert (await join(client, tokens, court_id, "Bhavna", when)).status_code == 201


async def test_a_non_overlapping_session_is_unaffected_by_a_full_one(
    client: AsyncClient,
) -> None:
    tokens, sport_id = await onboarded(client, "nextslot@example.com")
    court_id = await make_court(
        client, tokens, sport_id, code="OS3", open_slots_enabled=True, slot_capacity=1
    )

    assert (await join(client, tokens, court_id, "Arjun", tomorrow_at(19))).status_code == 201
    # 20:00 starts exactly as the 19:00 hour ends — half-open bounds, so it is free.
    assert (await join(client, tokens, court_id, "Bhavna", tomorrow_at(20))).status_code == 201


# ── The counter tablet ──────────────────────────────────────────────────────


async def test_the_kiosk_reads_branding_but_not_the_full_settings(
    client: AsyncClient,
) -> None:
    """GET /settings carries GST and invoice identity; the shared tablet login must
    not reach it. /settings/public is the branding subset it may."""
    tokens, _ = await onboarded(client, "kiosk@example.com")

    public = await client.get("/api/v1/settings/public", headers=bearer(tokens))
    assert public.status_code == 200, public.text
    body = public.json()
    assert body["business_name"] == "Navigo Sports Arena"
    assert set(body) == {
        "business_name",
        "logo_url",
        "brand_primary",
        "brand_accent",
        "brand_background",
        "currency",
        "enabled_services",
    }
    assert "gst_number" not in body


# ── Staff on a shared origin ────────────────────────────────────────────────


async def test_new_staff_can_sign_in_without_a_subdomain(client: AsyncClient) -> None:
    """Every created user needs a directory row, or they are unreachable here."""
    tokens, _ = await onboarded(client, "owner@staffing.example.com")

    created = await client.post(
        "/api/v1/staff",
        json={
            "email": "reception@staffing.example.com",
            "password": PASSWORD,
            "full_name": "Front Desk",
            "role": "reception",
        },
        headers=bearer(tokens),
    )
    assert created.status_code == 201, created.text

    signed_in = await client.post(
        "/api/v1/auth/login",
        json={"email": "reception@staffing.example.com", "password": PASSWORD},
        headers=NO_TENANT,
    )
    assert signed_in.status_code == 200, signed_in.text


async def test_staff_cannot_take_an_email_used_at_another_turf(client: AsyncClient) -> None:
    """The stated cost of a global directory, asserted so it is not a surprise."""
    await signup(client, "shared.person@example.com")
    tokens, _ = await onboarded(client, "otherowner@example.com")

    refused = await client.post(
        "/api/v1/staff",
        json={
            "email": "shared.person@example.com",
            "password": PASSWORD,
            "full_name": "Same Person",
            "role": "manager",
        },
        headers=bearer(tokens),
    )
    assert refused.status_code == 409, refused.text
