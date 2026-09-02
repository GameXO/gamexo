import StatCard from './StatCard'
import MonthlyRevenueCard from './MonthlyRevenueCard'
import SportPopularityCard from './SportPopularityCard'
import QuickStatsCard from './QuickStatsCard'
import RevenueTrendChart from './RevenueTrendChart'
import RevenueByChannelCard from './RevenueByChannelCard'
import PrimeHoursCard from './PrimeHoursCard'
import LatestBookingsTable from './LatestBookingsTable'
import { useDashboardStatCards, type StatCardData } from '../dashboard/useDashboardStats'
import type { View } from '../App'

const LOADING_CARDS: StatCardData[] = [
  "Today's Revenue",
  'Bookings Today',
  'Available Courts',
  'Outstanding Dues',
].map((label) => ({ label, value: '—', trend: { value: '—', sentiment: 'up', caption: 'loading…' } }))

export default function Dashboard({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const statCards = useDashboardStatCards()

  return (
    <div className="flex flex-1 flex-col items-start gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <p className="w-full text-lg text-ink">Today's Overview</p>

      <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {(statCards ?? LOADING_CARDS).map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>

      <div className="flex w-full flex-col items-stretch gap-5 lg:flex-row">
        <MonthlyRevenueCard />
        <SportPopularityCard />
        <QuickStatsCard />
      </div>

      <RevenueTrendChart />

      <div className="flex w-full flex-col items-stretch gap-5 lg:flex-row">
        <RevenueByChannelCard />
        <PrimeHoursCard />
      </div>

      <LatestBookingsTable onNavigate={onNavigate} />
    </div>
  )
}
