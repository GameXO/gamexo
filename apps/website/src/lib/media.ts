/**
 * Resolving an uploaded image's URL.
 *
 * Uploads come back as `/media/…` when the API stores to local disk, and as an
 * absolute R2 URL when it does not. The relative form is deliberate — see
 * `app/core/storage.py::_store_local` — because the API cannot know which hostname
 * a frontend reaches it on. So the frontend resolves it, against the API's origin
 * rather than its own, which in development is a different port entirely.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')

export function resolveMedia(url: string): string {
  return /^https?:\/\//.test(url) ? url : `${API_BASE}${url}`
}
