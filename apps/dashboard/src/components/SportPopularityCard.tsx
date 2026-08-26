import { sportPopularity } from '../data/mockData'
import discountTag from '../assets/figma/discount-tag.svg'
import chevronDown from '../assets/figma/chevron-down.svg'

const max = Math.max(...sportPopularity.map((s) => s.revenue))

export default function SportPopularityCard() {
  return (
    <div className="flex h-full flex-[1_0_0] flex-col items-start gap-8 self-stretch overflow-hidden rounded-xl border border-border-card bg-surface p-5">
      <div className="flex w-full items-center gap-6">
        <div className="flex flex-1 items-center gap-2.5">
          <img src={discountTag} alt="" className="size-5" />
          <p className="text-sm font-medium text-ink">Sport Popularity</p>
        </div>
        <button
          type="button"
          className="flex shrink-0 items-center gap-3 rounded-lg border border-border-input bg-surface px-3 py-2 shadow-[0px_1px_2px_0px_rgba(82,88,102,0.09)]"
        >
          <span className="text-xs font-medium tracking-[-0.24px] text-slate">This month</span>
          <img src={chevronDown} alt="" className="w-2.5 h-auto shrink-0" />
        </button>
      </div>

      <div className="flex w-full flex-col items-start justify-end gap-5">
        {sportPopularity.map((row) => (
          <div key={row.sport} className="flex w-full items-center gap-4">
            <p className="w-[76px] shrink-0 text-xs font-medium text-slate">{row.sport}</p>
            <div className="h-[15px] flex-1 rounded overflow-hidden bg-surface-muted">
              <div
                className="h-full rounded"
                style={{
                  width: `${(row.revenue / max) * 100}%`,
                  backgroundImage: 'linear-gradient(to right, #336b4c, #07ad52)',
                }}
              />
            </div>
            <p className="w-[60px] shrink-0 text-right text-xs font-medium text-ink">
              {row.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
