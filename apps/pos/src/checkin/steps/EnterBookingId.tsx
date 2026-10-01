import { useEffect } from 'react'
import Keyboard from '../../ui/Keyboard'
import { asset } from '../../lib/asset'

const arrowRight = asset('pos/checkin/arrow-right-check.svg')

const MAX_LENGTH = 24

export default function EnterBookingId({
  code,
  setCode,
  onSubmit,
  label = 'Enter Booking ID',
  submitLabel = 'Check In',
}: {
  code: string
  setCode: (v: string) => void
  onSubmit: () => void
  label?: string
  submitLabel?: string
}) {
  const ready = code.trim().length > 0

  const pressChar = (c: string) => setCode(code.length < MAX_LENGTH ? code + c : code)
  const backspace = () => setCode(code.slice(0, -1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[a-zA-Z0-9]$/.test(e.key)) pressChar(e.key.toUpperCase())
      else if (e.key === '-') pressChar('-')
      else if (e.key === 'Backspace') backspace()
      else if (e.key === 'Enter' && ready) onSubmit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex w-full max-w-[420px] flex-col items-center gap-[clamp(2rem,5vw,4.1875rem)]">
      <div className="flex w-full flex-col items-start gap-3">
        <p className="text-[clamp(0.9375rem,1.1vw,1rem)] font-medium text-ink">{label}</p>
        <div className="flex w-full items-center overflow-hidden rounded-xl border-2 border-white bg-border-input px-[clamp(0.9rem,1.6vw,1.0625rem)] py-[clamp(0.9rem,1.8vw,1.5rem)] shadow-[0px_12px_17px_-9px_rgba(0,0,0,0.12)]">
          <span className="truncate text-[clamp(1.1rem,1.7vw,1.375rem)] font-medium tracking-wide text-ink">
            {code || <span className="text-muted">e.g. BK-A1B2C3 or your platform's booking ID</span>}
          </span>
        </div>
      </div>

      <div className="flex w-full flex-col items-center gap-[clamp(1.25rem,2.6vw,2.1875rem)]">
        <Keyboard onChar={pressChar} onSpace={() => {}} onBackspace={backspace} />

        <button
          type="button"
          disabled={!ready}
          onClick={onSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-[clamp(0.875rem,1.6vw,1.125rem)] text-[clamp(1rem,1.2vw,1.125rem)] font-bold text-white transition-opacity disabled:opacity-40"
        >
          {submitLabel}
          <img src={arrowRight} alt="" className="size-[clamp(1.1rem,1.4vw,1.5rem)]" />
        </button>
      </div>
    </div>
  )
}
