/**
 * Replacing the generated password an owner was emailed.
 *
 * Two things here are load-bearing rather than decorative:
 *
 *   * **The new tokens are stored before anything else happens.** Changing the
 *     password bumps `token_version` server-side, which invalidates every token
 *     already issued for this account — including the one this very request was
 *     made with. The response carries the replacement pair. Miss it and the app
 *     signs itself out one request after succeeding.
 *   * **The form says other devices will be signed out**, before the click rather
 *     than after. That is the intended effect, not a side effect, and someone
 *     running a counter tablet on the same admin login deserves to know.
 */
import { useState, type FormEvent } from 'react'
import { ApiError, api } from '../api/client'
import { setTokens } from '../api/auth'

export function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const tooShort = next.length > 0 && next.length < 8
  const mismatch = confirm.length > 0 && next !== confirm
  const unchanged = next.length > 0 && next === current
  const canSubmit =
    current.length > 0 && next.length >= 8 && next === confirm && !unchanged && !busy

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const tokens = await api.changePassword(current, next)
      // Before any state update that could unmount this component: the old token is
      // already dead server-side, so every request after this point needs the new
      // one. See the note at the top of the file.
      setTokens(tokens)
      setDone(true)
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err) {
      setError(
        err instanceof ApiError
          ? // 401 here means the current password was wrong, not that the session
            // expired — the server deliberately returns the same generic wording as
            // a failed login, so it is reworded for the one context it can mean.
            err.isUnauthenticated
            ? 'That is not your current password.'
            : err.message
          : 'Could not change your password. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-border-card bg-surface p-6">
      <h2 className="font-display text-lg font-semibold text-ink">Password</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate">
        If you're still using the password from your welcome email, change it here.
        Everyone signed in to this account on other devices will be signed out.
      </p>

      {done && (
        <p
          role="status"
          className="mt-4 rounded-lg bg-positive/10 px-4 py-3 text-sm text-positive"
        >
          Password changed. Other devices signed in as you have been signed out.
        </p>
      )}

      <form onSubmit={submit} className="mt-5 space-y-4">
        <Field label="Current password">
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-border-input bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-lime-ink"
          />
        </Field>

        <Field
          label="New password"
          hint={tooShort ? 'At least 8 characters.' : undefined}
          invalid={tooShort || unchanged}
          error={unchanged ? 'This is the password you already have.' : undefined}
        >
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
            className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-lime-ink ${
              tooShort || unchanged ? 'border-negative' : 'border-border-input'
            }`}
          />
        </Field>

        <Field
          label="Confirm new password"
          invalid={mismatch}
          error={mismatch ? "These don't match." : undefined}
        >
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-lime-ink ${
              mismatch ? 'border-negative' : 'border-border-input'
            }`}
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </section>
  )
}

function Field({
  label,
  hint,
  error,
  invalid,
  children,
}: {
  label: string
  hint?: string
  error?: string
  invalid?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {/* aria-live so a message that appears as you type is announced, not just
          drawn — the same rule as the website's Field primitive. */}
      <span aria-live="polite">
        {error ? (
          <span className="mt-1.5 block text-[13px] text-negative">{error}</span>
        ) : hint ? (
          <span className={`mt-1.5 block text-[13px] ${invalid ? 'text-negative' : 'text-muted'}`}>
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  )
}
