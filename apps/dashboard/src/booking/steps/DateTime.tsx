import { useMemo } from 'react'
import { MAX_BOOKING_HOURS, courtById, hour12, money, nextDays, slotChipLabel, toISO, type Draft } from '../../data/booking'
import { useCourtAvailability } from '../../api/hooks'
import { SLOT_UNITS, useSlotPicker } from '../slotPicker'

const GROUPS = [
  { id: 'morning', label: 'Morning', from: 0, to: 12 },
  { id: 'afternoon', label: 'Afternoon', from: 12, to: 17 },
  { id: 'evening', label: 'Evening', from: 17, to: 24 },
]

/**
 * The classic flow's time step: day, then slots, for the court chosen on the step
 * before. Free hours are the server's (see `useCourtAvailability`), and picking follows
 * the same six-hour rule as the single-page view (`slotPicker.ts`).
 */
export default function DateTime({ draft, setDraft }: { draft: Draft; setDraft: (patch: Partial<Draft>) => void }) {
  const court = courtById(draft.courtId || '')
  const days = useMemo(() => nextDays(7), [])
  const date = draft.date || toISO(new Date())

  const availability = useCourtAvailability(draft.courtId, date)
  const slots = useMemo(() => availability.data ?? [], [availability.data])
  const picker = useSlotPicker(draft, setDraft, slots)

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex w-full items-center justify-between">
        <p className="text-[clamp(1rem,1.3vw,1.125rem)] font-medium text-ink">When do you want to play?</p>
        <p className="text-[clamp(0.875rem,1vw,0.9375rem)] text-slate">
          {court?.name} · <span className="font-semibold text-positive">{money(court?.price || 0)}/hr</span>
        </p>
      </div>

      <div className="flex w-full gap-2 overflow-x-auto rounded-2xl bg-white p-[clamp(0.625rem,1.2vw,0.875rem)]">
        {days.map((d) => {
          const active = date === d.iso
          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => setDraft({ date: d.iso, startHour: null, hours: draft.slotUnit })}
              className={`flex min-w-[clamp(3.75rem,7vw,4.5rem)] shrink-0 flex-col items-center gap-1 rounded-xl px-3 py-[clamp(0.625rem,1.2vw,0.875rem)] transition-colors ${
                active ? 'bg-ink text-white' : 'bg-surface-muted text-ink hover:bg-bone/60'
              }`}
            >
              <span className={`text-[12px] font-medium ${active ? 'text-white/60' : 'text-muted'}`}>{d.label}</span>
              <span className="text-[clamp(1rem,1.4vw,1.0625rem)] font-bold leading-none">{d.dayNum}</span>
              <span className={`text-[12px] font-medium uppercase tracking-wide ${active ? 'text-white/50' : 'text-muted'}`}>
                {d.monthShort}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex w-full flex-col gap-5 rounded-2xl bg-white p-[clamp(1rem,2vw,1.375rem)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate">
            Pick up to {picker.maxUnits} back-to-back {picker.unit} hr {picker.maxUnits === 1 ? 'slot' : 'slots'} —{' '}
            {MAX_BOOKING_HOURS} hours at most.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate">Slot length</span>
            {SLOT_UNITS.map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => picker.setUnit(u)}
                aria-pressed={picker.unit === u}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  picker.unit === u ? 'bg-ink text-white' : 'bg-surface text-ink hover:bg-border-input'
                }`}
              >
                {u} hr
              </button>
            ))}
          </div>
        </div>

        {availability.isPending ? (
          <p className="py-8 text-center text-sm text-muted">Loading times…</p>
        ) : availability.error ? (
          <p role="alert" className="py-8 text-center text-sm text-negative">
            Could not load times: {availability.error instanceof Error ? availability.error.message : 'unknown error'}
          </p>
        ) : slots.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">{court?.name} has no bookable hours on this day.</p>
        ) : (
          GROUPS.map((group) => {
            const rows = slots.filter((s) => s.hour >= group.from && s.hour < group.to)
            if (rows.length === 0) return null
            const free = rows.filter((s) => s.state === 'open' && picker.fits(s.hour)).length
            return (
              <section key={group.id}>
                <div className="mb-2.5 flex items-baseline justify-between">
                  <p className="text-[clamp(0.8125rem,0.95vw,0.875rem)] font-semibold uppercase tracking-wide text-muted">{group.label}</p>
                  <span className="text-[12px] text-muted">{free} free</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {rows.map(({ hour, state }) => {
                    const start = picker.isStart(hour)
                    const covered = picker.isCovered(hour)
                    const fits = picker.fits(hour)
                    const disabled = !covered && !fits
                    return (
                      <button
                        key={hour}
                        type="button"
                        disabled={disabled}
                        onClick={() => picker.pick(hour)}
                        className={`rounded-xl px-3.5 py-2 text-[clamp(0.875rem,1vw,0.9375rem)] font-medium transition-colors ${
                          start
                            ? 'bg-ink text-white'
                            : covered
                              ? 'bg-bone/60 text-ink'
                              : fits
                                ? 'bg-surface text-ink hover:bg-border-input'
                                : state === 'open'
                                  ? 'cursor-not-allowed bg-surface-muted text-muted'
                                  : 'cursor-not-allowed bg-surface-muted text-muted line-through'
                        }`}
                      >
                        {picker.unit > 1 ? `${slotChipLabel(hour)}–${slotChipLabel(hour + picker.unit)}` : slotChipLabel(hour)}
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })
        )}
      </div>

      {draft.startHour != null && (
        <div className="flex w-full items-baseline justify-between gap-3 rounded-2xl bg-white p-[clamp(1rem,2vw,1.375rem)]">
          <div>
            <p className="text-[clamp(0.8125rem,0.95vw,0.875rem)] font-semibold uppercase tracking-wide text-muted">Your slot</p>
            <p className="mt-1 text-[clamp(1rem,1.3vw,1.125rem)] font-semibold text-ink">
              {hour12(draft.startHour)} – {hour12(draft.startHour + draft.hours)}
            </p>
          </div>
          <p className="text-sm text-slate">
            {draft.hours} hr{picker.unit > 1 ? ` (${picker.chosen} × ${picker.unit} hr)` : ''}
          </p>
        </div>
      )}
    </div>
  )
}
