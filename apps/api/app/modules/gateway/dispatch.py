"""One URL for every platform. The API key decides which one is calling.

Playo, District and Hudle are all handed the same string — `/api/v1/gateway` — plus a
key. Nobody picks a base URL, so nobody picks the wrong one.

Each platform's adapter is still mounted at its own canonical path
(`/api/v1/gateway/playo/…`), because they are genuinely different contracts: different
paths, different field names, different response envelopes. Folding them into one
namespace would mean `/gateway/availability` declaring a single response schema while
returning two shapes, and each new platform would deepen the ambiguity. So the adapters
stay separate and honest, and this middleware routes to them.

── Why the key, and not the path ───────────────────────────────────────────────
`key_prefix` is globally unique (models.py), so an inbound key names exactly one
partner and therefore exactly one wire format — known before a body is parsed, and
without any guessing from JSON shape.

Routing here does NOT authenticate. The prefix is read; the secret is never checked.
`deps.get_current_partner` still does that properly downstream, so a forged prefix is
routed somewhere and then refused. An *unknown* prefix routes to the default dialect,
which answers with its ordinary "Invalid or revoked API key" — the same reply a missing
key gets. A caller therefore cannot learn which prefixes exist by watching where they
land.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass

from fastapi.responses import JSONResponse
from sqlalchemy import select
from starlette.routing import Match
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import settings
from app.core.errors import _envelope
from app.db.session import untenanted_session
from app.modules.gateway.dialects import DEFAULT_DIALECT, DIALECTS
from app.modules.gateway.models import PartnerKeyDirectory, split_api_key

API_KEY_HEADER = "x-api-key"

#: First path segments the dispatcher must not touch: every dialect's canonical path,
#: plus the sandbox, which is mounted at `/gateway/sandbox`.
RESERVED = frozenset(DIALECTS) | {"sandbox"}


# ── prefix → dialect ────────────────────────────────────────────────────────
#
# Deliberately the same shape, and the same rules, as the tenant snapshot cache in
# tenancy/resolver.py — down to the consequences, which are worth restating rather
# than cross-referencing:
#
#   * TTL'd and per-process, so changing a partner's dialect takes up to TTL to
#     take effect anywhere it was not explicitly invalidated.
#   * Misses are NOT cached. A key minted a second ago is therefore never masked by
#     a stale "no such prefix" — the failure that would be maddening to debug — at
#     the cost of an unknown prefix reaching the database every time.
#
# Keyed on the prefix alone, and the prefix is globally unique, so it cannot resolve
# to two partners. Academy A's key presented on academy B's *hostname* still routes
# to A's dialect and is then refused: the host wins tenant resolution, so the
# authentication lookup that follows is RLS-scoped to B, finds nothing, and returns
# 401. Routing to the "wrong" adapter reveals nothing, because nothing there answers
# without a valid, in-tenant key.

_CACHE_TTL_SECONDS = 300.0


@dataclass(frozen=True, slots=True)
class PartnerRouting:
    """What an inbound key prefix tells us before anything is authenticated."""

    dialect: str
    tenant_id: uuid.UUID
    allowed_origins: tuple[str, ...]


# key_prefix -> (expires_at, routing)
_routes: dict[str, tuple[float, PartnerRouting]] = {}


def invalidate_partner_cache(*prefixes: str) -> None:
    """Drop cached key prefixes. No arguments clears everything.

    Called from admin_router whenever a partner is created, re-pointed at another
    dialect, rotated (the prefix itself changes) or deleted. Creation cannot be
    masked by a stale entry — misses are not cached — but rotation and a dialect
    change both would be, and both are things a tenant admin does expecting the very
    next call to behave differently.
    """
    if not prefixes:
        _routes.clear()
        return
    for prefix in prefixes:
        _routes.pop(prefix, None)


async def routing_for(key_prefix: str) -> PartnerRouting | None:
    """The dialect and academy behind a key prefix, or None if no such key exists.

    Reads `partner_key_directory`, not `integration_partner`. That is not a
    shortcut — `integration_partner` is tenant-scoped, and an unbound session sees
    zero rows through RLS, which is the whole reason a directory table exists. Same
    exception, same reasoning as `AccountDirectory` for logins.

    This resolves; it does not authenticate. Only the public half of the key is
    read, and `deps.get_current_partner` still verifies the secret afterwards
    against a tenant-scoped row. A forged prefix therefore resolves to an academy
    and is then refused by it.
    """
    entry = _routes.get(key_prefix)
    if entry is not None:
        expires_at, routing = entry
        if expires_at > time.monotonic():
            return routing
        _routes.pop(key_prefix, None)

    async with untenanted_session() as session:
        row = (
            await session.execute(
                select(
                    PartnerKeyDirectory.dialect,
                    PartnerKeyDirectory.tenant_id,
                    PartnerKeyDirectory.allowed_origins,
                ).where(PartnerKeyDirectory.key_prefix == key_prefix)
            )
        ).one_or_none()

    if row is None:
        return None

    routing = PartnerRouting(
        dialect=row[0], tenant_id=row[1], allowed_origins=tuple(row[2] or ())
    )
    _routes[key_prefix] = (time.monotonic() + _CACHE_TTL_SECONDS, routing)
    return routing


def tenant_reference_for_key(raw_key: str | None) -> str | None:
    """The cached academy id for this key, as a resolver reference. None on a miss.

    Synchronous and cache-only, so `resolve_tenant_cached` — which exists to answer
    without opening a connection — keeps that property. A miss returns None and the
    caller falls through to the async path, exactly as it does for an uncached slug.
    """
    prefix = _prefix_of(raw_key)
    if prefix is None:
        return None
    entry = _routes.get(prefix)
    if entry is None or entry[0] <= time.monotonic():
        return None
    return str(entry[1].tenant_id)


async def load_tenant_reference_for_key(raw_key: str | None) -> str | None:
    """Same answer as `tenant_reference_for_key`, paying for a query on a miss."""
    prefix = _prefix_of(raw_key)
    if prefix is None:
        return None
    routing = await routing_for(prefix)
    return None if routing is None else str(routing.tenant_id)


def _prefix_of(raw_key: str | None) -> str | None:
    if not raw_key:
        return None
    parts = split_api_key(raw_key)
    return None if parts is None else parts[0]


# ── which dialect claims a path ─────────────────────────────────────────────


def _claims(slug: str, path: str, method: str) -> bool:
    """Does this dialect declare `path`?

    Starlette's own matcher rather than string comparison — `/bookings/{reference}`
    has parameters, and a hand-rolled equality check would report it missing.

    A PARTIAL match (right path, wrong method) counts as a claim: that request wants
    a 405 from the dialect that owns it, not a "belongs to someone else" message.
    """
    probe: Scope = {"type": "http", "path": path, "method": method}
    for route in DIALECTS[slug].router.routes:
        match, _ = route.matches(probe)
        if match is not Match.NONE:
            return True
    return False


def _owners(path: str, method: str) -> list[str]:
    return [slug for slug in DIALECTS if _claims(slug, path, method)]


# ── the middleware ──────────────────────────────────────────────────────────


class GatewayDispatch:
    """Rewrite `/api/v1/gateway/…` to the canonical path for the caller's platform.

    Pure ASGI rather than BaseHTTPMiddleware: only `scope` is touched, and going
    through the request/response abstraction would buffer every partner's body for
    no reason.

    Registered *first* in create_app so it ends up innermost. `add_middleware`
    inserts at index 0 and the stack is built by wrapping in reverse, so the
    first-added middleware sits closest to the router — which is what keeps CORS and
    `Server-Timing` reporting the path the caller actually sent.

    Being outside Starlette's ExceptionMiddleware, it cannot raise into the app's
    handlers, so the one error it produces is returned directly — built from the same
    `_envelope` as every other error in the API.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self.prefix = f"{settings.api_v1_prefix}/gateway"

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        path: str = scope["path"]
        if not path.startswith(f"{self.prefix}/"):
            return await self.app(scope, receive, send)

        rest = path[len(self.prefix):]          # "/bookings/hold"
        head = rest.split("/", 2)[1]            # "bookings"
        if head in RESERVED:
            # An explicit canonical path, or the sandbox. Left exactly as sent —
            # `deps.speaking` is what decides whether that key belongs there.
            return await self.app(scope, receive, send)

        slug = await self._dialect(scope) or DEFAULT_DIALECT
        method: str = scope.get("method", "GET")

        if not _claims(slug, rest, method):
            elsewhere = _owners(rest, method)
            # An unbuilt dialect claims nothing, so *every* path fails against it —
            # including ones no other dialect claims either. It gets the explanation
            # regardless, or the one case that most needs saying would be the one
            # that fell through to a bare 404.
            if elsewhere or not DIALECTS[slug].is_ready:
                return await self._mismatch(scope, receive, send, slug, rest, elsewhere)
            # Claimed by nobody — a plain typo. Rewrite anyway and let FastAPI's
            # ordinary 404 answer it, rather than inventing a special case for it.

        return await self.app(self._rewrite(scope, f"{self.prefix}/{slug}{rest}"), receive, send)

    async def _dialect(self, scope: Scope) -> str | None:
        """The calling platform, or None if that cannot be established.

        Every failure here — no key, malformed key, unknown key — returns None, and
        the caller falls back to the default dialect. That is deliberate: a gateway
        path must never 404 for want of routing when the real answer is 401, and the
        dependencies downstream produce those errors properly, in the one place they
        are defined.

        This used to resolve the tenant first and then look the key up inside it,
        which meant routing depended on a hostname a partner does not have. The
        prefix is globally unique, so it is enough on its own.
        """
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}

        prefix = _prefix_of(headers.get(API_KEY_HEADER))
        if prefix is None:
            return None

        routing = await routing_for(prefix)
        return None if routing is None else routing.dialect

    @staticmethod
    def _rewrite(scope: Scope, path: str) -> Scope:
        scope = dict(scope)
        scope["path"] = path
        # raw_path is what Starlette prefers when building request.url, so leaving it
        # behind would make request.url.path disagree with the route that ran.
        if "raw_path" in scope:
            scope["raw_path"] = path.encode("latin-1")
        return scope

    async def _mismatch(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        slug: str,
        rest: str,
        elsewhere: list[str],
    ) -> None:
        """404 that names the fix.

        Removing the per-platform base URL removed the moment a wrong choice used to
        announce itself. Without this the same mistake is a bare 404 with nothing in
        it, which is strictly worse than the 401 it replaced.
        """
        spec = DIALECTS[slug]
        owner = ", ".join(DIALECTS[s].label for s in elsewhere)

        if not spec.is_ready:
            # Unreachable through the dashboard — `create_partner` refuses an unbuilt
            # dialect — so getting here means a row was edited by hand. Say the true
            # thing anyway: "that path belongs to Playo" would send someone hunting a
            # routing bug instead of a missing adapter.
            message = (
                f"This key is registered as {spec.label}, whose integration is not "
                f"built yet — we have no API spec from them. No request can succeed "
                f"against it. Re-point this integration in Manage → Integrations."
            )
        else:
            message = (
                f"This key is registered as {spec.label}, so {rest} was routed to "
                f"{self.prefix}/{slug}{rest}, which does not exist. {rest} belongs to "
                f"{owner}. Change this integration's API in Manage → Integrations, or "
                f"call {spec.label}'s equivalent."
            )

        response = JSONResponse(
            status_code=404,
            content=_envelope(
                "not_found",
                message,
                {
                    "registered_as": slug,
                    "path_belongs_to": elsewhere,
                    "tried": f"{self.prefix}/{slug}{rest}",
                },
            ),
        )
        await response(scope, receive, send)
