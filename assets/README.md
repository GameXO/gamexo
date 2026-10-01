# Assets

Every image and icon the dashboard, POS, website and docs show. Nothing here is
bundled into an app: it is uploaded to a Cloudflare R2 bucket and served from that
bucket's public domain (the asset CDN). Apps build URLs with `asset('<path>')`
(`src/lib/asset.ts`), e.g. `asset('sports/golf.jpg')`.

| Folder | What |
| --- | --- |
| `sports/` | Sport photos, named by the sport's slug (`apps/api/app/modules/booking/catalogue.py`). 720×480 JPEG. A sport with no file shows its icon. |
| `brand/` | Logos, shared by every app |
| `dashboard/`, `pos/`, `website/`, `docs/` | Images and icons used by one app |

## Adding or replacing an image

1. Put the file here (kebab-case name; sport photos as `sports/<slug>.jpg`).
2. `pnpm assets:sync sports/<slug>.jpg`, or `pnpm assets:sync` for everything.
3. A new sport photo needs no deploy. A new icon needs the code that uses it, as usual.

Replacing a file keeps its URL. Browsers recheck hourly and Cloudflare's edge caches
for a day, so purge the URL (Cloudflare dashboard → Caching → Purge Cache) to make a
replacement show immediately.

## Local development

Nothing needs uploading. Each app's dev server serves this folder at `/cdn`, and
`asset()` points there when no CDN is configured.

## Production builds

The CDN is `https://cdn.turfleo.com`. The deploy commands use it by default; the
address is set in `deploy/build.sh`, `deploy/build-website.sh` and the root
`docs:build` script. Override it for one build with the environment variable:

```bash
VITE_ASSET_BASE_URL=https://other.example.com pnpm deploy:cf        # dashboard + POS
VITE_ASSET_BASE_URL=https://other.example.com pnpm website:deploy
NEXT_PUBLIC_ASSET_BASE_URL=https://other.example.com pnpm docs:deploy
```

Building an app directly (`pnpm build` inside it) has no default and refuses to run
without the variable, so a stray local build can never point at the wrong place.

## One-time setup

1. Cloudflare dashboard → **R2** → **Create bucket** → `gamexo-assets`
   (or set `ASSETS_BUCKET` when syncing).
2. Bucket → **Settings** → **Custom Domains** → **Connect Domain**, e.g.
   `cdn.turfleo.com`. The domain's DNS must be on Cloudflare. The `r2.dev` URL works
   for testing but is rate-limited and not meant for production.
3. `pnpm exec wrangler login` if you have not, then `pnpm assets:sync`.
4. Deploy as usual; the build scripts already point at the domain.
