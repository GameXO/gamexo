/**
 * Sport, court, day and time — the whole of "what and when" on one screen.
 *
 * These used to be two steps (pick a sport and a court, then a time), which meant
 * choosing a court to find out whether it had a slot, and going back to try another.
 * Here the court list and its free hours sit side by side, so "is Court B free at 6?"
 * is a click away, and so is the next court. It opens with the first sport and its
 * first court already chosen, so the right-hand side is never an empty panel.
 *
 * Free hours come from the server (`useCourtAvailability`), not a guess: the court's
 * own opening hours, every live booking and hold, and whether it is switched on.
 * Picking follows the six-hour rule in `slotPicker.ts`.
 *
 * Everything that can be pressed lifts a little on hover and settles on press (the
 * global button styles do the easing); every list shows a skeleton of itself while it
 * loads, so the page keeps its shape instead of jumping when the data arrives.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, CalendarDays, Check, ChevronRight, Info } from 'lucide-react'
import { MAX_BOOKING_HOURS, money, nextDays, pad, toISO, type Draft } from '../../data/booking'
import { useBranches, useCourtAvailability, useManagedCourts, useSports } from '../../api/hooks'
import SportGlyph from '../../facility/SportGlyph'
import { SLOT_UNITS, useSlotPicker } from '../slotPicker'

const GROUPS = [
  { id: 'morning', label: 'Morning', from: 0, to: 12 },
  { id: 'afternoon', label: 'Afternoon', from: 12, to: 17 },
  { id: 'evening', label: 'Evening', from: 17, to: 24 },
]

const hourLabel = (h: number) => `${pad(h % 24)}:00`

/** A small rounded tile holding a sport's glyph. */
function SportTile({ sport, active }: { sport: { name: string; slug?: string }; active?: boolean }) {
  return (
    <span
      className={`flex size-7 shrink-0 items-center justify-center rounded-md transition-colors ${
        active ? 'bg-white/15 text-white' : 'bg-surface-muted text-ink group-hover:bg-lime/30'
      }`}
    >
      <SportGlyph sport={sport} size={16} />
    </span>
  )
}

