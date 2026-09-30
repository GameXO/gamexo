"""The externalisation gateway: partner isolation, idempotency, double-booking.

The property that matters most here is negative — what a partner CANNOT see. Most
of these tests assert a 404 or a 403, because the failure mode is silent: a gateway
that leaks another platform's bookings works perfectly from the partner's side.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from tests.conftest import TenantFixture
from tests.test_booking import book, setup_academy

IST = ZoneInfo("Asia/Kolkata")


def _next_month() -> tuple[int, int]:
    """The month after this one, so every day-of-month below is still ahead."""
    today = datetime.now(IST).date()
    return (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)


_YEAR, _MONTH = _next_month()


def at(day: int, hour: int, minute: int = 0) -> str:
    """`test_booking.at()`, shifted into next month.

    Same signature and the same day-numbering, so the tests below keep using
    distinct days to stay out of each other's way — only the month moves. The
    booking suite pins its calendar to September 2026 because it asserts on
    specific weekdays and peak windows; nothing in this file does, and every
    partner call here creates a hold or a booking, which the gateway correctly
    refuses for a slot that has already happened. Pinned, these tests passed
    until the wall clock caught up with them and then failed on an empty
    response body.
    """
    return datetime(_YEAR, _MONTH, day, hour, minute, tzinfo=IST).isoformat()


#: The same month, as a bare date, for availability queries.
DAY = f"{_YEAR:04d}-{_MONTH:02d}-04"


async def make_partner(
    client: AsyncClient,
    ctx: dict,
    tenant: TenantFixture,
    name: str,
    slug: str,
    dialect: str = "native",
    key_kind: str = "secret",
    allowed_origins: list[str] | None = None,
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
        json={
            "name": name,
            "slug": slug,
            "dialect": dialect,
            "key_kind": key_kind,
            "allowed_origins": allowed_origins or [],
        },
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


async def test_a_key_used_against_another_dialects_canonical_path_is_refused(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """`speaking()`, on the path it still guards.

    A misconfiguration alarm, not a security boundary — both dialects reach the same
    core and are scoped to the same partner, so nothing is exposed either way. It only
    fires on a deliberate call to a canonical path, because everything arriving through
    the advertised URL has already been routed by this same field.
    """
    ctx = await setup_academy(client, tenant_a)
    native_partner = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")

    wrong_way = await client.get(
        "/api/v1/gateway/playo/availability",
        params={"date": DAY},
        headers=native_partner["headers"],
    )
    assert wrong_way.status_code == 401
    assert "native" in wrong_way.json()["error"]["message"]


async def test_the_dialect_registry_is_listed_for_the_dashboard(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """So Manage → Integrations offers what exists rather than a hardcoded list."""
    ctx = await setup_academy(client, tenant_a)

    response = await client.get("/api/v1/partners/dialects", headers=ctx["headers"])
    assert response.status_code == 200, response.text

    listed = response.json()
    by_slug = {d["slug"]: d for d in listed}
    assert {"native", "playo", "hudle", "district"} <= set(by_slug)
    assert by_slug["native"]["is_default"] is True

    # The same URL for every platform — the one thing this endpoint exists to say.
    # A dashboard that offered a choice of base path would be offering a way to get
    # it wrong.
    assert {d["base_path"] for d in by_slug.values()} == {"/api/v1/gateway"}
    assert by_slug["playo"]["canonical_path"] == "/api/v1/gateway/playo"
    assert by_slug["native"]["canonical_path"] == "/api/v1/gateway/native"

    # Exactly three platforms, and the one with an adapter comes first — the screen
    # renders them in the order they arrive.
    platforms = [d["slug"] for d in listed if d["is_platform"]]
    assert platforms == ["playo", "hudle", "district"]
    assert by_slug["native"]["is_platform"] is False

    assert by_slug["playo"]["is_ready"] is True
    assert by_slug["hudle"]["is_ready"] is False
    assert by_slug["district"]["is_ready"] is False


async def test_a_platform_without_an_adapter_cannot_be_given_a_key(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Greying the card out is presentation. This is the rule.

    A key issued against Hudle would authenticate perfectly and then fail on every
    call, because there is no adapter behind it — the worst kind of broken, since the
    credential looks right and the integration simply never works.
    """
    ctx = await setup_academy(client, tenant_a)

    created = await client.post(
        "/api/v1/partners",
        json={"name": "Hudle", "slug": "hudle", "dialect": "hudle"},
        headers=ctx["headers"],
    )
    assert created.status_code == 409, created.text
    assert "Hudle" in created.json()["error"]["message"]
    assert created.json()["error"]["details"]["dialect"] == "hudle"

    # And the same rule on the way in through the back door — re-pointing an existing
    # integration onto an unbuilt platform is the identical mistake, one PATCH later.
    partner = await make_partner(client, ctx, tenant_a, "Playo", "playo", dialect="playo")
    moved = await client.patch(
        f"/api/v1/partners/{partner['id']}",
        json={"dialect": "district"},
        headers=ctx["headers"],
    )
    assert moved.status_code == 409, moved.text
    assert "District" in moved.json()["error"]["message"]


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


