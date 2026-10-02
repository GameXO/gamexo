#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Builds the public marketing/signup site into apps/website/dist, which is
# exactly what wrangler.website.jsonc points its asset store at — a single app,
# so unlike deploy/build.sh there is no separate assembly step.
#
# Run via `pnpm website:build`, or `pnpm website:deploy` to build and ship.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Vite inlines these at BUILD time, so changing either means rebuilding and
# redeploying, not editing a setting somewhere. Neither is a secret — every
# endpoint this site calls is public, since signup has no login yet by
# definition. Overridable: VITE_API_BASE_URL=... pnpm website:build
#
# DASHBOARD_URL only matters as a fallback for the header's "Sign in" link,
# rendered before any API call — the signup flow's own redirect at the end
# comes from the API's own DASHBOARD_URL setting and wins over this. Still worth
# getting right: left unset, this silently defaults to localhost:5173 and ships
# that link to production, which is exactly what building it via deploy/build.sh
# used to do (that script built this app too, discarded the output, and never
# passed this variable at all).
API_BASE_URL="${VITE_API_BASE_URL:-https://api.turfleo.com}"
DASHBOARD_URL="${VITE_DASHBOARD_URL:-https://dashboard.turfleo.com}"
# The asset CDN — see deploy/build.sh.
ASSET_BASE_URL="${VITE_ASSET_BASE_URL:-https://cdn.turfleo.com}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/apps/website/dist"

echo "==> API base URL: $API_BASE_URL"
echo "==> dashboard URL: $DASHBOARD_URL"
echo "==> asset CDN:     $ASSET_BASE_URL"

# Stale output would otherwise survive as orphaned files in the asset upload —
# a renamed page leaves its old bundle behind and Wrangler happily ships both.
rm -rf "$OUT"

echo "==> building @gamexo/website"
VITE_API_BASE_URL="$API_BASE_URL" \
VITE_DASHBOARD_URL="$DASHBOARD_URL" \
VITE_ASSET_BASE_URL="$ASSET_BASE_URL" \
  pnpm --filter @gamexo/website build

[ -s "$OUT/index.html" ] || { echo "ERROR: $OUT/index.html missing or empty — build failed" >&2; exit 1; }

echo "==> done: $(find "$OUT" -type f | wc -l | tr -d ' ') files"
