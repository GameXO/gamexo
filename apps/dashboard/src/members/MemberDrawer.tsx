import { X } from 'lucide-react'
import { balanceOf, courtById, money, sportById } from '../data/booking'
import { membershipStatus, planById } from '../data/membership'
import type { CustomerProfile } from '../data/customers'

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

export default function MemberDrawer({ profile, onClose }: { profile: CustomerProfile; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[440px] flex-col gap-5 overflow-y-auto bg-white p-6"
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-lg font-semibold text-ink">{profile.name}</p>
            <p className="text-sm text-muted">+91 {profile.phone}</p>
            {profile.email && <p className="text-sm text-muted">{profile.email}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Stat label="Bookings" value={String(profile.totalBookings)} />
          <Stat label="Total spent" value={money(profile.totalSpent)} />
          <Stat
            label="Outstanding"
            value={money(profile.outstandingDues)}
            tone={profile.outstandingDues > 0 ? 'negative' : undefined}
          />
        </div>

        {profile.activeMembership ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border-card bg-surface p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">{planById(profile.activeMembership.planId)?.name}</p>
              <div className="flex items-center gap-1.5">
                {profile.membershipTier && (
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${TIER_COLOR[profile.membershipTier]}`}>
                    {profile.membershipTier}
                  </span>
                )}
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_COLOR[membershipStatus(profile.activeMembership)]}`}>
                  {membershipStatus(profile.activeMembership)}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted">
              Runs to {profile.activeMembership.endDate} · {profile.activeMembership.sessionsUsed} sessions used
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">No active membership.</p>
        )}

        {profile.academyPrograms.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Academy</p>
            <div className="flex flex-wrap gap-1.5">
              {profile.academyPrograms.map((p) => (
                <span key={p} className="rounded-full bg-surface-muted px-3 py-1 text-xs text-ink">
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Recent bookings</p>
          {profile.bookings.length === 0 && <p className="text-sm text-muted">No bookings yet.</p>}
          {profile.bookings.slice(0, 6).map((b) => {
            const court = courtById(b.courtId)
            const due = balanceOf(b)
            return (
              <div key={b.id} className="flex items-center justify-between rounded-lg border border-border-card px-3.5 py-2.5">
                <div>
                  <p className="text-sm text-ink">
                    {sportById(b.sportId)?.name} · {court?.name}
                  </p>
                  <p className="text-xs text-muted">
                    {b.date} · {b.hours} hr
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-ink">{money(b.total)}</p>
                  {due > 0 && <p className="text-xs text-negative">{money(due)} due</p>}
                </div>
              </div>
            )
          })}
        </div>

        {profile.sales.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">Counter sales</p>
            {profile.sales.slice(0, 4).map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-border-card px-3.5 py-2.5">
                <p className="text-sm text-ink">{Object.keys(s.equipment).length} item(s)</p>
                <p className="text-sm font-medium text-ink">{money(s.total)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'negative' }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-muted p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-sm font-semibold ${tone === 'negative' ? 'text-negative' : 'text-ink'}`}>{value}</p>
    </div>
  )
}
