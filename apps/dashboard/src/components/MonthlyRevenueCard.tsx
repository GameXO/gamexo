import { monthlyRevenueTarget as data } from '../data/mockData'
import chartPie from '../assets/figma/chart-pie.svg'
import legendDotTarget from '../assets/figma/legend-dot-a.svg'
import legendDotAchieved from '../assets/figma/legend-dot-b.svg'

const SIZE = 140
const STROKE = 14
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export default function MonthlyRevenueCard() {
  const pct = Math.min(1, data.achieved / data.target)
  const dash = CIRCUMFERENCE * pct

  return (
    <div className="flex h-full flex-1 flex-col items-start gap-8 self-stretch overflow-hidden rounded-xl border border-border-card bg-surface p-5">
      <div className="flex items-center gap-2.5 py-[9px]">
        <img src={chartPie} alt="" className="size-5" />
        <p className="text-sm font-medium text-ink">Monthly Revenue Target</p>
      </div>

      <div className="flex w-full flex-col items-center gap-8">
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} className="-rotate-90">
            <defs>
              <linearGradient id="revenueTargetGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#336B4C" />
                <stop offset="100%" stopColor="#07AD52" />
              </linearGradient>
            </defs>
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="#B3EABD"
              strokeWidth={STROKE}
            />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="url(#revenueTargetGradient)"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[14.4px] font-semibold text-ink">
              {(pct * 100).toFixed(2)}%
            </p>
          </div>
        </div>

        <div className="flex w-full items-center justify-center gap-6">
          <div className="flex items-center gap-1.5">
            <img src={legendDotTarget} alt="" className="size-3" />
            <span className="text-xs font-medium tracking-[-0.24px] text-slate">
              Target · {data.targetLabel}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <img src={legendDotAchieved} alt="" className="size-3" />
            <span className="text-xs font-medium tracking-[-0.24px] text-slate">
              Achieved · {data.achievedLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
