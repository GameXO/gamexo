"""Self-serve signup: from a form on the marketing site to a working academy.

The whole flow, in the order it happens:

    POST /signup/intent          draft row, token handed to the browser
    PATCH /signup/intent/{token} the wizard's three steps, saved as they are taken
    POST  …/order                a Razorpay order for the chosen plan
      ── the owner pays ──
    POST  …/verify   (browser)   ┐ either may arrive first, both are idempotent,
    POST /billing/webhook        ┘ and exactly one of them provisions
    POST /auth/handoff           the one-time token that opens the dashboard

── The three transactions, and why it is not one ───────────────────────────────
Provisioning happens in its own transaction, after the payment has been recorded
and committed in an earlier one. That separation is the point: if provisioning
fails — a race on the email address, a slug collision, a database blip — the
*payment* must still be on record. A single transaction would roll the evidence of
the money back along with the failed academy, leaving a customer who has been
charged and a database that has never heard of them.

So:

    1. record_payment  — verify the signature, stamp paid_at, COMMIT.
    2. fulfil          — provision, onboard, email, COMMIT.
    3. mark_failed     — only if (2) raised, in a fresh session, so the error
                         survives the rollback that just discarded it.

── How double-provisioning is prevented ────────────────────────────────────────
`SELECT … FOR UPDATE` on the intent row in both (1) and (2). A webhook and a browser
callback arriving in the same millisecond serialise on that lock; the second one
wakes up, re-reads a row that now says COMPLETED, and does nothing. Not an
application-level "check then act", which is exactly the shape that produces two
academies and one payment under load.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import write_audit
from app.auth import usernames
from app.auth.service import (
    access_token_ttl_seconds,
    assert_email_available,
    create_kiosk_login,
    issue_user_tokens,
    provision_tenant,
)
from app.core import mail, mail_templates
from app.core.config import settings
from app.core.errors import AuthenticationError, ConflictError, InvalidInputError, NotFoundError
from app.db.session import bind_session_to, untenanted_session
from app.models.audit import ActorKind
from app.models.tenant import Tenant, TenantSettings
from app.models.user import User
from app.modules.billing import plans, razorpay
from app.modules.billing.models import SignupIntent, SignupStatus
from app.modules.onboarding import service as onboarding
from app.tenancy.resolver import invalidate_tenant_cache

logger = logging.getLogger("gamexo.billing")

#: Password alphabet with every ambiguous glyph removed. This password is read off
#: a screen and typed into a login form, often from a phone — 0/O and 1/l/I are the
#: difference between signing in and filing a support ticket.
_PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"


def new_intent_token() -> str:
    """The browser's handle on its own signup. See models.SignupIntent."""
    return secrets.token_urlsafe(32)


def generate_password(groups: int = 3, size: int = 4) -> str:
    """`Kf7m-Rp3x-Tw9d` — 12 characters of ~69 bits, in chunks a human can retype.

    Hyphenated because an unbroken 12-character string is transcribed wrongly far
    more often than three groups of four, and this one is going into an email that
    somebody will copy by hand at least once.
    """
    return "-".join(
        "".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(size))
        for _ in range(groups)
    )


