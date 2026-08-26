import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { revenueTrend } from '../data/mockData'
import chartHistogram from '../assets/figma/chart-histogram.svg'
import legendDotRevenue from '../assets/figma/legend-dot-c.svg'
import legendDotRefunds from '../assets/figma/legend-dot-d.svg'
import chevronDown from '../assets/figma/chevron-down.svg'

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
          {p.dataKey === 'revenue' ? 'Revenue' : 'Refunds'}: ₹{p.value}L
        </p>
      ))}
    </div>
  )
}

export default function RevenueTrendChart() {
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
            <img src={legendDotRefunds} alt="" className="size-3" />
            <span className="text-xs font-medium tracking-[-0.24px] text-muted">
              Refunds
            </span>
          </div>
        </div>
        <button
          type="button"
          className="flex shrink-0 items-center gap-3 rounded-lg border border-border-input bg-surface px-3 py-2 shadow-[0px_1px_2px_0px_rgba(82,88,102,0.09)]"
        >
          <span className="text-xs font-medium tracking-[-0.24px] text-slate">12 months</span>
          <img src={chevronDown} alt="" className="w-2.5 h-auto shrink-0" />
        </button>
      </div>

      <div className="h-[257px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={revenueTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#ebf0f4" />
            <XAxis
              dataKey="month"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#8c8c8c', fontSize: 11 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#8c8c8c', fontSize: 11 }}
              tickFormatter={(v) => `₹${v}L`}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#07ad52"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 5, fill: '#07ad52' }}
            />
            <Line
              type="monotone"
              dataKey="refunds"
              stroke="#1a1a1a"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5, fill: '#1a1a1a' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
