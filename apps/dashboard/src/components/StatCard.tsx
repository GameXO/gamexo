import type { Trend } from '../data/mockData'
import dotSeparator from '../assets/figma/dot-separator.svg'

export default function StatCard({
  label,
  value,
  trend,
}: {
  label: string
  value: string
  trend: Trend
}) {
  return (
    <div className="flex items-center overflow-hidden rounded-xl border border-surface bg-surface p-5">
      <div className="flex min-w-0 flex-1 flex-col items-start gap-6">
        <p className="text-sm font-medium leading-[1.5] text-slate">{label}</p>
        <p className="text-[28px] font-semibold leading-[1.2] tracking-[0.28px] text-ink">
          {value}
        </p>
        <div className="flex items-center gap-2 text-sm leading-[1.5]">
          <span
            className={`font-medium ${trend.sentiment === 'up' ? 'text-positive' : 'text-negative'}`}
          >
            {trend.value}
          </span>
          <img src={dotSeparator} alt="" className="size-1" />
          <span className="font-medium text-slate">{trend.caption}</span>
        </div>
      </div>
    </div>
  )
}
