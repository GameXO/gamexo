"""The externalisation gateway: partner isolation, idempotency, double-booking.

The property that matters most here is negative — what a partner CANNOT see. Most
of these tests assert a 404 or a 403, because the failure mode is silent: a gateway
that leaks another platform's bookings works perfectly from the partner's side.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from httpx import AsyncClient
from sqlalchemy import text

from tests.conftest import TenantFixture
from tests.test_booking import at, book, setup_academy

IST = ZoneInfo("Asia/Kolkata")


async def make_partner(
    client: AsyncClient,
    ctx: dict,
    tenant: TenantFixture,
    name: str,
    slug: str,
    dialect: str = "native",
) -> dict:
    """Mint an integration and return `{headers, id, api_key, slug}`.

    The partner headers carry the tenant and the API key but NO Authorization:
    a partner is not a staff member, and the gateway must authenticate it on the
    key alone.

    `dialect` decides which wire format the key is valid for — see
    `gateway/deps.py::speaking`. Defaults to our own contract.
    """
    response = await client.post(
        "/api/v1/partners",
        json={"name": name, "slug": slug, "dialect": dialect},
        headers=ctx["headers"],
    )
    assert response.status_code == 201, response.text
    body = response.json()
    return {
        "id": body["id"],
        "slug": slug,
        "api_key": body["api_key"],
        "headers": {"X-API-Key": body["api_key"], **tenant.headers},
    }


async def partner_book(
    client: AsyncClient, partner: dict, *, court: str, starts_at: str, hold: bool = False, **extra
):
    """Claim one slot through the native dialect.

    The contract takes a batch (`{"slots": [...]}`) because all-or-nothing across
    several slots is the guarantee that matters, and a single-slot body would be a
    second shape to maintain for no gain. This helper wraps the one-slot case, which
    is what most tests want.

    `hold=True` uses the two-phase path instead — the slot is blocked but no booking
    exists until `/bookings/confirm`.
    """
    path = "/api/v1/gateway/bookings/hold" if hold else "/api/v1/gateway/bookings"
    return await client.post(
        path,
        json={
            "slots": [
                {
                    "court_id": court,
                    "starts_at": starts_at,
                    "duration_min": 60,
                    "customer_name": "External Customer",
                    "customer_phone": "9876500000",
                    **extra,
                }
            ]
        },
        headers=partner["headers"],
    )


def one(response) -> dict:
    """The single booking in a response, whether or not it came back in a batch.

    Create and hold return a list, because they are all-or-nothing across several
    slots. Cancel and get return one object. Tests mostly do not care which, so this
    accepts both rather than making every call site remember.
    """
    body = response.json()
    if isinstance(body, list):
        assert body, response.text
        return body[0]
    return body


# ── Key management ──────────────────────────────────────────────────────────


async def test_the_api_key_is_returned_once_and_never_again(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Only a hash is stored, so a lost key needs a rotation, not a lookup."""
    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    assert partner["api_key"]

    listed = await client.get("/api/v1/partners", headers=ctx["headers"])
    assert listed.status_code == 200, listed.text
    row = next(p for p in listed.json() if p["slug"] == "playo")
    assert "api_key" not in row
    # The prefix is public — it is how a key is looked up and how staff identify one.
    assert row["key_prefix"]


