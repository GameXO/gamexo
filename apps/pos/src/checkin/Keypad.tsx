import { asset } from '../lib/asset'

const backspaceIcon = asset('pos/checkin/backspace.svg')

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

/** On-screen numeric pad for the counter's touchscreen. A hardware keyboard works too —
 *  callers also wire up digit/backspace keydown handlers alongside this. */
export default function Keypad({
  onDigit,
  onBackspace,
}: {
  onDigit: (digit: string) => void
  onBackspace: () => void
}) {
  return (
    <div className="grid w-full grid-cols-4 gap-[clamp(0.5rem,1.1vw,0.6875rem)]">
      {DIGITS.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onDigit(d)}
          className="aspect-square rounded-2xl bg-surface text-[clamp(1.15rem,2vw,1.5rem)] font-semibold text-ink transition-colors hover:bg-surface-muted active:scale-[0.96] active:bg-border-input"
        >
          {d}
        </button>
      ))}
      <button
        type="button"
        onClick={onBackspace}
        aria-label="Delete digit"
        className="col-span-2 flex items-center justify-center rounded-2xl bg-border-input transition-colors hover:bg-[#d5d5d5] active:scale-[0.98]"
      >
        <img src={backspaceIcon} alt="" className="size-[clamp(1.1rem,1.6vw,1.5rem)] scale-y-[-1]" />
      </button>
    </div>
  )
}
