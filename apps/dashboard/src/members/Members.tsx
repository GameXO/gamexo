import { useState } from 'react'
import { Search } from 'lucide-react'
import { money, sportById } from '../data/booking'
import { MEMBERSHIP_PLANS, membershipStatus, planById } from '../data/membership'
import { listMemberDirectory, type CustomerProfile } from '../data/customers'
import * as db from '../lib/db'
import MemberDrawer from './MemberDrawer'
import NewMembershipWizard from './NewMembershipWizard'

const TIER_COLOR: Record<string, string> = {
  gold: 'bg-lime text-lime-ink',
  silver: 'bg-surface-muted text-ink',
  bronze: 'bg-flame/15 text-flame',
}

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-positive/15 text-positive',
  expiring: 'bg-flame/15 text-flame',
  expired: 'bg-negative/15 text-negative',
  frozen: 'bg-surface-muted text-muted',
}

export default function Members() {
  db.useDbVersion()
  const [tab, setTab] = useState<'directory' | 'plans'>('directory')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<CustomerProfile | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

  const directory = listMemberDirectory().filter((p) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return p.name.toLowerCase().includes(q) || p.phone.includes(q)
  })

  const memberships = db.getMemberships()

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg bg-surface-muted p-1">
          <button
            type="button"
            onClick={() => setTab('directory')}
            className={`rounded-md px-4 py-2 text-sm transition-colors ${tab === 'directory' ? 'bg-white text-ink shadow-sm' : 'text-slate'}`}
          >
            Directory
          </button>
          <button
            type="button"
            onClick={() => setTab('plans')}
            className={`rounded-md px-4 py-2 text-sm transition-colors ${tab === 'plans' ? 'bg-white text-ink shadow-sm' : 'text-slate'}`}
          >
            Membership plans
          </button>
        </div>

        {tab === 'plans' && (
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="flex h-10 items-center justify-center rounded-full px-5 text-sm text-[#fefefe]"
            style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
          >
            New membership
          </button>
        )}
      </div>

      {tab === 'directory' ? (
        <>
          <div className="relative max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              className="w-full rounded-lg border border-border-input bg-white py-2.5 pl-9 pr-3.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none"
              placeholder="Search name or phone"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="overflow-hidden rounded-xl border border-border-card bg-white">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border-card text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Membership</th>
                  <th className="px-4 py-3 font-medium">Bookings</th>
                  <th className="px-4 py-3 font-medium">Spent</th>
                  <th className="px-4 py-3 font-medium">Dues</th>
                </tr>
              </thead>
              <tbody>
                {directory.map((p) => (
                  <tr
                    key={p.phone}
                    onClick={() => setSelected(p)}
                    className="cursor-pointer border-b border-border-card last:border-0 hover:bg-surface-muted"
                  >
                    <td className="px-4 py-3 font-medium text-ink">{p.name}</td>
                    <td className="px-4 py-3 text-slate">{p.phone}</td>
                    <td className="px-4 py-3">
                      {p.membershipTier ? (
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${TIER_COLOR[p.membershipTier]}`}>
                          {p.membershipTier}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">Non-member</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate">{p.totalBookings}</td>
                    <td className="px-4 py-3 text-slate">{money(p.totalSpent)}</td>
                    <td className="px-4 py-3">
                      {p.outstandingDues > 0 ? (
                        <span className="font-medium text-negative">{money(p.outstandingDues)}</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {directory.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-muted">
                      No customers match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-6">
          {['football', 'cricket', 'tennis', 'badminton', 'pickleball', 'tabletennis'].map((sportId) => {
            const plans = MEMBERSHIP_PLANS.filter((p) => p.sportId === sportId)
            return (
              <div key={sportId} className="flex flex-col gap-3">
                <p className="text-sm font-semibold text-ink">{sportById(sportId)?.name}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {plans.map((plan) => (
                    <div key={plan.id} className="flex flex-col gap-1.5 rounded-xl border border-border-card bg-white p-4">
                      <p className="text-sm font-semibold text-ink">{plan.name}</p>
                      <p className="text-xl font-semibold text-ink">{money(plan.total)}</p>
                      <p className="text-xs text-muted">
                        {plan.months} mo · {Math.round(plan.discount * 100)}% off court hire · {plan.sessionsPerMonth}{' '}
                        sessions/mo
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          <div className="overflow-hidden rounded-xl border border-border-card bg-white">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border-card text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Expires</th>
                  <th className="px-4 py-3 font-medium">Sessions used</th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((m) => {
                  const status = membershipStatus(m)
                  return (
                    <tr key={m.id} className="border-b border-border-card last:border-0">
                      <td className="px-4 py-3 font-medium text-ink">{m.customer.name}</td>
                      <td className="px-4 py-3 text-slate">{planById(m.planId)?.name}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_COLOR[status]}`}>{status}</span>
                      </td>
                      <td className="px-4 py-3 text-slate">{m.endDate}</td>
                      <td className="px-4 py-3 text-slate">{m.sessionsUsed}</td>
                    </tr>
                  )
                })}
                {memberships.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted">
                      No memberships sold yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && <MemberDrawer profile={selected} onClose={() => setSelected(null)} />}
      {wizardOpen && <NewMembershipWizard onClose={() => setWizardOpen(false)} onCreated={() => {}} />}
    </div>
  )
}