# ── One URL, and the key decides which platform is calling ──────────────────
#
# Every other gateway test in this file, and every test in test_playo.py, already
# exercises the routing incidentally — they call `/api/v1/gateway/…` and reach the
# right contract. These are the ones that would fail *first*, and say why, if
# key-based dispatch broke.


async def test_one_url_reaches_each_platforms_own_contract(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The whole point. Two platforms, one URL, two different contracts.

    Neither request names a dialect anywhere — not in the path, not in a header, not
    in the body. The only thing distinguishing them is which key was presented.
    """
    ctx = await setup_academy(client, tenant_a)
    ours = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")
    theirs = await make_partner(client, ctx, tenant_a, "Playo", "playo", dialect="playo")

    mine = await client.post(
        "/api/v1/gateway/bookings/hold",
        json={
            "slots": [
                {
                    "court_id": ctx["court_1"],
                    "starts_at": at(4, 7),
                    "duration_min": 60,
                    "customer_name": "Ours",
                    "customer_phone": "9876500000",
                }
            ]
        },
        headers=ours["headers"],
    )
    assert mine.status_code == 201, mine.text
    # Our envelope: a bare list, snake_case, and a reference rather than their id.
    assert one(mine)["reference"].startswith("XCB")

    playo = await client.post(
        "/api/v1/gateway/order/create",
        json={
            "userName": "Theirs",
            "orders": [
                {
                    "date": DAY,
                    "courtId": ctx["court_2"],
                    "startTime": "07:00:00",
                    "endTime": "08:00:00",
                    "price": "1200",
                    "paidAtPlayo": "1200",
                    "playoOrderId": "P-DISPATCH-1",
                }
            ],
        },
        headers=theirs["headers"],
    )
    # Playo's envelope, not ours: a 200 carrying requestStatus, and camelCase.
    assert playo.status_code == 200, playo.text
    assert playo.json()["requestStatus"] == "1"
    assert playo.json()["orderIds"][0]["externalOrderId"]


async def test_the_one_shared_path_still_answers_in_each_platforms_shape(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """`/availability` is the only path both platforms declare.

    Nothing in the request tells them apart — same method, same path, a `date` query
    param in both. It is the case a path-based router could not resolve at all, and
    the reason the key is what decides.
    """
    ctx = await setup_academy(client, tenant_a)
    ours = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")
    theirs = await make_partner(client, ctx, tenant_a, "Playo", "playo", dialect="playo")

    mine = await client.get(
        "/api/v1/gateway/availability",
        params={"date": at(11, 0)},
        headers=ours["headers"],
    )
    assert mine.status_code == 200, mine.text
    # A bare list of courts, snake_case, ISO instants.
    assert isinstance(mine.json(), list)
    assert "court_id" in mine.json()[0]

    theirs_response = await client.get(
        "/api/v1/gateway/availability",
        params={"date": f"{_YEAR:04d}-{_MONTH:02d}-11"},
        headers=theirs["headers"],
    )
    assert theirs_response.status_code == 200, theirs_response.text
    body = theirs_response.json()
    assert body["requestStatus"] == "1"
    assert "courtId" in body["courts"][0]


async def test_calling_another_platforms_path_says_which_one_owns_it(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Removing the per-platform base URL removed the moment a wrong choice announced
    itself. Without this message the same mistake is a bare 404 — strictly worse than
    the 401 it replaced, because a 404 does not say what to change.
    """
    ctx = await setup_academy(client, tenant_a)
    theirs = await make_partner(client, ctx, tenant_a, "Playo", "playo", dialect="playo")

    response = await client.post(
        "/api/v1/gateway/bookings/hold", json={"slots": []}, headers=theirs["headers"]
    )
    assert response.status_code == 404, response.text

    error = response.json()["error"]
    assert "Playo" in error["message"]
    assert "gamexo API" in error["message"]
    assert error["details"]["registered_as"] == "playo"
    assert error["details"]["path_belongs_to"] == ["native"]


async def test_an_unknown_key_is_indistinguishable_from_no_key(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Routing must not become an oracle for which key prefixes exist.

    Both land on the default dialect and are refused by it. If an unknown prefix
    404'd while a real one 401'd, the difference would enumerate live integrations to
    anyone who could reach the gateway.
    """
    await setup_academy(client, tenant_a)

    invented = await client.get(
        "/api/v1/gateway/availability",
        params={"date": at(12, 0)},
        headers={"X-API-Key": "gx_nobody_0000.beef", **tenant_a.headers},
    )
    missing = await client.get(
        "/api/v1/gateway/availability", params={"date": at(12, 0)}, headers=tenant_a.headers
    )

    assert invented.status_code == 401
    assert missing.status_code == 401


async def test_repointing_a_partner_takes_effect_on_the_next_call(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The cache invalidation hook, which is invisible until it is missing.

    A partner set up against the wrong contract is fixed by changing the dialect, not
    by reissuing the key — and delete-and-recreate is not available, because the FK
    from booking is RESTRICT. So this PATCH is the only repair, and it has to work
    immediately rather than whenever a 5-minute cache happens to expire.
    """
    ctx = await setup_academy(client, tenant_a)
    # Set up wrongly: Playo, tagged as speaking our contract.
    partner = await make_partner(client, ctx, tenant_a, "Playo", "playo")

    body = {
        "userName": "Theirs",
        "orders": [
            {
                "date": DAY,
                "courtId": ctx["court_1"],
                "startTime": "11:00:00",
                "endTime": "12:00:00",
                "price": "1200",
                "paidAtPlayo": "1200",
                "playoOrderId": "P-REPOINT-1",
            }
        ],
    }

    before = await client.post(
        "/api/v1/gateway/order/create", json=body, headers=partner["headers"]
    )
    assert before.status_code == 404
    assert "Playo" in before.json()["error"]["message"]

    fixed = await client.patch(
        f"/api/v1/partners/{partner['id']}",
        json={"dialect": "playo"},
        headers=ctx["headers"],
    )
    assert fixed.status_code == 200, fixed.text

    after = await client.post(
        "/api/v1/gateway/order/create", json=body, headers=partner["headers"]
    )
    assert after.status_code == 200, after.text
    assert after.json()["requestStatus"] == "1"


async def test_rotating_a_key_does_not_leave_the_old_prefix_routing(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Rotation changes the prefix itself, so the retired one is what must be dropped.

    Cached under the *old* prefix, the stale entry is harmless — no key hashes to it
    any more. The test that matters is that the new prefix routes correctly straight
    away, which it does only because misses are never cached.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Playo", "playo", dialect="playo")

    warmed = await client.get(
        "/api/v1/gateway/availability", params={"date": f"{_YEAR:04d}-{_MONTH:02d}-13"},
        headers=partner["headers"],
    )
    assert warmed.json()["requestStatus"] == "1"

    rotated = await client.post(
        f"/api/v1/partners/{partner['id']}/rotate-key", headers=ctx["headers"]
    )
    assert rotated.status_code == 200, rotated.text
    new_headers = {"X-API-Key": rotated.json()["api_key"], **tenant_a.headers}

    stale = await client.get(
        "/api/v1/gateway/availability", params={"date": f"{_YEAR:04d}-{_MONTH:02d}-13"},
        headers=partner["headers"],
    )
    assert stale.status_code == 401

    fresh = await client.get(
        "/api/v1/gateway/availability", params={"date": f"{_YEAR:04d}-{_MONTH:02d}-13"}, headers=new_headers
    )
    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["requestStatus"] == "1"


async def test_the_sandbox_refuses_a_dialect_its_key_cannot_drive(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The drivers call the advertised URL, so the key decides there too.

    Before dispatch this needed two partners — one per dialect — which is how two
    `Sandbox …` integrations came to exist on the dev database. Now it is one refusal
    with a reason, instead of eight scenarios failing for no visible cause.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")

    response = await client.post(
        "/api/v1/gateway/sandbox/run", params={"dialect": "playo"},
        headers=partner["headers"],
    )
    assert response.status_code == 409, response.text
    assert "Playo" in response.json()["error"]["message"]
    assert response.json()["error"]["details"]["key_dialect"] == "native"


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


# ── Reaching the gateway without a subdomain ────────────────────────────────
#
# The partner path. A platform has no login and no per-academy hostname, so before
# the key could name its own academy every gateway call to a shared origin died at
# "could not determine the academy" — including the ones the published Playo docs
# tell partners to make.


async def test_a_key_names_its_own_academy_with_no_host_or_header(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The blocker this whole path exists to remove.

    No `X-Tenant-ID` (forbidden in production) and no subdomain — exactly what a
    partner sends. The request must reach the dialect and be answered, not refused
    with a 400 about hostnames.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")

    bare = {"X-API-Key": partner["headers"]["X-API-Key"]}
    assert "X-Tenant-ID" not in bare

    response = await client.get("/api/v1/gateway/availability", params={"date": DAY}, headers=bare)
    assert response.status_code == 200, response.text


async def test_an_unknown_key_is_401_not_a_tenant_error(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A forged prefix must fail on the credential, not on tenant resolution.

    Answering "could not determine the academy" would tell a caller their key was
    at least *shaped* like one we know. It also reads as our outage rather than
    their bad credential, which sends the wrong team looking.
    """
    await setup_academy(client, tenant_a)

    response = await client.get(
        "/api/v1/gateway/availability",
        params={"date": DAY},
        headers={"X-API-Key": "gx_ghost_deadbeef.notarealsecret"},
    )
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "unauthenticated"


async def test_a_hostname_still_outranks_the_key(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """Academy A's key presented to academy B is still refused.

    The key resolving its own academy must not become a way to ignore the academy
    the caller actually addressed. Host wins, the authentication lookup runs inside
    B, finds nothing, and 401s — the cross-tenant replay defence that would
    otherwise have been quietly removed.
    """
    ctx_a = await setup_academy(client, tenant_a)
    await setup_academy(client, tenant_b)
    partner = await make_partner(client, ctx_a, tenant_a, "Anyplace", "anyplace")

    response = await client.get(
        "/api/v1/gateway/availability",
        params={"date": DAY},
        headers={"X-API-Key": partner["headers"]["X-API-Key"], **tenant_b.headers},
    )
    assert response.status_code == 401, response.text


async def test_an_unknown_prefix_is_indistinguishable_from_a_wrong_secret(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The oracle this must not become.

    Once a key can name its own academy, an unknown prefix has no academy to name
    and resolution fails — while a known prefix with a forged secret gets all the
    way to authentication. Left alone, that is 400 against 401 and a free way to
    enumerate which integrations exist. Both must answer identically.
    """
    ctx = await setup_academy(client, tenant_a)
    real = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")
    real_prefix = real["headers"]["X-API-Key"].split(".")[0]

    unknown = await client.get(
        "/api/v1/gateway/availability",
        params={"date": DAY},
        headers={"X-API-Key": "gx_ghost_deadbeef.notarealsecret"},
    )
    forged = await client.get(
        "/api/v1/gateway/availability",
        params={"date": DAY},
        headers={"X-API-Key": f"{real_prefix}.wrong-secret-entirely"},
    )

    assert unknown.status_code == forged.status_code == 401
    assert unknown.json()["error"] == forged.json()["error"]


async def test_the_key_directory_stays_in_step_with_its_partner(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The mirror is a trigger, so it cannot drift.

    A stale directory does not fail loudly — it resolves a live integration to no
    academy, which reads as an outage rather than a bug. Rotation is the case that
    matters most: the prefix itself changes, so the old row has to go or a
    superseded key keeps resolving.
    """
    from sqlalchemy import text

    from app.db.session import untenanted_session

    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")
    first_prefix = partner["headers"]["X-API-Key"].split(".")[0]

    async def directory() -> dict[str, str]:
        async with untenanted_session() as session:
            rows = (
                await session.execute(text("select key_prefix, dialect from partner_key_directory"))
            ).all()
        return {r[0]: r[1] for r in rows}

    assert await directory() == {first_prefix: "native"}

    # Re-pointing carries the new dialect across.
    await client.patch(
        f"/api/v1/partners/{partner['id']}", json={"dialect": "playo"}, headers=ctx["headers"]
    )
    assert await directory() == {first_prefix: "playo"}

    # Rotation replaces the row rather than adding a second one.
    rotated = await client.post(
        f"/api/v1/partners/{partner['id']}/rotate-key", headers=ctx["headers"]
    )
    new_prefix = rotated.json()["api_key"].split(".")[0]
    assert new_prefix != first_prefix
    assert await directory() == {new_prefix: "playo"}

    # And the retired prefix no longer resolves an academy at all.
    stale = await client.get(
        "/api/v1/gateway/availability",
        params={"date": DAY},
        headers={"X-API-Key": f"{first_prefix}.whatever"},
    )
    assert stale.status_code == 401


# ── Publishable keys ───────────────────────────────────────────────────────
#
# A partner with no backend has nowhere to put a key except their JavaScript, where
# anyone can read it. A publishable key is the admission that this has happened, and
# the narrowing that has to follow from it.


async def publishable(client: AsyncClient, ctx: dict, tenant: TenantFixture) -> dict:
    return await make_partner(
        client, ctx, tenant, "Base44", "base44",
        key_kind="publishable", allowed_origins=["https://xcs.base44.app"],
    )


async def test_a_publishable_key_is_marked_as_such_in_the_key_itself(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """`gxp_` rather than `gx_`, so the two are told apart on sight.

    A secret key pasted into frontend code is the mistake this distinction exists
    to prevent, and it should be obvious in a diff or a screenshot — not only after
    somebody thinks to check the database.
    """
    ctx = await setup_academy(client, tenant_a)
    pub = await publishable(client, ctx, tenant_a)
    secret = await make_partner(client, ctx, tenant_a, "Server Side", "serverside")

    assert pub["api_key"].startswith("gxp_")
    assert secret["api_key"].startswith("gx_")
    assert not secret["api_key"].startswith("gxp_")


async def test_a_publishable_key_can_sell_a_court(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The whole point: a browser can read availability and take a booking."""
    ctx = await setup_academy(client, tenant_a)
    pub = await publishable(client, ctx, tenant_a)

    seen = await client.get(
        "/api/v1/gateway/availability", params={"date": DAY}, headers=pub["headers"]
    )
    assert seen.status_code == 200, seen.text

    held = await partner_book(client, pub, court=ctx["court_1"], starts_at=at(9, 7), hold=True)
    assert held.status_code == 201, held.text

    booked = await partner_book(client, pub, court=ctx["court_1"], starts_at=at(9, 9))
    assert booked.status_code == 201, booked.text


async def test_a_publishable_key_cannot_read_the_customer_list(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The exposure that actually matters.

    Listing bookings returns a name and phone number for every customer at the
    venue. A credential anyone can lift out of a browser must not be able to
    export that, whatever else it can do.
    """
    ctx = await setup_academy(client, tenant_a)
    pub = await publishable(client, ctx, tenant_a)
    made = await partner_book(client, pub, court=ctx["court_1"], starts_at=at(10, 7))
    reference = one(made)["reference"]

    listed = await client.get("/api/v1/gateway/bookings", headers=pub["headers"])
    assert listed.status_code == 403, listed.text
    assert listed.json()["error"]["details"]["key_kind"] == "publishable"

    single = await client.get(
        f"/api/v1/gateway/bookings/{reference}", headers=pub["headers"]
    )
    assert single.status_code == 403, single.text


async def test_a_publishable_key_cannot_cancel(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """There is no way to prove ownership from a public key.

    So "cancel my booking" and "cancel anyone's booking" are the same request, and
    the capability cannot be offered at all.
    """
    ctx = await setup_academy(client, tenant_a)
    pub = await publishable(client, ctx, tenant_a)
    made = await partner_book(client, pub, court=ctx["court_1"], starts_at=at(11, 7))
    reference = one(made)["reference"]

    response = await client.post(
        f"/api/v1/gateway/bookings/{reference}/cancel", json={}, headers=pub["headers"]
    )
    assert response.status_code == 403, response.text


async def test_a_secret_key_keeps_the_whole_contract(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Every partner onboarded before publishable keys existed has a secret one.

    Nothing about them may narrow, or this becomes a silent breaking change to a
    live integration.
    """
    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")
    made = await partner_book(client, partner, court=ctx["court_1"], starts_at=at(12, 7))
    reference = one(made)["reference"]

    assert (await client.get("/api/v1/gateway/bookings", headers=partner["headers"])).status_code == 200
    assert (
        await client.get(f"/api/v1/gateway/bookings/{reference}", headers=partner["headers"])
    ).status_code == 200
    assert (
        await client.post(
            f"/api/v1/gateway/bookings/{reference}/cancel", json={}, headers=partner["headers"]
        )
    ).status_code == 200


async def test_rotating_a_publishable_key_keeps_it_publishable(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Rotation must not quietly promote a browser key to a secret one.

    The new key lands in the same JavaScript bundle the old one came from, so it
    is public whatever we label it. Minting a `gx_` here would widen a credential
    that is already exposed, and remove the narrowing that made it safe to issue.
    """
    ctx = await setup_academy(client, tenant_a)
    pub = await publishable(client, ctx, tenant_a)

    rotated = await client.post(
        f"/api/v1/partners/{pub['id']}/rotate-key", headers=ctx["headers"]
    )
    assert rotated.status_code == 200, rotated.text
    assert rotated.json()["api_key"].startswith("gxp_")
    assert rotated.json()["key_kind"] == "publishable"

    fresh = {"X-API-Key": rotated.json()["api_key"], **tenant_a.headers}
    assert (await client.get("/api/v1/gateway/bookings", headers=fresh)).status_code == 403


# ── Cross-origin, for a partner calling from a browser ─────────────────────


async def test_an_allowed_origin_gets_a_cors_header(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Without this the browser discards a perfectly good response.

    That is the whole job: CORS is what makes a browser integration work, not what
    makes it safe. `PUBLISHABLE_OPERATIONS` is the part that makes it safe.
    """
    ctx = await setup_academy(client, tenant_a)
    pub = await publishable(client, ctx, tenant_a)

    response = await client.get(
        "/api/v1/gateway/availability",
        params={"date": DAY},
        headers={**pub["headers"], "Origin": "https://xcs.base44.app"},
    )
    assert response.status_code == 200, response.text
    assert response.headers["access-control-allow-origin"] == "https://xcs.base44.app"
    assert "Origin" in response.headers.get("vary", "")


async def test_another_origin_gets_no_cors_header(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A stolen key used from someone else's website reads nothing back.

    Answered normally rather than refused, so the browser reports "blocked by
    CORS" — which is true — instead of us inventing a 4xx that suggests the key
    or the request was wrong.
    """
    ctx = await setup_academy(client, tenant_a)
    pub = await publishable(client, ctx, tenant_a)

    response = await client.get(
        "/api/v1/gateway/availability",
        params={"date": DAY},
        headers={**pub["headers"], "Origin": "https://not-their-site.example"},
    )
    assert "access-control-allow-origin" not in response.headers


async def test_origins_are_per_partner_not_global(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """One customer's website must not be allowed by another customer's key."""
    ctx = await setup_academy(client, tenant_a)
    theirs = await publishable(client, ctx, tenant_a)
    other = await make_partner(
        client, ctx, tenant_a, "Someone Else", "someoneelse",
        key_kind="publishable", allowed_origins=["https://other.example"],
    )

    crossed = await client.get(
        "/api/v1/gateway/availability",
        params={"date": DAY},
        headers={**other["headers"], "Origin": "https://xcs.base44.app"},
    )
    assert "access-control-allow-origin" not in crossed.headers

    own = await client.get(
        "/api/v1/gateway/availability",
        params={"date": DAY},
        headers={**theirs["headers"], "Origin": "https://xcs.base44.app"},
    )
    assert own.headers["access-control-allow-origin"] == "https://xcs.base44.app"


async def test_a_preflight_is_answered_without_a_key(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Browsers do not send custom headers on a preflight, so there is no key here.

    Refusing it would break every browser integration before the real request is
    ever made. It is answered permissively on purpose, and the origin decision
    happens on the request that actually carries the credential — see cors.py.
    """
    await setup_academy(client, tenant_a)

    response = await client.request(
        "OPTIONS",
        "/api/v1/gateway/bookings/hold",
        headers={
            "Origin": "https://xcs.base44.app",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-api-key, content-type",
        },
    )
    assert response.status_code == 204, response.text
    assert response.headers["access-control-allow-origin"] == "https://xcs.base44.app"
    assert "X-API-Key" in response.headers["access-control-allow-headers"]


async def test_a_call_with_no_origin_is_untouched(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Server-to-server partners send no Origin and must not be affected at all."""
    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")

    response = await client.get(
        "/api/v1/gateway/availability", params={"date": DAY}, headers=partner["headers"]
    )
    assert response.status_code == 200, response.text
    assert "access-control-allow-origin" not in response.headers


# ── Rate limiting ──────────────────────────────────────────────────────────


def test_a_publishable_key_gets_a_tighter_budget_than_a_secret_one() -> None:
    """The unit, so the numbers are asserted without making 70 HTTP calls.

    A publishable key is one we know to be public, so its ceiling is what a real
    venue's traffic needs rather than what a trusted server might.
    """
    from app.modules.gateway import throttle

    assert throttle.limit_for("publishable", "hold").allowance < (
        throttle.limit_for("secret", "hold").allowance
    )
    # Holds are the tightest of all: they are the only call that takes a court out
    # of sale before anyone has paid.
    assert throttle.limit_for("publishable", "hold").allowance < (
        throttle.limit_for("publishable", "availability").allowance
    )


def test_the_budget_refuses_past_its_allowance_and_recovers() -> None:
    from app.modules.gateway import throttle

    throttle.reset()
    allowance = throttle.limit_for("publishable", "hold").allowance

    for _ in range(allowance):
        throttle.check(key_prefix="gxp_t_1", key_kind="publishable", operation="hold")

    with pytest.raises(throttle.RateLimitedError) as excinfo:
        throttle.check(key_prefix="gxp_t_1", key_kind="publishable", operation="hold")
    assert excinfo.value.details["allowance"] == allowance
    assert excinfo.value.details["retry_after_seconds"] >= 1

    # A different operation has its own budget — exhausting holds must not stop a
    # customer from seeing what is free.
    throttle.check(key_prefix="gxp_t_1", key_kind="publishable", operation="availability")


def test_budgets_do_not_leak_between_keys() -> None:
    """One noisy partner must not throttle another."""
    from app.modules.gateway import throttle

    throttle.reset()
    allowance = throttle.limit_for("publishable", "hold").allowance
    for _ in range(allowance + 5):
        try:
            throttle.check(key_prefix="gxp_noisy", key_kind="publishable", operation="hold")
        except throttle.RateLimitedError:
            pass

    throttle.check(key_prefix="gxp_quiet", key_kind="publishable", operation="hold")


async def test_a_throttled_partner_gets_429_and_creates_nothing(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """End to end, and the half that matters: the refusal writes no booking.

    A 429 that still consumed a court would be worse than no limit at all.
    """
    from sqlalchemy import func, select

    from app.db.session import tenant_session
    from app.modules.booking.models import Booking
    from app.modules.gateway import throttle

    ctx = await setup_academy(client, tenant_a)
    pub = await publishable(client, ctx, tenant_a)
    allowance = throttle.limit_for("publishable", "hold").allowance

    made = 0
    for hour in range(7, 7 + allowance):
        response = await partner_book(
            client, pub, court=ctx["court_1"], starts_at=at(13, hour), hold=True
        )
        assert response.status_code == 201, response.text
        made += 1

    async def booking_count() -> int:
        async with tenant_session(tenant_a.id) as session:
            return (await session.execute(select(func.count()).select_from(Booking))).scalar_one()

    before = await booking_count()

    refused = await partner_book(
        client, pub, court=ctx["court_2"], starts_at=at(13, 7), hold=True
    )
    assert refused.status_code == 429, refused.text
    assert refused.json()["error"]["code"] == "rate_limited"
    assert await booking_count() == before == made


async def test_a_secret_key_is_not_throttled_at_a_publishable_rate(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Existing server-to-server partners must not be narrowed by this."""
    from app.modules.gateway import throttle

    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Anyplace", "anyplace")
    over_publishable = throttle.limit_for("publishable", "hold").allowance + 3

    for hour in range(7, 7 + over_publishable):
        response = await partner_book(
            client, partner, court=ctx["court_1"], starts_at=at(14, hour), hold=True
        )
        assert response.status_code == 201, response.text


# ── A key alone names the academy ───────────────────────────────────────────


@pytest.mark.parametrize(
    "path,params",
    [
        # Not a gateway path at all: the dispatcher never sees it.
        ("/api/v1/health/tenant", {}),
        # A canonical per-dialect path, which the dispatcher deliberately leaves alone.
        ("/api/v1/gateway/playo/availability", {"date": f"{_YEAR:04d}-{_MONTH:02d}-13"}),
    ],
)
async def test_a_key_alone_resolves_its_academy_on_a_cold_cache(
    client: AsyncClient, tenant_a: TenantFixture, path: str, params: dict
) -> None:
    """A partner has no subdomain and no X-Tenant-ID — the key is all it sends.

    The resolver used to reach the key only through the dispatcher's routing cache,
    which only gateway paths warm. On anything else — the sandbox, a canonical
    `/gateway/playo/…` path, the health probe — a key the process had not seen yet
    was refused as invalid before its directory row was ever read. Found on staging,
    where the sandbox run 401'd with a perfectly good key.
    """
    from app.modules.gateway.dispatch import invalidate_partner_cache

    ctx = await setup_academy(client, tenant_a)
    partner = await make_partner(client, ctx, tenant_a, "Playo", "playo", dialect="playo")
    invalidate_partner_cache()

    response = await client.get(
        path, params=params, headers={"X-API-Key": partner["api_key"]}
    )

    assert response.status_code == 200, response.text
    if path.endswith("/health/tenant"):
        assert response.json()["slug"] == tenant_a.slug
        assert response.json()["resolved_via"] == "api_key"
    else:
        assert response.json()["requestStatus"] == "1"


async def test_an_unknown_key_alone_is_still_a_401(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The fallback must not turn "no such key" into "could not determine the
    academy" — that difference would tell a caller which prefixes exist."""
    response = await client.get(
        "/api/v1/health/tenant", headers={"X-API-Key": "gx_nobody_00000000.secret"}
    )
    assert response.status_code == 401
    assert response.json()["error"]["message"] == "Invalid or revoked API key."
