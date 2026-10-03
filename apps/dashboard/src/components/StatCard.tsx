import type { Trend } from '../dashboard/insights'
import { asset } from '../lib/asset'
import Card from '../ui/Card'

const dotSeparator = asset('dashboard/dot-separator.svg')

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
    <Card title={label} bodyClassName="flex flex-col items-start gap-5">
      <p className="text-[27px] font-semibold leading-[1.2] tracking-[0.28px] text-ink">{value}</p>
      <div className="flex items-center gap-2 text-sm leading-[1.5]">
        <span className={`font-medium ${trend.sentiment === 'up' ? 'text-positive' : 'text-negative'}`}>
          {trend.value}
        </span>
        <img src={dotSeparator} alt="" className="size-1" />
        <span className="font-medium text-slate">{trend.caption}</span>
      </div>
    </Card>
  )
}
