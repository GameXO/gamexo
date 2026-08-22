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

type AuthState = {
  status: 'checking' | 'authenticated' | 'anonymous'
  me: Me | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  signup: (email: string, password: string, fullName: string) => Promise<void>
  refresh: () => Promise<void>
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
  const [status, setStatus] = useState<AuthState['status']>(() =>
    getTokens()?.access_token ? 'authenticated' : 'anonymous',
  )

  const loadMe = useCallback(async () => {
    if (!getTokens()?.access_token) {
      setMe(null)
      setStatus('anonymous')
      return
    }
    try {
      setMe(await api.me())
      setStatus('authenticated')
    } catch (err) {
      // A stored token that no longer works (expired refresh, rotated secret,
      // reseeded database) should land on the login screen, not an error page.
      if (err instanceof ApiError && (err.isUnauthenticated || err.isForbidden)) {
        clearTokens()
        setMe(null)
        setStatus('anonymous')
        return
      }
      throw err
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

  const signup = useCallback(async (email: string, password: string, fullName: string) => {
    setTokens(await api.signup({ email, password, full_name: fullName }))
    await loadMe()
  }, [loadMe])

  return <AuthContext value={{ status, me, login, logout, signup, refresh: loadMe }}>{children}</AuthContext>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
