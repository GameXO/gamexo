import type { MouseEvent } from 'react'
import { Space } from 'lucide-react'
import { asset } from '../lib/asset'

const backspaceIcon = asset('pos/checkin/backspace.svg')

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

// Column width and row height must match exactly for square keys — driven from one
// constant so the grid template and the row height can never drift apart.
//
// The dvh term is what keeps the board on screen: this grid is seven rows tall, so a
// width-only size overflows a landscape tablet (short and wide) and pushes the footer
// off. Taking the smaller of the two makes height the binding constraint when it needs
// to be, and the floor keeps the keys thumb-sized on the smallest viewport we support.
const KEY_SIZE = 'clamp(2.1rem, min(4.7vw, 7.2dvh), 4.4rem)'
const GAP = 'clamp(0.35rem, min(0.9vw, 1.1dvh), 0.65rem)'

const keyBase =
  'flex items-center justify-center rounded-xl text-[clamp(1.05rem,1.9vw,1.5rem)] font-semibold text-ink transition-colors active:scale-[0.96]'

/** Buttons use onMouseDown+preventDefault so pressing a key never steals focus away
 *  from the text field it's typing into. */
function stayFocused(e: MouseEvent) {
  e.preventDefault()
}

/** On-screen alphanumeric keyboard for the counter's touchscreen, for text fields a
 *  numeric Keypad can't cover. Callers route keys into whichever input is active.
 *
 *  `spaceLabel` relabels the wide key without changing the layout. Check-in types a
 *  booking reference, where the separator people reach for is a hyphen and a space
 *  bar is the wrong affordance — but a key whose icon says "space" must not insert
 *  something else, so the caller changes both together. */
export default function Keyboard({
  onChar,
  onSpace,
  onBackspace,
  spaceLabel,
}: {
  onChar: (char: string) => void
  onSpace: () => void
  onBackspace: () => void
  spaceLabel?: string
}) {
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(7, ${KEY_SIZE})`, gridAutoRows: KEY_SIZE, gap: GAP }}
      role="group"
      aria-label="On-screen keyboard"
    >
      {LETTERS.map((l) => (
        <button
          key={l}
          type="button"
          onMouseDown={stayFocused}
          onClick={() => onChar(l)}
          className={`${keyBase} bg-surface hover:bg-surface-muted active:bg-border-input`}
        >
          {l}
        </button>
      ))}

      {DIGITS.map((d) => (
        <button
          key={d}
          type="button"
          onMouseDown={stayFocused}
          onClick={() => onChar(d)}
          className={`${keyBase} bg-border-input hover:bg-[#e1e1e1] active:bg-[#d5d5d5]`}
        >
          {d}
        </button>
      ))}

      <button
        type="button"
        onMouseDown={stayFocused}
        onClick={onSpace}
        aria-label={spaceLabel ? `Insert ${spaceLabel}` : 'Space'}
        className={`${keyBase} col-span-3 bg-border-input hover:bg-[#e1e1e1] active:bg-[#d5d5d5]`}
      >
        {spaceLabel ?? <Space className="size-[clamp(1.15rem,2vw,1.65rem)]" strokeWidth={2} />}
      </button>
      <button
        type="button"
        onMouseDown={stayFocused}
        onClick={onBackspace}
        aria-label="Delete character"
        className={`${keyBase} col-span-2 bg-border-input hover:bg-[#d5d5d5] active:bg-[#cacaca]`}
      >
        <img src={backspaceIcon} alt="" className="size-[clamp(1.25rem,2.1vw,1.75rem)] scale-y-[-1]" />
      </button>
    </div>
  )
}
