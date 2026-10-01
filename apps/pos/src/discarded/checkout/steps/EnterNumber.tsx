import { useEffect } from 'react'
import Keypad from '../../checkin/Keypad'
import { asset } from '../../../lib/asset'

const arrowRight = asset('pos/checkin/arrow-right-check.svg')

const MAX_LEN = 10

export default function EnterNumber({
  phone,
  setPhone,
  onSubmit,
}: {
  phone: string
  setPhone: (v: string) => void
  onSubmit: () => void
}) {
  const ready = phone.length === MAX_LEN

  const addDigit = (d: string) => setPhone(phone.length < MAX_LEN ? phone + d : phone)
  const backspace = () => setPhone(phone.slice(0, -1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) addDigit(e.key)
      else if (e.key === 'Backspace') backspace()
      else if (e.key === 'Enter' && ready) onSubmit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex w-full max-w-[360px] flex-col items-center gap-[clamp(2rem,5vw,4.1875rem)]">
      <div className="flex w-full flex-col items-start gap-3">
        <p className="text-[clamp(0.9375rem,1.1vw,1rem)] font-medium text-ink">Enter the customer's mobile number</p>
        <div className="flex w-full items-center gap-2.5">
          <div className="flex shrink-0 items-center gap-1.5 rounded-xl border-2 border-white bg-border-input px-3 py-[clamp(0.9rem,1.8vw,1.5rem)] text-[clamp(1rem,1.3vw,1.125rem)] font-medium text-ink shadow-[0px_12px_17px_-9px_rgba(0,0,0,0.12)]">
            +91
          </div>
          <div className="flex flex-1 items-center overflow-hidden rounded-xl border-2 border-white bg-border-input px-[clamp(0.9rem,1.6vw,1.0625rem)] py-[clamp(0.9rem,1.8vw,1.5rem)] shadow-[0px_12px_17px_-9px_rgba(0,0,0,0.12)]">
            <span className="truncate text-[clamp(1.1rem,1.7vw,1.375rem)] font-medium tracking-wide text-ink">
              {phone || <span className="text-muted">10-digit number</span>}
            </span>
          </div>
        </div>
      </div>

      <div className="flex w-full flex-col items-center gap-[clamp(1.25rem,2.6vw,2.1875rem)]">
        <Keypad onDigit={addDigit} onBackspace={backspace} />

        <button
          type="button"
          disabled={!ready}
          onClick={onSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-[clamp(0.875rem,1.6vw,1.125rem)] text-[clamp(1rem,1.2vw,1.125rem)] font-bold text-white transition-opacity disabled:opacity-40"
        >
          Find Session
          <img src={arrowRight} alt="" className="size-[clamp(1.1rem,1.4vw,1.5rem)]" />
        </button>
      </div>
    </div>
  )
}
