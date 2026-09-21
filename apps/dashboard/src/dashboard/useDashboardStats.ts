import { useCourtStatusSummary, useKpis } from '../api/hooks'
import { diffChange, formatINRCompact, pctChange, todayRange, yesterdayRange, type Trend } from './insights'

export type StatCardData = { label: string; value: string; trend: Trend }

/** The four headline stat cards — all real, all comparable day over day except
 *  court occupancy and outstanding dues, which are point-in-time snapshots with
 *  no "yesterday" equivalent worth faking. Returns `null` while any of the
 *  three underlying queries is still loading. */
export function useDashboardStatCards(): StatCardData[] | null {
  const today = todayRange()
  const yesterday = yesterdayRange()
  const kpisToday = useKpis(today.fromISO, today.toISO)
  const kpisYesterday = useKpis(yesterday.fromISO, yesterday.toISO)
  const courts = useCourtStatusSummary()

  if (!kpisToday.data || !kpisYesterday.data || !courts.data) return null

  const revenueToday = Number(kpisToday.data.total_revenue)
  const revenueYesterday = Number(kpisYesterday.data.total_revenue)
  const bookingsToday = kpisToday.data.total_bookings
  const bookingsYesterday = kpisYesterday.data.total_bookings
  const outstanding = Number(kpisToday.data.outstanding_dues)
  const occupiedShare = courts.data.total ? courts.data.occupied / courts.data.total : 0

  return [
    {
      label: "Today's Revenue",
      value: formatINRCompact(revenueToday),
      trend: { ...pctChange(revenueToday, revenueYesterday), caption: 'vs yesterday' },
    },
    {
      label: 'Bookings Today',
      value: String(bookingsToday),
      trend: { ...diffChange(bookingsToday, bookingsYesterday), caption: 'vs yesterday' },
    },
    {
      label: 'Available Courts',
      value: `${courts.data.available} / ${courts.data.total}`,
      trend: {
        value: `${courts.data.occupied} in use`,
        sentiment: occupiedShare >= 0.5 ? 'down' : 'up',
        caption: 'right now',
      },
    },
    {
      label: 'Outstanding Dues',
      value: formatINRCompact(outstanding),
      trend: {
        value: outstanding > 0 ? 'Unpaid' : 'Clear',
        sentiment: outstanding > 0 ? 'down' : 'up',
        caption: 'across all invoices',
      },
    },
  ]
}
