"""Every wire format the gateway speaks.

Adding a partner who accepts an API is **nothing** — point them at `native`.

Adding a partner who dictates their own spec is one module here plus one line in
`DIALECTS`. No migration, no change to `main.py`, no change to the core, and they
inherit atomicity, idempotency, holds, expiry, partner scoping and all eight sandbox
consistency scenarios without writing any of it.
"""

from __future__ import annotations

from app.modules.gateway.dialects import native, playo
from app.modules.gateway.dialects.base import Dialect, SandboxDriver

DIALECTS: dict[str, Dialect] = {
    d.slug: d for d in (native.DIALECT, playo.DIALECT)
}

#: What a partner is given when nobody says otherwise.
DEFAULT_DIALECT = next(d.slug for d in DIALECTS.values() if d.is_default)

__all__ = ["DEFAULT_DIALECT", "DIALECTS", "Dialect", "SandboxDriver"]
