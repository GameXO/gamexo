"""The public signup surface: everything the marketing site calls before a login exists.

Every endpoint here is **unauthenticated**, which is unusual in this codebase and is
the point — the caller has no account yet. What stands in for authentication is the
intent token: 32 bytes of `secrets` output, handed to the browser once, and the only
way to address a signup. See `models.SignupIntent`.

Two endpoints do not follow the house pattern of one transaction per request, and
deliberately: `verify` and the webhook each need the payment committed *before*
provisioning begins, so they manage their own sessions. `service.py` explains why.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, File, Header, Request, Response, UploadFile, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.core import storage
from app.core.config import settings
from app.core.errors import InvalidInputError
from app.db.session import untenanted_session
from app.modules.billing import plans, razorpay, service
from app.modules.billing.models import SignupIntent, SignupStatus
from app.modules.booking import catalogue
from app.tenancy.deps import UntenantedDb

logger = logging.getLogger("gamexo.billing")

router = APIRouter(tags=["signup"])


# ── Schemas ─────────────────────────────────────────────────────────────────


class PlanOut(BaseModel):
    code: str
    name: str
    tagline: str
    price_monthly_paise: int
    price_yearly_paise: int
    currency: str
    features: list[str]
    max_courts: int | None
    max_staff: int | None
    popular: bool


class SportPick(BaseModel):
    slug: str = Field(min_length=1, max_length=100)
    name: str | None = Field(default=None, max_length=100)


class StartSignup(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=32)


class UpdateSignup(BaseModel):
    """One step of the wizard. Every field is optional — omitted means unchanged,
    so step 2 cannot blank what step 1 collected."""

    business_name: str | None = Field(default=None, min_length=1, max_length=200)
    logo_url: str | None = None
    city: str | None = Field(default=None, max_length=120)
    address: str | None = None
    phone: str | None = Field(default=None, max_length=32)
    sports: list[SportPick] | None = None
    services: dict[str, bool] | None = None
    accepted_terms: bool | None = None


class SignupOut(BaseModel):
    """The wizard's own state, echoed back. Carries no secret.

    Note what is absent: the intent token (the browser already has it, and echoing
    a credential into a response body puts it in logs and caches) and the admin
    password (which exists only in the welcome email — see `service.fulfil`).
    """

    status: SignupStatus
    email: str
    full_name: str
    phone: str | None
    business_name: str | None
    logo_url: str | None
    city: str | None
    address: str | None
    sports: list[dict]
    services: dict[str, bool]
    accepted_terms: bool
    plan_code: str | None
    billing_period: str | None
    amount_paise: int | None
    currency: str
    paid_at: datetime | None
    #: Set once the academy exists. The success screen shows it; it is also what
    #: tells a browser polling after a closed checkout that it can stop.
    tenant_slug: str | None
    #: Whether the welcome email — the one carrying the generated password —
    #: actually went out.
    #:
    #: Surfaced because provisioning deliberately survives a mail failure (see
    #: `service._email_credentials`), and the resulting state is genuinely bad if
    #: nobody is told: the owner rides the handoff into the dashboard once, closes
    #: the tab, and has no password to come back with. The success screen shows a
    #: warning instead of a reassurance it did not earn.
    credentials_emailed: bool


class StartSignupOut(BaseModel):
    #: The browser's handle on this signup, for every later call. Store it — losing
    #: it means starting the wizard again.
    token: str
    signup: SignupOut


class CreateOrder(BaseModel):
    plan_code: str = Field(min_length=1, max_length=50)
    billing_period: str = Field(default="monthly", pattern="^(monthly|yearly)$")


class OrderOut(BaseModel):
    order_id: str
    amount_paise: int
    currency: str
    #: `razorpay` or `mock`. The website opens Razorpay Checkout for the first and
    #: its own stand-in screen for the second — see `POST …/mock-pay`.
    provider: str
    #: Razorpay's public key, for the Checkout SDK. Empty in mock mode.
    key_id: str
    #: Prefilled into Checkout so the payer does not retype what the wizard asked.
    prefill_name: str
    prefill_email: str
    prefill_contact: str | None
    business_name: str | None


class VerifyPayment(BaseModel):
    """Exactly what Razorpay Checkout hands the browser on success."""

    razorpay_order_id: str = Field(min_length=1, max_length=128)
    razorpay_payment_id: str = Field(min_length=1, max_length=128)
    razorpay_signature: str = Field(min_length=1, max_length=256)


class VerifyOut(BaseModel):
    signup: SignupOut
    #: One-time, short-lived, and the whole reason the owner lands in the dashboard
    #: already signed in. Exchange it at `POST /auth/handoff`.
    #:
    #: **Null once a handoff has already been redeemed** — the intent token gets
    #: exactly one ride into the dashboard, and after that the owner signs in with
    #: the credentials they were emailed. Send them to `dashboard_url` either way;
    #: without a token they simply land on the login screen.
    handoff_token: str | None
    #: Where to send them. Absolute, from DASHBOARD_URL — the website and the
    #: dashboard are different origins and the website cannot guess the other.
    dashboard_url: str


class UploadOut(BaseModel):
    url: str
    content_type: str
    size: int


def _to_out(intent: SignupIntent, tenant_slug: str | None) -> SignupOut:
    return SignupOut(
        status=intent.status,
        email=intent.email,
        full_name=intent.full_name,
        phone=intent.phone,
        business_name=intent.business_name,
        logo_url=intent.logo_url,
        city=intent.city,
        address=intent.address,
        sports=list(intent.sports or []),
        services=dict(intent.services or {}),
        accepted_terms=intent.accepted_terms_at is not None,
        plan_code=intent.plan_code,
        billing_period=intent.billing_period,
        amount_paise=intent.amount_paise,
        currency=intent.currency,
        paid_at=intent.paid_at,
        tenant_slug=tenant_slug,
        credentials_emailed=intent.credentials_emailed_at is not None,
    )


# ── The price list ──────────────────────────────────────────────────────────


@router.get(
    "/signup/plans",
    response_model=list[PlanOut],
    summary="What gamexo sells",
    description=(
        "The pricing page reads this rather than hardcoding numbers, so a price "
        "change is one edit to `modules/billing/plans.py` — no migration and no "
        "frontend release.\n\n"
        "Amounts are integers in paise. ₹2,499.00 is `249900`."
    ),
)
async def list_plans() -> list[PlanOut]:
    return [
        PlanOut(
            code=plan.code,
            name=plan.name,
            tagline=plan.tagline,
            price_monthly_paise=plan.price_monthly_paise,
            price_yearly_paise=plan.price_yearly_paise,
            currency=plans.CURRENCY,
            features=list(plan.features),
            max_courts=plan.max_courts,
            max_staff=plan.max_staff,
            popular=plan.popular,
        )
        for plan in plans.PLANS
    ]


class CatalogueSportOut(BaseModel):
    slug: str
    name: str
    icon: str
    color: str
    bg_color: str


@router.get(
    "/signup/sports",
    response_model=list[CatalogueSportOut],
    summary="The sports a turf can pick from",
    description=(
        "The same catalogue as `GET /sports/catalogue`, without the prices and "
        "without the login. The wizard's second step renders this rather than "
        "hardcoding a list, so a slug it sends always matches one the API stocks — "
        "an unrecognised slug is accepted too, but becomes a custom sport priced at "
        "zero for the owner to set.\n\n"
        "Prices are omitted deliberately: they are opening suggestions to be edited "
        "per venue, and putting them on a public page invites them to be read as a "
        "rate card."
    ),
)
async def list_catalogue_sports() -> list[CatalogueSportOut]:
    return [
        CatalogueSportOut(
            slug=sport.slug,
            name=sport.name,
            icon=sport.icon,
            color=sport.color,
            bg_color=sport.bg_color,
        )
        for sport in catalogue.SPORT_CATALOGUE
    ]


# ── The wizard ──────────────────────────────────────────────────────────────


@router.post(
    "/signup/intent",
    response_model=StartSignupOut,
    status_code=status.HTTP_201_CREATED,
    summary="Begin a signup",
    description=(
        "Creates a draft. **No academy, no user and no charge** — see "
        "`modules/billing/models.py` for why nothing is provisioned until a payment "
        "clears.\n\n"
        "Returns a token the browser must keep: it is the only way to address this "
        "signup, and every later call needs it.\n\n"
        "409 if the email already signs in somewhere on the platform. That check is "
        "repeated at provisioning, which is the one that counts — this one exists so "
        "the failure happens before anyone pays."
    ),
)
async def start_signup(payload: StartSignup, db: UntenantedDb) -> StartSignupOut:
    intent = await service.create_intent(
        db,
        email=str(payload.email),
        full_name=payload.full_name,
        phone=payload.phone,
    )
    return StartSignupOut(token=intent.token, signup=_to_out(intent, None))


@router.get(
    "/signup/intent/{token}",
    response_model=SignupOut,
    summary="Read a signup back",
    description=(
        "Resumes the wizard in a reopened tab, and is what the success screen polls "
        "when a browser returns from checkout before the webhook has landed: keep "
        "asking until `tenant_slug` is set.\n\n"
        "404 for an unknown *or* expired token — deliberately the same answer, so "
        "this cannot be used to test which tokens exist."
    ),
)
async def read_signup(token: str, db: UntenantedDb) -> SignupOut:
    intent = await service.load_intent(db, token)
    return _to_out(intent, await service.tenant_slug_for(db, intent))


@router.patch(
    "/signup/intent/{token}",
    response_model=SignupOut,
    summary="Save a step of the wizard",
    description=(
        "Called as the owner moves between steps, so a closed tab loses nothing.\n\n"
        "Omitted fields are left alone; `sports` and `services` are replaced wholesale "
        "when present, because both are the complete answer to their own screen.\n\n"
        "409 once the signup is paid for — the answers are what was provisioned, and "
        "editing them afterwards would describe an academy that does not exist."
    ),
)
async def update_signup(token: str, payload: UpdateSignup, db: UntenantedDb) -> SignupOut:
    intent = await service.load_intent(db, token)
    await service.save_details(
        db,
        intent,
        business_name=payload.business_name,
        logo_url=payload.logo_url,
        city=payload.city,
        address=payload.address,
        phone=payload.phone,
        sports=[pick.model_dump() for pick in payload.sports]
        if payload.sports is not None
        else None,
        services=payload.services,
        accepted_terms=payload.accepted_terms,
    )
    return _to_out(intent, await service.tenant_slug_for(db, intent))


@router.post(
    "/signup/intent/{token}/logo",
    response_model=UploadOut,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a logo, before there is an academy to own it",
    description=(
        "The same validation as `POST /uploads` — PNG, JPEG or WebP up to 5 MB, typed "
        "from the file's own magic bytes rather than the multipart header — filed "
        "under `signup/{intent}/` instead of a tenant prefix, because no tenant "
        "exists yet.\n\n"
        "Returns a URL. Storing it on the signup is a separate `PATCH`, so an upload "
        "the owner immediately replaces does not overwrite anything."
    ),
)
async def upload_signup_logo(
    token: str,
    db: UntenantedDb,
    file: UploadFile = File(description="PNG, JPEG or WebP, max 5 MB"),
) -> UploadOut:
    intent = await service.load_intent(db, token)
    # Read in full rather than streaming: the cap is 5 MB, both storage backends
    # want the whole body anyway, and a partial write leaves a truncated file behind
    # a URL that already looks valid.
    data = await file.read()
    stored = storage.store_image(data, prefix=storage.signup_prefix(intent.id))
    return UploadOut(url=stored.url, content_type=stored.content_type, size=stored.size)


# ── Checkout ────────────────────────────────────────────────────────────────


@router.post(
    "/signup/intent/{token}/order",
    response_model=OrderOut,
    summary="Raise a payment order for the chosen plan",
    description=(
        "Prices the plan server-side and creates a Razorpay order. The amount is "
        "**never** taken from the request — a client that could name its own price "
        "would be the whole vulnerability.\n\n"
        "Safe to call again: a checkout the owner dismissed leaves an unpaid order "
        "behind, and retrying replaces it rather than forcing the wizard to restart.\n\n"
        "`provider: \"mock\"` means no Razorpay keys are configured. The website then "
        "shows its own stand-in checkout and calls `…/mock-pay`; production refuses "
        "to boot in that state."
    ),
)
async def create_order(token: str, payload: CreateOrder, db: UntenantedDb) -> OrderOut:
    intent = await service.load_intent(db, token)
    order = await service.start_checkout(
        db, intent, plan_code=payload.plan_code, period=payload.billing_period
    )
    return OrderOut(
        order_id=order.id,
        amount_paise=order.amount_paise,
        currency=order.currency,
        provider=order.provider,
        key_id=order.key_id,
        prefill_name=intent.full_name,
        prefill_email=intent.email,
        prefill_contact=intent.phone,
        business_name=intent.business_name,
    )


async def _confirm(order_id: str, payment_id: str, *, via: str) -> uuid.UUID | None:
    """Record the payment, then provision — in two transactions, then a third on failure.

    Shared by the browser callback and the webhook, which is what makes them
    genuinely interchangeable: whichever arrives first does the work, and the other
    finds it done. Returns the intent id, or None if the order is unknown.

    Why the sessions are opened here rather than injected: the whole point is that
    the payment COMMITs before provisioning starts. One request-scoped transaction
    would roll the payment record back along with a failed academy, and leave a
    customer who has been charged with no trace of it. See `service.py`.
    """
    # ── (1) the money ────────────────────────────────────────────────────────
    async with untenanted_session() as db:
        intent = (
            await db.execute(
                select(SignupIntent)
                .where(SignupIntent.order_id == order_id)
                .with_for_update()
                .limit(1)
            )
        ).scalars().first()
        if intent is None:
            return None
        intent_id = intent.id
        await service.record_payment(db, intent, payment_id=payment_id, via=via)

    # ── (2) the academy ──────────────────────────────────────────────────────
    try:
        async with untenanted_session() as db:
            row = (
                await db.execute(
                    select(SignupIntent).where(SignupIntent.id == intent_id).with_for_update()
                )
            ).scalar_one()
            await service.fulfil(db, row)
    except Exception as exc:  # noqa: BLE001 — the payment is real; record and re-raise
        logger.exception("signup %s failed to provision", intent_id)
        # ── (3) the evidence, in a session the rollback cannot take with it ──
        await service.mark_failed(intent_id, f"{type(exc).__name__}: {exc}")
        raise

    return intent_id


@router.post(
    "/signup/intent/{token}/verify",
    response_model=VerifyOut,
    summary="Confirm a payment from the browser and provision the academy",
    description=(
        "Called by the website with the three values Razorpay Checkout hands it on "
        "success. The signature is HMAC-SHA256 of `\"{order_id}|{payment_id}\"` keyed "
        "with our API key secret, and it is verified before anything else happens — "
        "an unsigned or mis-signed callback provisions nothing.\n\n"
        "Idempotent, and interchangeable with the webhook: whichever lands first "
        "creates the academy and the other finds it already made. That matters "
        "because either one can be lost — a closed tab kills this, a firewall kills "
        "the webhook.\n\n"
        "Returns a one-time `handoff_token`. Send the browser to "
        "`{dashboard_url}/?handoff={token}` and it arrives signed in."
    ),
)
async def verify_payment(token: str, payload: VerifyPayment) -> VerifyOut:
    async with untenanted_session() as db:
        intent = await service.load_intent(db, token)
        intent_id, expected_order = intent.id, intent.order_id

    if not expected_order or payload.razorpay_order_id != expected_order:
        raise InvalidInputError(
            "That payment does not belong to this signup.",
            details={"field": "razorpay_order_id"},
        )
    if not razorpay.verify_checkout_signature(
        order_id=payload.razorpay_order_id,
        payment_id=payload.razorpay_payment_id,
        signature=payload.razorpay_signature,
    ):
        # Logged as a warning, not an error: a mismatched signature is either a bug
        # in an integration or somebody trying it on, and both are worth seeing.
        logger.warning("signup %s: bad checkout signature", intent_id)
        raise InvalidInputError(
            "This payment could not be verified. If money has left your account, "
            "contact support and quote the payment id.",
            details={"field": "razorpay_signature"},
        )

    await _confirm(payload.razorpay_order_id, payload.razorpay_payment_id, via="callback")

    # A fresh session, after provisioning has committed, so this reads the finished
    # row rather than the one that was locked a moment ago.
    async with untenanted_session() as db:
        intent = await service.load_intent(db, token, for_update=True)
        handoff = service.issue_handoff(intent)
        out = _to_out(intent, await service.tenant_slug_for(db, intent))

    return VerifyOut(signup=out, handoff_token=handoff, dashboard_url=settings.dashboard_url)


async def mock_pay(token: str) -> VerifyOut:
    """Complete a signup with no Razorpay account and no network.

    Registered by `register_mock_checkout` only where there is no real gateway, so
    the whole flow — provisioning, the welcome email, the handoff into the dashboard
    — can be exercised on a laptop.

    Not a bypass of the verification logic: it mints a payment id and signs it with
    `BILLING_MOCK_SECRET`, and that signature goes through exactly the same check a
    real one does.
    """
    async with untenanted_session() as db:
        intent = await service.load_intent(db, token)
        order_id = intent.order_id
        if not order_id or intent.provider != razorpay.MOCK:
            raise InvalidInputError("This signup has no mock order to pay.")

    payment_id, signature = razorpay.mock_payment(order_id)
    return await verify_payment(
        token,
        VerifyPayment(
            razorpay_order_id=order_id,
            razorpay_payment_id=payment_id,
            razorpay_signature=signature,
        ),
    )


# ── The webhook ─────────────────────────────────────────────────────────────


@router.post(
    "/billing/webhook/razorpay",
    status_code=status.HTTP_200_OK,
    summary="Razorpay payment webhook",
    description=(
        "Subscribe this URL to `payment.captured` in Razorpay → Settings → Webhooks, "
        "and put the secret it gives you in `PLATFORM_RAZORPAY_WEBHOOK_SECRET`.\n\n"
        "This is the half of the flow that does not depend on the payer's browser. A "
        "customer who pays and immediately closes the tab still gets their academy "
        "and their credentials, because this arrives regardless.\n\n"
        "**Always answers 200**, including for a signature it rejected. Razorpay "
        "retries any non-2xx for 24 hours, and retrying a forged callback forever "
        "achieves nothing but load. What it does with a payload is in the logs."
    ),
)
async def razorpay_webhook(
    request: Request,
    response: Response,
    x_razorpay_signature: str = Header(default=""),
) -> dict[str, str]:
    # The RAW body. Razorpay signs the bytes it sent; re-serialising the parsed JSON
    # changes them — a different key order or one space is enough — and the signature
    # then never matches. This is the single most common way this integration breaks.
    body = await request.body()

    if not razorpay.verify_webhook_signature(body=body, signature=x_razorpay_signature):
        logger.warning(
            "razorpay webhook rejected: bad signature (secret configured: %s)",
            bool(settings.platform_razorpay_webhook_secret),
        )
        # 200 with a body that says otherwise — see the endpoint description.
        return {"status": "rejected"}

    payload = await request.json()
    event = str(payload.get("event", ""))
    if event not in ("payment.captured", "order.paid"):
        return {"status": "ignored", "event": event}

    entity = (
        payload.get("payload", {}).get("payment", {}).get("entity", {})
        or payload.get("payload", {}).get("order", {}).get("entity", {})
    )
    order_id = str(entity.get("order_id") or entity.get("id") or "")
    payment_id = str(entity.get("id") or "")
    if not order_id or not payment_id:
        logger.warning("razorpay webhook %s carried no order id", event)
        return {"status": "ignored", "event": event}

    try:
        intent_id = await _confirm(order_id, payment_id, via="webhook")
    except Exception:  # noqa: BLE001 — already logged and recorded by _confirm
        # 500, so Razorpay retries: unlike a bad signature, this one may well
        # succeed next time, and the customer has paid.
        response.status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
        return {"status": "error"}

    if intent_id is None:
        # A payment for an order we have no signup for. Real, and not an error: our
        # own test orders and any other product on the same Razorpay account land here.
        logger.info("razorpay webhook: no signup for order %s", order_id)
        return {"status": "unknown_order"}

    return {"status": "ok"}


def register_mock_checkout(api: APIRouter) -> None:
    """Expose `…/mock-pay` only where there is no real gateway configured.

    Not registered at all rather than guarded, following `gateway/sandbox.py`: an
    endpoint that provisions a paid academy for free should not exist in the route
    table of a deployment that takes real money.
    """
    if razorpay.provider() == razorpay.MOCK and settings.environment != "production":
        api.add_api_route(
            "/signup/intent/{token}/mock-pay",
            mock_pay,
            methods=["POST"],
            response_model=VerifyOut,
            tags=["signup"],
            summary="Pay a mock order (development only)",
            description=(
                "Completes a signup without Razorpay, for local development. Mints a "
                "payment id, signs it with `BILLING_MOCK_SECRET`, and runs it through "
                "the same signature check a real payment takes.\n\n"
                "Present only when no Razorpay key is configured; production refuses "
                "to boot in that state."
            ),
        )
