import { useMemo } from 'react'
import { useBookingsInRange, useSports } from '../api/hooks'
import { formatINRCompact, revenueBySport, type DashboardRange } from '../dashboard/insights'
import discountTag from '../assets/figma/discount-tag.svg'

/** Revenue by sport over the selected period — summed straight off each
 *  booking's own `total`, not a booking-count proxy for it. */
export default function SportPopularityCard({ range }: { range: DashboardRange }) {
  const bookings = useBookingsInRange(range.fromISO, range.toISO)
  // Includes sports since retired — a booking made while one was still active
  // shouldn't lose its label the moment it's turned off.
  const sports = useSports(true)

  const rows = useMemo(() => {
    const nameOf = (id: string) => sports.data?.find((s) => s.id === id)?.name ?? 'Other'
    return revenueBySport(bookings.data ?? [], nameOf).slice(0, 5)
  }, [bookings.data, sports.data])

  const max = Math.max(1, ...rows.map((r) => r.revenue))
  const loading = bookings.isPending || sports.isPending

  return (
    <div className="flex h-full flex-[1_0_0] flex-col items-start gap-8 self-stretch overflow-hidden rounded-xl border border-border-card bg-surface p-5">
      <div className="flex w-full items-center gap-6">
        <div className="flex flex-1 items-center gap-2.5">
          <img src={discountTag} alt="" className="size-5" />
          <p className="text-sm font-medium text-ink">Revenue by Sport</p>
        </div>
        <span className="text-xs font-medium text-slate">{range.label}</span>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">No bookings in this period.</p>
      ) : (
        <div className="flex w-full flex-col items-start justify-end gap-5">
          {rows.map((row) => (
            <div key={row.sportId} className="flex w-full items-center gap-4">
              <p className="w-[76px] shrink-0 truncate text-xs font-medium text-slate">{row.sport}</p>
              <div className="h-[15px] flex-1 rounded overflow-hidden bg-surface-muted">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${(row.revenue / max) * 100}%`,
                    backgroundImage: 'linear-gradient(to right, #336b4c, #07ad52)',
                  }}
                />
              </div>
              <p className="w-[60px] shrink-0 text-right text-xs font-medium text-ink">
                {formatINRCompact(row.revenue)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
