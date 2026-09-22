import { useCourtStatusSummary, useKpis } from '../api/hooks'
import {
  comparisonCaption,
  diffChange,
  formatINRCompact,
  previousPeriod,
  pctChange,
  type DashboardRange,
  type Trend,
} from './insights'

export type StatCardData = { label: string; value: string; trend: Trend }

/** The four headline stat cards — all real, all comparable against the period
 *  immediately before the selected one, except court occupancy and outstanding
 *  dues, which are point-in-time snapshots with no earlier equivalent worth
 *  faking. Returns `null` while any of the three underlying queries is still
 *  loading. */
export function useDashboardStatCards(range: DashboardRange): StatCardData[] | null {
  const previous = previousPeriod(range)
  const kpisCurrent = useKpis(range.fromISO, range.toISO)
  const kpisPrevious = useKpis(previous.fromISO, previous.toISO)
  const courts = useCourtStatusSummary()

  if (!kpisCurrent.data || !kpisPrevious.data || !courts.data) return null

  const revenue = Number(kpisCurrent.data.total_revenue)
  const revenuePrevious = Number(kpisPrevious.data.total_revenue)
  const bookings = kpisCurrent.data.total_bookings
  const bookingsPrevious = kpisPrevious.data.total_bookings
  const outstanding = Number(kpisCurrent.data.outstanding_dues)
  const occupiedShare = courts.data.total ? courts.data.occupied / courts.data.total : 0
  const caption = comparisonCaption(range.preset)

  return [
    {
      label: 'Revenue',
      value: formatINRCompact(revenue),
      trend: { ...pctChange(revenue, revenuePrevious), caption },
    },
    {
      label: 'Bookings',
      value: String(bookings),
      trend: { ...diffChange(bookings, bookingsPrevious), caption },
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
