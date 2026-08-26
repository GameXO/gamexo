import { useMemo } from 'react'
import { courtById, hour12, money, nextDays, priceDraft, slotChipLabel, slotsForDay, toISO, type Draft } from '../../data/booking'

const GROUPS = [
  { id: 'morning', label: 'Morning', from: 6, to: 12 },
  { id: 'afternoon', label: 'Afternoon', from: 12, to: 17 },
  { id: 'evening', label: 'Evening', from: 17, to: 24 },
]

export default function DateTime({ draft, setDraft }: { draft: Draft; setDraft: (patch: Partial<Draft>) => void }) {
  const court = courtById(draft.courtId || '')
  const days = useMemo(() => nextDays(7), [])
  const date = draft.date || toISO(new Date())
  const slots = useMemo(() => slotsForDay(draft.courtId || '', date), [draft.courtId, date])

  const maxHours = useMemo(() => {
    if (draft.startHour == null) return 1
    let n = 0
    while (n < 3 && slots.find((s) => s.hour === draft.startHour! + n)?.state === 'open') n++
    return Math.max(1, n)
  }, [draft.startHour, slots])

  const selected = (hour: number) =>
    draft.startHour != null && hour >= draft.startHour && hour < draft.startHour + draft.hours

  const totals = priceDraft(draft)

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex w-full items-center justify-between">
        <p className="text-xl text-ink">When do you want to play?</p>
        <p className="text-sm text-slate">
          {court?.name} · <span className="text-positive">{money(court?.price || 0)}/hr</span>
        </p>
      </div>

      <div className="flex w-full gap-2 overflow-x-auto rounded-xl bg-white p-3">
        {days.map((d) => {
          const active = date === d.iso
          return (
            <button
              key={d.iso}
              type="button"
              onClick={() => setDraft({ date: d.iso, startHour: null })}
              className={`flex min-w-[70px] shrink-0 flex-col items-center gap-1 rounded-lg px-3 py-3 transition-colors ${
                active ? 'bg-ink text-bone' : 'bg-surface-muted text-ink hover:bg-bone/60'
              }`}
            >
              <span className={`text-[11px] ${active ? 'text-bone/60' : 'text-muted'}`}>{d.label}</span>
              <span className="text-[17px] leading-none">{d.dayNum}</span>
              <span className={`text-[10px] uppercase tracking-wide ${active ? 'text-bone/50' : 'text-muted'}`}>
                {d.monthShort}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex w-full flex-col gap-5 rounded-xl bg-white p-5">
        {GROUPS.map((group) => {
          const rows = slots.filter((s) => s.hour >= group.from && s.hour < group.to)
          const free = rows.filter((s) => s.state === 'open').length
          return (
            <section key={group.id}>
              <div className="mb-2.5 flex items-baseline justify-between">
                <p className="text-sm font-medium uppercase tracking-wide text-muted">{group.label}</p>
                <span className="text-[11px] text-muted">{free} free</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {rows.map(({ hour, state }) => {
                  const isSelected = selected(hour)
                  const disabled = state !== 'open' && !isSelected
                  return (
                    <button
                      key={hour}
                      type="button"
                      disabled={disabled}
                      onClick={() => setDraft({ startHour: hour, hours: 1 })}
                      className={`rounded-lg border px-3.5 py-2 text-sm transition-colors ${
                        isSelected
                          ? 'border-ink bg-ink text-bone'
                          : state === 'open'
                            ? 'border-border-card bg-surface text-ink hover:border-ink/40'
                            : 'cursor-not-allowed border-border-card bg-surface-muted text-muted line-through'
                      }`}
                    >
                      {slotChipLabel(hour)}
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      {draft.startHour != null && (
        <div className="flex w-full flex-col gap-3 rounded-xl bg-white p-5">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-muted">Your slot</p>
              <p className="mt-1 text-[17px] text-ink">
                {hour12(draft.startHour)} – {hour12(draft.startHour + draft.hours)}
              </p>
            </div>
            <p className="text-[24px] font-semibold leading-none text-ink">{money(totals.slotTotal)}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-slate">Play for</span>
            {[1, 2, 3].map((h) => {
              const active = draft.hours === h
              const allowed = h <= maxHours
              return (
                <button
                  key={h}
                  type="button"
                  disabled={!allowed}
                  onClick={() => setDraft({ hours: h })}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? 'border-ink bg-ink text-bone'
                      : allowed
                        ? 'border-border-card bg-surface text-ink hover:border-ink/40'
                        : 'cursor-not-allowed border-border-card bg-surface-muted text-muted'
                  }`}
                >
                  {h} hr
                </button>
              )
            })}
          </div>
          {maxHours < 3 && (
            <p className="text-[12px] text-muted">
              The next hour is taken, so this slot runs up to {maxHours} hour{maxHours > 1 ? 's' : ''}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
