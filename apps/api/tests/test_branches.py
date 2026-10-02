"""Branches: multi-site academies, who may manage them, and what they stamp on bookings."""

from __future__ import annotations

from httpx import AsyncClient

from app.core.security import Role
from tests.conftest import PASSWORD, TenantFixture, auth_headers, login, make_user
from tests.test_booking import at, book, setup_academy

BRANCHES = "/api/v1/branches"

KONDAPUR = {
    "name": "Kondapur",
    "address": "Survey 42, Kondapur",
    "city": "Hyderabad",
    "state": "Telangana",
    "pincode": "500084",
    "phone": "9876500099",
    "gstin": "36AABCN1234K1Z9",
}


async def _list(client: AsyncClient, headers: dict, **params) -> list[dict]:
    response = await client.get(BRANCHES, params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


async def _staff_headers(client: AsyncClient, tenant: TenantFixture, role: Role, email: str) -> dict:
    user = await make_user(tenant, email=email, role=role)
    return auth_headers(await login(client, tenant, user.username, PASSWORD), tenant)


# ── Provisioning ────────────────────────────────────────────────────────────


async def test_a_new_academy_starts_with_one_default_branch(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    branches = await _list(client, ctx["headers"])

    assert len(branches) == 1
    assert branches[0]["is_default"] is True
    assert branches[0]["is_active"] is True


async def test_a_court_added_without_a_branch_lands_in_the_default(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    default = (await _list(client, ctx["headers"]))[0]

    courts = (await client.get("/api/v1/courts", headers=ctx["headers"])).json()
    assert {c["branch_id"] for c in courts} == {default["id"]}


# ── Managing branches ───────────────────────────────────────────────────────


async def test_admin_can_add_a_branch_and_it_is_not_the_default(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    created = await client.post(BRANCHES, json=KONDAPUR, headers=ctx["headers"])

    assert created.status_code == 201, created.text
    body = created.json()
    assert body["is_default"] is False
    assert body["gstin"] == "36AABCN1234K1Z9"
    assert len(await _list(client, ctx["headers"])) == 2


async def test_branch_names_are_unique_ignoring_case(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    assert (await client.post(BRANCHES, json=KONDAPUR, headers=ctx["headers"])).status_code == 201

    clash = await client.post(BRANCHES, json={**KONDAPUR, "name": "kondapur"}, headers=ctx["headers"])
    assert clash.status_code == 409


async def test_a_malformed_gstin_is_refused_and_a_blank_one_is_allowed(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)

    bad = await client.post(BRANCHES, json={**KONDAPUR, "gstin": "NOT-A-GSTIN"}, headers=ctx["headers"])
    assert bad.status_code == 422

    blank = await client.post(BRANCHES, json={**KONDAPUR, "gstin": "  "}, headers=ctx["headers"])
    assert blank.status_code == 201
    assert blank.json()["gstin"] is None


async def test_only_an_admin_can_add_or_edit_a_branch(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    manager = await _staff_headers(client, tenant_a, Role.MANAGER, "manager@example.com")
    default = (await _list(client, ctx["headers"]))[0]

    assert (await client.post(BRANCHES, json=KONDAPUR, headers=manager)).status_code == 403
    edit = await client.patch(f"{BRANCHES}/{default['id']}", json={"city": "Pune"}, headers=manager)
    assert edit.status_code == 403


async def test_the_counter_can_list_branches_but_never_sees_closed_ones(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    created = (await client.post(BRANCHES, json=KONDAPUR, headers=ctx["headers"])).json()
    off = await client.patch(f"{BRANCHES}/{created['id']}", json={"is_active": False}, headers=ctx["headers"])
    assert off.status_code == 200, off.text

    kiosk = await _staff_headers(client, tenant_a, Role.KIOSK, "counter@example.com")

    # include_inactive is honoured for staff and ignored for the tablet.
    assert len(await _list(client, kiosk, include_inactive=True)) == 1
    assert len(await _list(client, ctx["headers"], include_inactive=True)) == 2


async def test_making_another_branch_the_default_moves_the_flag(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    original = (await _list(client, ctx["headers"]))[0]
    second = (await client.post(BRANCHES, json=KONDAPUR, headers=ctx["headers"])).json()

    promoted = await client.patch(f"{BRANCHES}/{second['id']}", json={"is_default": True}, headers=ctx["headers"])
    assert promoted.status_code == 200, promoted.text

    by_id = {b["id"]: b for b in await _list(client, ctx["headers"])}
    assert by_id[second["id"]]["is_default"] is True
    assert by_id[original["id"]]["is_default"] is False
    assert sum(b["is_default"] for b in by_id.values()) == 1


async def test_the_default_branch_cannot_be_deactivated_or_unset(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    default = (await _list(client, ctx["headers"]))[0]

    off = await client.patch(f"{BRANCHES}/{default['id']}", json={"is_active": False}, headers=ctx["headers"])
    assert off.status_code == 409
    unset = await client.patch(f"{BRANCHES}/{default['id']}", json={"is_default": False}, headers=ctx["headers"])
    assert unset.status_code == 409


async def test_a_branch_with_bookable_courts_cannot_be_deactivated(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    second = (await client.post(BRANCHES, json=KONDAPUR, headers=ctx["headers"])).json()
    await client.patch(f"/api/v1/courts/{ctx['court_2']}", json={"branch_id": second["id"]}, headers=ctx["headers"])

    refused = await client.patch(f"{BRANCHES}/{second['id']}", json={"is_active": False}, headers=ctx["headers"])
    assert refused.status_code == 409
    assert refused.json()["error"]["details"]["court_count"] == 1

    # Once the court is switched off the branch can close.
    await client.patch(f"/api/v1/courts/{ctx['court_2']}", json={"is_bookable": False}, headers=ctx["headers"])
    closed = await client.patch(f"{BRANCHES}/{second['id']}", json={"is_active": False}, headers=ctx["headers"])
    assert closed.status_code == 200, closed.text


async def test_branches_do_not_leak_between_academies(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    ctx_a = await setup_academy(client, tenant_a)
    ctx_b = await setup_academy(client, tenant_b)
    created = (await client.post(BRANCHES, json=KONDAPUR, headers=ctx_a["headers"])).json()

    assert created["id"] not in {b["id"] for b in await _list(client, ctx_b["headers"])}
    steal = await client.patch(f"{BRANCHES}/{created['id']}", json={"city": "X"}, headers=ctx_b["headers"])
    assert steal.status_code == 404


# ── Courts ──────────────────────────────────────────────────────────────────


async def test_courts_can_be_listed_per_branch(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await setup_academy(client, tenant_a)
    second = (await client.post(BRANCHES, json=KONDAPUR, headers=ctx["headers"])).json()
    moved = await client.patch(f"/api/v1/courts/{ctx['court_2']}", json={"branch_id": second["id"]}, headers=ctx["headers"])
    assert moved.status_code == 200, moved.text

    only_second = (
        await client.get("/api/v1/courts", params={"branch_id": second["id"]}, headers=ctx["headers"])
    ).json()
    assert [c["id"] for c in only_second] == [ctx["court_2"]]


async def test_a_court_cannot_be_put_in_a_closed_branch(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    second = (await client.post(BRANCHES, json=KONDAPUR, headers=ctx["headers"])).json()
    await client.patch(f"{BRANCHES}/{second['id']}", json={"is_active": False}, headers=ctx["headers"])

    refused = await client.patch(
        f"/api/v1/courts/{ctx['court_1']}", json={"branch_id": second["id"]}, headers=ctx["headers"]
    )
    assert refused.status_code == 409


# ── Bookings and invoices ───────────────────────────────────────────────────


async def test_a_booking_carries_its_courts_branch_with_the_gstin_resolved(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    second = (await client.post(BRANCHES, json=KONDAPUR, headers=ctx["headers"])).json()
    await client.patch(f"/api/v1/courts/{ctx['court_2']}", json={"branch_id": second["id"]}, headers=ctx["headers"])

    response = await book(client, ctx, court=ctx["court_2"], starts_at=at(3, 10))
    assert response.status_code == 201, response.text
    booking = response.json()

    assert booking["branch_id"] == second["id"]
    assert booking["branch"]["name"] == "Kondapur"
    assert booking["branch"]["address"] == "Survey 42, Kondapur"
    assert booking["branch"]["gstin"] == "36AABCN1234K1Z9"


async def test_a_branch_without_its_own_gstin_prints_the_academys(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    await client.patch("/api/v1/settings", json={"gst_number": "29AAAAA0000A1Z5"}, headers=ctx["headers"])

    response = await book(client, ctx, court=ctx["court_1"], starts_at=at(3, 12))
    assert response.status_code == 201, response.text
    assert response.json()["branch"]["gstin"] == "29AAAAA0000A1Z5"


async def test_the_counter_can_read_the_gstin_a_branch_will_print(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The tablet cannot read /settings, so the resolved GSTIN has to ride on the branch."""
    ctx = await setup_academy(client, tenant_a)
    await client.patch("/api/v1/settings", json={"gst_number": "29AAAAA0000A1Z5"}, headers=ctx["headers"])
    own = (await client.post(BRANCHES, json=KONDAPUR, headers=ctx["headers"])).json()
    assert own["effective_gstin"] == "36AABCN1234K1Z9"

    kiosk = await _staff_headers(client, tenant_a, Role.KIOSK, "counter@example.com")
    by_name = {b["name"]: b for b in await _list(client, kiosk)}
    default_name = next(n for n, b in by_name.items() if b["is_default"])
    assert by_name[default_name]["gstin"] is None
    assert by_name[default_name]["effective_gstin"] == "29AAAAA0000A1Z5"


async def test_the_invoice_is_raised_in_the_bookings_branch(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    second = (await client.post(BRANCHES, json=KONDAPUR, headers=ctx["headers"])).json()
    await client.patch(f"/api/v1/courts/{ctx['court_2']}", json={"branch_id": second["id"]}, headers=ctx["headers"])
    booking = (await book(client, ctx, court=ctx["court_2"], starts_at=at(3, 14))).json()

    invoiced = await client.post(f"/api/v1/bookings/{booking['id']}/invoice", headers=ctx["headers"])
    assert invoiced.status_code == 201, invoiced.text
    invoice = invoiced.json()

    assert invoice["branch_id"] == second["id"]
    assert invoice["gst_number"] == "36AABCN1234K1Z9"
    assert "Survey 42, Kondapur" in invoice["billing_address"]

    detail = (await client.get(f"/api/v1/invoices/{invoice['id']}", headers=ctx["headers"])).json()
    assert detail["branch"]["name"] == "Kondapur"


async def test_moving_a_court_later_does_not_rehome_bookings_already_taken(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    default = (await _list(client, ctx["headers"]))[0]
    second = (await client.post(BRANCHES, json=KONDAPUR, headers=ctx["headers"])).json()

    booking = (await book(client, ctx, court=ctx["court_1"], starts_at=at(4, 10))).json()
    await client.patch(f"/api/v1/courts/{ctx['court_1']}", json={"branch_id": second["id"]}, headers=ctx["headers"])

    again = (await client.get(f"/api/v1/bookings/{booking['id']}", headers=ctx["headers"])).json()
    assert again["branch_id"] == default["id"]


# ── Booking source ──────────────────────────────────────────────────────────


async def test_a_booking_from_the_dashboard_is_stamped_office_desk(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    reception = await _staff_headers(client, tenant_a, Role.RECEPTION, "desk@example.com")

    response = await client.post(
        "/api/v1/bookings",
        json={
            "court_id": ctx["court_1"],
            "starts_at": at(5, 10),
            "duration_min": 60,
            "customer_name": "Arjun Mehta",
            "customer_phone": "9876543210",
        },
        headers=reception,
    )
    assert response.status_code == 201, response.text
    assert response.json()["booked_via"] == "office_desk"


async def test_a_booking_from_the_counter_tablet_is_stamped_counter(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    kiosk = await _staff_headers(client, tenant_a, Role.KIOSK, "counter@example.com")

    response = await client.post(
        "/api/v1/bookings",
        json={
            "court_id": ctx["court_1"],
            "starts_at": at(5, 12),
            "duration_min": 60,
            "customer_name": "Arjun Mehta",
            "customer_phone": "9876543210",
        },
        headers=kiosk,
    )
    assert response.status_code == 201, response.text
    assert response.json()["booked_via"] == "counter"


async def test_the_source_cannot_be_claimed_by_the_client(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A receptionist posting `booked_via: counter` is still the office desk."""
    ctx = await setup_academy(client, tenant_a)
    reception = await _staff_headers(client, tenant_a, Role.RECEPTION, "desk@example.com")

    response = await client.post(
        "/api/v1/bookings",
        json={
            "court_id": ctx["court_1"],
            "starts_at": at(5, 14),
            "duration_min": 60,
            "customer_name": "Arjun Mehta",
            "customer_phone": "9876543210",
            "booked_via": "counter",
        },
        headers=reception,
    )
    assert response.status_code == 201, response.text
    assert response.json()["booked_via"] == "office_desk"
