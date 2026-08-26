/**
 * The `ops@gamexo` session, and the academy it is currently looking at.
 *
 * A platform operator is not a member of any academy — see
 * `models/user.py::PlatformAdmin` — so their token names no tenant and `/auth/me`
 * has nothing to resolve. They sign in, see every academy, and pick one; from that
 * point every request carries `X-Impersonate-Tenant` and the dashboard behaves
 * exactly as it does for that academy's own staff, against the same RLS policies.
 *
 * Impersonation is not a policy bypass. The server opens an ordinary tenant-bound
 * session for the academy named here and writes an audit row for the request. What
 * this module holds is only *which* academy — the authority is the platform token.
 */

const SESSION_KEY = 'gamexo.platform'
const IMPERSONATE_KEY = 'gamexo.impersonate'

/** Did this session come from `/platform/login` rather than `/auth/login`? */
export function isPlatformSession(): boolean {
  try {
    return localStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function setPlatformSession(on: boolean) {
  try {
    if (on) localStorage.setItem(SESSION_KEY, '1')
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* storage blocked — the session still works, it just won't survive a reload */
  }
}

/** The academy slug this operator is currently acting inside, if any. */
export function getImpersonatedTenant(): string | null {
  try {
    return localStorage.getItem(IMPERSONATE_KEY)
  } catch {
    return null
  }
}

export function setImpersonatedTenant(slug: string | null) {
  try {
    if (slug) localStorage.setItem(IMPERSONATE_KEY, slug)
    else localStorage.removeItem(IMPERSONATE_KEY)
  } catch {
    /* ignore */
  }
  notify()
}

export function clearPlatformState() {
  setPlatformSession(false)
  setImpersonatedTenant(null)
}

/* Lets the shell re-render when an operator steps into or out of an academy. */
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())

export function subscribeToImpersonation(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