def _hash_handoff(token: str) -> str:
    """SHA-256, not bcrypt.

    Deliberate, and the reasoning is the opposite of the password case: this token
    is 32 bytes of `secrets` output, so there is no dictionary to attack and key
    stretching buys nothing. What it would cost is a bcrypt round on a redemption
    that has to feel instantaneous — the owner is staring at a redirect.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ── The draft ───────────────────────────────────────────────────────────────


async def create_intent(
    db: AsyncSession, *, email: str, full_name: str, phone: str | None
) -> SignupIntent:
    """Start a signup. No tenant, no user, no charge — just the answers so far.

    The email is checked against the platform directory here so a taken address
    fails on the first screen rather than after a payment. That check is advisory:
    the authoritative one runs inside the provisioning transaction, because 20
    minutes elapse between the two and somebody else can claim the address in them.
    """
    # TODO: unauthenticated and cheap to call in a loop, exactly like /auth/signup.
    # Before this is public, put a per-IP rate limit in front of it — nothing here
    # can be read back, but an attacker can fill the table and probe which email
    # addresses are already registered.
    normalised = email.strip().lower()
    await assert_email_available(db, normalised)

    intent = SignupIntent(
        token=new_intent_token(),
        status=SignupStatus.DRAFT,
        email=normalised,
        full_name=full_name.strip(),
        phone=phone,
        sports=[],
        services={},
        currency=plans.CURRENCY,
    )
    db.add(intent)
    await db.flush()
    return intent


def _expiry_cutoff() -> datetime:
    return datetime.now(UTC) - timedelta(hours=settings.signup_intent_ttl_hours)


async def load_intent(
    db: AsyncSession, token: str, *, for_update: bool = False
) -> SignupIntent:
    """Fetch a signup by the token the browser holds.

    A stale token is a 404 and not a 410, and an expired one reads the same as a
    wrong one: this endpoint is unauthenticated, and distinguishing "no such signup"
    from "that signup has expired" tells an enumerator which of their guesses landed.
    """
    stmt = select(SignupIntent).where(SignupIntent.token == token)
    if for_update:
        stmt = stmt.with_for_update()
    intent = (await db.execute(stmt)).scalar_one_or_none()

    if intent is None:
        raise NotFoundError("That signup link is not valid. Please start again.")
    # A completed signup stays readable forever — it is the receipt the success
    # screen renders, and it has nothing left to protect that the tenant does not.
    if intent.status is not SignupStatus.COMPLETED and intent.created_at < _expiry_cutoff():
        raise NotFoundError("That signup link has expired. Please start again.")
    return intent


def _assert_editable(intent: SignupIntent) -> None:
    if intent.status in (SignupStatus.COMPLETED, SignupStatus.PROVISIONING):
        raise ConflictError("This signup is already paid for and cannot be changed.")


async def save_details(
    db: AsyncSession,
    intent: SignupIntent,
    *,
    business_name: str | None = None,
    logo_url: str | None = None,
    city: str | None = None,
    address: str | None = None,
    phone: str | None = None,
    sports: list[dict[str, Any]] | None = None,
    services: dict[str, Any] | None = None,
    accepted_terms: bool | None = None,
) -> SignupIntent:
    """Save one step of the wizard.

    Every field is optional and `None` means "not on this screen, leave it alone" —
    so step 2 posting its sports cannot blank the business name step 1 collected.
    """
    _assert_editable(intent)

    if business_name is not None:
        intent.business_name = business_name.strip()
    if logo_url is not None:
        intent.logo_url = logo_url
    if city is not None:
        intent.city = city
    if address is not None:
        intent.address = address
    if phone is not None:
        intent.phone = phone
    if sports is not None:
        intent.sports = sports
    if services is not None:
        intent.services = onboarding.clean_services(services)
    if accepted_terms is not None:
        # Only ever set, never cleared. Un-ticking the box on a re-visit does not
        # retract an agreement that was already made; it just stops them continuing.
        intent.accepted_terms_at = datetime.now(UTC) if accepted_terms else None

    await db.flush()
    return intent


# ── Checkout ────────────────────────────────────────────────────────────────


async def start_checkout(
    db: AsyncSession, intent: SignupIntent, *, plan_code: str, period: str
) -> razorpay.Order:
    """Price the plan and raise an order with the provider.

    Re-raising on an intent that already has an order is allowed and expected: a
    checkout the owner dismissed leaves an unpaid order behind, and forcing them to
    restart the wizard to try again would be absurd. The new order id replaces the
    old one, and the old one is simply never paid.
    """
    _assert_editable(intent)

    plan = plans.get(plan_code)
    if plan is None:
        raise InvalidInputError(
            f"Unknown plan {plan_code!r}.", details={"field": "plan_code"}
        )
    try:
        billing_period = plans.BillingPeriod(period)
    except ValueError as exc:
        raise InvalidInputError(
            "Billing period must be 'monthly' or 'yearly'.",
            details={"field": "billing_period"},
        ) from exc

    if not intent.business_name:
        raise InvalidInputError(
            "Tell us your turf's name before checking out.",
            details={"field": "business_name"},
        )
    if intent.accepted_terms_at is None:
        raise InvalidInputError(
            "Please accept the Terms & Conditions to continue.",
            details={"field": "accepted_terms"},
        )

    amount = plan.price_paise(billing_period)
    order = await razorpay.create_order(
        amount_paise=amount,
        currency=plans.CURRENCY,
        receipt=f"signup-{intent.id}",
        # Notes are echoed onto the Razorpay dashboard row, which is where a finance
        # question ("who is this ₹4,999 from?") actually gets asked.
        notes={
            "signup_intent_id": str(intent.id),
            "email": intent.email,
            "business_name": intent.business_name or "",
            "plan": plan.code,
        },
    )

    intent.plan_code = plan.code
    intent.billing_period = billing_period.value
    intent.amount_paise = amount
    intent.currency = plans.CURRENCY
    intent.provider = order.provider
    intent.order_id = order.id
    intent.status = SignupStatus.AWAITING_PAYMENT
    await db.flush()
    return order


async def record_payment(
    db: AsyncSession, intent: SignupIntent, *, payment_id: str, via: str
) -> bool:
    """Stamp the payment on the intent. Returns False if it was already recorded.

    Transaction (1) of the three. The caller commits this before provisioning, so
    the money is on record even if everything after it fails.
    """
    if intent.is_paid:
        return False

    intent.payment_id = payment_id
    intent.paid_at = datetime.now(UTC)
    intent.confirmed_via = via
    intent.status = SignupStatus.PROVISIONING
    await db.flush()
    logger.info("signup %s paid via %s (payment %s)", intent.id, via, payment_id)
    return True


# ── Provisioning ────────────────────────────────────────────────────────────


async def fulfil(db: AsyncSession, intent: SignupIntent) -> bool:
    """Turn a paid intent into an academy. Returns False if it was already done.

    Transaction (2). The row must already be locked `FOR UPDATE` by the caller —
    this is the function two concurrent confirmations race into, and the lock is
    the only thing standing between them and two academies for one payment.

    Order of operations matters at one point: the admin's password is generated
    here, hashed into `app_user`, put into the email, and then dropped. It is never
    written to the intent, which is addressable by a token in a URL.
    """
    if intent.status is SignupStatus.COMPLETED:
        return False
    if not intent.is_paid:
        raise ConflictError("This signup has not been paid for.")

    password = generate_password()
    kiosk_password = generate_password()

    # Authoritative check. `create_intent` looked too, but that was before the
    # payment and somebody else may have taken the address since.
    await assert_email_available(db, intent.email)

    display_name = intent.business_name or intent.full_name or intent.email.split("@")[0]

    # The slug is settled *before* provisioning, not after, and that ordering is
    # load-bearing here in a way it is not for /auth/signup. Usernames embed the
    # slug (`admin@navigo-sports`), so provisioning under a placeholder and renaming
    # afterwards — which is what the signup path does — would mint
    # `admin@turf-9f3a2b` and leave the owner with it permanently.
    #
    # Reserving the id first is what makes that possible: `claim_slug` excludes the
    # tenant it is claiming for, so it has to know which one that is before the row
    # exists.
    tenant_id = uuid.uuid4()
    slug = await onboarding.claim_slug(db, display_name, tenant_id=tenant_id)

    tenant, admin = await provision_tenant(
        db,
        tenant_id=tenant_id,
        slug=slug,
        admin_username=usernames.for_admin(slug),
        name=display_name,
        admin_email=intent.email,
        admin_password=password,
        admin_full_name=intent.full_name,
        business_name=intent.business_name,
        currency=intent.currency,
    )
    tenant.plan_tier = intent.plan_code or tenant.plan_tier

    # The counter tablet's shared login, created now rather than left to be
    # discovered. The wizard's last question is which services they want on their
    # POS; a counter with no credential is not a configured option, it is a broken one.
    await create_kiosk_login(
        db, tenant=tenant, password=kiosk_password, contact_email=intent.email
    )

    settings_row = (
        await db.execute(select(TenantSettings).where(TenantSettings.tenant_id == tenant.id))
    ).scalar_one()

    previous_slug, sports_created = await onboarding.apply(
        db,
        tenant,
        settings_row,
        business_name=intent.business_name or tenant.name,
        logo_url=intent.logo_url,
        phone=intent.phone,
        city=intent.city,
        address=intent.address,
        email=intent.email,
        sports=list(intent.sports or []),
        services=dict(intent.services or {}),
    )

    intent.tenant_id = tenant.id
    intent.status = SignupStatus.COMPLETED
    intent.last_error = None

    await write_audit(
        db,
        tenant_id=tenant.id,
        action="tenant.provisioned",
        actor_kind=ActorKind.SYSTEM,
        actor_label="signup",
        entity_type="tenant",
        entity_id=tenant.id,
        changes={
            "after": {
                "slug": tenant.slug,
                "plan": intent.plan_code,
                "amount_paise": intent.amount_paise,
                "payment_id": intent.payment_id,
                "provider": intent.provider,
                "sports_created": sports_created,
            }
        },
    )

    # Same reason as onboarding's: the resolver caches by slug for five minutes, and
    # the placeholder must stop resolving the instant the real name is claimed.
    invalidate_tenant_cache(previous_slug, tenant.slug, str(tenant.id))

    await _email_credentials(
        db,
        intent,
        settings_row,
        username=admin.username,
        password=password,
        kiosk_username=usernames.for_kiosk(tenant.slug),
        kiosk_password=kiosk_password,
    )
    await db.flush()

    logger.info("signup %s provisioned tenant %s (%s)", intent.id, tenant.id, tenant.slug)
    return True


async def _email_credentials(
    db: AsyncSession,
    intent: SignupIntent,
    settings_row: TenantSettings,
    *,
    username: str,
    password: str,
    kiosk_username: str,
    kiosk_password: str,
) -> None:
    """Send the welcome email — and never let it fail the provisioning.

    The payment succeeded and the academy exists. A bounced address, an unverified
    sender domain or a deployment with no mail configured at all are all real, all
    common in development, and none of them is a reason to roll back an academy
    somebody has paid for. The failure is recorded in two places instead: on the
    `notification_delivery` row `send_email` writes whatever happens, and on
    `intent.last_error` for whoever has to resend it by hand.

    The owner still gets in: the handoff token is what actually opens the dashboard,
    and it does not depend on this.
    """
    plan = plans.get(intent.plan_code or "")
    subject, text, html = mail_templates.welcome_credentials(
        settings_row,
        full_name=intent.full_name,
        username=username,
        password=password,
        kiosk_username=kiosk_username,
        kiosk_password=kiosk_password,
        dashboard_url=settings.dashboard_url,
        pos_url=settings.pos_url,
        plan_name=plan.name if plan else (intent.plan_code or "Subscription"),
        amount_paid=Decimal(intent.amount_paise or 0) / 100,
        payment_reference=intent.payment_id or "—",
    )

    try:
        await mail.send_email(
            db,
            mail.Message(to=intent.email, subject=subject, text=text, html=html),
            event_key="signup.credentials",
        )
    except Exception as exc:  # noqa: BLE001 — see the docstring
        intent.last_error = f"Welcome email failed: {type(exc).__name__}: {exc}"[:2000]
        logger.warning("signup %s: credentials email failed: %s", intent.id, exc)
        return

    intent.credentials_emailed_at = datetime.now(UTC)


async def mark_failed(intent_id: uuid.UUID, error: str) -> None:
    """Record a fulfilment failure in a session of its own.

    Transaction (3). It has to be a new session: the one that raised is being rolled
    back, and anything written into it goes with it — which would leave a paid
    signup sitting in `provisioning` with no explanation anywhere.
    """
    async with untenanted_session() as db:
        intent = (
            await db.execute(select(SignupIntent).where(SignupIntent.id == intent_id))
        ).scalar_one_or_none()
        if intent is None:
            return
        intent.status = SignupStatus.FAILED
        intent.last_error = error[:2000]


# ── The handoff into the dashboard ──────────────────────────────────────────


def issue_handoff(intent: SignupIntent) -> str | None:
    """Mint a one-time token that signs the owner in, and store only its hash.

    Called from the browser callback and **not** from the webhook. If both issued
    one, a webhook landing a moment after the callback would overwrite the hash of
    the token the browser is already navigating with, and the owner would arrive at
    the dashboard to be told their link is invalid.

    Returns None once a handoff has already been redeemed, and that is the important
    case. The intent token lives in the browser's localStorage and in whatever the
    owner pasted it into; without this check, re-posting it to `…/verify` would mint
    a fresh session forever — a permanent way into the account that survives a
    password change and appears in no session list. One ride into the dashboard is
    all the flow needs. After that they sign in with the credentials they were
    emailed, like anybody else.
    """
    if intent.handoff_used_at is not None:
        return None

    token = secrets.token_urlsafe(32)
    intent.handoff_token_hash = _hash_handoff(token)
    intent.handoff_expires_at = datetime.now(UTC) + timedelta(
        seconds=settings.handoff_token_ttl_seconds
    )
    intent.handoff_used_at = None
    return token


async def redeem_handoff(db: AsyncSession, token: str) -> tuple[str, str, int]:
    """Exchange the one-time token for a real token pair.

    Single-use and short-lived, because it travels in a URL — which means it is in
    browser history, in the referrer of anything the dashboard loads next, and on
    the screen of whoever is standing behind them. Burning it on first use means the
    copy left in history is inert.
    """
    digest = _hash_handoff(token)
    now = datetime.now(UTC)

    intent = (
        await db.execute(
            select(SignupIntent)
            .where(SignupIntent.handoff_token_hash == digest)
            .with_for_update()
        )
    ).scalar_one_or_none()

    # One message for every failure mode — expired, already used, never existed.
    # They are all "this link will not sign you in", and the differences are only
    # useful to somebody testing which of their guesses is closest.
    if (
        intent is None
        or intent.tenant_id is None
        or intent.handoff_used_at is not None
        or intent.handoff_expires_at is None
        or intent.handoff_expires_at < now
    ):
        raise AuthenticationError("This sign-in link is no longer valid. Please log in.")

    intent.handoff_used_at = now

    async with bind_session_to(db, intent.tenant_id):
        user = (
            await db.execute(
                select(User).where(func.lower(User.email) == intent.email)
            )
        ).scalar_one_or_none()
        if user is None or not user.is_active:
            raise AuthenticationError("This sign-in link is no longer valid. Please log in.")

        user.last_login_at = now
        access, refresh = issue_user_tokens(user)

        await write_audit(
            db,
            tenant_id=intent.tenant_id,
            action="auth.signup_handoff",
            actor_kind=ActorKind.USER,
            actor_id=user.id,
            actor_label=user.email,
            entity_type="app_user",
            entity_id=user.id,
        )

    return access, refresh, access_token_ttl_seconds()


async def tenant_slug_for(db: AsyncSession, intent: SignupIntent) -> str | None:
    """The provisioned academy's slug, for the success screen. None before fulfilment."""
    if intent.tenant_id is None:
        return None
    return (
        await db.execute(select(Tenant.slug).where(Tenant.id == intent.tenant_id))
    ).scalar_one_or_none()
