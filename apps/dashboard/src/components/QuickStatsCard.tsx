import { useMemo } from 'react'
import { useBookingsInRange, useKpis } from '../api/hooks'
import { channelOf, formatINRCompact, type DashboardRange } from '../dashboard/insights'
import cardIcon from '../assets/figma/card-icon.svg'

/** Counter activity over the selected period, read straight off its raw
 *  bookings — no invented "memberships renewed" or "equipment issued" figures
 *  the API has no cheap way to answer. */
export default function QuickStatsCard({ range }: { range: DashboardRange }) {
  const bookings = useBookingsInRange(range.fromISO, range.toISO)
  const kpis = useKpis(range.fromISO, range.toISO)

  const stats = useMemo(() => {
    const items = bookings.data ?? []
    const completed = items.filter((b) => b.status === 'completed').length
    const walkins = items.filter((b) => channelOf(b) === 'walkin').length
    const thirdParty = items.filter((b) => channelOf(b) === 'third_party').length
    const avgValue = kpis.data ? Number(kpis.data.average_booking_value) : 0
    return [
      { label: 'Completed Bookings', value: String(completed) },
      { label: 'Walk-ins', value: String(walkins) },
      { label: 'Third-Party Bookings', value: String(thirdParty) },
      { label: 'Avg. Booking Value', value: formatINRCompact(avgValue) },
    ]
  }, [bookings.data, kpis.data])

  return (
    <div className="flex h-full flex-[1_0_0] flex-col items-start gap-8 self-stretch overflow-hidden rounded-xl border border-border-card bg-surface p-5">
      <div className="flex w-full items-center gap-6">
        <div className="flex flex-1 items-center gap-2.5">
          <img src={cardIcon} alt="" className="size-5" />
          <p className="text-sm font-medium text-ink">Quick Stats</p>
        </div>
        <span className="text-xs font-medium text-slate">{range.label}</span>
      </div>

      <div className="grid w-full flex-1 grid-cols-2 gap-3 text-ink">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex flex-col items-start justify-center gap-2 rounded-lg border border-border-card bg-surface-muted px-5 py-2.5"
          >
            <p className="text-xs">{stat.label}</p>
            <p className="text-base font-semibold">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
