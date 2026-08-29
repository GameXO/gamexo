/**
 * Which of the counter's four services this academy actually offers.
 *
 * Saves on toggle rather than behind a Save button. Four independent booleans have
 * no consistent intermediate state to protect — there is no "half-applied" set of
 * switches — so a Save button would only add a step and a way to lose a change by
 * navigating away. Each row shows its own progress and rolls back on failure.
 *
 * The optimistic update is what makes a switch feel like a switch: the round trip to
 * a database on another continent is long enough that a toggle waiting for it reads
 * as broken. See the rollback in `toggle` for the honest half of that bargain.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import { POS_SERVICES, isEnabled, type PosServiceKey } from './services'

export function ServicesPicker() {
  const [services, setServices] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PosServiceKey | null>(null)

  const load = useCallback(async () => {
    try {
      const settings = await api.getSettings()
      setServices(settings.enabled_services as Record<string, unknown>)
      setError(null)
    } catch {
      setError('Could not load your services.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(key: PosServiceKey, next: boolean) {
    if (!services) return
    const previous = services
    setServices({ ...services, [key]: next })
    setPending(key)
    setError(null)
    try {
      const saved = await api.updateSettings({ enabled_services: { [key]: next } })
      // Take the server's version rather than keeping the guess: it is the merged
      // result, and it is what the counter will actually read.
      setServices(saved.enabled_services as Record<string, unknown>)
    } catch (err) {
      // Put the switch back. A toggle that stays flipped after a failed save is a
      // lie about what the counter is doing.
      setServices(previous)
      setError(
        err instanceof ApiError && err.isForbidden
          ? 'Only an admin can change which services are offered.'
          : 'Could not save that change. Please try again.',
      )
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="rounded-2xl border border-border-card bg-surface p-6">
      <h2 className="font-display text-lg font-semibold text-ink">Counter services</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate">
        What your front desk can do on the POS tablet. Switching one off removes its
        tile from the counter — it does not delete anything, and turning it back on
        restores it.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </p>
      )}

      <div className="mt-5 divide-y divide-border-card border-y border-border-card">
        {services === null
          ? POS_SERVICES.map((service) => (
              <div key={service.key} className="flex items-center gap-4 py-4">
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-28 animate-pulse rounded bg-surface-muted" />
                  <div className="mt-2 h-3 w-64 animate-pulse rounded bg-surface-muted" />
                </div>
              </div>
            ))
          : POS_SERVICES.map((service) => {
              const on = isEnabled(services, service.key)
              const busy = pending === service.key
              return (
                <div key={service.key} className="flex items-center gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium text-ink">{service.label}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-slate">
                      {service.blurb}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={service.label}
                    disabled={busy}
                    onClick={() => void toggle(service.key, !on)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
                      on ? 'bg-lime-ink' : 'bg-border-soft'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${
                        on ? 'left-[22px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>
              )
            })}
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-muted">
        The tablet picks this up when it next loads. A counter already open on a
        removed tile finishes what it is doing.
      </p>
    </section>
  )
}
