/**
 * Who is signed in, for the whole app.
 *
 * Deliberately not a TanStack Query hook: this decides whether the app renders
 * at all, so it needs a plain three-state answer (checking / signed out / signed
 * in) without a cache in the way.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { clearTokens, getTokens, setTokens, subscribeToTokens, type Me } from '../api/auth'

type AuthState = {
  status: 'checking' | 'authenticated' | 'anonymous'
  me: Me | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [status, setStatus] = useState<AuthState['status']>('checking')

  const loadMe = useCallback(async () => {
    if (!getTokens()?.access_token) {
      setMe(null)
      setStatus('anonymous')
      return
    }
    try {
      setMe(await api.me())
      setStatus('authenticated')
    } catch {
      // Any failure to establish who this is means we do not know who this is, and
      // the only honest screen for that is the login form.
      //
      // This used to rethrow anything that was not a 401 or 403, which on a device
      // that starts in 'checking' meant the counter tablet sat on a spinner
      // permanently — no error, no login form, nothing to tap. The case that made it
      // routine rather than theoretical: on a shared origin an expired token
      // contributes no tenant, so resolution failed before authentication was
      // reached and `/auth/me` answered *400*, not 401. Fixed server-side in
      // tenancy/deps.py::get_tenant_context; the catch stays broad because a staffed
      // counter cannot debug a spinner mid-shift.
      clearTokens()
      setMe(null)
      setStatus('anonymous')
    }
  }, [])

  useEffect(() => {
    void loadMe()
    // The client clears tokens when a refresh fails mid-session; that must drop
    // us back to the login screen rather than leave a signed-in shell with no token.
    return subscribeToTokens(() => {
      if (!getTokens()) {
        setMe(null)
        setStatus('anonymous')
      }
    })
  }, [loadMe])

  const login = useCallback(
    async (email: string, password: string) => {
      setTokens(await api.login(email, password))
      await loadMe()
    },
    [loadMe],
  )

  const logout = useCallback(() => {
    clearTokens()
    setMe(null)
    setStatus('anonymous')
  }, [])

  return <AuthContext value={{ status, me, login, logout }}>{children}</AuthContext>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
