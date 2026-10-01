/**
 * The URL of an image or icon on the asset CDN.
 *
 * Nothing under /assets is bundled: every image and icon is served from the R2
 * bucket behind `VITE_ASSET_BASE_URL` (see /assets/README.md), so all three apps
 * share one copy and a picture can change without a redeploy. In dev the files are
 * served straight from the repo's /assets folder at /cdn, so nothing has to be
 * uploaded to see a change locally.
 *
 *   asset('sports/golf.jpg') → https://cdn.example.com/sports/golf.jpg
 */
const BASE = (import.meta.env.VITE_ASSET_BASE_URL ?? '/cdn').replace(/\/$/, '')

export const asset = (path: string) => `${BASE}/${path}`
