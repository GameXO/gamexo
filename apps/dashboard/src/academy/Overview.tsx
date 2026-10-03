/**
 * What a manager sees before touching any tab: how the academy is doing today, and
 * who needs a call.
 *
 * Both halves answer a question with a destination. The numbers are not decoration —
 * each attention card ends in "View all", which opens the Students tab already
 * filtered to exactly those people.
 */
import { useState } from 'react'
import { AlertTriangle, CalendarClock, ChevronDown, CircleCheck, TrendingUp, UserX } from '../ui/icons'
import {
  useAcademyOverview,
  useAttention,
  type AttentionFlag,
  type AttentionItem,
} from '../api/hooks'
import Avatar from './Avatar'
import { rupees } from './format'
import StatTile from '../ui/StatTile'

export function SummaryStrip() {
  const { data, isLoading } = useAcademyOverview()
  const marked = (data?.present_today ?? 0) + (data?.absent_today ?? 0)

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label="Active students"
        value={String(data?.active_students ?? 0)}
        sub={`${data?.new_admissions_this_month ?? 0} joined this month`}
        loading={isLoading}
      />
      <StatTile
        label="Today's attendance"
        value={marked ? `${data?.present_today}/${marked}` : '—'}
        sub={
          data?.sessions_today
            ? `${data.sessions_today} ${data.sessions_today === 1 ? 'session' : 'sessions'} today · ${data.absent_today} absent`
            : 'No sessions today'
        }
        loading={isLoading}
      />
      <StatTile
        label="Fees pending"
        value={rupees(data?.fee_pending ?? 0)}
        sub={`${rupees(data?.fee_collected ?? 0)} collected`}
        loading={isLoading}
      />
      <StatTile
        label="Coaches"
        value={String(data?.active_coaches ?? 0)}
        sub={`${data?.sports_offered ?? 0} sports offered`}
        loading={isLoading}
      />
    </div>
  )
}

const GROUPS: {
  flag: AttentionFlag
  key: 'repeat_absentees' | 'low_attendance' | 'renewals_due' | 'promotion_candidates'
  countKey: 'repeat_absentees' | 'low_attendance' | 'renewals_due' | 'promotion_candidates'
  title: string
  empty: string
  icon: typeof UserX
  tone: string
}[] = [
  {
    flag: 'repeat_absentee',
    key: 'repeat_absentees',
    countKey: 'repeat_absentees',
    title: 'Repeat absentees',
    empty: 'Nobody has missed 3+ sessions lately.',
    icon: UserX,
    tone: 'bg-negative/10 text-negative',
  },
  {
    flag: 'low_attendance',
    key: 'low_attendance',
    countKey: 'low_attendance',
    title: 'Low attendance',
    empty: 'Everyone is attending well.',
    icon: AlertTriangle,
    tone: 'bg-amber-50 text-amber-800',
  },
  {
    flag: 'renewal_due',
    key: 'renewals_due',
    countKey: 'renewals_due',
    title: 'Renewals due',
    empty: 'No terms ending this week.',
    icon: CalendarClock,
    tone: 'bg-amber-50 text-amber-800',
  },
  {
    flag: 'promotion_ready',
    key: 'promotion_candidates',
    countKey: 'promotion_candidates',
    title: 'Ready for promotion',
    empty: 'No promotion candidates yet.',
    icon: TrendingUp,
    tone: 'bg-lime/30 text-lime-ink',
  },
]

const PREVIEW = 3

export function AttentionPanel({
  onViewAll,
  onOpen,
}: {
  onViewAll: (flag: AttentionFlag) => void
  onOpen: (studentId: string) => void
}) {
  const { data, isLoading, isError } = useAttention()
  const [open, setOpen] = useState(true)

  const total = data
    ? data.counts.repeat_absentees +
      data.counts.low_attendance +
      data.counts.renewals_due +
      data.counts.promotion_candidates
    : 0

  return (
    <section className="rounded-2xl border border-border-card bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2.5">
          <span className="font-display text-base font-semibold text-ink">Needs attention</span>
          {data && total > 0 && (
            <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-medium text-white">{total}</span>
          )}
        </span>
        <ChevronDown size={18} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-border-card p-4">
          {isError && <p className="text-sm text-negative">Could not load this list.</p>}

          {isLoading && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {GROUPS.map((g) => (
                <div key={g.flag} className="h-32 animate-pulse rounded-xl bg-surface-muted" />
              ))}
            </div>
          )}

          {data && total === 0 && (
            <p className="flex items-center gap-2 py-2 text-sm text-slate">
              <CircleCheck size={16} className="text-positive" />
              All clear — nobody needs attention right now.
            </p>
          )}

          {data && total > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {GROUPS.map((g) => {
                const items: AttentionItem[] = data[g.key]
                const count = data.counts[g.countKey]
                const Icon = g.icon
                return (
                  <div key={g.flag} className="flex flex-col rounded-xl border border-border-card p-3.5">
                    <div className="flex items-center gap-2">
                      <span className={`flex size-7 items-center justify-center rounded-lg ${g.tone}`}>
                        <Icon size={15} />
                      </span>
                      <p className="flex-1 text-sm font-semibold text-ink">{g.title}</p>
                      <span className="text-sm font-semibold text-ink">{count}</span>
                    </div>

                    <div className="mt-3 flex flex-1 flex-col gap-1">
                      {items.slice(0, PREVIEW).map((item) => (
                        <button
                          key={item.student_id}
                          type="button"
                          onClick={() => onOpen(item.student_id)}
                          className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-surface-muted"
                        >
                          <Avatar
                            name={item.name}
                            initials={item.avatar_initials}
                            photoUrl={item.photo_url}
                            size="sm"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-ink">{item.name}</span>
                            <span className="block truncate text-xs text-slate">{item.detail}</span>
                          </span>
                        </button>
                      ))}
                      {count === 0 && <p className="px-1.5 text-xs text-muted">{g.empty}</p>}
                    </div>

                    {count > 0 && (
                      <button
                        type="button"
                        onClick={() => onViewAll(g.flag)}
                        className="mt-2 self-start rounded-lg px-1.5 py-1 text-xs font-medium text-lime-ink underline-offset-2 hover:underline"
                      >
                        {count > PREVIEW ? `View all ${count}` : 'View in table'} →
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
