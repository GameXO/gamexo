"""Self-serve signup: the wizard, the payment, and the academy that appears after it.

The tests worth having here are about the *seam* — the point where an anonymous
form on a marketing site turns into a tenant, an admin and a password. Two things
would be expensive to get wrong and both are covered below at length:

  * **One payment must produce exactly one academy.** A webhook and a browser
    callback race by design, and either can be lost. Half this file is about
    proving that whichever combination arrives, and in whatever order, the result
    is one tenant.

  * **A payment must survive a failed provisioning.** The money is real before the
    academy exists, and a rollback that discards the payment record along with the
    half-built tenant would leave a charged customer the database has never heard of.

Runs in mock billing mode, because no Razorpay keys are set in the test
environment — see modules/billing/razorpay.py. The mock is not a bypass: it signs
its payments with the same HMAC construction and they go through the same
verification, so the code exercised here is the code that ships.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text

from app.db.session import tenant_session, untenanted_session
from app.modules.billing import razorpay, service
from app.modules.billing.models import SignupIntent, SignupStatus
from app.models.tenant import Tenant
from tests.conftest import TenantFixture

# No Host header that resolves to anything: the marketing site is a shared origin,
# and the signup endpoints resolve no tenant at all because there is not one yet.
NO_TENANT: dict[str, str] = {"host": "app.gamexo.app"}

WIZARD = {
    "business_name": "Navigo Sports Arena",
    "city": "Hyderabad",
    "accepted_terms": True,
    "sports": [{"slug": "badminton"}, {"slug": "turf-football"}],
    "services": {"checkin": True, "academy": True, "shop": False},
}


# ── Helpers ─────────────────────────────────────────────────────────────────


async def start(client: AsyncClient, email: str, name: str = "Turf Owner") -> str:
    """Create an intent and return its token."""
    response = await client.post(
        "/api/v1/signup/intent",
        json={"email": email, "full_name": name},
        headers=NO_TENANT,
    )
    assert response.status_code == 201, response.text
    return response.json()["token"]


async def fill(client: AsyncClient, token: str, **overrides) -> dict:
    response = await client.patch(
        f"/api/v1/signup/intent/{token}", json={**WIZARD, **overrides}, headers=NO_TENANT
    )
    assert response.status_code == 200, response.text
    return response.json()


async def order(client: AsyncClient, token: str, plan: str = "growth", period: str = "monthly"):
    return await client.post(
        f"/api/v1/signup/intent/{token}/order",
        json={"plan_code": plan, "billing_period": period},
        headers=NO_TENANT,
    )


async def ready(client: AsyncClient, email: str) -> tuple[str, str]:
    """A signup filled in and priced, one step short of being paid.

    Returns (intent token, razorpay order id).
    """
    token = await start(client, email)
    await fill(client, token)
    response = await order(client, token)
    assert response.status_code == 200, response.text
    return token, response.json()["order_id"]


async def pay(client: AsyncClient, token: str):
    return await client.post(f"/api/v1/signup/intent/{token}/mock-pay", headers=NO_TENANT)


async def send_webhook(client: AsyncClient, order_id: str, payment_id: str, amount: int = 499900):
    """Post a webhook the way Razorpay does — signed over the exact bytes sent."""
    body, signature = razorpay.mock_webhook(
        order_id=order_id, payment_id=payment_id, amount_paise=amount
    )
    return await client.post(
        "/api/v1/billing/webhook/razorpay",
        content=body,
        headers={**NO_TENANT, "Content-Type": "application/json", "X-Razorpay-Signature": signature},
    )


def bearer(tokens: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}", **NO_TENANT}


async def count_tenants() -> int:
    async with untenanted_session() as session:
        return (await session.execute(text("SELECT count(*) FROM tenant"))).scalar_one()


async def intent_row(token: str) -> SignupIntent:
    async with untenanted_session() as session:
        return (
            await session.execute(select(SignupIntent).where(SignupIntent.token == token))
        ).scalar_one()


# ── The price list ──────────────────────────────────────────────────────────


async def test_plans_are_served_to_anyone(client: AsyncClient) -> None:
    """Unauthenticated on purpose — it is a pricing page."""
    response = await client.get("/api/v1/signup/plans", headers=NO_TENANT)
    assert response.status_code == 200, response.text

    plans = response.json()
    assert {p["code"] for p in plans} == {"starter", "growth", "pro"}
    # Yearly must never cost more than twelve months, or the toggle is a penalty.
    assert all(p["price_yearly_paise"] <= p["price_monthly_paise"] * 12 for p in plans)
    assert sum(1 for p in plans if p["popular"]) == 1


async def test_the_sport_catalogue_is_public(client: AsyncClient) -> None:
    """The wizard's second step renders this, and it has no login to render behind."""
    response = await client.get("/api/v1/signup/sports", headers=NO_TENANT)
    assert response.status_code == 200, response.text

    slugs = {entry["slug"] for entry in response.json()}
    assert {"badminton", "turf-football", "box-cricket"} <= slugs
    # Prices are deliberately absent — see the endpoint's description.
    assert "price_base" not in response.json()[0]


