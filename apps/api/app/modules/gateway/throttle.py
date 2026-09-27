"""Rate limiting for partner keys.

The gap this closes: a hold blocks a court for fifteen minutes and costs the caller
one HTTP request. Without a ceiling, a loop can make every court at a venue
unsellable and keep them that way — denial of inventory, and as easily reached by a
retry bug as by anyone meaning harm. A publishable key makes that reachable by
whoever reads it out of a browser, which is the point at which "nobody has abused it
yet" stops being a plan.

── Why a fixed window, and why in-process ─────────────────────────────────────
Two honest limitations, both accepted deliberately.

A fixed window lets a caller spend a full budget at the end of one window and again
at the start of the next — a burst of up to 2x the limit across the boundary. A
sliding window or a token bucket would smooth that. It does not matter here: the
limits are set to bound sustained abuse, not to meter a paid API to the request.

The counters live in this process, so N workers allow N times the limit. A shared
counter means Redis, which this deployment does not run, and adding a datastore to
the request path of every partner call is a worse trade than a limit that is
approximate at the ceiling. When a second worker appears, the number to change is
here rather than the design.

Both are stated so the next person reads a decision rather than an oversight.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from fastapi import status

from app.core.errors import AppError


class RateLimitedError(AppError):
    """429. Its own class so the envelope carries a code a client can branch on."""

    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "rate_limited"


@dataclass(frozen=True, slots=True)
class Limit:
    """`allowance` requests per `window` seconds."""

    allowance: int
    window: float


#: Per key, per operation. Holds are tightest because they are the only operation
#: that consumes something scarce — a court, for fifteen minutes — without anyone
#: having paid for it yet.
#:
#: A publishable key is stricter throughout: it is a credential we know to be
#: public, so its budget is what a real venue's traffic needs and no more.
SECRET_LIMITS: dict[str, Limit] = {
    "hold": Limit(60, 60.0),
    "create": Limit(60, 60.0),
    "availability": Limit(600, 60.0),
}
PUBLISHABLE_LIMITS: dict[str, Limit] = {
    "hold": Limit(10, 60.0),
    "create": Limit(10, 60.0),
    "availability": Limit(120, 60.0),
}
#: Anything not named above. Generous — these are reads and reconciliation calls
#: that cost us a query and nobody else anything.
DEFAULT_LIMIT = Limit(300, 60.0)


@dataclass
class _Window:
    started: float
    count: int = 0


#: (key_prefix, operation) -> window
_windows: dict[tuple[str, str], _Window] = {}


def reset() -> None:
    """Drop every counter. For tests, which must not inherit each other's budgets."""
    _windows.clear()


def limit_for(key_kind: str, operation: str) -> Limit:
    table = PUBLISHABLE_LIMITS if key_kind == "publishable" else SECRET_LIMITS
    return table.get(operation, DEFAULT_LIMIT)


def check(*, key_prefix: str, key_kind: str, operation: str) -> None:
    """Count this request against its budget, or raise 429.

    Keyed on the *prefix*, not the secret: rotating a key resets its budget, which
    is correct — a rotation is a different credential, and a partner who has just
    been handed one should not inherit a penalty from the one they replaced.
    """
    limit = limit_for(key_kind, operation)
    now = time.monotonic()
    bucket = (key_prefix, operation)

    window = _windows.get(bucket)
    if window is None or now - window.started >= limit.window:
        _windows[bucket] = _Window(started=now, count=1)
        return

    window.count += 1
    if window.count > limit.allowance:
        retry_after = max(1, int(limit.window - (now - window.started)))
        raise RateLimitedError(
            f"Too many {operation} requests. This key allows {limit.allowance} "
            f"every {int(limit.window)} seconds. Retry in {retry_after}s.",
            details={
                "operation": operation,
                "allowance": limit.allowance,
                "window_seconds": int(limit.window),
                "retry_after_seconds": retry_after,
            },
        )
