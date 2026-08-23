import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { useAuth } from './AuthProvider'
import brandLogo from '../assets/figma/brand-logo.svg'

const inputClass =
  'rounded-lg border border-border-input px-3 py-2.5 text-sm text-ink outline-none focus:border-lime-ink'

export default function SignupPage({ onSignIn }: { onSignIn: () => void }) {
  const { signup } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Mirrors the API's own rule (schemas.py::_Password, min_length=8) so the
  // common mistake is caught before a round trip, not instead of one.
  const passwordTooShort = password.length > 0 && password.length < 8
  const mismatch = confirm.length > 0 && confirm !== password
  const canSubmit =
    fullName.trim().length > 1 && email.includes('@') && password.length >= 8 && confirm === password

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signup(email.trim(), password, fullName.trim())
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not reach the server. Is the API running?',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-page px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-7 shadow-xl">
        <img src={brandLogo} alt="" className="h-8" />

        <h1 className="mt-6 font-display text-xl font-semibold text-ink">Create your turf</h1>
        <p className="mt-1 text-sm text-slate">
          Set up bookings, courts and your counter in a few minutes.
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Your name</span>
            <input
              required
              autoFocus
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Email</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Password</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
            <span className={`text-xs ${passwordTooShort ? 'text-negative' : 'text-muted'}`}>
              At least 8 characters.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Confirm password</span>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
            {mismatch && <span className="text-xs text-negative">Passwords don’t match.</span>}
          </label>

          {error && (
            <p role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || !canSubmit}
            className="mt-1 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Creating your turf…' : 'Create account'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate">
          Already have an account?{' '}
          <button type="button" onClick={onSignIn} className="font-medium text-ink underline">
            Sign in
          </button>
        </p>
      </div>
    </div>
  )
}
