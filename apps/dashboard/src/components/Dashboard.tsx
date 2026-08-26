import StatCard from './StatCard'
import MonthlyRevenueCard from './MonthlyRevenueCard'
import SportPopularityCard from './SportPopularityCard'
import QuickStatsCard from './QuickStatsCard'
import RevenueTrendChart from './RevenueTrendChart'
import { statCards } from '../data/mockData'

export default function Dashboard() {
  return (
    <div className="flex flex-1 flex-col items-start gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <p className="w-full text-lg text-ink">Today's Overview</p>

      <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>

      <div className="flex w-full flex-col items-stretch gap-5 lg:flex-row">
        <MonthlyRevenueCard />
        <SportPopularityCard />
        <QuickStatsCard />
      </div>

      <RevenueTrendChart />
    </div>
  )
}