function Panel({
  title,
  aside,
  delay = 0,
  className = '',
  children,
}: {
  title: string
  aside?: React.ReactNode
  delay?: number
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
      className={`animate-rise rounded-xl border border-border-card bg-white p-5 shadow-card sm:p-6 ${className}`}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** A grey block that shimmers. Sized by the caller to match what will replace it. */
const Skeleton = ({ className, width }: { className: string; width?: number }) => (
  <div aria-hidden style={width ? { width } : undefined} className={`animate-pulse rounded-lg bg-surface-muted ${className}`} />
)

const LIFT = 'hover:-translate-y-px hover:shadow-card'

export default function SelectSlot({
  draft,
  setDraft,
  onContinue,
}: {
  draft: Draft
  setDraft: (patch: Partial<Draft>) => void
  onContinue: () => void
}) {
  const sportsQuery = useSports()
  const courtsQuery = useManagedCourts()
  const { data: branches } = useBranches()
  const [branchFilter, setBranchFilter] = useState<string>('all')
  const dateInput = useRef<HTMLInputElement>(null)

  const sports = sportsQuery.data ?? []
  const sport = sports.find((s) => s.id === draft.sportId)

  // Only courts that can be booked, for a given sport. A switched-off court would show a
  // row of unavailable times and invite someone to try it.
  const courtsOf = (sportId: string | null) =>
    (courtsQuery.data ?? []).filter((c) => c.sport_id === sportId && c.is_bookable !== false)

  const forSport = useMemo(
    () => (courtsQuery.data ?? []).filter((c) => c.sport_id === draft.sportId && c.is_bookable !== false),
    [courtsQuery.data, draft.sportId],
  )
  const branchIds = useMemo(() => [...new Set(forSport.map((c) => c.branch_id))], [forSport])
  const multiBranch = branchIds.length > 1
  const courts = forSport.filter((c) => !multiBranch || branchFilter === 'all' || c.branch_id === branchFilter)
  const court = forSport.find((c) => c.id === draft.courtId)

  // Open on something. A blank right-hand side is a screen with no obvious first move,
  // so the first sport and its first court are chosen up front — one tap to change.
  // A court opened from elsewhere arrives with both already set.
  const firstSportId = sports[0]?.id
  useEffect(() => {
    if (!draft.sportId && firstSportId) setDraft({ sportId: firstSportId })
  }, [draft.sportId, firstSportId, setDraft])

  const firstCourtId = courts[0]?.id
  const courtListed = courts.some((c) => c.id === draft.courtId)
  useEffect(() => {
    if (draft.sportId && firstCourtId && !courtListed) {
      setDraft({ courtId: firstCourtId, startHour: null, hours: draft.slotUnit })
    }
  }, [draft.sportId, firstCourtId, courtListed, draft.slotUnit, setDraft])

  const days = useMemo(() => nextDays(7), [])
  const todayISO = toISO(new Date())
  const date = draft.date || todayISO
  const inStrip = days.some((d) => d.iso === date)

  const availability = useCourtAvailability(draft.courtId, date)
  const slots = useMemo(() => availability.data ?? [], [availability.data])
  const slotAt = (hour: number) => slots.find((s) => s.hour === hour)
  const picker = useSlotPicker(draft, setDraft, slots)

  const pickSport = (sportId: string) => {
    if (sportId === draft.sportId) return
    setBranchFilter('all')
    // Straight to that sport's first court, not through an empty state.
    const first = courtsOf(sportId)[0]
    setDraft({ sportId, courtId: first?.id ?? null, startHour: null, hours: draft.slotUnit })
  }
  const pickCourt = (courtId: string) => setDraft({ courtId, startHour: null, hours: draft.slotUnit })
  const pickDate = (iso: string) => setDraft({ date: iso, startHour: null, hours: draft.slotUnit })

  const dayLabel = (iso: string) =>
    days.find((d) => d.iso === iso)?.label ??
    new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  const timeLabel =
    draft.startHour == null ? null : `${hourLabel(draft.startHour)}–${hourLabel(draft.startHour + draft.hours)}`

  const ready = !!draft.courtId && draft.startHour != null
  const rateNow = (draft.startHour != null ? slotAt(draft.startHour)?.rate : undefined) ?? Number(court?.hourly_rate ?? 0)

  return (
    <div className="flex w-full flex-1 flex-col gap-5">
      <div className="grid w-full items-start gap-5 lg:grid-cols-[minmax(300px,400px)_minmax(0,1fr)]">
        {/* ── Left: what you are playing, and where. Stays in view while the times scroll. ── */}
        <Panel title="What are you playing?" className="lg:sticky lg:top-4">
          {sportsQuery.isPending ? (
            <div className="flex flex-wrap gap-2">
              {[112, 96, 104, 100, 92].map((w, i) => (
                <Skeleton key={i} className="h-11" width={w} />
              ))}
            </div>
          ) : sportsQuery.error ? (
            <p role="alert" className="text-sm text-negative">
              Could not load sports: {sportsQuery.error instanceof Error ? sportsQuery.error.message : 'unknown error'}
            </p>
          ) : sports.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-soft px-4 py-8 text-center text-sm text-muted">
              No sports yet. Add one under Manage → Sports & Courts.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sports.map((s) => {
                const active = s.id === draft.sportId
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pickSport(s.id)}
                    aria-pressed={active}
                    className={`group flex items-center gap-2.5 rounded-lg border py-2 pl-2 pr-3.5 text-sm font-medium ${LIFT} ${
                      active
                        ? 'border-ink bg-ink text-white shadow-card'
                        : 'border-border-card bg-white text-ink hover:border-border-soft'
                    }`}
                  >
                    <SportTile sport={s} active={active} />
                    {s.name}
                  </button>
                )
              })}
            </div>
          )}

          <div className="my-5 border-t border-dashed border-border-soft" />

          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-ink">Choose a court</h3>
            {multiBranch && (
              <div className="flex items-center gap-1 rounded-lg bg-surface-muted p-1">
                {[{ id: 'all', name: 'All' }, ...(branches ?? []).filter((b) => branchIds.includes(b.id))].map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBranchFilter(b.id)}
                    aria-pressed={branchFilter === b.id}
                    className={`max-w-[9rem] truncate rounded-md px-2.5 py-1 text-xs ${
                      branchFilter === b.id ? 'bg-white font-medium text-ink shadow-control' : 'text-slate hover:text-ink'
                    }`}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {courtsQuery.isPending || sportsQuery.isPending ? (
            <div className="grid grid-cols-2 gap-2.5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[3.75rem]" />
              ))}
            </div>
          ) : courtsQuery.error ? (
            <p role="alert" className="text-sm text-negative">
              Could not load courts: {courtsQuery.error instanceof Error ? courtsQuery.error.message : 'unknown error'}
            </p>
          ) : courts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border-soft px-4 py-8 text-center text-sm text-muted">
              {draft.sportId ? 'No courts are open for booking for this sport.' : 'Pick a sport to see its courts.'}
            </p>
          ) : (
            <div key={draft.sportId} className="grid animate-fade-in grid-cols-2 gap-2.5">
              {courts.map((c) => {
                const active = c.id === draft.courtId
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pickCourt(c.id)}
                    aria-pressed={active}
                    className={`relative flex min-h-[3.75rem] flex-col items-start justify-center rounded-lg border px-3.5 py-2.5 text-left ${LIFT} ${
                      active
                        ? 'border-ink bg-ink text-white shadow-card'
                        : 'border-border-card bg-white text-ink hover:border-border-soft'
                    }`}
                  >
                    <span className="pr-5 text-sm font-semibold">{c.name}</span>
                    <span className={`text-xs ${active ? 'text-white/70' : 'text-muted'}`}>
                      {money(Number(c.hourly_rate))}/hr
                    </span>
                    {active && <Check size={14} className="absolute right-3 top-3 animate-pop text-lime" />}
                  </button>
                )
              })}
            </div>
          )}
        </Panel>

        {/* ── Right: when ── */}
        <Panel
          title="When are you playing?"
          delay={70}
          aside={
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate">Slot length</span>
              <div className="flex items-center gap-1 rounded-lg bg-surface-muted p-1">
                {SLOT_UNITS.map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => picker.setUnit(u)}
                    aria-pressed={picker.unit === u}
                    className={`rounded-md px-2.5 py-1 text-xs ${
                      picker.unit === u ? 'bg-white font-medium text-ink shadow-control' : 'text-slate hover:text-ink'
                    }`}
                  >
                    {u} hr
                  </button>
                ))}
              </div>
            </div>
          }
        >
          <div className="flex items-stretch gap-2">
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto p-1 -m-1">
              {days.map((d) => {
                const active = date === d.iso
                return (
                  <button
                    key={d.iso}
                    type="button"
                    onClick={() => pickDate(d.iso)}
                    aria-pressed={active}
                    className={`flex min-w-[4.25rem] shrink-0 flex-col items-center gap-0.5 rounded-lg border px-3 py-2.5 ${LIFT} ${
                      active
                        ? 'border-ink bg-ink text-white shadow-card'
                        : 'border-border-card bg-white text-ink hover:border-border-soft'
                    }`}
                  >
                    <span className={`text-xs ${active ? 'text-white/70' : 'text-muted'}`}>{d.label}</span>
                    <span className="text-lg font-semibold leading-tight">{d.dayNum}</span>
                    <span className={`text-xs uppercase ${active ? 'text-white/70' : 'text-muted'}`}>{d.monthShort}</span>
                  </button>
                )
              })}
            </div>

            <div className="relative shrink-0 border-l border-dashed border-border-soft pl-2">
              <button
                type="button"
                onClick={() => dateInput.current?.showPicker?.()}
                aria-pressed={!inStrip}
                className={`flex h-full min-w-[6.5rem] items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium ${LIFT} ${
                  !inStrip
                    ? 'border-ink bg-ink text-white shadow-card'
                    : 'border-border-card bg-white text-ink hover:border-border-soft'
                }`}
              >
                <CalendarDays size={16} />
                {inStrip ? 'Choose date' : dayLabel(date)}
              </button>
              {/* Visually hidden but focusable, so the native picker works with a
                  keyboard and on a touch tablet. */}
              <input
                ref={dateInput}
                type="date"
                min={todayISO}
                value={date}
                onChange={(e) => e.target.value && pickDate(e.target.value)}
                aria-label="Choose a date"
                className="pointer-events-none absolute inset-0 opacity-0"
                tabIndex={-1}
              />
            </div>
          </div>

          {draft.courtId && slots.length > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-surface-muted px-3 py-2.5 text-xs text-slate">
              <Info size={14} className="mt-px shrink-0 text-muted" />
              <p>
                Pick up to {picker.maxUnits} back-to-back {picker.unit} hr {picker.maxUnits === 1 ? 'slot' : 'slots'} —{' '}
                {MAX_BOOKING_HOURS} hours at most.
                {picker.chosen > 0 && (
                  <span className="font-medium text-ink">
                    {' '}
                    {draft.hours} hr chosen
                    {picker.unit > 1 ? ` (${picker.chosen} × ${picker.unit} hr)` : ''}.
                  </span>
                )}
              </p>
            </div>
          )}

          <div className="mt-2 flex flex-col">
            {!draft.courtId && !courtsQuery.isPending && !sportsQuery.isPending ? (
              <p className="mt-2 rounded-lg border border-dashed border-border-soft px-4 py-12 text-center text-sm text-muted">
                Pick a court to see its free times.
              </p>
            ) : !draft.courtId || availability.isPending ? (
              // The shape of the real thing — three headed groups of times — so the page
              // does not jump when they arrive.
              <div aria-hidden className="flex flex-col">
                {[5, 5, 5].map((n, g) => (
                  <div key={g} className={`py-4 ${g > 0 ? 'border-t border-dashed border-border-soft' : ''}`}>
                    <div className="mb-3 flex items-baseline justify-between">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: n }).map((_, i) => (
                        <Skeleton key={i} className="h-[2.625rem] w-[4.75rem]" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : availability.error ? (
              <p role="alert" className="px-1 py-12 text-center text-sm text-negative">
                Could not load times: {availability.error instanceof Error ? availability.error.message : 'unknown error'}
              </p>
            ) : slots.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-border-soft px-4 py-12 text-center text-sm text-muted">
                {court?.name} has no bookable hours on this day.
              </p>
            ) : (
              <div key={`${draft.courtId}|${date}`} className="animate-fade-in">
                {GROUPS.map((group, i) => {
                  const rows = slots.filter((s) => s.hour >= group.from && s.hour < group.to)
                  if (rows.length === 0) return null
                  const free = rows.filter((s) => s.state === 'open' && picker.fits(s.hour)).length
                  return (
                    <section
                      key={group.id}
                      className={`py-4 ${i > 0 ? 'border-t border-dashed border-border-soft' : ''}`}
                    >
                      <div className="mb-3 flex items-baseline justify-between">
                        <h3 className="text-sm font-semibold text-ink">{group.label}</h3>
                        <span className="text-xs text-muted">
                          {free} {free === 1 ? 'slot' : 'slots'} available
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {rows.map(({ hour, state, isPeak }) => {
                          const start = picker.isStart(hour)
                          const covered = picker.isCovered(hour)
                          const fits = picker.fits(hour)
                          // An hour inside the chosen stretch stays clickable (to trim it).
                          const disabled = !covered && !fits
                          const hole = state === 'open' && !fits
                          return (
                            <button
                              key={hour}
                              type="button"
                              disabled={disabled}
                              onClick={() => picker.pick(hour)}
                              aria-pressed={start}
                              title={
                                state === 'booked'
                                  ? 'Already booked'
                                  : state === 'past'
                                    ? 'Already started'
                                    : hole
                                      ? `Not ${picker.unit} free hours in a row from here`
                                      : isPeak
                                        ? 'Peak rate'
                                        : undefined
                              }
                              className={`relative min-w-[4.75rem] rounded-lg border px-3.5 py-2.5 text-sm font-medium ${
                                start
                                  ? 'animate-pop border-ink bg-ink text-white shadow-card'
                                  : covered
                                    ? 'border-ink/25 bg-surface-muted text-ink'
                                    : fits
                                      ? `border-border-card bg-white text-ink hover:border-ink/40 ${LIFT}`
                                      : hole
                                        ? 'border-transparent bg-surface-muted text-muted'
                                        : 'border-transparent bg-surface-muted text-muted line-through'
                              }`}
                            >
                              {picker.unit > 1 ? `${hourLabel(hour)}–${hourLabel(hour + picker.unit)}` : hourLabel(hour)}
                              {isPeak && fits && !start && (
                                <span aria-hidden className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-flame" />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </section>
                  )
                })}
                {slots.some((s) => s.isPeak) && (
                  <p className="flex items-center gap-2 border-t border-dashed border-border-soft pt-3 text-xs text-muted">
                    <span aria-hidden className="size-1.5 rounded-full bg-flame" />
                    Peak-rate hours
                  </p>
                )}
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Bottom bar: pinned. What has been chosen, and the way on ── */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-auto flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border-soft bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-2 font-semibold text-ink">
            {sport && (
              <span className="flex size-7 items-center justify-center rounded-md bg-surface-muted">
                <SportGlyph sport={sport} size={16} />
              </span>
            )}
            {sport?.name ?? 'Choose a sport'}
          </span>
          <ChevronRight size={14} className="shrink-0 text-muted" />
          <span className={court ? 'font-semibold text-ink' : 'text-muted'}>{court ? court.name : 'Choose a court'}</span>
          <ChevronRight size={14} className="shrink-0 text-muted" />
          <span className={timeLabel ? 'font-semibold text-ink' : 'text-muted'}>
            {timeLabel ? `${dayLabel(date)}, ${timeLabel}` : 'Choose a time'}
          </span>
          {timeLabel && <span className="text-muted">· {draft.hours} hr</span>}
        </div>

        {court && <span className="text-sm text-slate">{money(rateNow)} per hour</span>}

        <button
          type="button"
          onClick={onContinue}
          disabled={!ready}
          title={ready ? undefined : 'Choose a court and a time to continue'}
          className="group inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white shadow-control hover:bg-ink/90 hover:shadow-card disabled:opacity-40 disabled:hover:shadow-control"
        >
          Continue
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5 group-disabled:translate-x-0" />
        </button>
      </div>
    </div>
  )
}
