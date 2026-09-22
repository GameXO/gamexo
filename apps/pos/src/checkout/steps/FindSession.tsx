import { useEffect } from 'react'
import Keyboard from '../../ui/Keyboard'
import arrowRight from '../../assets/figma/checkin/arrow-right-check.svg'

/**
 * Find the session to settle.
 *
 * Was a ten-digit numeric pad that could only take a phone number, which meant a
 * customer who booked under someone else's number — or who could not remember which
 * one they used — could not be checked out at all without the desk going to the
 * dashboard.
 *
 * Now it is free text over the full keyboard, and the server searches name, phone
 * and booking reference together. Staff type whatever the customer offers.
 */

// Room for a full name. Longer than any reference or phone number, and short enough
// that a stuck key cannot fill the field unnoticed.
const MAX_LEN = 40

export default function FindSession({
  query,
  setQuery,
  searching,
  onSubmit,
}: {
  query: string
  setQuery: (v: string) => void
  searching: boolean
  onSubmit: () => void
}) {
  const ready = query.trim().length >= 2 && !searching

  const addChar = (ch: string) => setQuery(query.length < MAX_LEN ? query + ch : query)
  const backspace = () => setQuery(query.slice(0, -1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length === 1 && /^[A-Za-z0-9 @.+-]$/.test(e.key)) addChar(e.key)
      else if (e.key === 'Backspace') backspace()
      else if (e.key === 'Enter' && ready) onSubmit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex w-full max-w-[560px] flex-col items-center gap-[clamp(1.5rem,4vw,2.75rem)]">
      <div className="flex w-full flex-col items-start gap-3">
        <p className="text-[clamp(0.9375rem,1.1vw,1rem)] font-medium text-ink">
          Booking ID, name or mobile number
        </p>

        <div className="flex w-full items-center overflow-hidden rounded-xl border-2 border-white bg-border-input px-[clamp(0.9rem,1.6vw,1.0625rem)] py-[clamp(0.9rem,1.8vw,1.5rem)] shadow-[0px_12px_17px_-9px_rgba(0,0,0,0.12)]">
          <span className="truncate text-[clamp(1.1rem,1.7vw,1.375rem)] font-medium tracking-wide text-ink">
            {query || <span className="text-muted">XCB0042, Priya, or 98765…</span>}
          </span>
        </div>

        <p className="text-[clamp(0.8125rem,1vw,0.875rem)] text-muted">
          Any of the three works — whichever the customer has to hand.
        </p>
      </div>

      <div className="flex w-full flex-col items-center gap-[clamp(1.25rem,2.6vw,2.1875rem)]">
        <Keyboard onChar={addChar} onSpace={() => addChar(' ')} onBackspace={backspace} />

        <button
          type="button"
          disabled={!ready}
          onClick={onSubmit}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-[clamp(0.875rem,1.6vw,1.125rem)] text-[clamp(1rem,1.2vw,1.125rem)] font-bold text-white transition-opacity disabled:opacity-40"
        >
          {searching ? 'Searching…' : 'Find Session'}
          {!searching && <img src={arrowRight} alt="" className="size-[clamp(1.1rem,1.4vw,1.5rem)]" />}
        </button>
      </div>
    </div>
  )
}