# ── The wizard ──────────────────────────────────────────────────────────────


async def test_starting_a_signup_creates_no_academy(client: AsyncClient) -> None:
    """The entire premise. Nothing exists until somebody pays."""
    before = await count_tenants()
    await start(client, "nothing@example.com")
    assert await count_tenants() == before


async def test_an_email_that_already_signs_in_is_refused(client: AsyncClient) -> None:
    """Caught on the first screen rather than after a payment."""
    token = await start(client, "taken@example.com")
    await fill(client, token)
    await order(client, token)
    assert (await pay(client, token)).status_code == 200

    again = await client.post(
        "/api/v1/signup/intent",
        json={"email": "taken@example.com", "full_name": "Someone Else"},
        headers=NO_TENANT,
    )
    assert again.status_code == 409, again.text
    assert "already registered" in again.json()["error"]["message"]


async def test_a_step_does_not_blank_what_an_earlier_one_saved(client: AsyncClient) -> None:
    """Omitted means unchanged. Step 2 posting sports must not clear the name."""
    token = await start(client, "partial@example.com")
    await client.patch(
        f"/api/v1/signup/intent/{token}",
        json={"business_name": "Kondapur Turf", "accepted_terms": True},
        headers=NO_TENANT,
    )

    after = await client.patch(
        f"/api/v1/signup/intent/{token}",
        json={"sports": [{"slug": "badminton"}]},
        headers=NO_TENANT,
    )
    assert after.status_code == 200, after.text
    assert after.json()["business_name"] == "Kondapur Turf"
    assert after.json()["accepted_terms"] is True


async def test_an_unknown_token_is_not_found(client: AsyncClient) -> None:
    response = await client.get("/api/v1/signup/intent/not-a-real-token", headers=NO_TENANT)
    assert response.status_code == 404, response.text


async def test_an_expired_signup_reads_like_an_unknown_one(client: AsyncClient) -> None:
    """Same answer for both, so this cannot be used to test which tokens exist."""
    token = await start(client, "stale@example.com")

    async with untenanted_session() as session:
        row = (
            await session.execute(select(SignupIntent).where(SignupIntent.token == token))
        ).scalar_one()
        row.created_at = datetime.now(UTC) - timedelta(days=30)

    response = await client.get(f"/api/v1/signup/intent/{token}", headers=NO_TENANT)
    assert response.status_code == 404, response.text


# ── Checkout ────────────────────────────────────────────────────────────────


async def test_an_order_is_priced_from_the_catalogue_not_the_client(
    client: AsyncClient,
) -> None:
    """The client names a plan. It never names an amount."""
    token = await start(client, "priced@example.com")
    await fill(client, token)

    monthly = await order(client, token, "growth", "monthly")
    assert monthly.json()["amount_paise"] == 499900

    yearly = await order(client, token, "growth", "yearly")
    assert yearly.json()["amount_paise"] == 4999000


async def test_checkout_without_accepting_the_terms_is_refused(client: AsyncClient) -> None:
    token = await start(client, "noterms@example.com")
    await fill(client, token, accepted_terms=False)

    response = await order(client, token)
    assert response.status_code == 400, response.text
    assert response.json()["error"]["details"]["field"] == "accepted_terms"


async def test_checkout_without_a_business_name_is_refused(client: AsyncClient) -> None:
    token = await start(client, "noname@example.com")
    await client.patch(
        f"/api/v1/signup/intent/{token}", json={"accepted_terms": True}, headers=NO_TENANT
    )

    response = await order(client, token)
    assert response.status_code == 400, response.text
    assert response.json()["error"]["details"]["field"] == "business_name"


