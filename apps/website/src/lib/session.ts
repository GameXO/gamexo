/**
 * Where the in-progress signup lives between page loads.
 *
 * The intent token is this site's entire notion of "who is this" — there is no
 * login yet, so it is what lets a closed tab reopen onto step 3 instead of an empty
 * form. Kept in localStorage rather than sessionStorage for exactly that reason: a
 * signup that survives the tab is the point.
 *
 * It is a bearer capability, so it is cleared the moment it has been spent — once
 * the academy exists, holding this token should not be a way back into it.
 */

const KEY = 'gamexo.signup.token'

export function getSignupToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    // Safari in private mode, or a browser with storage blocked. The wizard still
    // works front to back; it just cannot be resumed after a reload.
    return null
  }
}

export function setSignupToken(token: string) {
  try {
    localStorage.setItem(KEY, token)
  } catch {
    /* storage blocked — see above */
  }
}

export function clearSignupToken() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
