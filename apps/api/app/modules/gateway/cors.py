"""Cross-origin headers for a partner calling from a browser.

Separate from the app's global `CORSMiddleware`, which takes one origin list for
the whole deployment. A partner's allowed origins belong to that partner, and
adding every customer's website to a global environment variable would mean a
redeploy per customer and one list that grants every origin access to every route.

── This is not a security control, and the code should not imply it is ─────────
`Origin` is a request header. Anything that is not a browser sets it to whatever it
likes, or omits it. What CORS actually does is stop *another website* from using a
key it has stolen, and stop a browser from reading a response it was not offered.
That is worth having and it is all it is worth.

The real containment for a browser-held key is `deps.PUBLISHABLE_OPERATIONS`, which
decides what such a key can do at all.

── The preflight problem, stated rather than hidden ────────────────────────────
A preflight is an OPTIONS request that carries `Origin` and
`Access-Control-Request-Headers` — and **not** the custom headers themselves. So
`X-API-Key` is absent, and there is no way to tell which partner is asking, and
therefore no way to know which origins are allowed for them.

Being strict here is not an option: refusing the preflight would break every
legitimate browser integration. So the preflight is answered permissively and the
decision moves to the real request, which does carry the key. A disallowed origin
gets a response with no `Access-Control-Allow-Origin`, and the browser refuses to
hand it to the page.

The honest consequence: the request still *executes*. For a disallowed origin the
attacker learns nothing from the response, but a booking may have been created.
That is inherent to CORS, not a gap in this implementation, and it is the reason
the operation allowlist — not this file — is what makes a public key safe to issue.
"""

from __future__ import annotations

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings
from app.modules.gateway.dispatch import _prefix_of, routing_for

#: Everything a gateway caller legitimately sends. `X-Tenant-ID` is included
#: because a browser strips any custom header it was not told to expect, and dev
#: builds still send it.
ALLOWED_REQUEST_HEADERS = "Authorization, Content-Type, X-API-Key, X-Tenant-ID"
ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS"
#: Browsers cache a preflight for this long, so a changed origin list takes effect
#: within the hour rather than immediately. Short enough not to strand anyone.
PREFLIGHT_MAX_AGE = "600"


class GatewayCors:
    """Per-partner CORS for `/api/v1/gateway/…`, decided from the calling key."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.prefix = f"{settings.api_v1_prefix}/gateway"

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(self.prefix):
            return await self.app(scope, receive, send)

        headers = Headers(scope=scope)
        origin = headers.get("origin")
        if not origin:
            # Not a browser. Nothing to negotiate.
            return await self.app(scope, receive, send)

        if scope.get("method") == "OPTIONS" and "access-control-request-method" in headers:
            return await self._preflight(origin, send)

        allowed = await self._origin_allowed(headers.get("x-api-key"), origin)
        if not allowed:
            # Deliberately not an error: the request is answered normally and simply
            # carries no CORS header, which is what a browser needs in order to say
            # "blocked by CORS" rather than surfacing a confusing 4xx from us.
            return await self.app(scope, receive, send)

        async def send_with_cors(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message).append("Access-Control-Allow-Origin", origin)
                # The allowlist is per key, so a cache keyed on the URL alone would
                # hand one origin's response to another.
                MutableHeaders(scope=message).append("Vary", "Origin")
            await send(message)

        await self.app(scope, receive, send_with_cors)

    async def _preflight(self, origin: str, send: Send) -> None:
        """Answered without knowing the caller — see the module docstring."""
        response = Response(status_code=204)
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = ALLOWED_METHODS
        response.headers["Access-Control-Allow-Headers"] = ALLOWED_REQUEST_HEADERS
        response.headers["Access-Control-Max-Age"] = PREFLIGHT_MAX_AGE
        response.headers["Vary"] = "Origin"
        await response({"type": "http"}, _no_body, send)

    @staticmethod
    async def _origin_allowed(raw_key: str | None, origin: str) -> bool:
        prefix = _prefix_of(raw_key)
        if prefix is None:
            return False
        routing = await routing_for(prefix)
        return routing is not None and origin in routing.allowed_origins


async def _no_body() -> Message:
    return {"type": "http.request", "body": b"", "more_body": False}