async def test_an_unknown_plan_is_refused(client: AsyncClient) -> None:
    token = await start(client, "noplan@example.com")
    await fill(client, token)

    response = await order(client, token, "enterprise-unlimited")
    assert response.status_code == 400, response.text


async def test_a_dismissed_checkout_can_be_retried(client: AsyncClient) -> None:
    """An unpaid order is abandoned, not a dead end — re-ordering replaces it."""
    token = await start(client, "retrycheckout@example.com")
    await fill(client, token)

    first = (await order(client, token, "starter")).json()["order_id"]
    second = (await order(client, token, "pro")).json()["order_id"]

    assert first != second
    assert (await intent_row(token)).order_id == second


# ── Payment, and the academy it creates ─────────────────────────────────────


async def test_paying_provisions_the_whole_academy(client: AsyncClient) -> None:
    """The payload of the entire feature, asserted in one place."""
    token = await start(client, "owner@navigo.example.com")
    await fill(client, token)
    await order(client, token)

    paid = await pay(client, token)
    assert paid.status_code == 200, paid.text
    body = paid.json()

    assert body["signup"]["status"] == "completed"
    assert body["signup"]["tenant_slug"] == "navigo-sports-arena"
    assert body["handoff_token"]

    tokens = await client.post(
        "/api/v1/auth/handoff", json={"token": body["handoff_token"]}, headers=NO_TENANT
    )
    assert tokens.status_code == 200, tokens.text

    me = (await client.get("/api/v1/auth/me", headers=bearer(tokens.json()))).json()
    assert me["user"]["email"] == "owner@navigo.example.com"
    assert me["user"]["role"] == "admin"
    assert me["tenant"]["onboarding_completed"] is True
    assert me["tenant"]["plan_tier"] == "growth"

    sports = (await client.get("/api/v1/sports", headers=bearer(tokens.json()))).json()
    assert {s["name"] for s in sports} == {"Badminton", "Turf Football"}
    # Priced from the catalogue, so the turf can take a booking immediately.
    assert all(float(s["price_base"]) > 0 for s in sports)

    settings = (await client.get("/api/v1/settings", headers=bearer(tokens.json()))).json()
    assert settings["business_name"] == "Navigo Sports Arena"
    assert settings["city"] == "Hyderabad"
    assert settings["enabled_services"]["academy"] is True
    assert settings["enabled_services"]["shop"] is False
    # Merged, not replaced: a key the wizard never sent keeps its default.
    assert settings["enabled_services"]["booking"] is True

    # No courts — the empty state is what drives the dashboard's first CTA.
    assert (await client.get("/api/v1/courts", headers=bearer(tokens.json()))).json() == []


async def test_the_owner_can_sign_in_normally_afterwards(client: AsyncClient) -> None:
    """The handoff is a convenience. The emailed password is the real credential.

    Read out of the database because it is deliberately never returned by the API —
    it exists in one email and one bcrypt hash and nowhere else.
    """
    token = await start(client, "normal@example.com")
    await fill(client, token)
    await order(client, token)

    # Intercept the generated password at its single source.
    generated: list[str] = []
    real = service.generate_password

    def capture() -> str:
        value = real()
        generated.append(value)
        return value

    service.generate_password = capture  # type: ignore[assignment]
    try:
        assert (await pay(client, token)).status_code == 200
    finally:
        service.generate_password = real  # type: ignore[assignment]

    # Two: the owner's, then the counter tablet's. Order matters below.
    assert len(generated) == 2

    slug = (await intent_row(token)).tenant_id is not None and (
        await client.get(f"/api/v1/signup/intent/{token}", headers=NO_TENANT)
    ).json()["tenant_slug"]

    # The owner signs in with a username, not the address they typed into the wizard.
    signed_in = await client.post(
        "/api/v1/auth/login",
        json={"username": f"admin@{slug}", "password": generated[0]},
        headers=NO_TENANT,
    )
    assert signed_in.status_code == 200, signed_in.text

    # The email they signed up with still works, because accounts that predate
    # usernames rely on that fallback and it must not silently rot.
    by_email = await client.post(
        "/api/v1/auth/login",
        json={"username": "normal@example.com", "password": generated[0]},
        headers=NO_TENANT,
    )
    assert by_email.status_code == 200, by_email.text

    # And the counter tablet has its own credential, provisioned with the academy.
    kiosk = await client.post(
        "/api/v1/auth/login",
        json={"username": f"kiosk@{slug}", "password": generated[1]},
        headers=NO_TENANT,
    )
    assert kiosk.status_code == 200, kiosk.text

    # Different passwords, deliberately: the dashboard credential must never be the
    # one left signed in on a tablet at a public counter.
    assert generated[0] != generated[1]


