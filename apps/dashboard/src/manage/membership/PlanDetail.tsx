import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { money, sportById } from '../../data/booking'
import { membershipStatus } from '../../data/membership'
import * as db from '../../lib/db'
import Tabs from '../../ui/Tabs'
import type { EffectivePlan } from './planOverrides'

const TABS = ['Overview', 'Members', 'Revenue', 'Invoices', 'Renewals'] as const
type Tab = (typeof TABS)[number]

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-positive/15 text-positive',
  expiring: 'bg-flame/15 text-flame',
  expired: 'bg-negative/15 text-negative',
  frozen: 'bg-surface-muted text-muted',
}

export default function PlanDetail({ plan, onBack }: { plan: EffectivePlan; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('Overview')
  db.useDbVersion()

  const enrollments = db.getMemberships().filter((m) => m.planId === plan.id)
  const revenue = enrollments.reduce((sum, m) => sum + m.paidTotal, 0)

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <button type="button" onClick={onBack} className="flex w-fit items-center gap-1.5 text-sm font-medium text-slate">
        <ArrowLeft size={15} /> Back to plans
      </button>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-semibold text-ink">{plan.name}</p>
          <p className="text-sm text-slate">
            {money(plan.price)}
            {plan.durationMonths === 1 ? '/month' : ` / ${plan.durationMonths} mo`} · {enrollments.length} members
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            plan.status === 'active' ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative'
          }`}
        >
          {plan.status === 'active' ? 'Active' : 'Paused'}
        </span>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'Overview' && (
        <div className="grid w-full grid-cols-1 gap-4 rounded-2xl border border-border-card bg-white p-5 shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)] sm:grid-cols-2">
          <Field label="Duration" value={plan.durationMonths === 1 ? '1 month' : `${plan.durationMonths} months`} />
          <Field label="Discount %" value={`${plan.discountPercent}% off court hire`} />
          <Field
            label="Sports included"
            value={plan.sportsIncluded.length ? plan.sportsIncluded.map((id) => sportById(id)?.name || id).join(', ') : 'All sports'}
          />
          <Field label="Price" value={`${money(plan.price)} + GST = ${money(plan.total)}`} />
          <div className="sm:col-span-2">
            <p className="text-xs uppercase tracking-wide text-muted">Benefits</p>
            <p className="text-sm text-ink">{plan.benefits}</p>
          </div>
        </div>
      )}

      {tab === 'Members' && (
        <div className="w-full overflow-hidden rounded-2xl border border-border-card bg-white shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)]">
          {enrollments.length === 0 ? (
            <EmptyState plan={plan} />
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border-card bg-surface-muted text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Sessions used</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((m) => (
                  <tr key={m.id} className="border-b border-border-card last:border-0">
                    <td className="px-4 py-3 font-medium text-ink">{m.customer.name}</td>
                    <td className="px-4 py-3 text-slate">{m.customer.phone}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_COLOR[membershipStatus(m)]}`}>
                        {membershipStatus(m)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate">{m.sessionsUsed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'Revenue' && (
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Total collected" value={money(revenue)} />
          <Stat label="Active members" value={String(enrollments.filter((m) => membershipStatus(m) === 'active').length)} />
          <Stat label="Avg. per member" value={money(enrollments.length ? revenue / enrollments.length : 0)} />
        </div>
      )}

      {tab === 'Invoices' && (
        <div className="w-full overflow-hidden rounded-2xl border border-border-card bg-white shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)]">
          {enrollments.length === 0 ? (
            <EmptyState plan={plan} />
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border-card bg-surface-muted text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((m) => (
                  <tr key={m.id} className="border-b border-border-card last:border-0">
                    <td className="px-4 py-3 font-medium text-ink">{m.id}</td>
                    <td className="px-4 py-3 text-slate">{m.customer.name}</td>
                    <td className="px-4 py-3 text-ink">{money(m.total)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          m.paidTotal >= m.total ? 'bg-lime/20 text-lime-ink' : 'bg-negative/10 text-negative'
                        }`}
                      >
                        {m.paidTotal >= m.total ? 'Paid' : `${money(m.total - m.paidTotal)} due`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'Renewals' && (
        <div className="w-full overflow-hidden rounded-2xl border border-border-card bg-white shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)]">
          {enrollments.length === 0 ? (
            <EmptyState plan={plan} />
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-border-card bg-surface-muted text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3">Member</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {[...enrollments]
                  .sort((a, b) => a.endDate.localeCompare(b.endDate))
                  .map((m) => (
                    <tr key={m.id} className="border-b border-border-card last:border-0">
                      <td className="px-4 py-3 font-medium text-ink">{m.customer.name}</td>
                      <td className="px-4 py-3 text-slate">{m.endDate}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_COLOR[membershipStatus(m)]}`}>
                          {membershipStatus(m)}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function EmptyState({ plan }: { plan: EffectivePlan }) {
  return (
    <p className="px-4 py-10 text-center text-sm text-muted">
      {plan.isCustom
        ? "No members enrolled yet — custom plans aren't wired into the enrollment flow yet."
        : 'No members enrolled in this plan yet.'}
    </p>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm font-medium text-ink">{value}</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border-card bg-white p-4 shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)]">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-semibold text-ink">{value}</p>
    </div>
  )
}
