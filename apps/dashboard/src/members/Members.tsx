/**
 * Members — every membership this academy has sold, and what to do with each.
 *
 * Reads the API, not localStorage. Pricing is not editable here: plans are
 * defined once in Settings → Membership Plans and only *applied* on this screen.
 * That split is deliberate — a price field beside a customer's name is how one
 * receptionist ends up repricing the whole academy while signing somebody up.
 *
 * Four lifecycle actions, and the two worth knowing:
 *
 *   **Renew** continues from the current expiry while the membership is still
 *   running, so renewing early never costs the member the days they have left.
 *
 *   **Pause** parks the term rather than consuming it. Every paused day is given
 *   back on resume and the expiry moves out to match, which is why a resumed
 *   membership can run past the anniversary of its start — `paused_days_total`
 *   is shown so staff can explain that without having to work it out.
 */
import { useState } from 'react'
import { Loader2, Pause, Play, RotateCw, Search, X } from 'lucide-react'
import {
  DURATION_LABEL,
  sellableDurations,
  useMembershipPlans,
  useMembershipLifecycle,
  useMemberships,
  useRenewMembership,
  type PlanDuration,
  type SubscriptionOut,
} from '../api/hooks'
import NewMembershipWizard from './NewMembershipWizard'

const rupees = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-positive/15 text-positive',
  paused: 'bg-surface-muted text-muted',
  expired: 'bg-negative/15 text-negative',
  cancelled: 'bg-surface-muted text-muted',
}

const FILTERS = ['all', 'active', 'paused', 'expired', 'cancelled'] as const

function whenLabel(row: SubscriptionOut): string {
  if (row.status === 'cancelled') return 'Cancelled'
  if (row.status === 'paused') return 'Paused'
  const days = row.days_left ?? 0
  if (days < 0) return `Expired ${Math.abs(days)}d ago`
  if (days === 0) return 'Expires today'
  return `${days}d left`
}

export default function Members() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const [wizardOpen, setWizardOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renewing, setRenewing] = useState<SubscriptionOut | null>(null)

  const { data, isLoading } = useMemberships(filter, query.trim() || undefined)
  const { data: plans } = useMembershipPlans(true)
  const lifecycle = useMembershipLifecycle()
  const renew = useRenewMembership()

  const rows = data?.items ?? []

  const act = async (row: SubscriptionOut, action: 'pause' | 'resume' | 'cancel') => {
    setError(null)
    setBusyId(row.id)
    try {
      await lifecycle.mutateAsync({ id: row.id, action })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through.')
    } finally {
      setBusyId(null)
    }
  }

  const doRenew = async (row: SubscriptionOut, duration: PlanDuration) => {
    setError(null)
    setBusyId(row.id)
    try {
      await renew.mutateAsync({ id: row.id, duration })
      setRenewing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not renew this membership.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-surface-muted p-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-md px-3.5 py-2 text-sm capitalize transition-colors ${
                filter === f ? 'bg-white text-ink shadow-sm' : 'text-slate'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="flex h-10 items-center justify-center rounded-full px-5 text-sm text-[#fefefe]"
          style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
        >
          New membership
        </button>
      </div>

      <div className="relative max-w-sm">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="w-full rounded-lg border border-border-input bg-white py-2.5 pl-9 pr-3.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none"
          placeholder="Search member or number"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-negative/30 bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      <div className="shrink-0 overflow-hidden rounded-xl border border-border-card bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-card text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">Member</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium">Paid</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const plan = (plans ?? []).find((p) => p.id === row.plan_id)
              const busy = busyId === row.id
              return (
                <tr key={row.id} className="border-b border-border-card last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{row.member_no}</p>
                    {(row.paused_days_total ?? 0) > 0 && (
                      <p className="text-xs text-muted">
                        {row.paused_days_total} paused day
                        {row.paused_days_total === 1 ? '' : 's'} added
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate">
                    {row.plan_name}
                    <span className="ml-1.5 text-xs text-muted">
                      {DURATION_LABEL[row.duration as PlanDuration]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                        STATUS_COLOR[row.status ?? 'active']
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-slate">{row.expiry_date}</p>
                    <p className="text-xs text-muted">{whenLabel(row)}</p>
                  </td>
                  <td className="px-4 py-3 text-slate">{rupees(Number(row.total_paid ?? 0))}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {busy && <Loader2 size={15} className="animate-spin text-muted" />}

                      {row.status !== 'cancelled' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setRenewing(row)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border-card px-2.5 py-1.5 text-xs text-slate disabled:opacity-40"
                        >
                          <RotateCw size={13} />
                          Renew
                        </button>
                      )}

                      {row.status === 'active' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => act(row, 'pause')}
                          className="inline-flex items-center gap-1 rounded-lg border border-border-card px-2.5 py-1.5 text-xs text-slate disabled:opacity-40"
                        >
                          <Pause size={13} />
                          Pause
                        </button>
                      )}

                      {row.status === 'paused' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => act(row, 'resume')}
                          className="inline-flex items-center gap-1 rounded-lg border border-border-card px-2.5 py-1.5 text-xs text-slate disabled:opacity-40"
                        >
                          <Play size={13} />
                          Resume
                        </button>
                      )}

                      {row.status !== 'cancelled' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => act(row, 'cancel')}
                          className="inline-flex items-center gap-1 rounded-lg border border-border-card px-2.5 py-1.5 text-xs text-negative disabled:opacity-40"
                        >
                          <X size={13} />
                          Cancel
                        </button>
                      )}
                    </div>

                    {renewing?.id === row.id && (
                      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
                        <span className="text-xs text-muted">Renew for</span>
                        {(plan ? sellableDurations(plan) : []).map((d) => (
                          <button
                            key={d}
                            type="button"
                            disabled={busy}
                            onClick={() => doRenew(row, d)}
                            className="rounded-lg bg-ink px-2.5 py-1.5 text-xs text-white disabled:opacity-40"
                          >
                            {DURATION_LABEL[d]}
                          </button>
                        ))}
                        {plan && sellableDurations(plan).length === 0 && (
                          <span className="text-xs text-amber-700">
                            This plan no longer prices any term.
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => setRenewing(null)}
                          className="text-xs text-muted underline"
                        >
                          cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}

            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                  Loading memberships…
                </td>
              </tr>
            )}

            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                  {query || filter !== 'all'
                    ? 'No memberships match.'
                    : 'No memberships sold yet. Define a plan in Settings → Membership Plans, then sell one here.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {wizardOpen && (
        <NewMembershipWizard onClose={() => setWizardOpen(false)} onCreated={() => setWizardOpen(false)} />
      )}
    </div>
  )
}
