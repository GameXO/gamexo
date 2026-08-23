"""What a dialect is.

A dialect is a *wire format*, not a feature set. Every one of them reaches the same
`gateway/service.py` and therefore has the same guarantees — atomicity, idempotency,
holds, expiry, partner scoping. What differs is only how a partner spells a request
and what shape they expect back.

That split is the whole design. Adding a partner who will use our API is zero code.
Adding one who dictates their own spec is one file here, and they inherit every
guarantee and every sandbox scenario without writing either.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from fastapi import APIRouter


class SandboxDriver(Protocol):
    """How the sandbox speaks one dialect.

    The consistency scenarios (`gateway/sandbox.py`) are written once, against these
    five operations. A dialect that implements them gets all of them — double
    booking, atomicity, idempotency, hold expiry — without restating any of it.

    Each method issues that dialect's own HTTP calls against a running server and
    normalises the reply into `(ok, refs, message)`:

      ok       did the call succeed *in that dialect's terms*? Ours answers a taken
               slot with 409; Playo's answers it with 200 + requestStatus 0. Both
               mean "no", and the scenarios only care about the "no".
      refs     booking references the call returned, for the next step to use.
      message  human text, for the transcript when a step fails.
    """

    async def availability(self, day: str) -> tuple[bool, list[dict[str, Any]], str]: ...

    async def hold(self, slots: list[dict[str, Any]]) -> tuple[bool, list[str], str]: ...

    async def create(self, slots: list[dict[str, Any]]) -> tuple[bool, list[str], str]: ...

    async def confirm(self, refs: list[str]) -> tuple[bool, list[str], str]: ...

    async def cancel(self, refs: list[str]) -> tuple[bool, list[str], str]: ...

    async def map_ids(self, refs: list[str], external: str) -> tuple[bool, list[str], str]: ...


#: Handler functions in a dialect module must be prefixed with its slug —
#: `playo_availability`, not `availability`. `main.unique_operation_id` builds the
#: generated TypeScript client's function names from the route's tag and handler
#: name, and every dialect shares the `gateway` tag, so two dialects with an
#: `availability` handler silently collide into one operation id.


@dataclass(frozen=True)
class Dialect:
    #: URL segment and the value stored on `IntegrationPartner.dialect`.
    slug: str

    #: Shown in Manage → Integrations when choosing what a new partner speaks.
    label: str

    #: One line explaining who this is for, on the same screen.
    summary: str

    router: APIRouter

    #: None means the sandbox cannot exercise this dialect. Every dialect we ship
    #: has one; the field is optional so a hand-rolled adapter for a single customer
    #: is not blocked on writing a driver first.
    driver: type[SandboxDriver] | None = None

    #: True for the dialect a partner should be pointed at when they have no
    #: opinion. Exactly one dialect sets this.
    is_default: bool = False
