#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Uploads /assets to the R2 bucket the asset CDN serves from. See assets/README.md.
#
#   pnpm assets:sync                          every file
#   pnpm assets:sync sports/golf.jpg          just these (paths relative to assets/)
#
# Uses your `wrangler login` session, the same one `pnpm deploy:cf` uses. Uploads
# overwrite, and nothing is ever deleted from the bucket: removing a file here
# leaves the old object in place, because a deployed build may still point at it.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export BUCKET="${ASSETS_BUCKET:-gamexo-assets}"

# Keys are plain file names, not content hashes, so a replaced image keeps its URL.
# Browsers recheck hourly; Cloudflare's edge holds a copy for a day — purge the URL
# in the dashboard (Caching → Purge Cache) to make a replacement show immediately.
export CACHE_CONTROL="public, max-age=3600, s-maxage=86400"

upload() {
  local key="${1#./}" type
  case "$key" in
    *.svg) type="image/svg+xml" ;;
    *.png) type="image/png" ;;
    *.jpg | *.jpeg) type="image/jpeg" ;;
    *.webp) type="image/webp" ;;
    *) echo "skip (not an image): $key"; return 0 ;;
  esac
  pnpm exec wrangler r2 object put "$BUCKET/$key" --remote \
    --file "$key" --content-type "$type" --cache-control "$CACHE_CONTROL" >/dev/null
  echo "uploaded $key"
}
export -f upload

cd "$ROOT/assets"
echo "==> uploading to r2://$BUCKET"
if [ "$#" -gt 0 ]; then
  printf '%s\0' "$@"
else
  find . -type f ! -name '*.md' -print0
fi | xargs -0 -n1 -P6 bash -c 'upload "$0"'
echo "==> done"
