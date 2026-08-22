import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { TENANT } from '../api/client'
import { useAuth } from './AuthProvider'
import brandLogo from '../assets/figma/brand-logo.svg'

export default function LoginPage({ onCreateAccount }: { onCreateAccount?: () => void }) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(email.trim(), password)
    } catch (err) {
      // The API deliberately returns the same message for unknown-email and
      // wrong-password, so there is nothing more specific to show here.
      setError(
        err instanceof ApiError ? err.message : 'Could not reach the server. Is the API running?',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-7 shadow-xl">
        <img src={brandLogo} alt="" className="h-8" />

        <h1 className="mt-6 font-display text-xl font-semibold text-ink">Sign in</h1>
        <p className="mt-1 text-sm text-slate">
          Academy <span className="font-medium text-ink">{TENANT}</span>
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Email</span>
            <input
              type="email"
              required
              autoFocus
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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

        {onCreateAccount && (
          <button
            type="button"
            onClick={onCreateAccount}
            className="mt-5 w-full text-center text-sm font-medium text-ink underline"
          >
            Create an account
          </button>
        )}
      </div>
    </div>
  )
}
