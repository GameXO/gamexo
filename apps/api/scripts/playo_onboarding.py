"""Print what Playo needs to configure one venue.

    .venv/bin/python scripts/playo_onboarding.py <tenant-slug>
    .venv/bin/python scripts/playo_onboarding.py <tenant-slug> --base-url https://api.example.com

Playo's spec requires venue, sport and court ids that "match the IDs agreed during
onboarding". Ours are UUIDs that no screen shows, so this prints them, along with
the rest of the per-venue sheet: base URL, which key to use, and the booking rules
Playo's slots must follow.

Read-only — nothing is written. The API key itself is never printed: only its hash
is stored. It is shown once, in Manage → Integrations, when the key is minted or
rotated; send it to Playo separately from this sheet.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Runnable from anywhere, like export_openapi.py.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.db.session import dispose_engine, tenant_session, untenanted_session
from app.models.tenant import Tenant, TenantSettings
from app.modules.booking.models import Court, Sport
from app.modules.gateway.models import IntegrationPartner

#: The production API, as deploy/build.sh builds the dashboard against it.
DEFAULT_BASE_URL = "https://gamexo-i6mt.onrender.com"


async def sheet(slug: str, base_url: str) -> str:
    async with untenanted_session() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.slug == slug))
        ).scalar_one_or_none()
    if tenant is None:
        raise SystemExit(f"No academy with slug {slug!r}.")

    async with tenant_session(tenant.id) as session:
        settings = (await session.execute(select(TenantSettings))).scalar_one()
        partners = (
            await session.execute(
                select(IntegrationPartner).where(IntegrationPartner.dialect == "playo")
            )
        ).scalars().all()
        sports = (await session.execute(select(Sport).order_by(Sport.name))).scalars().all()
        courts = (await session.execute(select(Court).order_by(Court.name))).scalars().all()

    rules = settings.booking_rules or {}
    lines = [
        f"# Playo onboarding — {tenant.name}",
        "",
        f"Base URL:   {base_url.rstrip('/')}/api/v1/gateway",
        "Auth:       X-API-Key header (key sent separately)",
        f"Timezone:   {settings.timezone} — every date and time is venue-local",
        f"Slot size:  {rules.get('min_duration_minutes', 60)} minutes",
        "Currency:   INR, prices GST-inclusive, 2 decimals",
        "",
        "## Integration keys (dialect: playo)",
    ]
    if not partners:
        lines.append("  None yet — create one in Manage → Integrations → Booking platforms.")
    for p in partners:
        lines.append(
            f"  {p.name}: key {p.key_prefix}…  venue_id "
            f"{p.external_venue_id or '(not set — agree one and save it on the integration)'}"
            f"{'' if p.is_active else '  [REVOKED]'}"
        )

    lines += ["", "## Sports (send as sport_id)"]
    for s in sports:
        lines.append(f"  {s.name:<24} {s.id}")

    lines += ["", "## Courts (send as courtId)"]
    names = {s.id: s.name for s in sports}
    for c in courts:
        state = "" if c.is_bookable else "  [not bookable]"
        lines.append(f"  {c.name:<24} {names.get(c.sport_id, '?'):<16} {c.id}{state}")

    return "\n".join(lines)


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("tenant_slug")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    args = parser.parse_args()
    try:
        print(await sheet(args.tenant_slug, args.base_url))
    finally:
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
