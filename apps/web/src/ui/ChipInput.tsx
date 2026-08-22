/**
 * A row of removable chips with an optional suggestion list.
 *
 * Every "list of short labels" in this app — facility amenities, sports a member
 * plays — has so far been either a comma-joined string or a bespoke pill loop.
 * This is the one place that behaviour lives now.
 */
import { useState, type KeyboardEvent } from 'react'
import { X, Plus } from 'lucide-react'

export default function ChipInput({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Add and press Enter',
  max,
}: {
  value: string[]
  onChange: (next: string[]) => void
  suggestions?: string[]
  placeholder?: string
  max?: number
}) {
  const [draft, setDraft] = useState('')

  const full = max !== undefined && value.length >= max
  // Case-insensitive, so "Parking" cannot be added next to "parking".
  const has = (label: string) => value.some((v) => v.toLowerCase() === label.toLowerCase())

  const add = (label: string) => {
    const trimmed = label.trim()
    if (!trimmed || has(trimmed) || full) return
    onChange([...value, trimmed])
    setDraft('')
  }

  const remove = (label: string) => onChange(value.filter((v) => v !== label))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(draft)
      return
    }
    // Backspace on an empty field removes the last chip — the behaviour every
    // token input has, and the one people try without being told.
    if (e.key === 'Backspace' && !draft && value.length) {
      remove(value[value.length - 1])
    }
  }

  const unused = suggestions.filter((s) => !has(s))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border-input bg-surface px-2 py-2">
        {value.map((label) => (
          <span
            key={label}
            className="inline-flex items-center gap-1 rounded-full bg-lime/25 py-0.5 pl-2.5 pr-1 text-[13px] font-medium text-lime-ink"
          >
            {label}
            <button
              type="button"
              onClick={() => remove(label)}
              aria-label={`Remove ${label}`}
              className="rounded-full p-0.5 hover:bg-lime/40"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          disabled={full}
          placeholder={value.length ? '' : placeholder}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-ink outline-none disabled:cursor-not-allowed"
        />
      </div>

      {unused.length > 0 && !full && (
        <div className="flex flex-wrap gap-1.5">
          {unused.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => add(label)}
              className="inline-flex items-center gap-1 rounded-full border border-border-input px-2.5 py-0.5 text-[13px] text-slate hover:border-ink hover:text-ink"
            >
              <Plus size={11} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
