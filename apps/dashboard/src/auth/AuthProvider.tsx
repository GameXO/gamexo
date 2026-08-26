/**
 * Who is signed in, for the whole app.
 *
 * Deliberately not a TanStack Query hook: this decides whether the app renders
 * at all, so it needs a plain three-state answer (checking / signed out / signed
 * in) without a cache in the way.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from '../api/client'
import { clearTokens, getTokens, setTokens, subscribeToTokens, type Me } from '../api/auth'
import { hasHandoff, redeemHandoffFromUrl } from './handoff'
import { clearOpsRoute } from './opsRoute'
import {
  clearPlatformState,
  getImpersonatedTenant,
  isPlatformSession,
  setImpersonatedTenant,
  setPlatformSession,
  subscribeToImpersonation,
} from './platform'

type AuthState = {
  status: 'checking' | 'authenticated' | 'anonymous'
  me: Me | null
  /** The signed-in operator, when this is a `ops@gamexo` session. Null otherwise. */
  operator: { username: string; full_name: string } | null
  /**
   * True for a platform session that has not yet stepped into an academy. The
   * shell renders only the all-academies list in that state — there is no tenant
   * to draw a dashboard for, and every tenant-scoped request would 400.
   */
  needsTenantChoice: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  // Holding a token is treated as signed in until proven otherwise, so the shell
  // renders immediately and its screens start fetching in parallel with /auth/me.
  // Blocking on it meant a slow `me` froze the entire app behind a spinner — and
  // `me` is the request most likely to be slow, because it is the one that wakes
  // a scale-to-zero database. A token that turns out to be invalid drops to the
  // login screen a moment later, which is the rare case, not the common one.
  // Three starting states, not two.
  //
  // A stored token means 'authenticated' immediately, for the reason above. A
  // `?handoff=` in the URL means someone has just paid on the marketing site and is
  // arriving with a one-time token instead of a password — and there, 'checking' is
  // the only correct answer. 'anonymous' would flash a login screen at the one
  // person who has no password to type into it; 'authenticated' would mount the
  // whole shell and let every screen fire its queries before the exchange has
  // produced a token, which is a burst of 401s and a dashboard of empty states.
  const [status, setStatus] = useState<AuthState['status']>(() => {
    if (getTokens()?.access_token) return 'authenticated'
    return hasHandoff() ? 'checking' : 'anonymous'
  })

  const [operator, setOperator] = useState<AuthState['operator']>(null)
  const [impersonating, setImpersonating] = useState<string | null>(getImpersonatedTenant)

  const loadMe = useCallback(async () => {
    if (!getTokens()?.access_token) {
      setMe(null)
      setOperator(null)
      setStatus('anonymous')
      return
    }
    try {
      if (isPlatformSession()) {
        // `/platform/me` needs no tenant, which is exactly why it is used here:
        // an operator who has not yet stepped into an academy has none to resolve,
        // and `/auth/me` would 400 trying.
        const admin = await api.platformMe()
        setOperator({ username: admin.username, full_name: admin.full_name })
        // Once impersonating, /auth/me works again and returns the academy
        // alongside the operator — which is what the shell renders from.
        setMe(getImpersonatedTenant() ? await api.me() : null)
      } else {
        setOperator(null)
        setMe(await api.me())
      }
      setStatus('authenticated')
    } catch {
      // Any failure to establish who this is means we do not know who this is, and
      // the only honest screen for that is the login form.
      //
      // This used to rethrow anything that was not a 401 or 403, which left the app
      // in the worst possible state: `status` had already been set to
      // 'authenticated' from the mere presence of a stored token, the rejection went
      // unhandled, and the shell rendered a whole dashboard around an identity of
      // `null` — signed in as nobody, every query failing, no way to sign in again.
      //
      // The case that made it common rather than theoretical: on a shared origin an
      // expired token contributes no tenant, so resolution failed before
      // authentication was ever reached and `/auth/me` answered *400*, not 401. That
      // is now a 401 server-side (tenancy/deps.py::get_tenant_context), but the
      // catch stays broad on purpose — whatever else goes wrong here, dropping to
      // the login screen is recoverable and a dead shell is not.
      clearTokens()
      clearPlatformState()
      setMe(null)
      setOperator(null)
      setStatus('anonymous')
    }
  }, [])

  useEffect(() => {
    // The handoff has to be redeemed before `me` is fetched, or the first request
    // goes out with no token, 401s, and drops a paying customer on a login screen.
    void redeemHandoffFromUrl().then(loadMe)
    // The client clears tokens when a refresh fails mid-session; that must drop
    // us back to the login screen rather than leave a signed-in shell with no token.
    const unsubTokens = subscribeToTokens(() => {
      if (!getTokens()) {
        setMe(null)
        setOperator(null)
        setStatus('anonymous')
      }
    })
    // Stepping into or out of an academy changes which tenant every request names,
    // so the whole shell has to be rebuilt around the new one.
    const unsubImpersonation = subscribeToImpersonation(() => {
      setImpersonating(getImpersonatedTenant())
      void loadMe()
    })
    return () => {
      unsubTokens()
      unsubImpersonation()
    }
  }, [loadMe])

  const login = useCallback(
    async (username: string, password: string) => {
      try {
        setTokens(await api.login(username, password))
        setPlatformSession(false)
      } catch (err) {
        // Not a member of any academy? It may be the platform operator, whose
        // account lives in a different table behind a different endpoint. Only a
        // rejected credential is retried this way — a network failure is not a
        // reason to try a second login with the same password.
        if (!(err instanceof ApiError && err.isUnauthenticated)) throw err
        setTokens(await api.platformLogin(username, password))
        setPlatformSession(true)
        setImpersonatedTenant(null)
        // The `#/ops` marker has done its job. Leaving it means a refresh re-renders
        // a sign-in screen this operator is already past.
        clearOpsRoute()
      }
      await loadMe()
    },
    [loadMe],
  )

  const logout = useCallback(() => {
    clearTokens()
    clearPlatformState()
    setMe(null)
    setOperator(null)
    setStatus('anonymous')
  }, [])

  return (
    <AuthContext
      value={{
        status,
        me,
        operator,
        needsTenantChoice: operator !== null && !impersonating,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
