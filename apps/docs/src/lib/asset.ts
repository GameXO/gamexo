/**
 * The URL of an image on the asset CDN — the same R2 bucket the dashboard, POS and
 * website use (see /assets/README.md). Nothing under /assets is bundled.
 *
 * In `next dev`, /assets is linked into public/cdn by the dev script, so it is
 * served locally at /cdn. A production build must be given the CDN's address.
 */
const BASE = (process.env.NEXT_PUBLIC_ASSET_BASE_URL ?? '/cdn').replace(/\/$/, '')

export const asset = (path: string) => `${BASE}/${path}`
