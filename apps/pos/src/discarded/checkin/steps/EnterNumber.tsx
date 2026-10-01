import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import Keypad from '../Keypad'
import { COUNTRIES, flagEmoji, type Country } from '../countries'
import { asset } from '../../../lib/asset'

const arrowRight = asset('pos/checkin/arrow-right-check.svg')

export default function EnterNumber({
  phone,
  setPhone,
  country,
  setCountry,
  onSubmit,
}: {
  phone: string
  setPhone: (v: string) => void
  country: Country
  setCountry: (c: Country) => void
  onSubmit: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)

  const ready = phone.length >= country.min && phone.length <= country.max

  const addDigit = (d: string) => setPhone(phone.length < country.max ? phone + d : phone)
  const backspace = () => setPhone(phone.slice(0, -1))

  const selectCountry = (c: Country) => {
    setCountry(c)
    setPhone(phone.slice(0, c.max))
    setPickerOpen(false)
    setQuery('')
  }

  useEffect(() => {
    if (!pickerOpen) return
    const onClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [pickerOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pickerOpen) {
        if (e.key === 'Escape') setPickerOpen(false)
        return
      }
      if (/^[0-9]$/.test(e.key)) addDigit(e.key)
      else if (e.key === 'Backspace') backspace()
      else if (e.key === 'Enter' && ready) onSubmit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return COUNTRIES
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.dial.includes(q))
  }, [query])

  const placeholder =
    country.min === country.max ? `${country.min}-digit number` : `${country.min}-${country.max} digit number`

  return (
    <div className="flex w-full max-w-[360px] flex-col items-center gap-[clamp(2rem,5vw,4.1875rem)]">
      <div className="flex w-full flex-col items-start gap-3">
        <p className="text-[clamp(0.9375rem,1.1vw,1rem)] font-medium text-ink">Enter Mobile Number</p>
        <div className="flex w-full items-center gap-2.5">
          <div ref={pickerRef} className="relative shrink-0">
            <button
              type="button"
              title={`${country.name} (+${country.dial})`}
              onClick={() => setPickerOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border-2 border-white bg-border-input px-3 py-[clamp(0.9rem,1.8vw,1.5rem)] text-[clamp(1rem,1.3vw,1.125rem)] font-medium text-ink shadow-[0px_12px_17px_-9px_rgba(0,0,0,0.12)]"
            >
              <span aria-hidden>{flagEmoji(country.iso2)}</span>+{country.dial}
              <ChevronDown size={11} strokeWidth={2.5} />
            </button>

            {pickerOpen && (
              <div
                role="listbox"
                className="absolute left-0 top-[calc(100%+0.5rem)] z-20 flex max-h-80 w-72 flex-col overflow-hidden rounded-xl border border-border-card bg-surface shadow-[0px_18px_32px_-12px_rgba(0,0,0,0.25)]"
              >
                <div className="flex items-center gap-2 border-b border-border-soft px-3 py-2.5">
                  <Search size={15} className="shrink-0 text-muted" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search country or code"
                    className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
                  />
                </div>
                <div className="flex-1 overflow-y-auto py-1">
                  {filtered.length === 0 && <p className="px-3 py-3 text-sm text-muted">No matches</p>}
                  {filtered.map((c) => (
                    <button
                      key={c.iso2}
                      type="button"
                      role="option"
                      aria-selected={c.iso2 === country.iso2}
                      onClick={() => selectCountry(c)}
                      className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-surface-muted ${
                        c.iso2 === country.iso2 ? 'bg-surface-muted font-semibold text-ink' : 'text-ink'
                      }`}
                    >
                      <span aria-hidden>{flagEmoji(c.iso2)}</span>
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-muted">+{c.dial}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-1 items-center overflow-hidden rounded-xl border-2 border-white bg-border-input px-[clamp(0.9rem,1.6vw,1.0625rem)] py-[clamp(0.9rem,1.8vw,1.5rem)] shadow-[0px_12px_17px_-9px_rgba(0,0,0,0.12)]">
            <span className="truncate text-[clamp(1.1rem,1.7vw,1.375rem)] font-medium tracking-wide text-ink">
              {phone || <span className="text-muted">{placeholder}</span>}
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
          Send OTP
          <img src={arrowRight} alt="" className="size-[clamp(1.1rem,1.4vw,1.5rem)]" />
        </button>
      </div>
    </div>
  )
}