async def test_the_emailed_password_works_from_a_shared_origin(
    client: AsyncClient, tenant_a: TenantFixture
) -> None:
    """A regression test for a real, and very confusing, failure.

    The dashboard used to attach `X-Tenant-ID` from a slug baked into its bundle on
    any request without a token — which is every login. That header outranks the
    directory lookup, so a self-serve owner's correct password was checked against
    a completely different academy, where their account does not exist, and came
    back "Incorrect email or password". The credential looked wrong; only the tenant
    resolution was.

    `tenant_a` exists purely to be the wrong academy: without a second tenant in the
    database there is nothing for the lookup to be misdirected *to*, and the bug
    cannot be expressed.
    """
    token = await start(client, "shared@origin.example.com")
    await fill(client, token)
    await order(client, token)

    generated: list[str] = []
    real = service.generate_password

    def capture() -> str:
        value = real()
        generated.append(value)
        return value

    service.generate_password = capture  # type: ignore[assignment]
    try:
        assert (await pay(client, token)).status_code == 200
    finally:
        service.generate_password = real  # type: ignore[assignment]

    # No host that resolves, and no tenant header: exactly what the frontends now
    # send. The academy has to be found from the email alone.
    signed_in = await client.post(
        "/api/v1/auth/login",
        json={"username": "shared@origin.example.com", "password": generated[0]},
        headers=NO_TENANT,
    )
    assert signed_in.status_code == 200, signed_in.text

    # And the shape of the original bug, asserted so nobody reintroduces the header
    # believing it is harmless: naming another academy really does reject a correct
    # password, with a message that says nothing about tenants.
    misdirected = await client.post(
        "/api/v1/auth/login",
        json={"username": "shared@origin.example.com", "password": generated[0]},
        headers={**NO_TENANT, "X-Tenant-ID": tenant_a.slug},
    )
    assert misdirected.status_code == 401, misdirected.text


async def test_a_failed_welcome_email_is_reported_not_hidden(client: AsyncClient) -> None:
    """Mail is disabled across this suite, so every signup here takes the sad path.

    The academy is still provisioned — that is deliberate — but the response must
    say the email did not go out. An owner told "check your inbox" when nothing was
    sent closes the tab and loses the only session they had.
    """
    token = await start(client, "mailfailed@example.com")
    await fill(client, token)
    await order(client, token)

    paid = await pay(client, token)
    assert paid.status_code == 200, paid.text
    assert paid.json()["signup"]["status"] == "completed"
    assert paid.json()["signup"]["credentials_emailed"] is False
    # And the handoff is still offered, because it is now the only way in.
    assert paid.json()["handoff_token"]


async def test_the_password_is_never_stored_on_the_signup(client: AsyncClient) -> None:
    """The intent is addressable by a token in a URL. It must hold no credential.

    Asserted against the *actual* generated password rather than by grepping for the
    word "password", which an email address like `nopassword@example.com` satisfies
    all on its own.
    """
    token = await start(client, "vault@example.com")
    await fill(client, token)
    await order(client, token)

    generated: list[str] = []
    real = service.generate_password

    def capture() -> str:
        value = real()
        generated.append(value)
        return value

    service.generate_password = capture  # type: ignore[assignment]
    try:
        await pay(client, token)
    finally:
        service.generate_password = real  # type: ignore[assignment]

    assert generated, "provisioning should have generated exactly one password"

    async with untenanted_session() as session:
        row = (
            await session.execute(
                text("SELECT * FROM signup_intent WHERE token = :t"), {"t": token}
            )
        ).mappings().one()

    every_column = " ".join(str(value) for value in row.values())
    assert generated[0] not in every_column
    # Nor any fragment of it — a partial leak is still a leak.
    assert generated[0].split("-")[0] not in every_column


