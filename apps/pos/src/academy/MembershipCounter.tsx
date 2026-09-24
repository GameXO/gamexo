/**
 * Membership, at the counter.
 *
 * Deliberately read-only. The counter's actual question is "is this person a
 * member today", and that is all this answers — status and expiry, never what
 * they paid. Selling and renewing need a login that names a person, because the
 * tablet credential is shared across shifts and taped to a desk, and taking
 * payment for a twelve-month membership is not something it should be able to do.
 *
 * So the screen is honest about its own limit: it looks somebody up, and for
 * anything that moves money it says to fetch reception rather than pretending
 * a button will appear.
 */
import { useState } from 'react'
import { BadgeCheck, CircleSlash, Search } from 'lucide-react'
import { TopBar } from '../ui/TopBar'
import { CheckinFooter } from '../checkin/Chrome'
import { useMembershipCheck } from '../api/hooks'

const STATUS_TONE: Record<string, string> = {
  active: 'bg-positive/15 text-positive',
  paused: 'bg-surface-muted text-muted',
  expired: 'bg-negative/15 text-negative',
  cancelled: 'bg-surface-muted text-muted',
}

export default function MembershipCounter({ onHome }: { onHome: () => void }) {
  const [typed, setTyped] = useState('')
  const [code, setCode] = useState<string | null>(null)
  const { data, isFetching, isError } = useMembershipCheck(code)

  const submit = () => {
    const cleaned = typed.trim()
    if (cleaned.length >= 3) setCode(cleaned)
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <TopBar centerTitle="Membership" onLogoClick={onHome} />

      <main className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-6">
        <div>
          <p className="font-display text-xl font-bold text-ink">Check a membership</p>
          <p className="mt-1 text-sm text-muted">Member number or the phone they booked with.</p>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              size={17}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value)
                // Clear the previous answer as soon as the question changes, so a
                // stale "active" card cannot be read as belonging to the new code.
                setCode(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="XC-M-0001 or 98765…"
              className="w-full rounded-2xl border border-border-card bg-white py-4 pl-10 pr-4 text-base text-ink placeholder:text-muted focus:border-ink focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={typed.trim().length < 3}
            className="rounded-2xl bg-ink px-6 text-base font-medium text-white disabled:opacity-40"
          >
            Check
          </button>
        </div>

        {isFetching && <p className="text-sm text-muted">Looking…</p>}

        {isError && code && (
          <div className="flex items-start gap-3 rounded-2xl border border-border-card bg-white px-4 py-4">
            <span className="mt-0.5 text-muted">
              <CircleSlash size={20} />
            </span>
            <div>
              <p className="font-medium text-ink">No membership found</p>
              <p className="mt-0.5 text-sm text-muted">
                Nothing matches “{code}”. They can still book as a non-member.
              </p>
            </div>
          </div>
        )}

        {data && !isFetching && (
          <div className="rounded-2xl border border-border-card bg-white px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-lg font-bold text-ink">{data.customer_name}</p>
                <p className="mt-0.5 text-sm text-muted">
                  {data.member_no} · {data.plan_name}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium capitalize ${
                  STATUS_TONE[data.status] ?? 'bg-surface-muted text-muted'
                }`}
              >
                {data.status}
              </span>
            </div>

            <div className="mt-3 flex items-center gap-2 text-sm">
              {data.status === 'active' && data.days_left > 0 ? (
                <>
                  <BadgeCheck size={16} className="text-positive" />
                  <span className="text-ink">
                    Valid until {data.expiry_date} · {data.days_left} days left
                  </span>
                </>
              ) : (
                <span className="text-muted">
                  {data.status === 'active'
                    ? `Expires today (${data.expiry_date})`
                    : `Ended ${data.expiry_date}`}
                </span>
              )}
            </div>

            {(data.status !== 'active' || data.days_left <= 7) && (
              <p className="mt-3 rounded-xl bg-surface-muted px-3 py-2.5 text-sm text-slate">
                Renewals are taken at reception — the counter can't process one.
              </p>
            )}
          </div>
        )}
      </main>

      <CheckinFooter onHome={onHome} />
    </div>
  )
}
