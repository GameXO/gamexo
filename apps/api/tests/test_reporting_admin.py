"""Phase 6: reporting aggregates, settings, notifications, channel config, jobs."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from httpx import AsyncClient

from tests.conftest import PASSWORD, TenantFixture, auth_headers, login, make_user
from tests.test_booking import at, book, setup_academy

IST = ZoneInfo("Asia/Kolkata")


# ── Reporting ───────────────────────────────────────────────────────────────


async def test_peak_hours_bucket_in_the_tenants_timezone(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The single most important detail in the reporting layer.

    An 18:00 IST booking is 12:30 UTC. Bucketed in UTC it lands in the afternoon and
    the evening peak — the thing the chart exists to show — disappears.
    """
    ctx = await setup_academy(client, tenant_a)
    await book(client, ctx, court=ctx["court_1"], starts_at=at(1, 18), minutes=60)
    await book(client, ctx, court=ctx["court_2"], starts_at=at(1, 18), minutes=60)
    await book(client, ctx, court=ctx["court_1"], starts_at=at(2, 7), minutes=60)

    response = await client.get(
        "/api/v1/reports/peak-hours",
        params={"date_from": at(1, 0), "date_to": at(28, 23)},
        headers=ctx["headers"],
    )
    assert response.status_code == 200, response.text
    buckets = {row["hour"]: row["bookings"] for row in response.json()}

    assert buckets["6PM"] == 2, f"expected the evening peak at 6PM IST, got {buckets}"
    assert buckets["7AM"] == 1
    assert "12PM" not in buckets  # where UTC bucketing would have put them


