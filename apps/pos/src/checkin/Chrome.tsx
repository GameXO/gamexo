import type { ReactNode } from 'react'
import { asset } from '../lib/asset'

const arrowLeft = asset('pos/checkin/arrow-left.svg')
const homeNav = asset('pos/checkin/home-nav.svg')

function NavPill({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-xl bg-surface px-[clamp(1rem,1.6vw,1.375rem)] py-[clamp(0.5rem,1.3dvh,0.875rem)] text-[clamp(0.875rem,1vw,1rem)] font-semibold text-ink"
    >
      <img src={icon} alt="" className="size-[clamp(1.1rem,1.4vw,1.5rem)]" />
      {label}
    </button>
  )
}

export function CheckinFooter({
  onBack,
  onHome,
  step,
  totalSteps,
  rightExtra,
}: {
  onBack?: () => void
  onHome?: () => void
  step?: number
  totalSteps?: number
  rightExtra?: ReactNode
}) {
  const showProgress = !!step && !!totalSteps

  return (
    <footer className="flex w-full shrink-0 items-center justify-between gap-4 px-[clamp(1.25rem,3vw,3.25rem)] py-[clamp(0.625rem,1.8dvh,1.75rem)]">
      <div className="flex items-center gap-[clamp(0.75rem,1.4vw,1.25rem)]">
        {onBack && <NavPill icon={arrowLeft} label="Back" onClick={onBack} />}
        {onHome && <NavPill icon={homeNav} label="Home" onClick={onHome} />}
      </div>

      {rightExtra ?? (showProgress ? (
        <div className="flex items-center gap-[clamp(0.625rem,1vw,0.9375rem)]">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalSteps }).map((_, i) => {
              const idx = i + 1
              const active = idx === step
              return (
                <span
                  key={idx}
                  className={`h-2.5 rounded-full transition-all ${active ? 'w-9 bg-lime' : 'w-2.5 bg-[#d5d5d5]'}`}
                />
              )
            })}
          </div>
          <p className="text-[clamp(0.9375rem,1.3vw,1.375rem)] font-semibold text-[#b0b0b0]">
            {step}/{totalSteps}
          </p>
        </div>
      ) : (
        <span />
      ))}
    </footer>
  )
}
