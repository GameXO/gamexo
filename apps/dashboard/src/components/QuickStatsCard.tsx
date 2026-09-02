import { useMemo } from 'react'
import { useBookingsInRange, useKpis } from '../api/hooks'
import { channelOf, formatINRCompact, todayRange } from '../dashboard/insights'
import cardIcon from '../assets/figma/card-icon.svg'

/** Today's counter activity, read straight off today's raw bookings — no
 *  invented "memberships renewed" or "equipment issued" figures the API has
 *  no cheap way to answer. */
export default function QuickStatsCard() {
  const { fromISO, toISO } = todayRange()
  const bookings = useBookingsInRange(fromISO, toISO)
  const kpis = useKpis(fromISO, toISO)

  const stats = useMemo(() => {
    const items = bookings.data ?? []
    const completed = items.filter((b) => b.status === 'completed').length
    const walkins = items.filter((b) => channelOf(b) === 'walkin').length
    const thirdParty = items.filter((b) => channelOf(b) === 'third_party').length
    const avgValue = kpis.data ? Number(kpis.data.average_booking_value) : 0
    return [
      { label: 'Completed Bookings Today', value: String(completed) },
      { label: 'Walk-ins Today', value: String(walkins) },
      { label: 'Third-Party Bookings Today', value: String(thirdParty) },
      { label: 'Avg. Booking Value Today', value: formatINRCompact(avgValue) },
    ]
  }, [bookings.data, kpis.data])

  return (
    <div className="flex h-full flex-[1_0_0] flex-col items-start gap-8 self-stretch overflow-hidden rounded-xl border border-border-card bg-surface p-5">
      <div className="flex w-full items-center gap-6">
        <div className="flex flex-1 items-center gap-2.5">
          <img src={cardIcon} alt="" className="size-5" />
          <p className="text-sm font-medium text-ink">Quick Stats</p>
        </div>
        <span className="text-xs font-medium text-slate">Today</span>
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
