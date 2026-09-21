import { useMemo } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useRevenueTrend } from '../api/hooks'
import { formatINRCompact, monthRange, pctChange } from '../dashboard/insights'
import chartPie from '../assets/figma/chart-pie.svg'

// The two bars are ordinal, not categorical — "last month" and "this month"
// have a fixed order, so one hue stepped by lightness (light = older, accent
// = current) is the correct encoding, not a second hue. Reuses this app's own
// established revenue-green rather than introducing a new color.
const TRACK_HEIGHT = 96
const BAR_WIDTH = 56

/**
 * There is no revenue *target* anywhere in the API — a turf's goal for the
 * month is a business decision nobody has entered, not a number to invent. So
 * this compares two real figures instead: this month's collected revenue
 * against last month's, which is exactly the baseline an owner judges "on
 * track" against.
 */
export default function MonthlyRevenueCard() {
  const lastMonth = monthRange(-1)
  const thisMonth = monthRange(0)
  const revenue = useRevenueTrend(lastMonth.fromISO)

  const { achieved, target } = useMemo(() => {
    const rows = revenue.data ?? []
    const find = (label: string) => Number(rows.find((r) => r.month === label)?.revenue ?? 0)
    return { achieved: find(thisMonth.label), target: find(lastMonth.label) }
  }, [revenue.data, thisMonth.label, lastMonth.label])

  const change = pctChange(achieved, target)
  const diff = achieved - target
  const max = Math.max(1, achieved, target)
  const barHeight = (value: number) => (value > 0 ? Math.max(6, (value / max) * TRACK_HEIGHT) : 4)

  return (
    <div className="flex h-full flex-1 flex-col items-start gap-6 self-stretch overflow-hidden rounded-xl border border-border-card bg-surface p-5">
      <div className="flex items-center gap-2.5 py-[9px]">
        <img src={chartPie} alt="" className="size-5" />
        <p className="text-sm font-medium text-ink">This Month vs Last Month</p>
      </div>

      <div className="flex w-full flex-col items-start gap-1">
        <div className="flex items-baseline gap-2.5">
          <p className="text-[28px] font-semibold leading-[1.2] tracking-[0.28px] text-ink">
            {formatINRCompact(achieved)}
          </p>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
              change.sentiment === 'up' ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative'
            }`}
          >
            {change.sentiment === 'up' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {change.value}
          </span>
        </div>
        <p className="text-xs font-medium text-slate">
          {formatINRCompact(Math.abs(diff))} {diff >= 0 ? 'more' : 'less'} than {lastMonth.label}
        </p>
      </div>

      <div className="flex w-full flex-1 items-end justify-center gap-10 pt-2">
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs font-medium text-slate">{formatINRCompact(target)}</span>
          <div
            title={`${lastMonth.label}: ${formatINRCompact(target)}`}
            className="rounded-t-lg bg-[#B3EABD] transition-[height]"
            style={{ width: BAR_WIDTH, height: barHeight(target) }}
          />
          <span className="text-xs font-medium text-muted">{lastMonth.label}</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <span className="text-xs font-semibold text-ink">{formatINRCompact(achieved)}</span>
          <div
            title={`${thisMonth.label}: ${formatINRCompact(achieved)}`}
            className="rounded-t-lg transition-[height]"
            style={{
              width: BAR_WIDTH,
              height: barHeight(achieved),
              backgroundImage: 'linear-gradient(180deg, #07AD52 0%, #336B4C 100%)',
            }}
          />
          <span className="text-xs font-medium text-ink">{thisMonth.label}</span>
        </div>
      </div>
    </div>
  )
}
