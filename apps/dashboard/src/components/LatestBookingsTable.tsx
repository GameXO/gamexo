import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAllCourts, useSports } from '../api/hooks'
import { channelOf, formatINR, type ChannelKey } from '../dashboard/insights'
import type { View } from '../App'
import calendar05 from '../assets/figma/calendar-05.svg'

const STATUS_TONE: Record<string, string> = {
  held: 'bg-amber-50 text-amber-700',
  upcoming: 'bg-amber-50 text-amber-700',
  active: 'bg-lime/20 text-lime-ink',
  overdue: 'bg-negative/10 text-negative',
  completed: 'bg-surface-muted text-slate',
  cancelled: 'bg-surface-muted text-muted',
}

const CHANNEL_TONE: Record<ChannelKey, string> = {
  walkin: 'bg-surface-muted text-slate',
  online: 'bg-lime/20 text-lime-ink',
  third_party: 'bg-amber-50 text-amber-700',
}

const CHANNEL_LABEL: Record<ChannelKey, string> = {
  walkin: 'Walk-in',
  online: 'Online',
  third_party: 'Third-Party',
}

/**
 * The most recently *made* bookings, straight off the same `/bookings` list
 * the rest of the app uses — read raw rather than through `toBooking`, which
 * folds `booking_type`/`source_platform` away before this table needs them.
 *
 * The API only orders this list by `starts_at desc`, which is "soonest
 * upcoming slot", not "latest activity" — an advance booking for next month
 * would permanently sit above one made an hour ago. Fetched a wider page and
 * re-sorted by `created_at` here instead, and cancelled bookings dropped: a
 * cancelled slot is not activity a front desk needs surfaced on the
 * dashboard.
 */
function useLatestBookings(limit: number) {
  return useQuery({
    queryKey: ['bookings', 'latest', limit],
    queryFn: async () => {
      const page = await api.listBookings({ page: 1, size: Math.max(limit * 3, 30) })
      return (page.items ?? [])
        .filter((b) => b.status !== 'cancelled')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

type Row = {
  id: string
  reference: string
  customer: string
  sport: string
  court: string
  whenLabel: string
  whenSort: string
  total: number
  status: string
  channel: ChannelKey
}

type SortKey = 'when' | 'amount'

function SortIcon({ active, dir }: { active: boolean; dir: 1 | -1 }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 transition-opacity duration-100 ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`}
      style={{ transform: active && dir === -1 ? 'rotate(180deg)' : undefined }}
    >
      <path d="M12 5v14M5 12l7 7 7-7" />
    </svg>
  )
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align = 'left',
}: {
  label: string
  active: boolean
  dir: 1 | -1
  onClick: () => void
  align?: 'left' | 'right'
}) {
  return (
    <th className={`px-3 py-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={onClick}
        className={`group inline-flex items-center gap-1 transition-colors duration-100 hover:text-ink ${
          align === 'right' ? 'flex-row-reverse' : ''
        }`}
      >
        <span>{label}</span>
        <SortIcon active={active} dir={dir} />
      </button>
    </th>
  )
}

const initialOf = (name: string) => name.trim().slice(0, 1).toUpperCase() || '?'

export default function LatestBookingsTable({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const latest = useLatestBookings(8)
  // Includes sports since retired — see SportPopularityCard.
  const sports = useSports(true)
  const courts = useAllCourts()
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'when', dir: -1 })

  const rows = useMemo((): Row[] => {
    const sportName = (id: string) => sports.data?.find((s) => s.id === id)?.name ?? 'Unknown'
    const courtName = (id: string) => courts.data?.find((c) => c.id === id)?.name ?? 'Unknown'
    return (latest.data ?? []).map((b) => ({
      id: b.id,
      reference: b.reference,
      customer: b.customer_name || 'Walk-in guest',
      sport: sportName(b.sport_id),
      court: courtName(b.court_id),
      whenLabel: formatWhen(b.starts_at),
      whenSort: b.starts_at,
      total: Number(b.total),
      status: b.status ?? 'upcoming',
      channel: channelOf(b),
    }))
  }, [latest.data, sports.data, courts.data])

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const value = sort.key === 'when' ? a.whenSort.localeCompare(b.whenSort) : a.total - b.total
      return value * sort.dir
    })
  }, [rows, sort])

  const toggleSort = (key: SortKey) =>
    setSort((current) => (current.key === key ? { key, dir: (current.dir * -1) as 1 | -1 } : { key, dir: -1 }))

  const totalShown = sortedRows.reduce((sum, row) => sum + row.total, 0)

  return (
    <div className="flex w-full shrink-0 flex-col items-start gap-5 overflow-hidden rounded-xl border border-border-card bg-surface p-5">
      <div className="flex w-full items-center gap-2.5">
        <img src={calendar05} alt="" className="size-5" />
        <p className="flex-1 text-sm font-medium text-ink">Latest Bookings</p>
        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate('bookings')}
            className="text-xs font-medium text-slate transition-colors duration-100 hover:text-ink"
          >
            View all
          </button>
        )}
      </div>

      {latest.isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : latest.error ? (
        <p className="text-sm text-negative">Could not load bookings.</p>
      ) : sortedRows.length === 0 ? (
        <p className="text-sm text-muted">No bookings yet.</p>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border-card text-xs font-medium uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Sport &amp; Court</th>
                <SortableTh
                  label="When"
                  active={sort.key === 'when'}
                  dir={sort.dir}
                  onClick={() => toggleSort('when')}
                />
                <th className="px-3 py-3">Source</th>
                <th className="px-3 py-3">Status</th>
                <SortableTh
                  label="Amount"
                  active={sort.key === 'amount'}
                  dir={sort.dir}
                  onClick={() => toggleSort('amount')}
                  align="right"
                />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id} className="border-b border-border-card/80 transition-colors duration-100 last:border-none hover:bg-surface-muted/70">
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lime-ink text-[12px] font-semibold text-lime">
                        {initialOf(row.customer)}
                      </span>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-ink">{row.customer}</span>
                        <span className="text-xs text-muted">{row.reference}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col">
                      <span className="font-medium text-ink">{row.sport}</span>
                      <span className="text-xs text-muted">{row.court}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate">{row.whenLabel}</td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${CHANNEL_TONE[row.channel]}`}>
                      {CHANNEL_LABEL[row.channel]}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${
                        STATUS_TONE[row.status] ?? 'bg-surface-muted text-slate'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-semibold text-ink">{formatINR(row.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="px-3 pt-3 text-xs text-muted" colSpan={4}>
                  {sortedRows.length} booking{sortedRows.length === 1 ? '' : 's'} shown
                </td>
                <td className="px-3 pt-3 text-right text-xs font-medium text-muted" colSpan={2}>
                  {formatINR(totalShown)} total
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
