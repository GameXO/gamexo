import { useEffect, useRef, useState } from 'react'
import { customPreset, monthPreset, todayPreset, type DashboardRange } from '../dashboard/insights'
import calendarPlus from '../assets/figma/calendar-plus.svg'

const toInputDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The end instant is exclusive, so the last day a viewer actually picked is
 *  the day before it — what the two date inputs must show when reopening. */
const toInclusiveEndDate = (iso: string) => {
  const d = new Date(iso)
  d.setDate(d.getDate() - 1)
  return toInputDate(d.toISOString())
}

export default function DateRangePicker({
  range,
  onChange,
  icon = calendarPlus,
}: {
  range: DashboardRange
  onChange: (next: DashboardRange) => void
  icon?: string
}) {
  const [open, setOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [from, setFrom] = useState(() => toInputDate(range.fromISO))
  const [to, setTo] = useState(() => toInclusiveEndDate(range.toISO))
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) close()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function close() {
    setOpen(false)
    setCustomOpen(false)
  }

  function pick(next: DashboardRange) {
    onChange(next)
    close()
  }

  function openCustom() {
    setFrom(toInputDate(range.fromISO))
    setTo(toInclusiveEndDate(range.toISO))
    setCustomOpen(true)
  }

  const invalid = !from || !to || from > to

  const options: { key: DashboardRange['preset']; label: string; apply: () => void }[] = [
    { key: 'today', label: 'Today', apply: () => pick(todayPreset()) },
    { key: 'month', label: 'This Month', apply: () => pick(monthPreset()) },
    { key: 'custom', label: 'Custom', apply: openCustom },
  ]

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`hidden h-9 shrink-0 items-center gap-2.5 rounded-lg border bg-white px-3.5 py-2.5 drop-shadow-[0px_1px_1px_rgba(82,88,102,0.09)] transition-colors duration-100 md:flex ${
          open ? 'border-ink' : 'border-border-input hover:border-slate'
        }`}
      >
        <span className="whitespace-nowrap text-sm text-ink">{range.label}</span>
        <img src={icon} alt="" className="size-[18px]" />
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[260px] overflow-hidden rounded-lg border border-border-card bg-white py-1.5 shadow-[0px_10px_30px_-5px_rgba(15,73,106,0.25)]">
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={option.apply}
              className={`flex w-full cursor-pointer items-center justify-between px-3.5 py-2 text-left text-sm transition-colors duration-100 hover:bg-surface-muted ${
                range.preset === option.key ? 'font-medium text-ink' : 'text-slate'
              }`}
            >
              <span>{option.label}</span>
              {range.preset === option.key && range.label !== option.label && (
                <span className="text-xs text-muted">{range.label}</span>
              )}
            </button>
          ))}

          {customOpen && (
            <div className="mt-1.5 flex flex-col gap-3 border-t border-border-card px-3.5 pb-1 pt-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate">From</span>
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                  className="rounded-lg border border-border-input px-2.5 py-1.5 text-sm text-ink outline-none focus:border-lime-ink"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate">To</span>
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                  className="rounded-lg border border-border-input px-2.5 py-1.5 text-sm text-ink outline-none focus:border-lime-ink"
                />
              </label>
              <button
                type="button"
                disabled={invalid}
                onClick={() => pick(customPreset(from, to))}
                className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition-opacity duration-100 disabled:opacity-40"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
