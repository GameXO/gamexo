import StatCard from './StatCard'
import MonthlyRevenueCard from './MonthlyRevenueCard'
import SportPopularityCard from './SportPopularityCard'
import QuickStatsCard from './QuickStatsCard'
import RevenueTrendChart from './RevenueTrendChart'
import RevenueByChannelCard from './RevenueByChannelCard'
import PrimeHoursCard from './PrimeHoursCard'
import LatestBookingsTable from './LatestBookingsTable'
import { useDashboardStatCards, type StatCardData } from '../dashboard/useDashboardStats'
import type { DashboardRange } from '../dashboard/insights'
import type { View } from '../App'

const LOADING_CARDS: StatCardData[] = [
  'Revenue',
  'Bookings',
  'Available Courts',
  'Outstanding Dues',
].map((label) => ({ label, value: '—', trend: { value: '—', sentiment: 'up', caption: 'loading…' } }))

export default function Dashboard({
  onNavigate,
  range,
}: {
  onNavigate?: (view: View) => void
  range: DashboardRange
}) {
  const statCards = useDashboardStatCards(range)

  return (
    <div className="flex flex-1 flex-col items-start gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <p className="w-full text-lg text-ink">
        {range.preset === 'custom' ? `Overview · ${range.label}` : `${range.label}’s Overview`}
      </p>

      <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {(statCards ?? LOADING_CARDS).map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>

      <div className="flex w-full flex-col items-stretch gap-5 lg:flex-row">
        <MonthlyRevenueCard range={range} />
        <SportPopularityCard range={range} />
        <QuickStatsCard range={range} />
      </div>

      <RevenueTrendChart />

      <div className="flex w-full flex-col items-stretch gap-5 lg:flex-row">
        <RevenueByChannelCard range={range} />
        <PrimeHoursCard range={range} />
      </div>

      <LatestBookingsTable onNavigate={onNavigate} />
    </div>
  )
}
