/**
 * Arriving from the marketing site already paid for.
 *
 * The website ends a signup by sending the browser to `/?handoff=<token>`. That
 * token is single-use and short-lived; this exchanges it for a real token pair
 * before the app decides whether anyone is signed in, so a freshly-paid owner
 * never sees the login screen they have no password for yet.
 *
 * Deliberately not a React effect. It has to complete *before* AuthProvider reads
 * storage — an effect would run after the first render, the app would have already
 * decided "anonymous", and the owner would watch a login form flash past.
 */
import { setTokens, type TokenPair } from './../api/auth'
import { BASE_URL, TENANT } from './../api/client'

const PARAM = 'handoff'

/**
 * Is this page load an arrival from checkout?
 *
 * Read synchronously, during AuthProvider's initial state, so the app starts in
 * 'checking' rather than 'anonymous'. Without it the login screen renders for the
 * one frame before the exchange resolves — to the one person who has just paid and
 * has no password to type into it.
 */
export function hasHandoff(): boolean {
  return new URL(window.location.href).searchParams.has(PARAM)
}

/**
 * Take the token out of the URL immediately, whether or not it works.
 *
 * `replaceState` rather than leaving it: the token is spent server-side on first
 * use, but a URL sitting in the address bar gets copied into a chat window, and a
 * reload that re-posts a burnt token would show a scary error over a working app.
 */
function claimFromUrl(): string | null {
  const url = new URL(window.location.href)
  const token = url.searchParams.get(PARAM)
  if (!token) return null

  url.searchParams.delete(PARAM)
  window.history.replaceState({}, '', url.toString())
  return token
}

/**
 * Exchange a handoff token for a session, if the URL carries one.
 *
 * Resolves to true when it signed someone in. A failure is not surfaced: the token
 * has expired, been used, or never existed, and the honest next step is the login
 * screen — which is exactly where returning false lands them.
 */
export async function redeemHandoffFromUrl(): Promise<boolean> {
  const token = claimFromUrl()
  if (!token) return false

  try {
    const res = await fetch(`${BASE_URL}/api/v1/auth/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) return false

    setTokens((await res.json()) as TokenPair)
    return true
  } catch {
    return false
  }
}
