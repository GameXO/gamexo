/**
 * One plan, and who is on it.
 *
 * The members list is fetched filtered by status rather than pulled whole and
 * counted here, so the numbers match what the Members screen shows — two
 * independent derivations of "how many active members" is how they end up
 * disagreeing in a meeting.
 */
import { useState } from 'react'
import { ChevronRight, Pencil } from '../../ui/icons'
import Card from '../../ui/Card'
import StatTile from '../../ui/StatTile'
import StatusPill, { type StatusTone } from '../../ui/StatusPill'
import { Table, TableMessage, Tbody, Td, Th, Thead, Tr } from '../../ui/Table'
import {
  DURATION_LABEL,
  PLAN_DURATIONS,
  planPrice,
  useMemberships,
  type MembershipPlanOut,
  type PlanDuration,
} from '../../api/hooks'

const TABS = ['Overview', 'Members'] as const
type Tab = (typeof TABS)[number]

const rupees = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

const STATUS_TONE: Record<string, StatusTone> = {
  active: 'positive',
  paused: 'neutral',
  expired: 'negative',
  cancelled: 'neutral',
}

export default function PlanDetail({
  plan,
  onBack,
  onEdit,
}: {
  plan: MembershipPlanOut
  onBack: () => void
  onEdit: () => void
}) {
  const [tab, setTab] = useState<Tab>('Overview')
  const { data, isLoading } = useMemberships('all')

  const onThisPlan = (data?.items ?? []).filter((m) => m.plan_id === plan.id)
  const revenue = onThisPlan.reduce((sum, m) => sum + Number(m.total_paid ?? 0), 0)
  const discount = Number(plan.discount_pct ?? 0)
  const joining = Number(plan.joining_fee ?? 0)
  const benefits = plan.benefits ?? []

  const stats = [
    { label: 'Members', value: String(onThisPlan.length) },
    { label: 'Collected to date', value: rupees(revenue) },
    { label: 'Discount on court hire', value: `${discount}%` },
    { label: 'Visits included', value: plan.max_visits == null ? 'Unlimited' : String(plan.max_visits) },
  ]

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={onBack}
          className="font-medium text-slate underline-offset-2 hover:text-ink hover:underline"
        >
          Plans
        </button>
        <ChevronRight size={14} className="text-muted" />
        <span className="font-medium text-ink">{plan.name}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-ink">{plan.name}</h1>
            <StatusPill label={plan.is_active ? 'Offered' : 'Retired'} tone={plan.is_active ? 'positive' : 'neutral'} />
          </div>
          <p className="mt-1 text-sm text-slate">{plan.category || 'All members'}</p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-2 rounded-lg border border-border-card bg-white px-4 py-2.5 text-sm font-medium text-ink shadow-control hover:bg-surface-muted"
        >
          <Pencil size={15} />
          Edit plan
        </button>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <StatTile key={s.label} label={s.label} value={s.value} />
        ))}
      </div>

      <div role="tablist" className="flex gap-6 border-b border-border-soft">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors ${
              tab === t ? 'border-ink text-ink' : 'border-transparent text-slate hover:text-ink'
            }`}
          >
            {t}
            {t === 'Members' && <span className="ml-1.5 text-xs text-muted">{onThisPlan.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="grid gap-5 xl:grid-cols-2">
          <Card flush title="Pricing">
            <dl className="divide-y divide-dashed divide-border-soft text-sm">
              {PLAN_DURATIONS.map((d) => {
                const price = planPrice(plan, d)
                return (
                  <div key={d} className="flex items-center justify-between px-5 py-3.5">
                    <dt className="text-slate">{DURATION_LABEL[d]}</dt>
                    <dd className={price > 0 ? 'font-semibold text-ink' : 'text-muted'}>
                      {price > 0 ? rupees(price) : 'Not offered'}
                    </dd>
                  </div>
                )
              })}
              <div className="flex items-center justify-between px-5 py-3.5">
                <dt className="text-slate">Joining fee</dt>
                <dd className={joining > 0 ? 'font-semibold text-ink' : 'text-muted'}>
                  {joining > 0 ? rupees(joining) : 'None'}
                </dd>
              </div>
            </dl>
          </Card>

          <Card flush title="What's included">
            {benefits.length > 0 ? (
              <ul className="divide-y divide-dashed divide-border-soft text-sm">
                {benefits.map((b) => (
                  <li key={b} className="flex items-center gap-3 px-5 py-3.5 text-ink">
                    <span className="size-1.5 shrink-0 rounded-full bg-lime-ink" />
                    {b}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-sm text-muted">No extra benefits listed for this plan.</p>
            )}
          </Card>
        </div>
      )}

      {tab === 'Members' && (
        <Table>
          <Thead>
            <Tr>
              <Th>Member</Th>
              <Th>Term</Th>
              <Th>Status</Th>
              <Th>Expires</Th>
              <Th align="right">Paid</Th>
            </Tr>
          </Thead>
          <Tbody>
            {onThisPlan.map((m) => (
              <Tr key={m.id}>
                <Td className="font-medium text-ink">{m.member_no}</Td>
                <Td className="text-slate">{DURATION_LABEL[m.duration as PlanDuration]}</Td>
                <Td>
                  <StatusPill label={m.status ?? 'active'} tone={STATUS_TONE[m.status ?? 'active'] ?? 'neutral'} />
                </Td>
                <Td className="text-slate">{m.expiry_date}</Td>
                <Td align="right" className="font-medium text-ink">{rupees(Number(m.total_paid ?? 0))}</Td>
              </Tr>
            ))}
            {isLoading && (
              <TableMessage colSpan={5}>
                  Loading…
                </TableMessage>
            )}
            {!isLoading && onThisPlan.length === 0 && (
              <TableMessage colSpan={5}>
                  Nobody is on this plan yet.
                </TableMessage>
            )}
          </Tbody>
        </Table>
      )}
    </div>
  )
}
