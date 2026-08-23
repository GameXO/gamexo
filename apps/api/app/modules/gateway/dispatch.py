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

from fastapi.responses import JSONResponse
from sqlalchemy import select
from starlette.routing import Match
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.config import settings
from app.core.errors import AppError, _envelope
from app.db.session import tenant_session, untenanted_session
from app.modules.gateway.dialects import DEFAULT_DIALECT, DIALECTS
from app.modules.gateway.models import IntegrationPartner, split_api_key
from app.tenancy.resolver import (
    IMPERSONATE_HEADER,
    TENANT_HEADER,
    resolve_tenant,
    resolve_tenant_cached,
)

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
# Keyed on the prefix alone rather than on (tenant, prefix): the prefix is globally
# unique, so it cannot resolve to two partners. One case looks like it should matter
# and does not — academy A's key presented on academy B's hostname hits this cache
# and is routed to A's dialect. The lookup that follows is RLS-scoped to B, finds
# nothing, and returns 401. Routing to the "wrong" adapter reveals nothing, because
# nothing there answers without a valid, in-tenant key.

_CACHE_TTL_SECONDS = 300.0

# key_prefix -> (expires_at, dialect slug)
_dialects: dict[str, tuple[float, str]] = {}


def invalidate_partner_cache(*prefixes: str) -> None:
    """Drop cached key prefixes. No arguments clears everything.

    Called from admin_router whenever a partner is created, re-pointed at another
    dialect, rotated (the prefix itself changes) or deleted. Creation cannot be
    masked by a stale entry — misses are not cached — but rotation and a dialect
    change both would be, and both are things a tenant admin does expecting the very
    next call to behave differently.
    """
    if not prefixes:
        _dialects.clear()
        return
    for prefix in prefixes:
        _dialects.pop(prefix, None)


async def dialect_for(tenant_id, key_prefix: str) -> str | None:
    """Which wire format this key speaks, or None if no such key exists here."""
    entry = _dialects.get(key_prefix)
    if entry is not None:
        expires_at, slug = entry
        if expires_at > time.monotonic():
            return slug
        _dialects.pop(key_prefix, None)

    async with tenant_session(tenant_id) as session:
        slug = (
            await session.execute(
                select(IntegrationPartner.dialect).where(
                    IntegrationPartner.key_prefix == key_prefix
                )
            )
        ).scalar_one_or_none()

    if slug is None:
        return None

    _dialects[key_prefix] = (time.monotonic() + _CACHE_TTL_SECONDS, slug)
    return slug


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

        Every failure here — no key, malformed key, unknown key, unresolvable tenant
        — returns None, and the caller falls back to the default dialect. That is
        deliberate: a gateway path must never 404 for want of routing when the real
        answer is 401, and the dependencies downstream produce those errors properly,
        in the one place they are defined.
        """
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}

        raw_key = headers.get(API_KEY_HEADER)
        if not raw_key:
            return None
        parts = split_api_key(raw_key)
        if parts is None:
            return None
        key_prefix, _ = parts

        try:
            args = {
                "host": headers.get("host"),
                "tenant_header": headers.get(TENANT_HEADER.lower()),
                "impersonate_header": headers.get(IMPERSONATE_HEADER.lower()),
                # A gateway request authenticates with X-API-Key, never a bearer
                # token, so it can never be a platform operator impersonating.
                "is_platform_admin": False,
            }
            tenant = resolve_tenant_cached(**args)
            if tenant is None:
                async with untenanted_session() as session:
                    tenant = await resolve_tenant(session, **args)
        except AppError:
            # An unresolvable or suspended academy. Swallowed here so the same error
            # is raised once, by get_tenant_context, with its own message.
            return None

        return await dialect_for(tenant.id, key_prefix)

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
