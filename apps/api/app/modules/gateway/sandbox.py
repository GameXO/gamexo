"""A stand-in for a partner, so an integration can be exercised without one.

A partner is the caller here, which means there is nothing to point at until they
have built against us. This drives our own gateway the way they would — real HTTP,
real endpoints, real database — and returns a transcript of every request and
response with a verdict per scenario.

The scenarios below are written **once**, against five operations any integration
performs. Each dialect supplies a `SandboxDriver` that speaks those five in its own
wire format (see `dialects/base.py`). So a new dialect inherits every consistency
check here for free, which is the point: the guarantees are properties of the
gateway, not of any one partner's adapter.

── Never available in production ───────────────────────────────────────────────
`ENVIRONMENT=production` and these routes are not registered at all — not merely
guarded. They create and cancel real bookings on whatever academy the key belongs to,
which is what you want on a dev database and never on a live one.

── Why this handler holds no database transaction ──────────────────────────────
It cannot, and finding out why cost a debugging session worth writing down.

Every other endpoint takes `Db`, which runs the whole request inside one transaction.
This one calls *back into its own API* over HTTP, and those nested requests open
their own transactions against the same rows. The outer transaction had already
updated `integration_partner.last_used_at` during authentication, so every nested
call blocked trying to update the same row — for as long as the outer request lived,
which was until the nested call returned. A textbook self-deadlock, surfacing as a
read timeout thirty seconds in.

So the sandbox takes no `Db` dependency and does not use `CurrentPartner`. It
authenticates by hand in a session it closes immediately, and every later database
touch opens its own short-lived session. Nothing is held while an HTTP call is in
flight.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, text, update

from app.core.config import settings
from app.core.errors import AuthenticationError, NotFoundError
from app.db.session import tenant_session
from app.modules.booking.models import Booking, Court
from app.modules.gateway.deps import API_KEY_HEADER
from app.modules.gateway.dialects import DIALECTS
from app.modules.gateway.models import IntegrationPartner, hash_api_key, split_api_key
from app.modules.gateway.service import HOLD_TTL
from app.tenancy.deps import TenantCtx

router = APIRouter(prefix="/gateway/sandbox", tags=["gateway"])

SCENARIOS: dict[str, str] = {
    "happy-path": "Availability → hold → confirm. The normal sale.",
    "double-booking": "Two partners race for one slot. The second must be refused.",
    "atomic-failure": "A two-slot request where one is taken. Neither may be created.",
    "idempotency": "The same external ref sent twice. One booking, not two.",
    "hold-expiry": "A hold aged past its TTL, then the slot re-sold to someone else.",
    "confirm-expired": "A lapsed hold whose court was re-sold. Confirming must be refused.",
    "direct-create": "create → map → cancel, the single-phase path.",
    "cancel-frees-slot": "A cancelled booking's slot becomes sellable again.",
}


class Step(BaseModel):
    step: str
    request: dict[str, Any] | None = None
    status: int
    response: dict[str, Any]
    expected: str
    ok: bool


class ScenarioResult(BaseModel):
    scenario: str
    description: str
    passed: bool
    steps: list[Step]
    references: list[str] = Field(default_factory=list)


class SandboxRun(BaseModel):
    tenant: str
    partner: str
    dialect: str
    court_id: str
    passed: bool
    results: list[ScenarioResult]
    #: Rows removed on the way out, so a run leaves the database as it found it.
    #: Zero when `keep=true`, or when nothing was created.
    purged: dict[str, int] = Field(default_factory=lambda: {"bookings": 0, "events": 0})


class Caller:
    """Raw HTTP into our own API, and the transcript it produces.

    Over the network rather than by calling handlers directly, deliberately: the
    savepoint semantics, the request-scoped transaction and the JSON aliasing are the
    parts most likely to be wrong, and an in-process call exercises none of them.
    """

    def __init__(self, base_url: str, api_key: str, tenant: str) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={API_KEY_HEADER: api_key, "X-Tenant-ID": tenant},
            timeout=httpx.Timeout(20.0),
        )
        self.steps: list[Step] = []
        #: Every booking reference this run created, in order. The purge at the end
        #: works from this rather than from `ScenarioResult.references`, which holds
        #: only each scenario's *primary* booking — the scenarios that re-sell a
        #: freed slot create more, and those are exactly the rows that used to be
        #: left behind.
        self.created: list[str] = []
        self._label = ""
        self._expect_ok = True

    async def __aenter__(self) -> Caller:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self._client.aclose()

    async def __call__(self, method: str, path: str, *, json=None, params=None):
        """Issue one call. Returns `(http_ok, body, message)` for the driver to read.

        `http_ok` is only the transport verdict — a dialect that signals failure in
        the body (Playo) decides for itself what counts as success, which is exactly
        what its driver is for.
        """
        response = await self._client.request(
            method, f"/api/v1{path}", json=json, params=params
        )
        try:
            body = response.json()
        except ValueError:
            body = {"raw": response.text[:400]}

        message = ""
        if isinstance(body, dict):
            message = body.get("message") or (body.get("error") or {}).get("message", "")

        self.steps.append(
            Step(
                step=self._label,
                request=json,
                status=response.status_code,
                response=body if isinstance(body, dict) else {"items": body},
                expected=f"{'succeeds' if self._expect_ok else 'is refused'}",
                ok=False,  # overwritten by `record`
            )
        )
        return response.is_success, body, message

    def record(self, label: str, *, expect_ok: bool) -> None:
        """Name the step about to run, and say what it should do."""
        self._label = label
        self._expect_ok = expect_ok

    def settle(self, ok: bool, message: str = "") -> None:
        """Mark the step just recorded against what the driver made of the reply."""
        if not self.steps:
            return
        step = self.steps[-1]
        step.ok = ok == self._expect_ok
        if message and not step.response.get("message"):
            step.response = {**step.response, "message": message}

    def note(self, label: str, payload: dict[str, Any], expected: str, ok: bool) -> None:
        """A transcript entry for something checked outside the HTTP calls."""
        self.steps.append(
            Step(step=label, status=200, response=payload, expected=expected, ok=ok)
        )


class Driven:
    """A driver plus the bookkeeping that turns each call into a transcript line."""

    def __init__(self, driver, caller: Caller) -> None:
        self._driver = driver
        self._caller = caller

    async def run(self, op: str, label: str, *args, expect_ok: bool = True):
        self._caller.record(label, expect_ok=expect_ok)
        ok, refs, message = await getattr(self._driver, op)(*args)
        self._caller.settle(ok, message)
        # Only hold/create bring a booking into existence. confirm and cancel return
        # references too, but to rows already recorded here.
        if ok and op in ("hold", "create"):
            self._caller.created.extend(r for r in refs if r)
        return ok, refs


def _slot(court_id: str, day: str, hour: int, ref: str, name: str = "Sandbox Customer") -> dict:
    """One slot, in the neutral shape every driver translates from."""
    return {
        "date": day,
        "courtId": court_id,
        "startTime": f"{hour:02d}:00:00",
        "endTime": f"{hour + 1:02d}:00:00",
        "price": "1200",
        "paidAtPlayo": "1200",
        "playoOrderId": ref,
        "userName": name,
    }


async def _purge(tenant_id, partner_id, refs: list[str]) -> dict[str, int]:
    """Delete the bookings this run created, and wind the counter back.

    The sandbox used to only *cancel* what it made, which left ~11 bookings and ~30
    events behind per run and pushed the reference counter up by 11 — and a run that
    failed part-way could leave a booking `upcoming`, quietly blocking a court. So a
    run now removes its own rows outright and leaves the database as it found it.

    Scoped to `created_by_partner_id` as well as the tenant: even with a malformed
    reference list this cannot reach a booking the sandbox did not make.

    Runs after the HTTP client has closed. Never while a request is in flight — see
    the self-deadlock note at the top of this module.
    """
    if not refs:
        return {"bookings": 0, "events": 0}

    async with tenant_session(tenant_id) as session:
        scope = (
            "select id from booking "
            "where reference = any(:refs) and created_by_partner_id = :partner"
        )
        params = {"refs": refs, "partner": partner_id}

        events = (
            await session.execute(
                text(f"delete from booking_event where booking_id in ({scope})"), params
            )
        ).rowcount or 0
        bookings = (
            await session.execute(
                text(
                    "delete from booking "
                    "where reference = any(:refs) and created_by_partner_id = :partner"
                ),
                params,
            )
        ).rowcount or 0

        # Back to the highest reference that survives — computed, not remembered.
        # Safe under concurrency: a real booking taken during the run has a higher
        # number, so max() preserves it and the next allocation cannot collide.
        await session.execute(
            text(
                "update document_counter set last_value = coalesce("
                "  (select max(substring(reference from '[0-9]+$')::int) from booking), 0) "
                "where kind = 'booking'"
            )
        )

    return {"bookings": bookings, "events": events}


async def _expire_holds(tenant_id, refs: list[str]) -> None:
    """Age holds past their TTL — the only way to test expiry without waiting.

    Its own session, committed and closed before the next HTTP call. Holding this row
    lock across a nested request is precisely the deadlock described at the top.
    """
    async with tenant_session(tenant_id) as session:
        await session.execute(
            update(Booking)
            .where(Booking.reference.in_(refs))
            .values(hold_expires_at=datetime.now(UTC) - timedelta(minutes=1))
        )


async def _run_scenario(
    name: str, driven: Driven, caller: Caller, tenant_id, court: str, day: str, hour: int
) -> ScenarioResult:
    tag = uuid.uuid4().hex[:8].upper()
    before = len(caller.steps)
    refs: list[str] = []

    def ref(n: int = 1) -> str:
        return f"SBX-{tag}-{n}"

    if name == "happy-path":
        await driven.run("availability", "fetch availability", day)
        _, refs = await driven.run("hold", "hold the slot", [_slot(court, day, hour, ref())])
        await driven.run("confirm", "confirm after payment", refs)
        await driven.run("cancel", "cancel (cleanup)", refs)

    elif name == "double-booking":
        _, refs = await driven.run("hold", "first partner holds", [_slot(court, day, hour, ref(1))])
        await driven.run(
            "hold", "second partner tries the same slot",
            [_slot(court, day, hour, ref(2), "Second Customer")], expect_ok=False,
        )
        await driven.run("cancel", "cancel (cleanup)", refs)

    elif name == "atomic-failure":
        _, refs = await driven.run(
            "hold", "block the second hour", [_slot(court, day, hour + 1, ref(1))]
        )
        await driven.run(
            "hold", "two slots, second one taken",
            [_slot(court, day, hour, ref(2)), _slot(court, day, hour + 1, ref(3))],
            expect_ok=False,
        )
        async with tenant_session(tenant_id) as session:
            leaked = (
                await session.execute(
                    select(Booking.reference).where(Booking.external_ref == ref(2))
                )
            ).scalars().all()
        caller.note(
            "verify: nothing partially created",
            {"bookings_for_the_free_slot": list(leaked)},
            "the free half of the failed request must NOT have been booked",
            not leaked,
        )
        await driven.run("cancel", "cancel (cleanup)", refs)

    elif name == "idempotency":
        _, first = await driven.run("hold", "hold the slot", [_slot(court, day, hour, ref())])
        _, again = await driven.run(
            "hold", "identical retry", [_slot(court, day, hour, ref())]
        )
        caller.note(
            "verify: retry returned the same booking",
            {"first": first, "retry": again},
            "identical references — one booking, not two",
            bool(first) and first == again,
        )
        refs = first
        await driven.run("cancel", "cancel (cleanup)", refs)

    elif name in ("hold-expiry", "confirm-expired"):
        _, refs = await driven.run(
            "hold", "hold the slot", [_slot(court, day, hour, ref(1), "Abandoned Checkout")]
        )
        await _expire_holds(tenant_id, refs)
        caller.note(
            f"age the hold past its {int(HOLD_TTL.total_seconds() // 60)}min TTL",
            {"references": refs},
            "the hold should stop blocking the court",
            bool(refs),
        )

        if name == "hold-expiry":
            _, resold = await driven.run(
                "hold", "someone else takes the freed slot",
                [_slot(court, day, hour, ref(2), "New Customer")],
            )
            await driven.run("cancel", "cancel (cleanup)", resold)
        else:
            # The case that matters: confirming now would put two customers on one
            # court. (A lapsed hold whose slot is still free confirms happily — the
            # customer paid, and our timer is not their problem.)
            _, resold = await driven.run(
                "hold", "the counter takes the slot",
                [_slot(court, day, hour, ref(2), "Someone Else")],
            )
            await driven.run("confirm", "confirm — the slot is gone", refs, expect_ok=False)
            await driven.run("cancel", "cancel (cleanup)", resold)

    elif name == "direct-create":
        _, refs = await driven.run(
            "create", "create confirmed booking",
            [_slot(court, day, hour, ref(), "Direct Customer")],
        )
        await driven.run("map_ids", "map their booking id", refs, f"EXT-{tag}")
        await driven.run("cancel", "cancel", refs)

    elif name == "cancel-frees-slot":
        _, refs = await driven.run("create", "create booking", [_slot(court, day, hour, ref(1))])
        await driven.run(
            "create", "same slot again, must fail",
            [_slot(court, day, hour, ref(2), "Blocked Customer")], expect_ok=False,
        )
        await driven.run("cancel", "cancel it", refs)
        _, resold = await driven.run(
            "create", "slot is bookable again",
            [_slot(court, day, hour, ref(3), "Later Customer")],
        )
        await driven.run("cancel", "cancel (cleanup)", resold)

    steps = caller.steps[before:]
    return ScenarioResult(
        scenario=name,
        description=SCENARIOS[name],
        passed=all(s.ok for s in steps),
        steps=steps,
        references=refs,
    )


async def _authenticate(tenant: TenantCtx, api_key: str) -> IntegrationPartner:
    """The same check `deps.get_current_partner` makes, minus the throttled
    `last_used_at` write — that write is what deadlocked the nested calls, and a
    sandbox run is not integration traffic worth recording as "last used"."""
    parts = split_api_key(api_key or "")
    if parts is None:
        raise AuthenticationError("Missing or malformed X-API-Key.")

    async with tenant_session(tenant.id) as session:
        partner = (
            await session.execute(
                select(IntegrationPartner).where(IntegrationPartner.key_prefix == parts[0])
            )
        ).scalar_one_or_none()
        if partner is None or not partner.is_active:
            raise AuthenticationError("Invalid or revoked API key.")
        if partner.key_hash != hash_api_key(api_key):
            raise AuthenticationError("Invalid or revoked API key.")
        session.expunge(partner)
        return partner


@router.get(
    "/scenarios",
    summary="Sandbox: what can be simulated",
    description="Names accepted by `POST /gateway/sandbox/run`. Dev and staging only.",
)
async def list_scenarios() -> dict[str, str]:
    return SCENARIOS


@router.post(
    "/run",
    response_model=SandboxRun,
    summary="Sandbox: drive the gateway as if we were a partner",
    description=(
        "Runs the consistency scenarios end to end against the live endpoints, over "
        "real HTTP, and returns every request, every response, and whether it was "
        "what the scenario expected.\n\n"
        "The scenarios are dialect-independent — the same eight run against **any** "
        "dialect, because the guarantees belong to the gateway rather than to a "
        "partner's adapter. `dialect` defaults to whatever the API key was issued "
        "for.\n\n"
        "**This writes to the database, then cleans up after itself.** Bookings are "
        "created on the academy the key belongs to and *deleted* again on the way "
        "out, so a run leaves the row counts and the booking reference counter "
        "exactly as it found them. `purged` in the response says what was removed.\n\n"
        "Pass `keep=true` to leave them behind for inspection — the transcript "
        "returns every request and response either way, so diagnosing a failure "
        "rarely needs it.\n\n"
        "Still a dev tool: the routes are not registered when "
        "`ENVIRONMENT=production`."
    ),
)
async def run(
    request: Request,
    tenant: TenantCtx,
    dialect: Annotated[str | None, Query(description="Defaults to the key's own dialect")] = None,
    scenarios: Annotated[list[str] | None, Query(description="Defaults to all")] = None,
    days_ahead: Annotated[int, Query(ge=1, le=365)] = 60,
    court_id: Annotated[str | None, Query(description="Defaults to the first bookable court")] = None,
    keep: Annotated[bool, Query(description="Leave the bookings behind for inspection")] = False,
) -> SandboxRun:
    key = request.headers.get(API_KEY_HEADER, "")
    partner = await _authenticate(tenant, key)

    slug = dialect or partner.dialect
    spec = DIALECTS.get(slug)
    if spec is None or spec.driver is None:
        raise NotFoundError(
            f"No sandbox driver for dialect {slug!r}. Known: {sorted(DIALECTS)}."
        )

    names = [n for n in (scenarios or list(SCENARIOS)) if n in SCENARIOS]

    async with tenant_session(tenant.id) as session:
        if court_id:
            court = await session.get(Court, uuid.UUID(court_id))
        else:
            court = (
                await session.execute(select(Court).where(Court.is_bookable.is_(True)).limit(1))
            ).scalar_one_or_none()
        court_uuid = str(court.id) if court else ""

    if not court_uuid:
        return SandboxRun(
            tenant=tenant.slug, partner=partner.name, dialect=slug, court_id="",
            passed=False, results=[],
        )

    results: list[ScenarioResult] = []
    async with Caller(str(request.base_url).rstrip("/"), key, tenant.slug) as caller:
        driven = Driven(spec.driver(caller), caller)

        # A day per scenario, not an hour. Eight scenarios needing two consecutive
        # free hours each is sixteen, which does not fit in one trading day — and
        # sharing a day means one scenario's leftover row can fail the next. Dates
        # are free; contention is not.
        for index, name in enumerate(names):
            day = (
                datetime.now(UTC) + timedelta(days=days_ahead + index)
            ).date().isoformat()

            free = await _free_hours(driven, caller, day, court_uuid)
            if not free:
                results.append(
                    ScenarioResult(
                        scenario=name, description=SCENARIOS[name], passed=False,
                        steps=[
                            Step(
                                step="pick free slots", status=200,
                                response={"date": day, "free_hours": []},
                                expected="two consecutive free hours on this court",
                                ok=False,
                            )
                        ],
                    )
                )
                continue

            results.append(
                await _run_scenario(name, driven, caller, tenant.id, court_uuid, day, free[0])
            )

    # Whether or not the scenarios passed. A failed run is *more* likely to have left
    # a booking live — that is exactly how two courts ended up blocked by the
    # confirm-expired bug — and `keep=true` is there for when the rows matter.
    purged = (
        {"bookings": 0, "events": 0}
        if keep
        else await _purge(tenant.id, partner.id, caller.created)
    )

    return SandboxRun(
        tenant=tenant.slug,
        partner=partner.name,
        dialect=slug,
        court_id=court_uuid,
        passed=all(r.passed for r in results),
        results=results,
        purged=purged,
    )


async def _free_hours(driven: Driven, caller: Caller, day: str, court_id: str) -> list[int]:
    """Whole free hours on this court, each with its successor also free.

    From a real availability read, not from arithmetic. An earlier version computed
    `6 + index * 3`, which walked past midnight and asked for 27:00 — and, worse,
    happily chose hours that already had bookings on them.

    Pairs, because `atomic-failure` books hour+1 to create the conflict it needs. A
    scenario handed an hour whose neighbour is busy would fail for a reason that has
    nothing to do with what it is testing.
    """
    ok, courts = await driven.run("availability", "setup: fetch availability", day)
    if not ok:
        return []

    court = next((c for c in courts if c["courtId"] == court_id), None)
    if court is None:
        return []

    free = {
        int(s["startTime"][:2])
        for s in court["slots"]
        if s["available"] and s["startTime"].endswith("00:00")
    }
    return sorted(h for h in free if h + 1 in free and h + 1 <= 22)


def register(api: APIRouter) -> None:
    """Mount the sandbox, unless this is production.

    Not registered rather than registered-and-guarded: a route that exists is a route
    someone can reach through a misconfigured guard, and this one writes bookings.
    """
    if settings.environment != "production":
        api.include_router(router)
