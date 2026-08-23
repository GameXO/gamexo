"""District — placeholder, awaiting their spec.

District sells courts here, so they get a dialect. What they do not have yet is a
published integration contract, and nothing in this file guesses at one: invented
field names would be worse than an empty module, because they would look finished.

`is_ready=False` keeps it out of reach — `create_partner` refuses the slug, so no key
can be issued against an adapter that cannot answer — while still listing it in
Manage → Integrations as a platform we know about.

── When their spec arrives ──────────────────────────────────────────────────────
Everything below is the same shape as `playo.py`, which is the worked example:

1. Their request and response models, in this file. Each platform's wire format is
   its own module precisely so one partner's camelCase quirks cannot leak into
   another's — see the note at the top of `base.py`.
2. Handlers on `router`, at whatever paths they dictate. **Prefix every handler
   function with `district_`** (`district_availability`, not `availability`):
   operation ids are built from the tag and the function name, and every dialect
   shares the `gateway` tag, so a bare name silently collides with Playo's.
3. `DistrictDriver`, implementing the six operations in `base.SandboxDriver` against
   `/gateway/…` — the advertised URL, never `/gateway/district/…`, so the sandbox
   exercises key-based routing the way District will. All eight consistency scenarios
   then run against them without writing any.
4. Flip `is_ready` to True and set `driver=DistrictDriver`.

No migration, no change to `main.py`, no change to the core, and no change to the URL
anyone has already been given.

Nothing here decides anything about bookings. A dialect translates; every write goes
through `gateway/service.py`, which is where atomicity, idempotency, holds, expiry and
partner scoping live.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.modules.gateway.dialects.base import Dialect

#: No routes yet. Mounted regardless — an empty router adds nothing to the schema,
#: and having it here means the adapter is written in one place rather than wired up
#: in three.
router = APIRouter(tags=["gateway"])

DIALECT = Dialect(
    slug="district",
    label="District",
    summary="Their own integration contract. Not built yet — we need District's API "
    "spec before a key can be issued.",
    router=router,
    is_platform=True,
    is_ready=False,
)
