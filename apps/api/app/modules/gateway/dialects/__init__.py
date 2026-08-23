"""Every wire format the gateway speaks.

Three third-party platforms sell courts here — Playo, Hudle and District — and each
gets its own module, because each dictates its own contract. `native` is ours, the
fallback for anyone without a spec of their own and what the dispatcher routes to when
a request cannot be attributed.

Adding a partner who accepts our API is **nothing** — point them at `native`.

Adding one who dictates their own spec is one module here plus one line below. No
migration, no change to `main.py`, no change to the core, no change to the URL anyone
already has — and they inherit atomicity, idempotency, holds, expiry, partner scoping
and all eight sandbox consistency scenarios without writing any of it.
"""

from __future__ import annotations

from app.modules.gateway.dialects import district, hudle, native, playo
from app.modules.gateway.dialects.base import Dialect, SandboxDriver

#: Order is the order Manage → Integrations offers them in, so the one that works
#: comes first and the two awaiting a spec sit after it.
DIALECTS: dict[str, Dialect] = {
    d.slug: d
    for d in (playo.DIALECT, hudle.DIALECT, district.DIALECT, native.DIALECT)
}

#: What a partner is given when nobody says otherwise, and what the dispatcher falls
#: back to when a request carries no usable key.
DEFAULT_DIALECT = next(d.slug for d in DIALECTS.values() if d.is_default)

#: The named third-party platforms, in registry order. `native` is not one: it is our
#: own contract, not somebody we integrate with.
PLATFORMS: tuple[str, ...] = tuple(d.slug for d in DIALECTS.values() if d.is_platform)

__all__ = ["DEFAULT_DIALECT", "DIALECTS", "PLATFORMS", "Dialect", "SandboxDriver"]
