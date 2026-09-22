import { useMemo } from 'react'
import { useBookingsInRange, useSports } from '../api/hooks'
import { formatHourRange, primeHoursBySport, type DashboardRange } from '../dashboard/insights'
import bolt from '../assets/figma/bolt.svg'

/** The single busiest hour of day per sport over the selected period — the slot
 *  a turf prices its peak rate around. Read straight off each booking's own
 *  `starts_at`, not a guess. */
export default function PrimeHoursCard({ range }: { range: DashboardRange }) {
  const bookings = useBookingsInRange(range.fromISO, range.toISO)
  // Includes sports since retired — see SportPopularityCard.
  const sports = useSports(true)

  const rows = useMemo(() => {
    const nameOf = (id: string) => sports.data?.find((s) => s.id === id)?.name ?? 'Other'
    return primeHoursBySport(bookings.data ?? [], nameOf).slice(0, 5)
  }, [bookings.data, sports.data])

  const loading = bookings.isPending || sports.isPending

  return (
    <div className="flex h-full flex-1 flex-col items-start gap-8 self-stretch overflow-hidden rounded-xl border border-border-card bg-surface p-5">
      <div className="flex w-full items-center gap-6">
        <div className="flex flex-1 items-center gap-2.5">
          <img src={bolt} alt="" className="size-5" />
          <p className="text-sm font-medium text-ink">Prime Hours by Sport</p>
        </div>
        <span className="text-xs font-medium text-slate">{range.label}</span>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">No bookings in this period.</p>
      ) : (
        <div className="flex w-full flex-col gap-3">
          {rows.map((row) => (
            <div
              key={row.sportId}
              className="flex w-full items-center justify-between rounded-lg border border-border-card bg-surface-muted px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{row.sport}</p>
                <p className="text-xs text-muted">
                  {row.totalBookings} booking{row.totalBookings === 1 ? '' : 's'}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-ink">{formatHourRange(row.hour)}</p>
                <p className="text-xs text-muted">{row.bookingsAtPeak} at peak</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
