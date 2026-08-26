#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Builds both frontends and assembles them into deploy/dist for a single
# static-asset Worker: the dashboard at /, the POS at /pos/.
#
# Run via `pnpm deploy:build`, or `pnpm deploy` to build and ship in one step.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Vite inlines these at BUILD time — they are baked into the bundle, so changing
# any of them means rebuilding and redeploying, not editing a setting somewhere.
# None are secrets: they ship to every browser that loads the app either way.
# Overridable from the environment so a different backend can be targeted without
# editing this file: VITE_API_BASE_URL=... pnpm deploy:build
API_BASE_URL="${VITE_API_BASE_URL:-https://gamexo-i6mt.onrender.com}"
TENANT_SLUG="${VITE_TENANT_SLUG:-xcourt}"
UPI_ID="${VITE_UPI_ID:-xcourtsports@upi}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/deploy/dist"

echo "==> API base URL: $API_BASE_URL"
echo "==> tenant slug:  $TENANT_SLUG"

# Stale output would otherwise survive as orphaned files in the asset upload —
# a renamed page leaves its old bundle behind and Wrangler happily ships both.
rm -rf "$OUT"

# `pnpm --filter` runs each package's own build script, deliberately bypassing
# `turbo run build`. Turbo's cache key does not provably include these VITE_*
# values, and a cache hit carrying a bundle built against localhost:8000 would
# deploy a dashboard that cannot reach the API — silently, with no build error.
# NOTE — the dashboard lives in apps/dashboard/ but its package is still named
# `@gamexo/web`. That mismatch is why this script failed silently for a while: the
# filter resolved fine and the build succeeded, then the copy below looked for
# apps/web/dist and found nothing. Keep the two in step, or rename the package.
echo "==> building @gamexo/dashboard"
VITE_API_BASE_URL="$API_BASE_URL" \
VITE_TENANT_SLUG="$TENANT_SLUG" \
  pnpm --filter @gamexo/dashboard build

echo "==> building @gamexo/pos"
VITE_API_BASE_URL="$API_BASE_URL" \
VITE_TENANT_SLUG="$TENANT_SLUG" \
VITE_UPI_ID="$UPI_ID" \
  pnpm --filter @gamexo/pos build

  echo "==> building @gamexo/website"
VITE_API_BASE_URL="$API_BASE_URL" \
VITE_TENANT_SLUG="$TENANT_SLUG" \
VITE_UPI_ID="$UPI_ID" \
  pnpm --filter @gamexo/website build

# The dashboard owns the root; the POS nests under /pos/, matching the `base`
# already set in apps/pos/vite.config.ts. Copying with `/.` copies directory
# CONTENTS, so dist/index.html lands at the root rather than at dist/dist/.
echo "==> assembling $OUT"
mkdir -p "$OUT/pos"
cp -R "$ROOT/apps/dashboard/dist/." "$OUT/"
cp -R "$ROOT/apps/pos/dist/." "$OUT/pos/"

# Both builds must actually have landed. `cp` already fails loudly on a missing
# source, but an empty-but-present dist would sail through and ship a blank site.
for page in "$OUT/index.html" "$OUT/pos/index.html"; do
  [ -s "$page" ] || { echo "ERROR: $page missing or empty — nothing was assembled" >&2; exit 1; }
done

echo "==> done: $(find "$OUT" -type f | wc -l | tr -d ' ') files"
