import { quickStats } from '../data/mockData'
import cardIcon from '../assets/figma/card-icon.svg'
import chevronDown from '../assets/figma/chevron-down.svg'

export default function QuickStatsCard() {
  return (
    <div className="flex h-full flex-[1_0_0] flex-col items-start gap-8 self-stretch overflow-hidden rounded-xl border border-border-card bg-surface p-5">
      <div className="flex w-full items-center gap-6">
        <div className="flex flex-1 items-center gap-2.5">
          <img src={cardIcon} alt="" className="size-5" />
          <p className="text-sm font-medium text-ink">Quick Stats</p>
        </div>
        <button
          type="button"
          className="flex shrink-0 items-center gap-3 rounded-lg border border-border-input bg-surface px-3 py-2 shadow-[0px_1px_2px_0px_rgba(82,88,102,0.09)]"
        >
          <span className="text-xs font-medium tracking-[-0.24px] text-slate">This month</span>
          <img src={chevronDown} alt="" className="w-2.5 h-auto shrink-0" />
        </button>
      </div>

      <div className="grid w-full flex-1 grid-cols-2 gap-3 text-ink">
        {quickStats.map((stat) => (
          <div
            key={stat.label}
            className="flex flex-col items-start justify-center gap-2 rounded-lg border border-border-card bg-surface-muted px-5 py-2.5"
          >
            <p className="text-xs">{stat.label}</p>
            <p className="text-base font-semibold">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