async def test_a_revoked_key_stops_working(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Playo", "playo")

    revoke = await client.patch(
        f"/api/v1/partners/{partner['id']}", json={"is_active": False}, headers=ctx["headers"]
    )
    assert revoke.status_code == 200, revoke.text

    response = await client.get(
        "/api/v1/gateway/availability",
        params={"date": at(9, 10)},
        headers=partner["headers"],
    )
    assert response.status_code == 401


async def test_a_forged_secret_is_rejected(client: AsyncClient, tenant_a: TenantFixture) -> None:
    """A valid prefix with the wrong secret must fail — the prefix is not the secret."""
    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    prefix = partner["api_key"].split(".")[0]

    response = await client.get(
        "/api/v1/gateway/availability",
        params={"date": at(9, 10)},
        headers={**partner["headers"], "X-API-Key": f"{prefix}.wrong-secret"},
    )
    assert response.status_code == 401


# ── Availability ────────────────────────────────────────────────────────────


async def test_availability_reflects_bookings_from_every_source(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The gateway's whole purpose: a walk-in must close the slot for Playo too.

    If this fails, the integration double-books courts.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    slot = at(10, 19)

    before = await client.get(
        "/api/v1/gateway/availability",
        params={"date": at(10, 0), "court_id": ctx["court_1"]},
        headers=partner["headers"],
    )
    assert before.status_code == 200, before.text
    assert any(
        s["available"] for s in before.json()[0]["slots"] if s["starts_at"].startswith(slot[:13])
    )

    # Booked at the counter, by staff — nothing to do with any platform.
    walkin = await book(client, ctx, court=ctx["court_1"], starts_at=slot, minutes=60)
    assert walkin.status_code == 201, walkin.text

    after = await client.get(
        "/api/v1/gateway/availability",
        params={"date": at(10, 0), "court_id": ctx["court_1"]},
        headers=partner["headers"],
    )
    taken = [s for s in after.json()[0]["slots"] if s["starts_at"].startswith(slot[:13])]
    assert taken and not any(s["available"] for s in taken)


async def test_availability_does_not_leak_internal_booking_ids(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """`blocked_by_booking_id` is right for our dashboard and wrong for a partner.

    Handing it out would let a platform enumerate our bookings by polling a day at
    a time — including walk-ins that are none of its business.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    booked = await book(client, ctx, court=ctx["court_1"], starts_at=at(11, 19), minutes=60)
    assert booked.status_code == 201

    response = await client.get(
        "/api/v1/gateway/availability",
        params={"date": at(11, 0), "court_id": ctx["court_1"]},
        headers=partner["headers"],
    )
    assert response.status_code == 200, response.text
    for slot in response.json()[0]["slots"]:
        assert "blocked_by_booking_id" not in slot


# ── Double booking ──────────────────────────────────────────────────────────


async def test_two_platforms_cannot_take_the_same_slot(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    hudle = await make_partner(client, ctx, tenant_a, "Hudle", "hudle")
    slot = at(12, 19)

    first = await partner_book(client, playo, court=ctx["court_1"], starts_at=slot)
    assert first.status_code == 201, first.text

    second = await partner_book(client, hudle, court=ctx["court_1"], starts_at=slot)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "conflict"


async def test_a_conflict_does_not_reveal_the_blocking_booking(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """`ensure_slot_free` names the conflicting booking; the gateway must strip it.

    Otherwise one platform learns another's booking ids by probing slots.
    """
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    hudle = await make_partner(client, ctx, tenant_a, "Hudle", "hudle")
    slot = at(13, 19)

    assert (await partner_book(client, playo, court=ctx["court_1"], starts_at=slot)).status_code == 201
    clash = await partner_book(client, hudle, court=ctx["court_1"], starts_at=slot)

    assert clash.status_code == 409
    assert "conflicting_booking_id" not in clash.json()["error"]["details"]


async def test_a_walk_in_blocks_a_platform_from_the_same_slot(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    slot = at(14, 19)

    assert (await book(client, ctx, court=ctx["court_1"], starts_at=slot, minutes=60)).status_code == 201
    blocked = await partner_book(client, playo, court=ctx["court_1"], starts_at=slot)
    assert blocked.status_code == 409


# ── Isolation ───────────────────────────────────────────────────────────────


async def test_a_partner_cannot_read_another_platforms_booking(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """404, not 403: a 403 confirms the id exists and turns this into an oracle."""
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    hudle = await make_partner(client, ctx, tenant_a, "Hudle", "hudle")

    made = await partner_book(client, playo, court=ctx["court_1"], starts_at=at(15, 19))
    assert made.status_code == 201, made.text
    booking_id = one(made)["id"]

    seen = await client.get(f"/api/v1/gateway/bookings/{booking_id}", headers=hudle["headers"])
    assert seen.status_code == 404


async def test_a_partner_cannot_cancel_another_platforms_booking(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    hudle = await make_partner(client, ctx, tenant_a, "Hudle", "hudle")

    made = await partner_book(client, playo, court=ctx["court_1"], starts_at=at(16, 19))
    assert made.status_code == 201
    booking_id = one(made)["id"]

    killed = await client.post(
        f"/api/v1/gateway/bookings/{booking_id}/cancel", json={}, headers=hudle["headers"]
    )
    assert killed.status_code == 404

    # And it really is still live, not merely hidden.
    still = await client.get(f"/api/v1/gateway/bookings/{booking_id}", headers=playo["headers"])
    assert one(still)["status"] != "cancelled"


async def test_a_partner_cannot_see_a_counter_booking(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")

    walkin = await book(client, ctx, court=ctx["court_1"], starts_at=at(17, 19), minutes=60)
    assert walkin.status_code == 201

    seen = await client.get(
        f"/api/v1/gateway/bookings/{walkin.json()['id']}", headers=playo["headers"]
    )
    assert seen.status_code == 404


async def test_the_booking_list_is_scoped_to_the_calling_partner(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    hudle = await make_partner(client, ctx, tenant_a, "Hudle", "hudle")

    assert (await partner_book(client, playo, court=ctx["court_1"], starts_at=at(18, 19))).status_code == 201
    assert (await partner_book(client, hudle, court=ctx["court_2"], starts_at=at(18, 19))).status_code == 201
    assert (await book(client, ctx, court=ctx["court_1"], starts_at=at(18, 8), minutes=60)).status_code == 201

    for partner in (playo, hudle):
        listed = await client.get("/api/v1/gateway/bookings", headers=partner["headers"])
        assert listed.status_code == 200, listed.text
        rows = listed.json()
        assert rows, "partner should see its own booking"
        assert {row["source_platform"] for row in rows} == {partner["slug"]}


# ── Idempotency and provenance ──────────────────────────────────────────────


async def test_repeating_a_create_with_the_same_ref_returns_the_same_booking(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A timeout on the partner's side must be safe to retry, not sell the court twice."""
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    slot = at(19, 19)

    first = await partner_book(client, playo, court=ctx["court_1"], starts_at=slot, external_ref="REF-1")
    assert first.status_code == 201, first.text

    retry = await partner_book(client, playo, court=ctx["court_1"], starts_at=slot, external_ref="REF-1")
    assert retry.status_code == 201
    assert one(retry)["id"] == one(first)["id"]

    listed = await client.get("/api/v1/gateway/bookings", headers=playo["headers"])
    assert len(listed.json()) == 1


async def test_the_platform_is_recorded_and_visible_to_staff(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """"Where did this booking come from?" answered without a join."""
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")

    made = await partner_book(
        client, playo, court=ctx["court_1"], starts_at=at(20, 19), external_ref="PLAYO-77"
    )
    assert made.status_code == 201, made.text
    assert one(made)["source_platform"] == "playo"

    internal = await client.get(f"/api/v1/bookings/{one(made)['id']}", headers=ctx["headers"])
    assert internal.status_code == 200, internal.text
    assert one(internal)["source_platform"] == "playo"
    assert one(internal)["external_ref"] == "PLAYO-77"


async def test_source_platform_is_taken_from_the_key_not_the_request(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A platform must not be able to file a booking under a competitor's name."""
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    await make_partner(client, ctx, tenant_a, "Hudle", "hudle")

    made = await partner_book(
        client,
        playo,
        court=ctx["court_1"],
        starts_at=at(21, 19),
        # Ignored: not a field on PartnerBookingCreate at all.
        source_platform="hudle",
    )
    assert made.status_code == 201, made.text
    assert one(made)["source_platform"] == "playo"


async def test_a_partner_booking_is_not_auto_checked_in(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Nobody is at the counter. Arriving stays a separate event the desk confirms."""
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")

    starts = (datetime.now(UTC) + timedelta(minutes=2)).replace(microsecond=0).isoformat()
    made = await partner_book(client, playo, court=ctx["court_1"], starts_at=starts)
    assert made.status_code == 201, made.text
    assert one(made)["status"] == "upcoming"


# ── Cancellation ────────────────────────────────────────────────────────────


async def test_cancelling_frees_the_slot_for_everyone(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    hudle = await make_partner(client, ctx, tenant_a, "Hudle", "hudle")
    slot = at(22, 19)

    made = await partner_book(client, playo, court=ctx["court_1"], starts_at=slot)
    assert made.status_code == 201

    blocked = await partner_book(client, hudle, court=ctx["court_1"], starts_at=slot)
    assert blocked.status_code == 409

    released = await client.post(
        f"/api/v1/gateway/bookings/{one(made)['id']}/cancel",
        json={"reason": "customer cancelled"},
        headers=playo["headers"],
    )
    assert released.status_code == 200, released.text
    assert one(released)["status"] == "cancelled"

    # The exclusion constraint's `WHERE status <> 'cancelled'` is what makes this work.
    retry = await partner_book(client, hudle, court=ctx["court_1"], starts_at=slot)
    assert retry.status_code == 201, retry.text


async def test_cancelling_twice_is_not_an_error(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    made = await partner_book(client, playo, court=ctx["court_1"], starts_at=at(23, 19))
    assert made.status_code == 201

    for _ in range(2):
        again = await client.post(
            f"/api/v1/gateway/bookings/{one(made)['id']}/cancel",
            json={},
            headers=playo["headers"],
        )
        assert again.status_code == 200, again.text
        assert one(again)["status"] == "cancelled"


async def test_an_integration_with_bookings_cannot_be_deleted(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A booking must keep answering "where did this come from?" — revoke, don't delete."""
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    assert (await partner_book(client, playo, court=ctx["court_1"], starts_at=at(24, 19))).status_code == 201

    refused = await client.delete(f"/api/v1/partners/{playo['id']}", headers=ctx["headers"])
    assert refused.status_code == 409


async def test_checkin_lookup_matches_a_partners_external_ref(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The counter's check-in screen has to accept Playo's own booking reference,
    not just an id we minted — that reference is what the customer actually holds."""
    ctx = await setup_academy(client, tenant_a)
    playo = await make_partner(client, ctx, tenant_a, "Playo", "playo")
    starts = (datetime.now(UTC) + timedelta(minutes=5)).replace(microsecond=0).isoformat()
    made = await partner_book(
        client, playo, court=ctx["court_1"], starts_at=starts, external_ref="PLYO-998877"
    )
    assert made.status_code == 201, made.text

    found = await client.get(
        "/api/v1/bookings/checkin-lookup",
        params={"code": "plyo-998877"},
        headers=ctx["headers"],
    )
    assert found.status_code == 200, found.text
    assert one(found)["id"] == one(made)["id"]


# ── What the shared core bought the native dialect ──────────────────────────
#
# None of the tests below could pass before the gateway was split into a core plus
# dialects: holds, all-or-nothing writes and expiry existed only inside the Playo
# adapter. They are here rather than in test_playo.py precisely because they are
# properties of the *gateway*, not of any one partner's wire format.


async def test_a_native_hold_blocks_the_counter(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Two-phase checkout, for any partner — not just the one that asked for it."""
    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")

    held = await partner_book(
        client, partner, court=ctx["court_1"], starts_at=at(12, 9), hold=True
    )
    assert held.status_code == 201, held.text
    assert one(held)["status"] == "held"

    counter = await book(client, ctx, court=ctx["court_1"], starts_at=at(12, 9))
    assert counter.status_code == 409


async def test_a_native_hold_is_not_a_booking(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """It blocks the calendar and nothing else.

    A held slot reaching the bookings list would have staff chasing a customer who
    has not bought anything yet.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")

    await partner_book(client, partner, court=ctx["court_1"], starts_at=at(12, 9), hold=True)

    listed = await client.get("/api/v1/bookings", headers=ctx["headers"])
    assert listed.json()["items"] == []


async def test_confirming_a_native_hold_makes_it_real(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")

    held = await partner_book(
        client, partner, court=ctx["court_1"], starts_at=at(12, 9), hold=True
    )
    reference = one(held)["reference"]

    confirmed = await client.post(
        "/api/v1/gateway/bookings/confirm",
        json={"references": [reference]},
        headers=partner["headers"],
    )
    assert confirmed.status_code == 200, confirmed.text
    assert one(confirmed)["status"] == "upcoming"

    listed = await client.get("/api/v1/bookings", headers=ctx["headers"])
    assert len(listed.json()["items"]) == 1


async def test_a_native_batch_is_all_or_nothing(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The savepoint, from the other dialect's side.

    The request session commits on a normal return, so a handler that creates the
    first slot, fails on the second and then returns a 409 would still have
    committed the first — a court blocked with no counterpart anywhere.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")

    await book(client, ctx, court=ctx["court_1"], starts_at=at(12, 10))

    response = await client.post(
        "/api/v1/gateway/bookings",
        json={
            "slots": [
                {
                    "court_id": ctx["court_1"],
                    "starts_at": at(12, 9),
                    "duration_min": 60,
                    "customer_name": "Atomic Customer",
                    "external_ref": "N-A1",
                },
                {
                    "court_id": ctx["court_1"],
                    "starts_at": at(12, 10),
                    "duration_min": 60,
                    "customer_name": "Atomic Customer",
                    "external_ref": "N-A2",
                },
            ]
        },
        headers=partner["headers"],
    )
    assert response.status_code == 409, response.text

    # The 9am slot was free and must have stayed that way.
    free = await book(client, ctx, court=ctx["court_1"], starts_at=at(12, 9))
    assert free.status_code == 201


async def test_an_expired_native_hold_frees_the_court(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Nothing in Postgres notices a stale hold — `release_expired_holds` does."""
    from sqlalchemy import update

    from app.db.session import tenant_session
    from app.modules.booking.models import Booking

    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")

    held = await partner_book(
        client, partner, court=ctx["court_1"], starts_at=at(12, 9), hold=True
    )
    reference = one(held)["reference"]

    async with tenant_session(tenant_a.id) as session:
        await session.execute(
            update(Booking)
            .where(Booking.reference == reference)
            .values(hold_expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )

    counter = await book(client, ctx, court=ctx["court_1"], starts_at=at(12, 9))
    assert counter.status_code == 201


async def test_a_key_cannot_be_used_against_another_dialect(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A misconfiguration alarm, not a security boundary.

    Both dialects reach the same core and are scoped to the same partner, so nothing
    is exposed either way. But a partner driving the wrong contract gets results that
    look almost right — a create that prices differently, a cancel that 404s for no
    visible reason — and that is far harder to diagnose than a flat refusal.
    """
    ctx = await setup_academy(client, tenant_a)
    native_partner = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")
    playo_partner = await make_partner(
        client, ctx, tenant_a, "Playo", "playo", dialect="playo"
    )

    wrong_way = await client.get(
        "/api/v1/gateway/playo/availability",
        params={"date": "2026-09-04"},
        headers=native_partner["headers"],
    )
    assert wrong_way.status_code == 401
    assert "native" in wrong_way.json()["error"]["message"]

    other_way = await client.get(
        "/api/v1/gateway/availability",
        params={"date": at(9, 10)},
        headers=playo_partner["headers"],
    )
    assert other_way.status_code == 401


async def test_the_dialect_registry_is_listed_for_the_dashboard(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """So Manage → Integrations offers what exists rather than a hardcoded list."""
    ctx = await setup_academy(client, tenant_a)

    response = await client.get("/api/v1/partners/dialects", headers=ctx["headers"])
    assert response.status_code == 200, response.text

    by_slug = {d["slug"]: d for d in response.json()}
    assert {"native", "playo"} <= set(by_slug)
    assert by_slug["native"]["is_default"] is True
    assert by_slug["native"]["base_path"] == "/api/v1/gateway"
    assert by_slug["playo"]["base_path"] == "/api/v1/gateway/playo"


async def test_an_unknown_dialect_is_refused(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    response = await client.post(
        "/api/v1/partners",
        json={"name": "Nonsense", "slug": "nonsense", "dialect": "esperanto"},
        headers=ctx["headers"],
    )
    assert response.status_code == 409
    assert "esperanto" in response.json()["error"]["message"]


# ── The sandbox cleans up after itself ──────────────────────────────────────


async def test_a_sandbox_run_leaves_no_trace(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A run must leave the row counts and the reference counter as it found them.

    It used to only *cancel* what it created, which meant every run permanently added
    ~11 bookings and ~30 events and pushed the counter up by 11 — and a run that
    failed part-way could leave a booking `upcoming`, quietly blocking a court. Two
    courts on the dev database ended up blocked exactly that way.

    Driven through the service layer rather than the HTTP endpoint: the endpoint
    calls back into its own API over the network, which needs a running server. What
    is under test here is the purge, not the transport.
    """
    from sqlalchemy import select

    from app.db.session import tenant_session
    from app.modules.booking.models import Booking, BookingEvent
    from app.modules.gateway.sandbox import _purge

    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Sandbox", "sandbox")

    async def counts() -> tuple[int, int, int]:
        async with tenant_session(tenant_a.id) as session:
            bookings = len((await session.execute(select(Booking.id))).all())
            events = len((await session.execute(select(BookingEvent.id))).all())
            counter = (
                await session.execute(
                    text("select last_value from document_counter where kind = 'booking'")
                )
            ).scalar()
        # `or 0`: before the first booking there is no counter row at all, and after
        # the purge there is one holding 0. Both mean "the next reference is 0001" —
        # `numbering.allocate` upserts the row at 0 and increments — so treating them
        # as different would fail this test for a difference that does not exist.
        return bookings, events, counter or 0

    before = await counts()

    made = [
        one(await partner_book(client, partner, court=ctx["court_1"], starts_at=at(13, 9))),
        one(
            await partner_book(
                client, partner, court=ctx["court_1"], starts_at=at(13, 11), hold=True
            )
        ),
    ]
    refs = [b["reference"] for b in made]
    assert (await counts())[0] == before[0] + 2

    removed = await _purge(tenant_a.id, partner["id"], refs)

    assert removed["bookings"] == 2
    assert await counts() == before, "a run must leave the database as it found it"


async def test_the_purge_cannot_reach_another_partners_booking(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Scoped to `created_by_partner_id`, so a bad reference list is inert.

    The sandbox is a dev tool that deletes rows by reference. Without this scope a
    malformed list — or a reference guessed off a ticket — would delete a walk-in.
    """
    from sqlalchemy import select

    from app.db.session import tenant_session
    from app.modules.booking.models import Booking
    from app.modules.gateway.sandbox import _purge

    ctx = await setup_academy(client, tenant_a)
    sandbox = await make_partner(client, ctx, tenant_a, "Sandbox", "sandbox")
    other = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")

    walkin = (await book(client, ctx, court=ctx["court_1"], starts_at=at(13, 9))).json()
    theirs = one(
        await partner_book(client, other, court=ctx["court_1"], starts_at=at(13, 11))
    )

    # The sandbox partner naming both — neither is its own.
    removed = await _purge(
        tenant_a.id, sandbox["id"], [walkin["reference"], theirs["reference"]]
    )
    assert removed["bookings"] == 0

    async with tenant_session(tenant_a.id) as session:
        surviving = {
            r for (r,) in (await session.execute(select(Booking.reference))).all()
        }
    assert walkin["reference"] in surviving
    assert theirs["reference"] in surviving
