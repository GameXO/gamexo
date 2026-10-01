import { useEffect, useState } from 'react'
import { pad } from '../lib/format'
import { asset } from '../lib/asset'

const homeNav = asset('pos/checkin/home-nav-2.svg')

export const HOME_COUNTDOWN_SECONDS = 15

function useCountdown(totalSeconds: number, onDone: () => void) {
  const [remaining, setRemaining] = useState(totalSeconds)

  useEffect(() => {
    if (remaining <= 0) {
      onDone()
      return
    }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining])

  return remaining
}

/** Auto-navigates home after `seconds`, showing a filling progress bar and a live
 *  countdown — also clickable for an immediate exit. Shared by every flow's success step. */
export default function HomeCountdownButton({
  seconds = HOME_COUNTDOWN_SECONDS,
  onHome,
}: {
  seconds?: number
  onHome: () => void
}) {
  const remaining = useCountdown(seconds, onHome)

  return (
    <button
      type="button"
      onClick={onHome}
      className="relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-[#FAFAFA] py-[clamp(0.875rem,1.6vw,1.125rem)] text-[clamp(1rem,1.2vw,1.125rem)] font-bold text-ink"
    >
      <span
        aria-hidden
        className="absolute inset-0 origin-left bg-lime"
        style={{ animation: `fill-progress ${seconds}s linear forwards` }}
      />
      <span className="relative flex items-center gap-2">
        <img src={homeNav} alt="" className="size-[clamp(1.1rem,1.4vw,1.5rem)]" />
        Home
        <span className="text-[clamp(0.75rem,0.9vw,0.8125rem)] font-medium text-muted">0:{pad(remaining)}</span>
      </span>
    </button>
  )
}
