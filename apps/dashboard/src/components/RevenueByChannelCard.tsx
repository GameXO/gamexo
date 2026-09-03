import { useMemo } from 'react'
import { useBookingsInRange } from '../api/hooks'
import {
  formatINRCompact,
  revenueByChannel,
  type ChannelKey,
  type DashboardRange,
} from '../dashboard/insights'
import storeManagement from '../assets/figma/store-management.svg'

const CHANNEL_GRADIENT: Record<ChannelKey, string> = {
  walkin: 'linear-gradient(to right, #336b4c, #07ad52)',
  online: 'linear-gradient(to right, #4b3b73, #9b6bd1)',
  third_party: 'linear-gradient(to right, #b5581a, #f58161)',
}

/** How the selected period's revenue arrived: counter walk-ins, the venue's own
 *  online gateway, or a partner platform (Playo, Hudle, …) — split on
 *  `booking_type` and `source_platform`, the same fields the booking record
 *  itself carries. */
export default function RevenueByChannelCard({ range }: { range: DashboardRange }) {
  const bookings = useBookingsInRange(range.fromISO, range.toISO)

  const rows = useMemo(() => revenueByChannel(bookings.data ?? []), [bookings.data])
  const total = rows.reduce((sum, r) => sum + r.revenue, 0)
  const max = Math.max(1, ...rows.map((r) => r.revenue))

  return (
    <div className="flex h-full flex-1 flex-col items-start gap-8 self-stretch overflow-hidden rounded-xl border border-border-card bg-surface p-5">
      <div className="flex w-full items-center gap-6">
        <div className="flex flex-1 items-center gap-2.5">
          <img src={storeManagement} alt="" className="size-5" />
          <p className="text-sm font-medium text-ink">Revenue by Booking Type</p>
        </div>
        <span className="text-xs font-medium text-slate">{range.label}</span>
      </div>

      {bookings.isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">No bookings in this period.</p>
      ) : (
        <div className="flex w-full flex-col items-start justify-end gap-5">
          {rows.map((row) => (
            <div key={row.key} className="flex w-full items-center gap-4">
              <p className="w-[100px] shrink-0 truncate text-xs font-medium text-slate">{row.label}</p>
              <div className="h-[15px] flex-1 rounded overflow-hidden bg-surface-muted">
                <div
                  className="h-full rounded"
                  style={{ width: `${(row.revenue / max) * 100}%`, backgroundImage: CHANNEL_GRADIENT[row.key] }}
                />
              </div>
              <p className="w-[60px] shrink-0 text-right text-xs font-medium text-ink">
                {formatINRCompact(row.revenue)}
              </p>
            </div>
          ))}
          <p className="w-full text-right text-xs text-muted">{formatINRCompact(total)} total</p>
        </div>
      )}
    </div>
  )
}