async def test_a_custom_sport_is_created_at_zero(client: AsyncClient) -> None:
    """Something the catalogue does not stock. A made-up price would be charged."""
    token = await start(client, "custom@example.com")
    await fill(client, token, sports=[{"slug": "sepak-takraw", "name": "Sepak Takraw"}])
    await order(client, token)
    handoff = (await pay(client, token)).json()["handoff_token"]

    tokens = (
        await client.post("/api/v1/auth/handoff", json={"token": handoff}, headers=NO_TENANT)
    ).json()
    sports = (await client.get("/api/v1/sports", headers=bearer(tokens))).json()

    assert sports[0]["name"] == "Sepak Takraw"
    assert float(sports[0]["price_base"]) == 0


async def test_a_paid_signup_can_no_longer_be_edited(client: AsyncClient) -> None:
    """The answers are what was provisioned. Editing them would describe a fiction."""
    token = await start(client, "frozen@example.com")
    await fill(client, token)
    await order(client, token)
    await pay(client, token)

    response = await client.patch(
        f"/api/v1/signup/intent/{token}",
        json={"business_name": "Renamed After Paying"},
        headers=NO_TENANT,
    )
    assert response.status_code == 409, response.text


async def test_provisioning_survives_email_being_broken(client: AsyncClient) -> None:
    """Mail is disabled throughout this suite, which is the point of this test.

    A bounced address, an unverified sender or no mail configured at all must not
    roll back an academy somebody has paid for. The failure is recorded instead —
    and the handoff still gets them in.
    """
    token = await start(client, "nomail@example.com")
    await fill(client, token)
    await order(client, token)

    paid = await pay(client, token)
    assert paid.status_code == 200, paid.text
    assert paid.json()["signup"]["status"] == "completed"
    assert paid.json()["handoff_token"]

    row = await intent_row(token)
    assert row.credentials_emailed_at is None
    assert row.last_error is not None and "email" in row.last_error.lower()


# ── One payment, one academy ────────────────────────────────────────────────


async def test_paying_twice_makes_one_academy(client: AsyncClient) -> None:
    token = await start(client, "double@example.com")
    await fill(client, token)
    await order(client, token)

    before = await count_tenants()
    assert (await pay(client, token)).status_code == 200
    assert (await pay(client, token)).status_code == 200

    assert await count_tenants() == before + 1


async def test_the_webhook_alone_provisions(client: AsyncClient) -> None:
    """The half that does not need the payer's browser.

    Somebody who pays and closes the tab immediately still gets their academy and
    their credentials — this is the path that delivers them.
    """
    token, order_id = await ready(client, "webhookonly@example.com")

    response = await send_webhook(client, order_id, "pay_webhook_only")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "ok"

    read = (await client.get(f"/api/v1/signup/intent/{token}", headers=NO_TENANT)).json()
    assert read["status"] == "completed"
    assert read["tenant_slug"]
    assert (await intent_row(token)).confirmed_via == "webhook"


async def test_a_duplicate_webhook_makes_one_academy(client: AsyncClient) -> None:
    """Razorpay retries a webhook it is not sure landed. It lands more than once."""
    _, order_id = await ready(client, "hookdupe@example.com")

    before = await count_tenants()
    assert (await send_webhook(client, order_id, "pay_dupe")).status_code == 200
    assert (await send_webhook(client, order_id, "pay_dupe")).status_code == 200

    assert await count_tenants() == before + 1


async def test_a_webhook_and_a_callback_together_make_one_academy(
    client: AsyncClient,
) -> None:
    """The race the FOR UPDATE lock exists for.

    Both confirmations fire concurrently, as they genuinely do — the browser returns
    from Checkout at roughly the moment Razorpay posts the webhook. Exactly one of
    them must provision.
    """
    token, order_id = await ready(client, "race@example.com")

    before = await count_tenants()
    results = await asyncio.gather(
        send_webhook(client, order_id, "pay_race"),
        pay(client, token),
        return_exceptions=True,
    )
    assert not any(isinstance(r, Exception) for r in results), results

    assert await count_tenants() == before + 1
    assert (await intent_row(token)).status is SignupStatus.COMPLETED


