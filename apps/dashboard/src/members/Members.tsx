/**
 * Members — every membership this academy has sold, and what to do with each.
 *
 * Reads the API, not localStorage. Pricing is not editable here: plans are
 * defined once on this page's Plans tab and only *applied* in the Members tab.
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
import { Loader2, Pause, Play, Plus, RotateCw, Search, X } from '../ui/icons'
import RowActionsMenu, { type RowAction } from '../ui/RowActionsMenu'
import StatusPill, { type StatusTone } from '../ui/StatusPill'
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
import Membership from '../manage/Membership'
import NewMembershipWizard from './NewMembershipWizard'
import { Table, TableMessage, Tbody, Td, Th, Thead, Tr } from '../ui/Table'

const rupees = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

const STATUS_TONE: Record<string, StatusTone> = {
  active: 'positive',
  paused: 'neutral',
  expired: 'negative',
  cancelled: 'neutral',
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

const TABS = [
  { id: 'members', label: 'Members' },
  { id: 'plans', label: 'Plans' },
] as const

export default function Members() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('members')

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
      <div role="tablist" className="flex shrink-0 gap-6 border-b border-border-soft">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors ${
              tab === t.id ? 'border-ink text-ink' : 'border-transparent text-slate hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* `key` restarts the entrance animation, so switching tabs eases in. */}
      <div key={tab} className="flex flex-col animate-section-in motion-reduce:animate-none">
        {tab === 'members' ? <MembersList /> : <Membership />}
      </div>
    </div>
  )
}

function MembersList() {
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="w-full rounded-lg border border-border-card bg-white py-2.5 pl-9 pr-3.5 text-sm text-ink shadow-control outline-none placeholder:text-muted focus:border-lime-ink"
              placeholder="Search member or number"
              aria-label="Search members"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-surface-muted p-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors ${
                  filter === f ? 'bg-white font-medium text-ink shadow-control' : 'text-slate hover:text-ink'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-control"
        >
          <Plus size={15} />
          New membership
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-negative/30 bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      <Table>
        <Thead>
          <Tr>
            <Th>Member</Th>
            <Th>Plan</Th>
            <Th>Status</Th>
            <Th>Expires</Th>
            <Th>Paid</Th>
            <Th align="right">
              <span className="sr-only">Actions</span>
            </Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((row) => {
            const plan = (plans ?? []).find((p) => p.id === row.plan_id)
            const busy = busyId === row.id
            const actions: RowAction[] = [
              ...(row.status === 'active'
                ? [{ label: 'Pause', icon: Pause, onClick: () => void act(row, 'pause') }]
                : []),
              ...(row.status === 'paused'
                ? [{ label: 'Resume', icon: Play, onClick: () => void act(row, 'resume') }]
                : []),
              ...(row.status !== 'cancelled'
                ? [{ label: 'Cancel membership', icon: X, danger: true, onClick: () => void act(row, 'cancel') }]
                : []),
            ]
            return (
              <Tr key={row.id}>
                <Td>
                  <p className="font-semibold text-ink">{row.member_no}</p>
                  {(row.paused_days_total ?? 0) > 0 && (
                    <p className="text-xs text-muted">
                      {row.paused_days_total} paused day
                      {row.paused_days_total === 1 ? '' : 's'} added
                    </p>
                  )}
                </Td>
                <Td>
                  <p className="font-medium text-ink">{row.plan_name}</p>
                  <p className="text-xs text-muted">{DURATION_LABEL[row.duration as PlanDuration]}</p>
                </Td>
                <Td>
                  <StatusPill label={row.status ?? 'active'} tone={STATUS_TONE[row.status ?? 'active'] ?? 'neutral'} />
                </Td>
                <Td>
                  <p className="text-ink">{row.expiry_date}</p>
                  <p className="text-xs text-muted">{whenLabel(row)}</p>
                </Td>
                <Td className="font-medium text-ink">{rupees(Number(row.total_paid ?? 0))}</Td>
                <Td>
                  <div className="flex items-center justify-end gap-2">
                    {busy && <Loader2 size={15} className="animate-spin text-muted" />}

                    {row.status !== 'cancelled' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRenewing(row)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border-card bg-white px-3 py-1.5 text-xs font-medium text-ink shadow-control hover:bg-surface-muted disabled:opacity-40"
                      >
                        <RotateCw size={13} />
                        Renew
                      </button>
                    )}

                    {actions.length > 0 && <RowActionsMenu actions={actions} />}
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
                        <span className="text-xs text-amber-700">This plan no longer prices any term.</span>
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
                </Td>
              </Tr>
            )
          })}

          {isLoading && (
            <TableMessage colSpan={6}>
                Loading memberships…
              </TableMessage>
          )}

          {!isLoading && rows.length === 0 && (
            <TableMessage colSpan={6}>
                {query || filter !== 'all'
                  ? 'No memberships match.'
                  : 'No memberships sold yet. Create a plan on the Plans tab, then sell one here.'}
              </TableMessage>
          )}
        </Tbody>
      </Table>

      {wizardOpen && (
        <NewMembershipWizard onClose={() => setWizardOpen(false)} onCreated={() => setWizardOpen(false)} />
      )}
    </div>
  )
}
