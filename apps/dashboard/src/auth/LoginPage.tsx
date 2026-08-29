import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { useAuth } from './AuthProvider'
// `goToOps` is not imported: the signpost that used it is commented out below.
// Re-add it there if the link comes back. The #/ops route itself still works.
import { isOpsRoute, subscribeToOpsRoute } from './opsRoute'
import brandLogo from '../assets/figma/brand-logo.svg'

export default function LoginPage() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Same form, same endpoint fallback — only the words change. An operator arriving
  // at #/ops should not be told to look in a welcome email they never received, and
  // an academy owner should never be shown `ops@gamexo` as an example.
  const [operatorMode, setOperatorMode] = useState(isOpsRoute)
  useEffect(() => subscribeToOpsRoute(() => setOperatorMode(isOpsRoute())), [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(username.trim(), password)
    } catch (err) {
      // The API deliberately returns the same message for an unknown username and
      // a wrong password, so there is nothing more specific to show here.
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

        <h1 className="mt-6 font-display text-xl font-semibold text-ink">
          {operatorMode ? 'gamexo Operations' : 'Sign in'}
        </h1>
        {/* No academy named here any more. The username carries it — `admin@your-turf`
            — and printing a build-time slug was actively misleading on a shared
            origin, where every academy signs in through this same page. */}
        <p className="mt-1 text-sm text-slate">
          {operatorMode
            ? 'Platform operator sign-in. Academy staff should use the main sign-in page.'
            : 'Use the username from your welcome email.'}
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Username</span>
            {/* type="text", deliberately. A username's domain part is the academy
                slug, so `admin@navigo-sports` has no dot in it and type="email"
                would make the browser refuse to submit a perfectly valid login. */}
            <input
              type="text"
              required
              autoFocus
              autoComplete="username"
              spellCheck={false}
              autoCapitalize="none"
              placeholder={operatorMode ? 'ops@gamexo' : 'admin@your-turf'}
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

        {/* Small and at the bottom, deliberately. There is exactly one operator
            account and thousands of academy logins, so this is a signpost for the
            person who already knows it exists — not an invitation. */}
            {/* disable for now */}
        {/* Needs `goToOps` back in the import above to compile. */}
        {/* {!operatorMode && (
          <button
            type="button"
            onClick={goToOps}
            className="mt-5 text-[12px] font-medium text-muted underline underline-offset-4 hover:text-slate"
          >
            Platform operator sign-in
          </button>
        )} */}
      </div>
    </div>
  )
}
