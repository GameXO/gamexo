"""Talking to Razorpay — and standing in for it when there is no account yet.

Two providers behind one interface. `razorpay` is the real thing; `mock` exists so
the entire signup flow — order, checkout, callback, webhook, provisioning, email —
can be exercised on a laptop by someone who has not yet been given credentials.
`settings.billing_provider` picks between them, and production refuses to boot on
`mock` (see core/config.py::_guard_production).

── The property that makes the mock worth having ───────────────────────────────
The mock does **not** skip signature verification. It signs its fake payments with
`BILLING_MOCK_SECRET` using the same HMAC-SHA256 construction Razorpay uses, and
they are verified by the same `verify_checkout_signature` and
`verify_webhook_signature` below. So the code path exercised without an account is
the code path that ships — a mock that returned `True` from the verifier would test
everything except the part most likely to be wrong.

── What Razorpay actually signs ────────────────────────────────────────────────
Two different constructions, and confusing them is the classic integration bug:

  * **Checkout callback** — HMAC-SHA256 of the ASCII string `"{order_id}|{payment_id}"`,
    keyed with the **API key secret**. This is what Checkout hands the browser.
  * **Webhook** — HMAC-SHA256 of the **raw request body, byte for byte**, keyed with
    the **webhook secret**, which is a different secret set when the endpoint is
    created. Re-serialising the parsed JSON changes the bytes and the signature
    never matches; the router therefore reads `await request.body()`.

Docs: https://razorpay.com/docs/webhooks/validate-test/
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import time
from dataclasses import dataclass

import httpx

from app.core.config import settings
from app.core.errors import AppError

logger = logging.getLogger("gamexo.billing")

API_BASE = "https://api.razorpay.com/v1"
TIMEOUT = httpx.Timeout(15.0, connect=5.0)

MOCK = "mock"
RAZORPAY = "razorpay"


class BillingProviderError(AppError):
    """Razorpay could not be reached, or refused to create the order.

    A 502 rather than a 500: nothing is wrong on our side, and the owner staring at
    a spinner should be told to try again rather than shown a crash.
    """

    status_code = 502
    code = "billing_provider_error"


@dataclass(frozen=True, slots=True)
class Order:
    """An order raised with the provider, ready to hand to Checkout."""

    id: str
    amount_paise: int
    currency: str
    provider: str
    #: The public key the browser needs to open Checkout. Public by design — it
    #: reaches the page either way — and empty in mock mode, which has no SDK.
    key_id: str


def provider() -> str:
    return settings.billing_provider


def _key_secret() -> str:
    """Whichever secret signs a *payment* for the active provider."""
    if provider() == RAZORPAY:
        secret = settings.platform_razorpay_key_secret
        return secret.get_secret_value() if secret else ""
    return settings.billing_mock_secret


def _webhook_secret() -> str:
    """Whichever secret signs a *webhook* for the active provider.

    Razorpay's webhook secret is separate from the API key secret and is chosen when
    the endpoint is created. Falling back to the key secret would silently accept
    nothing, so an unset value returns "" and every webhook is rejected — which is
    the safe direction and is logged loudly by the router.
    """
    if provider() == RAZORPAY:
        secret = settings.platform_razorpay_webhook_secret
        return secret.get_secret_value() if secret else ""
    return settings.billing_mock_secret


# ── Orders ──────────────────────────────────────────────────────────────────


async def create_order(
    *, amount_paise: int, currency: str, receipt: str, notes: dict[str, str]
) -> Order:
    if provider() == MOCK:
        return _mock_order(amount_paise, currency)

    key_id = settings.platform_razorpay_key_id or ""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(
                f"{API_BASE}/orders",
                json={
                    "amount": amount_paise,
                    "currency": currency,
                    # Our own reference, echoed back on the order and in the
                    # dashboard. This is what makes a Razorpay row traceable to a
                    # signup without a support ticket.
                    "receipt": receipt[:40],
                    "notes": notes,
                    # Razorpay may auto-capture or leave the payment authorised
                    # depending on account settings. Asking for capture here means
                    # the money is actually taken rather than held for five days.
                    "payment_capture": 1,
                },
                auth=(key_id, _key_secret()),
            )
    except httpx.HTTPError as exc:
        # Type only — the string form can carry the URL, and the URL carries the key.
        logger.warning("razorpay order failed: %s", type(exc).__name__)
        raise BillingProviderError(
            "Could not reach Razorpay to start the payment. Please try again."
        ) from exc

    if response.status_code >= 400:
        logger.warning("razorpay refused the order: HTTP %s", response.status_code)
        raise BillingProviderError(
            f"Razorpay refused to create the order ({response.status_code}). "
            "Please try again in a moment."
        )

    body = response.json()
    return Order(
        id=str(body["id"]),
        amount_paise=int(body["amount"]),
        currency=str(body["currency"]),
        provider=RAZORPAY,
        key_id=key_id,
    )


def _mock_order(amount_paise: int, currency: str) -> Order:
    """An order id shaped like Razorpay's, and obviously not one.

    `order_mock_…` rather than `order_…`: a mock order that is indistinguishable
    from a real one in a log is how somebody eventually concludes that payments are
    working when nothing has been charged.
    """
    return Order(
        id=f"order_mock_{secrets.token_hex(8)}",
        amount_paise=amount_paise,
        currency=currency,
        provider=MOCK,
        key_id="",
    )


# ── Signatures ──────────────────────────────────────────────────────────────


def _sign(payload: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def verify_checkout_signature(*, order_id: str, payment_id: str, signature: str) -> bool:
    """The signature Checkout hands the browser on success.

    `compare_digest` rather than `==`: a plain comparison over a hex digest leaks the
    number of matching leading characters through timing, which is enough to forge
    one given a few thousand attempts.
    """
    secret = _key_secret()
    if not secret or not signature:
        return False
    expected = _sign(f"{order_id}|{payment_id}".encode("utf-8"), secret)
    return hmac.compare_digest(expected, signature)


def verify_webhook_signature(*, body: bytes, signature: str) -> bool:
    """Over the **raw** body. See the module docstring on why that matters."""
    secret = _webhook_secret()
    if not secret or not signature:
        return False
    return hmac.compare_digest(_sign(body, secret), signature)


# ── Mock helpers, for tests and the local checkout ──────────────────────────


def mock_payment(order_id: str) -> tuple[str, str]:
    """A fake payment id and a *correctly signed* signature for it.

    Used by the mock checkout endpoint and by the tests. It produces a signature
    that `verify_checkout_signature` genuinely accepts, so nothing downstream needs
    a special case for mock mode.
    """
    payment_id = f"pay_mock_{secrets.token_hex(8)}"
    signature = _sign(f"{order_id}|{payment_id}".encode("utf-8"), _key_secret())
    return payment_id, signature


def mock_webhook(
    *, order_id: str, payment_id: str, amount_paise: int, event: str = "payment.captured"
) -> tuple[bytes, str]:
    """A webhook body in Razorpay's shape, and its signature.

    Returns the exact bytes to POST, because the signature is over those bytes —
    re-encoding the dict at the call site would produce a body that does not verify.
    """
    payload = {
        "event": event,
        "created_at": int(time.time()),
        "payload": {
            "payment": {
                "entity": {
                    "id": payment_id,
                    "order_id": order_id,
                    "amount": amount_paise,
                    "currency": "INR",
                    "status": "captured",
                }
            }
        },
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return body, _sign(body, _webhook_secret())
