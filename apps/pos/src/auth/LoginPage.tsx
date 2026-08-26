import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { useAuth } from './AuthProvider'
import brandLogo from '../assets/figma/brand-logo.svg'

export default function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(username.trim(), password)
    } catch (err) {
      // The API deliberately returns the same message for an unknown username and
      // a wrong password, so there is nothing more specific to show here.
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Is the API running?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center-safe overflow-y-auto bg-page px-4 py-6">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-7 shadow-xl">
        <img src={brandLogo} alt="" className="h-8" />

        <h1 className="mt-6 font-display text-xl font-semibold text-ink">Counter sign-in</h1>
        {/* The academy is no longer printed from a build-time slug: the username
            carries it, and one POS build serves every venue. */}
        <p className="mt-1 text-sm text-slate">
          Use the counter login from your welcome email.
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Username</span>
            {/* type="text", not "email": `kiosk@navigo-sports` has no dot after the
                @, and the browser would refuse to submit a valid login. */}
            <input
              type="text"
              required
              autoFocus
              autoComplete="username"
              spellCheck={false}
              autoCapitalize="none"
              placeholder="kiosk@your-turf"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="rounded-lg border border-border-input px-3 py-2.5 text-sm text-ink outline-none focus:border-lime-ink"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-border-input px-3 py-2.5 text-sm text-ink outline-none focus:border-lime-ink"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