async def test_a_forged_webhook_provisions_nothing(client: AsyncClient) -> None:
    """Answered 200 so Razorpay stops retrying, and acted on not at all."""
    token, order_id = await ready(client, "forged@example.com")

    before = await count_tenants()
    response = await client.post(
        "/api/v1/billing/webhook/razorpay",
        json={
            "event": "payment.captured",
            "payload": {"payment": {"entity": {"id": "pay_forged", "order_id": order_id}}},
        },
        headers={**NO_TENANT, "X-Razorpay-Signature": "not-a-real-signature"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "rejected"
    assert await count_tenants() == before
    assert (await intent_row(token)).status is SignupStatus.AWAITING_PAYMENT


async def test_a_webhook_for_an_unrelated_order_is_ignored(client: AsyncClient) -> None:
    """Our own test payments, and any other product on the same Razorpay account."""
    response = await send_webhook(client, "order_not_ours", "pay_elsewhere")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "unknown_order"


async def test_a_payment_for_another_signups_order_is_refused(client: AsyncClient) -> None:
    """The order has to belong to the signup being confirmed."""
    mine = await start(client, "mine@example.com")
    await fill(client, mine)
    await order(client, mine)

    theirs, their_order = await ready(client, "theirs@example.com")
    payment_id, signature = razorpay.mock_payment(their_order)

    response = await client.post(
        f"/api/v1/signup/intent/{mine}/verify",
        json={
            "razorpay_order_id": their_order,
            "razorpay_payment_id": payment_id,
            "razorpay_signature": signature,
        },
        headers=NO_TENANT,
    )
    assert response.status_code == 400, response.text
    assert response.json()["error"]["details"]["field"] == "razorpay_order_id"
    assert (await intent_row(theirs)).status is SignupStatus.AWAITING_PAYMENT


async def test_a_mis_signed_callback_is_refused(client: AsyncClient) -> None:
    token, order_id = await ready(client, "badsig@example.com")

    before = await count_tenants()
    response = await client.post(
        f"/api/v1/signup/intent/{token}/verify",
        json={
            "razorpay_order_id": order_id,
            "razorpay_payment_id": "pay_made_up",
            "razorpay_signature": "0" * 64,
        },
        headers=NO_TENANT,
    )

    assert response.status_code == 400, response.text
    assert await count_tenants() == before


# ── The handoff ─────────────────────────────────────────────────────────────


async def test_a_handoff_works_exactly_once(client: AsyncClient) -> None:
    """It travels in a URL, so the copy left in browser history must be inert."""
    token = await start(client, "handoff@example.com")
    await fill(client, token)
    await order(client, token)
    handoff = (await pay(client, token)).json()["handoff_token"]

    first = await client.post(
        "/api/v1/auth/handoff", json={"token": handoff}, headers=NO_TENANT
    )
    assert first.status_code == 200, first.text

    replay = await client.post(
        "/api/v1/auth/handoff", json={"token": handoff}, headers=NO_TENANT
    )
    assert replay.status_code == 401, replay.text


async def test_a_redeemed_signup_cannot_mint_another_session(client: AsyncClient) -> None:
    """The intent token gets one ride into the dashboard, not a standing key.

    Without this, anyone holding the token from localStorage could re-post it to
    `/verify` forever and get a fresh session — a way in that survives a password
    change and shows up in no session list.
    """
    token = await start(client, "onlyonce@example.com")
    await fill(client, token)
    await order(client, token)
    handoff = (await pay(client, token)).json()["handoff_token"]

    assert (
        await client.post("/api/v1/auth/handoff", json={"token": handoff}, headers=NO_TENANT)
    ).status_code == 200

    again = await pay(client, token)
    assert again.status_code == 200, again.text
    assert again.json()["handoff_token"] is None


async def test_an_expired_handoff_is_refused(client: AsyncClient) -> None:
    token = await start(client, "expiredhandoff@example.com")
    await fill(client, token)
    await order(client, token)
    handoff = (await pay(client, token)).json()["handoff_token"]

    async with untenanted_session() as session:
        row = (
            await session.execute(select(SignupIntent).where(SignupIntent.token == token))
        ).scalar_one()
        row.handoff_expires_at = datetime.now(UTC) - timedelta(minutes=1)

    response = await client.post(
        "/api/v1/auth/handoff", json={"token": handoff}, headers=NO_TENANT
    )
    assert response.status_code == 401, response.text


async def test_an_invented_handoff_is_refused(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/handoff", json={"token": "made-up-token"}, headers=NO_TENANT
    )
    assert response.status_code == 401, response.text


# ── Isolation, for academies that arrived this way ──────────────────────────


async def test_two_self_serve_academies_cannot_see_each_other(client: AsyncClient) -> None:
    """Provisioned by payment rather than by /auth/signup, and isolated identically."""
    first_token = await start(client, "first@selfserve.example.com")
    await fill(client, first_token, business_name="First Arena")
    await order(client, first_token)
    first = (await pay(client, first_token)).json()["handoff_token"]

    second_token = await start(client, "second@selfserve.example.com")
    await fill(client, second_token, business_name="Second Arena", sports=[{"slug": "tennis"}])
    await order(client, second_token)
    second = (await pay(client, second_token)).json()["handoff_token"]

    a = (
        await client.post("/api/v1/auth/handoff", json={"token": first}, headers=NO_TENANT)
    ).json()
    b = (
        await client.post("/api/v1/auth/handoff", json={"token": second}, headers=NO_TENANT)
    ).json()

    assert {s["name"] for s in (await client.get("/api/v1/sports", headers=bearer(a))).json()} == {
        "Badminton",
        "Turf Football",
    }
    assert {s["name"] for s in (await client.get("/api/v1/sports", headers=bearer(b))).json()} == {
        "Tennis"
    }


@pytest.mark.parametrize("plan,expected", [("starter", "starter"), ("pro", "pro")])
async def test_the_plan_is_recorded_on_the_tenant(
    client: AsyncClient, plan: str, expected: str
) -> None:
    token = await start(client, f"plan{plan}@example.com")
    await fill(client, token)
    await order(client, token, plan)
    await pay(client, token)

    async with untenanted_session() as session:
        row = (
            await session.execute(select(SignupIntent).where(SignupIntent.token == token))
        ).scalar_one()
        tier = (
            await session.execute(select(Tenant.plan_tier).where(Tenant.id == row.tenant_id))
        ).scalar_one()

    assert tier == expected


async def test_two_venues_with_the_same_name_get_distinct_slugs(client: AsyncClient) -> None:
    first = await start(client, "same1@example.com")
    await fill(client, first)
    await order(client, first)
    a = (await pay(client, first)).json()["signup"]["tenant_slug"]

    second = await start(client, "same2@example.com")
    await fill(client, second)
    await order(client, second)
    b = (await pay(client, second)).json()["signup"]["tenant_slug"]

    assert a == "navigo-sports-arena"
    assert b == "navigo-sports-arena-2"


async def test_every_paid_signup_leaves_an_audit_row(client: AsyncClient) -> None:
    """An academy appearing with money attached is exactly what an audit log is for."""
    token = await start(client, "audited@example.com")
    await fill(client, token)
    await order(client, token)
    await pay(client, token)

    row = await intent_row(token)
    assert row.tenant_id is not None

    # A tenant-bound session, not an untenanted one: `audit_log` is under RLS, and
    # an unbound session sees zero rows for every tenant — which reads exactly like
    # the audit row never being written.
    async with tenant_session(row.tenant_id) as session:
        entries = (
            await session.execute(
                text(
                    "SELECT action, changes FROM audit_log "
                    "WHERE action = 'tenant.provisioned'"
                )
            )
        ).mappings().all()

    assert len(entries) == 1
    after = entries[0]["changes"]["after"]
    assert after["plan"] == "growth"
    assert after["payment_id"] == row.payment_id
    # The provider is on the row so a mock-provisioned academy is visibly not a sale.
    assert after["provider"] == "mock"


async def test_an_abandoned_signup_leaves_only_its_own_row(client: AsyncClient) -> None:
    """The cost of a dropped checkout, stated: one row, no academy, no user."""
    before = await count_tenants()
    token = await start(client, "abandoned@example.com")
    await fill(client, token)
    await order(client, token)

    assert await count_tenants() == before
    async with untenanted_session() as session:
        assert (
            await session.execute(
                select(func.count()).select_from(SignupIntent).where(SignupIntent.token == token)
            )
        ).scalar_one() == 1
        assert (
            await session.execute(
                text("SELECT count(*) FROM account_directory WHERE email = 'abandoned@example.com'")
            )
        ).scalar_one() == 0