async def test_sport_popularity_percentages(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    for day in (3, 4, 5):
        await book(client, ctx, court=ctx["court_1"], starts_at=at(day, 10))

    response = await client.get(
        "/api/v1/reports/sport-popularity",
        params={"date_from": at(1, 0), "date_to": at(28, 23)},
        headers=ctx["headers"],
    )
    body = response.json()
    assert body[0]["sport"] == "Tennis"
    assert body[0]["bookings"] == 3
    assert body[0]["percentage"] == 100.0


async def test_cancelled_bookings_are_excluded_from_reports(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A cancelled booking is not demand and must not inflate utilisation."""
    ctx = await setup_academy(client, tenant_a)
    keep = await book(client, ctx, court=ctx["court_1"], starts_at=at(6, 10))
    drop = await book(client, ctx, court=ctx["court_1"], starts_at=at(6, 12))
    await client.post(
        f"/api/v1/bookings/{drop.json()['id']}/cancel", json={}, headers=ctx["headers"]
    )

    response = await client.get(
        "/api/v1/reports/sport-popularity",
        params={"date_from": at(1, 0), "date_to": at(28, 23)},
        headers=ctx["headers"],
    )
    assert response.json()[0]["bookings"] == 1
    assert keep.status_code == 201


async def test_revenue_is_grouped_by_month_from_payments(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)
    created = await book(client, ctx, court=ctx["court_1"], starts_at=at(7, 10))
    invoice = await client.post(
        f"/api/v1/bookings/{created.json()['id']}/invoice", headers=ctx["headers"]
    )
    await client.post(
        "/api/v1/payments",
        json={"invoice_id": invoice.json()["id"], "amount": "500", "method": "upi"},
        headers=ctx["headers"],
    )

    response = await client.get("/api/v1/reports/revenue", headers=ctx["headers"])
    assert response.status_code == 200, response.text
    assert len(response.json()) == 1
    assert Decimal(response.json()[0]["revenue"]) == Decimal("500.00")


async def test_court_utilisation_uses_operating_hours_not_a_flat_day(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A pool open 05:30–21:00 must not look underused against a 24h denominator."""
    ctx = await setup_academy(client, tenant_a)
    # One 60-minute booking in a single-day window: 60 / (16h × 60) = 6.3%.
    await book(client, ctx, court=ctx["court_1"], starts_at=at(8, 10), minutes=60)

    response = await client.get(
        "/api/v1/reports/court-utilization",
        params={"date_from": at(8, 0), "date_to": at(9, 0)},
        headers=ctx["headers"],
    )
    court_1 = next(row for row in response.json() if row["court"] == "Court 1")
    assert court_1["available_minutes"] == 16 * 60  # 06:00–22:00, not 24h
    assert court_1["booked_minutes"] == 60
    assert court_1["utilization"] == 6.3


async def test_kpis(client: AsyncClient, tenant_a: TenantFixture) -> None:
    ctx = await setup_academy(client, tenant_a)
    created = await book(client, ctx, court=ctx["court_1"], starts_at=at(9, 10))
    invoice = await client.post(
        f"/api/v1/bookings/{created.json()['id']}/invoice", headers=ctx["headers"]
    )
    await client.post(
        "/api/v1/payments",
        json={"invoice_id": invoice.json()["id"], "amount": "444", "method": "cash"},
        headers=ctx["headers"],
    )

    response = await client.get(
        "/api/v1/reports/kpis",
        params={"date_from": "2026-01-01T00:00:00+05:30", "date_to": "2027-01-01T00:00:00+05:30"},
        headers=ctx["headers"],
    )
    body = response.json()
    assert body["total_bookings"] == 1
    assert Decimal(body["total_revenue"]) == Decimal("444.00")
    assert Decimal(body["outstanding_dues"]) == Decimal("500.00")  # 944 - 444


async def test_reports_do_not_aggregate_across_academies(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """The aggregate must be per-tenant, or one academy sees the platform's totals."""
    ctx_a = await setup_academy(client, tenant_a)
    ctx_b = await setup_academy(client, tenant_b)

    for day in (10, 11, 12):
        await book(client, ctx_a, court=ctx_a["court_1"], starts_at=at(day, 10))
    await book(client, ctx_b, court=ctx_b["court_1"], starts_at=at(10, 10))

    params = {"date_from": at(1, 0), "date_to": at(28, 23)}
    a = await client.get("/api/v1/reports/kpis", params=params, headers=ctx_a["headers"])
    b = await client.get("/api/v1/reports/kpis", params=params, headers=ctx_b["headers"])

    assert a.json()["total_bookings"] == 3
    assert b.json()["total_bookings"] == 1


# ── Settings ────────────────────────────────────────────────────────────────


async def test_settings_are_the_white_label_surface(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)

    current = await client.get("/api/v1/settings", headers=ctx["headers"])
    assert current.json()["brand_primary"] == "#002E25"
    assert current.json()["currency"] == "INR"
    assert current.json()["timezone"] == "Asia/Kolkata"

    updated = await client.patch(
        "/api/v1/settings",
        json={
            "business_name": "Alpha Sports Club",
            "brand_primary": "#123456",
            "gst_number": "27AABCX1234Z1ZV",
            "invoice_prefix": "ALPHA",
            "tax_config": {"gst_rate": 12, "cgst": 6, "sgst": 6},
        },
        headers=ctx["headers"],
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["brand_primary"] == "#123456"
    assert updated.json()["tax_config"]["gst_rate"] == 12


async def test_changing_the_gst_rate_changes_pricing(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """Settings are not decoration — the tax config drives the booking quote."""
    ctx = await setup_academy(client, tenant_a)

    before = await client.post(
        "/api/v1/bookings/quote",
        json={"court_id": ctx["court_1"], "starts_at": at(16, 10), "duration_min": 60},
        headers=ctx["headers"],
    )
    assert Decimal(before.json()["taxes"]) == Decimal("144.00")  # 18% of 800

    await client.patch(
        "/api/v1/settings",
        json={"tax_config": {"gst_rate": 5, "cgst": 2.5, "sgst": 2.5}},
        headers=ctx["headers"],
    )

    after = await client.post(
        "/api/v1/bookings/quote",
        json={"court_id": ctx["court_1"], "starts_at": at(16, 10), "duration_min": 60},
        headers=ctx["headers"],
    )
    assert Decimal(after.json()["taxes"]) == Decimal("40.00")  # 5% of 800


async def test_settings_of_one_academy_do_not_affect_another(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    ctx_a = await setup_academy(client, tenant_a)
    ctx_b = await setup_academy(client, tenant_b)

    await client.patch(
        "/api/v1/settings", json={"brand_primary": "#AAAAAA"}, headers=ctx_a["headers"]
    )
    b_settings = await client.get("/api/v1/settings", headers=ctx_b["headers"])
    assert b_settings.json()["brand_primary"] == "#002E25"


async def test_only_admins_change_settings(client: AsyncClient, tenant_a: TenantFixture) -> None:
    from app.core.security import Role

    ctx = await setup_academy(client, tenant_a)
    await make_user(tenant_a, email="desk2@alpha.example.com", role=Role.RECEPTION)
    token = await login(client, tenant_a, "desk2@alpha.example.com", PASSWORD)
    desk = auth_headers(token, tenant_a)

    assert (await client.get("/api/v1/settings", headers=desk)).status_code == 200
    refused = await client.patch(
        "/api/v1/settings", json={"business_name": "Hijacked"}, headers=desk
    )
    assert refused.status_code == 403


# ── Staff ───────────────────────────────────────────────────────────────────


async def test_staff_crud_and_duplicate_email(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)

    created = await client.post(
        "/api/v1/staff",
        json={
            "email": "sunita@alpha.example.com",
            "password": PASSWORD,
            "full_name": "Sunita Rao",
            "role": "reception",
            "shift": "Evening (2PM–10PM)",
        },
        headers=ctx["headers"],
    )
    assert created.status_code == 201, created.text
    assert created.json()["avatar_initials"] == "SR"

    duplicate = await client.post(
        "/api/v1/staff",
        json={
            "email": "SUNITA@alpha.example.com",
            "password": PASSWORD,
            "full_name": "Impostor",
        },
        headers=ctx["headers"],
    )
    assert duplicate.status_code == 409

    # The new staff member can log in immediately — one table, one identity.
    assert (
        await client.post(
            "/api/v1/auth/login",
            json={"username": "sunita@alpha.example.com", "password": PASSWORD},
            headers=tenant_a.headers,
        )
    ).status_code == 200


async def test_an_admin_cannot_lock_themselves_out(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The classic way an academy loses access to its own account."""
    ctx = await setup_academy(client, tenant_a)
    me = await client.get("/api/v1/auth/me", headers=ctx["headers"])
    my_id = me.json()["user"]["id"]

    demote = await client.patch(
        f"/api/v1/staff/{my_id}", json={"role": "reception"}, headers=ctx["headers"]
    )
    assert demote.status_code == 409

    deactivate = await client.patch(
        f"/api/v1/staff/{my_id}", json={"status": "inactive"}, headers=ctx["headers"]
    )
    assert deactivate.status_code == 409


# ── Notifications ───────────────────────────────────────────────────────────


async def test_notifications_and_unread_count(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    ctx = await setup_academy(client, tenant_a)

    for title in ("New Online Booking", "Payment Received"):
        await client.post(
            "/api/v1/notifications",
            json={"kind": "booking", "title": title, "body": "…"},
            headers=ctx["headers"],
        )

    assert (await client.get("/api/v1/notifications/unread-count", headers=ctx["headers"])).json()[
        "unread"
    ] == 2

    listed = await client.get("/api/v1/notifications", headers=ctx["headers"])
    first_id = listed.json()["items"][0]["id"]
    await client.post(f"/api/v1/notifications/{first_id}/read", headers=ctx["headers"])
    assert (await client.get("/api/v1/notifications/unread-count", headers=ctx["headers"])).json()[
        "unread"
    ] == 1

    await client.post("/api/v1/notifications/read-all", headers=ctx["headers"])
    assert (await client.get("/api/v1/notifications/unread-count", headers=ctx["headers"])).json()[
        "unread"
    ] == 0


async def test_channel_config_is_seeded_and_toggleable(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """The Settings → Notifications matrix, per tenant."""
    ctx = await setup_academy(client, tenant_a)

    config = await client.get("/api/v1/notification-channels", headers=ctx["headers"])
    assert config.status_code == 200, config.text
    keys = [row["event_key"] for row in config.json()]
    assert "booking_confirmation" in keys
    assert "membership_expiring" in keys
    # WhatsApp and SMS default off — they cost real money per message.
    assert all(row["whatsapp_enabled"] is False for row in config.json())

    updated = await client.patch(
        "/api/v1/notification-channels/booking_reminder",
        json={"whatsapp_enabled": True, "lead_time_minutes": 60},
        headers=ctx["headers"],
    )
    assert updated.json()["whatsapp_enabled"] is True
    assert updated.json()["lead_time_minutes"] == 60

    # Reading again does not duplicate rows.
    again = await client.get("/api/v1/notification-channels", headers=ctx["headers"])
    assert len(again.json()) == len(config.json())


async def test_notification_usage_is_metered_per_tenant(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """WhatsApp/SMS spend has to be attributable — this is what a plan bills on."""
    from decimal import Decimal as D

    from app.db.session import tenant_session
    from app.modules.admin.models import Channel, DeliveryState, NotificationDelivery

    ctx_a = await setup_academy(client, tenant_a)
    ctx_b = await setup_academy(client, tenant_b)

    async with tenant_session(tenant_a.id) as session:
        for _ in range(3):
            session.add(
                NotificationDelivery(
                    event_key="booking_reminder",
                    channel=Channel.WHATSAPP,
                    recipient="9876543210",
                    state=DeliveryState.DELIVERED,
                    cost=D("0.7500"),
                )
            )
    async with tenant_session(tenant_b.id) as session:
        session.add(
            NotificationDelivery(
                event_key="booking_reminder",
                channel=Channel.SMS,
                recipient="9000000000",
                state=DeliveryState.SENT,
                cost=D("0.1200"),
            )
        )

    usage_a = await client.get("/api/v1/notification-usage", headers=ctx_a["headers"])
    assert len(usage_a.json()) == 1
    assert usage_a.json()[0]["channel"] == "whatsapp"
    assert usage_a.json()[0]["messages"] == 3
    assert Decimal(usage_a.json()[0]["cost"]) == Decimal("2.2500")

    usage_b = await client.get("/api/v1/notification-usage", headers=ctx_b["headers"])
    assert usage_b.json()[0]["channel"] == "sms"
    assert usage_b.json()[0]["messages"] == 1


# ── Jobs and the worker ─────────────────────────────────────────────────────


async def test_jobs_can_be_queued_and_claimed_once(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """`FOR UPDATE SKIP LOCKED` means a job is claimed by exactly one worker."""
    from app.db.session import tenant_session
    from app.jobs.worker import claim_batch

    ctx = await setup_academy(client, tenant_a)

    created = await client.post(
        "/api/v1/jobs",
        json={"kind": "membership.expire_lapsed", "payload": {}},
        headers=ctx["headers"],
    )
    assert created.status_code == 201, created.text
    assert created.json()["state"] == "pending"

    async with tenant_session(tenant_a.id) as session:
        claimed = await claim_batch(session)
    assert len(claimed) == 1

    # Already RUNNING, so a second pass finds nothing.
    async with tenant_session(tenant_a.id) as session:
        assert await claim_batch(session) == []


async def test_worker_expires_lapsed_memberships(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    from app.db.session import tenant_session
    from app.jobs.worker import expire_memberships

    ctx = await setup_academy(client, tenant_a)
    plan = await client.post(
        "/api/v1/membership-plans",
        json={"name": "Lapsing Plan", "price_1m": "1000"},
        headers=ctx["headers"],
    )
    customer = await client.post(
        "/api/v1/customers",
        json={"name": "Lapsed Member", "phone": "9333333333"},
        headers=ctx["headers"],
    )
    created = await client.post(
        "/api/v1/memberships",
        json={
            "customer_id": customer.json()["id"],
            "plan_id": plan.json()["id"],
            "duration": "1m",
            "start_date": (date.today() - timedelta(days=60)).isoformat(),
        },
        headers=ctx["headers"],
    )
    subscription_id = created.json()["subscription"]["id"]
    assert created.json()["subscription"]["status"] == "active"
    assert created.json()["subscription"]["days_left"] < 0

    async with tenant_session(tenant_a.id) as session:
        assert await expire_memberships(session) == 1

    after = await client.get(
        f"/api/v1/memberships/{subscription_id}", headers=ctx["headers"]
    )
    assert after.json()["status"] == "expired"


async def test_worker_advances_booking_states(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """upcoming → overdue once the slot has passed unpaid."""
    from app.db.session import tenant_session
    from app.jobs.worker import advance_booking_states

    ctx = await setup_academy(client, tenant_a)
    past = (datetime.now(IST) - timedelta(days=1)).replace(microsecond=0)
    created = await client.post(
        "/api/v1/bookings",
        json={
            "court_id": ctx["court_1"],
            "starts_at": past.isoformat(),
            "duration_min": 60,
            "customer_name": "Yesterday Walk-in",
        },
        headers=ctx["headers"],
    )
    booking_id = created.json()["id"]
    assert created.json()["status"] == "upcoming"

    async with tenant_session(tenant_a.id) as session:
        assert await advance_booking_states(session) == 1

    after = await client.get(f"/api/v1/bookings/{booking_id}", headers=ctx["headers"])
    assert after.json()["status"] == "overdue"


async def test_worker_raises_renewal_notifications(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    from app.db.session import tenant_session
    from app.jobs.worker import notify_expiring_memberships

    ctx = await setup_academy(client, tenant_a)
    plan = await client.post(
        "/api/v1/membership-plans",
        json={"name": "Expiring Plan", "price_1m": "1000"},
        headers=ctx["headers"],
    )
    customer = await client.post(
        "/api/v1/customers",
        json={"name": "Soon To Expire", "phone": "9444444444"},
        headers=ctx["headers"],
    )
    await client.post(
        "/api/v1/memberships",
        json={
            "customer_id": customer.json()["id"],
            "plan_id": plan.json()["id"],
            "duration": "1m",
            "start_date": (date.today() - timedelta(days=27)).isoformat(),
        },
        headers=ctx["headers"],
    )

    async with tenant_session(tenant_a.id) as session:
        assert await notify_expiring_memberships(session, within_days=7) == 1

    notifications = await client.get(
        "/api/v1/notifications", params={"unread_only": True}, headers=ctx["headers"]
    )
    assert notifications.json()["total"] == 1
    assert notifications.json()["items"][0]["kind"] == "membership"


async def test_worker_sweep_is_scoped_per_tenant(
    client: AsyncClient, tenant_a: TenantFixture, tenant_b: TenantFixture
) -> None:
    """Each academy is swept in its own transaction, under its own tenant binding."""
    from app.jobs.worker import sweep_tenant

    ctx_a = await setup_academy(client, tenant_a)
    await setup_academy(client, tenant_b)

    past = (datetime.now(IST) - timedelta(days=1)).replace(microsecond=0)
    await client.post(
        "/api/v1/bookings",
        json={
            "court_id": ctx_a["court_1"],
            "starts_at": past.isoformat(),
            "duration_min": 60,
            "customer_name": "Yesterday",
        },
        headers=ctx_a["headers"],
    )

    stats_a = await sweep_tenant(tenant_a.id)
    stats_b = await sweep_tenant(tenant_b.id)

    assert stats_a["bookings_advanced"] == 1
    assert stats_b["bookings_advanced"] == 0
