/**
 * One plan, and who is on it.
 *
 * The members list is fetched filtered by status rather than pulled whole and
 * counted here, so the numbers match what the Members screen shows — two
 * independent derivations of "how many active members" is how they end up
 * disagreeing in a meeting.
 */
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import Tabs from '../../ui/Tabs'
import {
  DURATION_LABEL,
  PLAN_DURATIONS,
  planPrice,
  sellableDurations,
  useMemberships,
  type MembershipPlanOut,
  type PlanDuration,
} from '../../api/hooks'

const TABS = ['Overview', 'Members'] as const
type Tab = (typeof TABS)[number]

const rupees = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-positive/15 text-positive',
  paused: 'bg-surface-muted text-muted',
  expired: 'bg-negative/15 text-negative',
  cancelled: 'bg-surface-muted text-muted',
}

export default function PlanDetail({
  plan,
  onBack,
}: {
  plan: MembershipPlanOut
  onBack: () => void
}) {
  const [tab, setTab] = useState<Tab>('Overview')
  const { data, isLoading } = useMemberships('all')

  const onThisPlan = (data?.items ?? []).filter((m) => m.plan_id === plan.id)
  const revenue = onThisPlan.reduce((sum, m) => sum + Number(m.total_paid ?? 0), 0)
  const terms = sellableDurations(plan)

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 text-sm font-medium text-slate"
      >
        <ArrowLeft size={15} /> Back to plans
      </button>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-semibold text-ink">{plan.name}</p>
          <p className="text-sm text-slate">
            {terms.length > 0
              ? terms.map((d) => `${DURATION_LABEL[d]} ${rupees(planPrice(plan, d))}`).join(' · ')
              : 'No term priced'}
            {' · '}
            {onThisPlan.length} member{onThisPlan.length === 1 ? '' : 's'}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            plan.is_active ? 'bg-positive/10 text-positive' : 'bg-surface-muted text-muted'
          }`}
        >
          {plan.is_active ? 'Offered' : 'Retired'}
        </span>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'Overview' && (
        <div className="grid w-full grid-cols-1 gap-4 rounded-2xl border border-border-card bg-white p-5 shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)] sm:grid-cols-2">
          {PLAN_DURATIONS.map((d) => (
            <Field
              key={d}
              label={DURATION_LABEL[d]}
              value={
                planPrice(plan, d) > 0 ? rupees(planPrice(plan, d)) : 'Not offered'
              }
            />
          ))}
          <Field
            label="Joining fee"
            value={
              Number(plan.joining_fee ?? 0) > 0 ? rupees(Number(plan.joining_fee)) : 'None'
            }
          />
          <Field label="Discount on court hire" value={`${plan.discount_pct ?? 0}%`} />
          <Field
            label="Visits included"
            value={plan.max_visits == null ? 'Unlimited' : String(plan.max_visits)}
          />
          <Field label="Collected to date" value={rupees(revenue)} />
          {(plan.benefits ?? []).length > 0 && (
            <div className="sm:col-span-2">
              <p className="text-xs uppercase tracking-wide text-muted">Benefits</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {(plan.benefits ?? []).map((b) => (
                  <li key={b} className="text-sm text-ink">
                    · {b}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'Members' && (
        <div className="shrink-0 overflow-hidden rounded-xl border border-border-card bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border-card text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Member</th>
                <th className="px-4 py-3 font-medium">Term</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium">Paid</th>
              </tr>
            </thead>
            <tbody>
              {onThisPlan.map((m) => (
                <tr key={m.id} className="border-b border-border-card last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{m.member_no}</td>
                  <td className="px-4 py-3 text-slate">
                    {DURATION_LABEL[m.duration as PlanDuration]}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                        STATUS_COLOR[m.status ?? 'active']
                      }`}
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate">{m.expiry_date}</td>
                  <td className="px-4 py-3 text-slate">{rupees(Number(m.total_paid ?? 0))}</td>
                </tr>
              ))}
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && onThisPlan.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                    Nobody is on this plan yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-sm text-ink">{value}</p>
    </div>
  )
}
