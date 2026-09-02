import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { useRevenueTrend } from '../api/hooks'
import { formatINRCompact, lastNMonthLabels, monthsAgoStart } from '../dashboard/insights'
import chartHistogram from '../assets/figma/chart-histogram.svg'
import legendDotRevenue from '../assets/figma/legend-dot-c.svg'
import legendDotBookings from '../assets/figma/legend-dot-d.svg'

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { value: number; dataKey: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border-card bg-white px-3 py-2 shadow-lg">
      <p className="mb-1 text-xs font-semibold text-ink">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-xs text-slate">
          {p.dataKey === 'revenue' ? `Revenue: ${formatINRCompact(p.value)}` : `Bookings: ${p.value}`}
        </p>
      ))}
    </div>
  )
}

/** Revenue collected and bookings taken, by month — `/reports/revenue` over a
 *  rolling 12-month window. Two different units (₹ and a count), so two axes
 *  rather than forcing bookings onto the same Lakhs scale as money. */
export default function RevenueTrendChart() {
  const trend = useRevenueTrend(monthsAgoStart(11))
  const byMonth = new Map((trend.data ?? []).map((r) => [r.month, r]))
  const data = lastNMonthLabels(12).map((month) => {
    const point = byMonth.get(month)
    return { month, revenue: point ? Number(point.revenue) : 0, bookings: point?.bookings ?? 0 }
  })
  const hasData = data.some((d) => d.revenue > 0 || d.bookings > 0)

  return (
    <div className="flex w-full shrink-0 flex-col items-center gap-6 overflow-hidden rounded-xl border border-border-input bg-surface p-4 sm:p-6">
      <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-1 items-center gap-2.5">
          <img src={chartHistogram} alt="" className="size-5" />
          <p className="text-sm font-medium text-ink">Revenue Trends</p>
        </div>
        <div className="flex items-center gap-[22px]">
          <div className="flex items-center gap-1.5">
            <img src={legendDotRevenue} alt="" className="size-3" />
            <span className="text-xs font-medium tracking-[-0.24px] text-muted">
              Revenue
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <img src={legendDotBookings} alt="" className="size-3" />
            <span className="text-xs font-medium tracking-[-0.24px] text-muted">
              Bookings
            </span>
          </div>
        </div>
        <span className="shrink-0 text-xs font-medium text-slate">Last 12 months</span>
      </div>

      {!hasData ? (
        <div className="flex h-[257px] w-full items-center justify-center text-sm text-muted">
          {trend.isPending ? 'Loading…' : 'No revenue recorded yet.'}
        </div>
      ) : (
        <div className="h-[257px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#ebf0f4" />
              <XAxis
                dataKey="month"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#8c8c8c', fontSize: 11 }}
              />
              <YAxis
                yAxisId="revenue"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#8c8c8c', fontSize: 11 }}
                tickFormatter={(v) => formatINRCompact(v)}
                width={48}
              />
              <YAxis
                yAxisId="bookings"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#8c8c8c', fontSize: 11 }}
                width={32}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                yAxisId="revenue"
                type="monotone"
                dataKey="revenue"
                stroke="#07ad52"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: '#07ad52' }}
              />
              <Line
                yAxisId="bookings"
                type="monotone"
                dataKey="bookings"
                stroke="#1a1a1a"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, fill: '#1a1a1a' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
