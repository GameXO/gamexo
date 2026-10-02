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
import { SettingsPanel, SettingsRow } from './SettingsPanel'
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
    <SettingsPanel flush>
      {done && (
        <p role="status" className="mb-4 rounded-lg bg-positive/10 px-4 py-3 text-sm text-positive">
          Password changed. Other devices signed in as you have been signed out.
        </p>
      )}

      <form onSubmit={submit}>
        <SettingsRow label="Current password" description="To confirm it is really you." htmlFor="pw-current">
          <input
            id="pw-current"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
            className={INPUT}
          />
        </SettingsRow>

        <SettingsRow label="New password" description="At least 8 characters." htmlFor="pw-new">
          <input
            id="pw-new"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            required
            className={`${INPUT} ${tooShort || unchanged ? 'border-negative' : ''}`}
          />
          <Message
            error={unchanged ? 'This is the password you already have.' : undefined}
            hint={tooShort ? 'At least 8 characters.' : undefined}
          />
        </SettingsRow>

        <SettingsRow label="Confirm new password" htmlFor="pw-confirm">
          <input
            id="pw-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            className={`${INPUT} ${mismatch ? 'border-negative' : ''}`}
          />
          <Message error={mismatch ? "These don't match." : undefined} />
        </SettingsRow>

        <div className="flex items-center justify-end gap-4 border-t border-dashed border-border-soft py-4">
          {error && (
            <p role="alert" className="mr-auto text-sm text-negative">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-control disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </div>
      </form>
    </SettingsPanel>
  )
}

const INPUT =
  'w-full rounded-lg border border-border-card bg-white px-3.5 py-2.5 text-sm text-ink shadow-control outline-none transition-colors focus:border-lime-ink'

/* aria-live so a message that appears as you type is announced, not just drawn --
   the same rule as the website's Field primitive. */
function Message({ error, hint }: { error?: string; hint?: string }) {
  const text = error ?? hint
  return (
    <span aria-live="polite">
      {text ? <span className="mt-1.5 block text-[12px] text-negative">{text}</span> : null}
    </span>
  )
}
