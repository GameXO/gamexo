import { useState } from 'react'
import { Clock, Loader2, X } from '../ui/icons'
import Drawer from '../ui/Drawer'
import Toggle from '../manage/Toggle'
import { ApiError } from '../api/client'
import { useActiveBranchId } from '../branch/activeBranch'
import { useSaveCourt, type CourtRecord, type SportRecord } from '../api/hooks'
import { ImageGallery } from './ImageFields'
import { DEFAULT_HOURS, HOUR_OPTIONS, closesNextDay, hoursLabel, timeLabel } from './hours'

const MAX_COURT_IMAGES = 5

const INPUT =
  'w-full rounded-lg border border-border-card bg-white px-3.5 py-2.5 text-sm text-ink shadow-control outline-none transition-colors placeholder:text-muted focus:border-lime-ink'

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-dashed border-border-soft pb-5 last:border-b-0 last:pb-0">
      <div>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {hint && <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** A short unique code for a new court: `football-3`, skipping any already taken. */
function nextCode(slug: string, taken: Set<string>) {
  let n = 1
  while (taken.has(`${slug}-${n}`)) n += 1
  return `${slug}-${n}`
}

/**
 * Add or edit one court.
 *
 * A new court is born with the default hours (6 AM – 10 PM) and the sport's rates,
 * so it is bookable the moment it exists; the owner narrows the window or changes the
 * price afterwards by opening the court from the list. Switching a court off keeps
 * everything about it — it only stops being offered — which is why a court that has
 * been played on cannot be deleted but can always be disabled.
 */
export default function CourtDrawer({
  sport,
  court,
  takenCodes,
  onClose,
  onSaved,
}: {
  sport: SportRecord
  court: CourtRecord | null
  takenCodes: Set<string>
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const save = useSaveCourt()
  // A new court is created at the branch being viewed (the academy's default when
  // viewing all), so adding one while on a branch does not drop it somewhere else.
  const activeBranchId = useActiveBranchId()
  const editing = court !== null

  const [name, setName] = useState(court?.name ?? '')
  const [open, setOpen] = useState(court?.operating_hours?.open ?? DEFAULT_HOURS.open)
  const [close, setClose] = useState(court?.operating_hours?.close ?? DEFAULT_HOURS.close)
  const [hourly, setHourly] = useState(String(Number(court?.hourly_rate ?? sport.price_base ?? 0)))
  const [peak, setPeak] = useState(String(Number(court?.peak_rate ?? sport.price_peak ?? 0)))
  const [images, setImages] = useState<string[]>(court?.images ?? [])
  const [amenities, setAmenities] = useState<string[]>(court?.amenities ?? [])
  const [amenity, setAmenity] = useState('')
  const [bookable, setBookable] = useState(court?.is_bookable ?? true)
  const [note, setNote] = useState(court?.maintenance_note ?? '')
  const [error, setError] = useState<string | null>(null)

  const rate = (v: string) => (v.trim() === '' ? NaN : Number(v))
  const ratesOk = rate(hourly) >= 0 && rate(peak) >= 0
  const canSave = name.trim().length > 0 && ratesOk && !save.isPending

  const addAmenity = () => {
    const v = amenity.trim()
    if (v && !amenities.some((a) => a.toLowerCase() === v.toLowerCase())) setAmenities([...amenities, v])
    setAmenity('')
  }

  async function onSubmit() {
    setError(null)
    const shared = {
      name: name.trim(),
      hourly_rate: String(rate(hourly)),
      peak_rate: String(rate(peak)),
      operating_hours: { open, close },
      images,
      amenities,
    }
    try {
      if (court) {
        await save.mutateAsync({
          courtId: court.id,
          body: {
            ...shared,
            is_bookable: bookable,
            maintenance_note: bookable ? null : note.trim() || null,
          },
        })
        onSaved(`${shared.name} updated`)
      } else {
        await save.mutateAsync({
          body: {
            ...shared,
            sport_id: sport.id,
            code: nextCode(sport.slug, takenCodes),
            ...(activeBranchId ? { branch_id: activeBranchId } : {}),
          },
        })
        onSaved(`${shared.name} added`)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this court. Please try again.')
    }
  }

  return (
    <Drawer
      title={editing ? court.name : 'Add court'}
      subtitle={`${sport.name}${editing ? ` · ${court.code}` : ''}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-card bg-white px-4 py-2 text-sm font-medium text-ink shadow-control hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={!canSave}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white shadow-control disabled:opacity-40"
          >
            {save.isPending && <Loader2 size={14} className="animate-spin" />}
            {editing ? 'Save changes' : 'Add court'}
          </button>
        </div>
      }
    >
      {error && (
        <p role="alert" className="rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </p>
      )}

      <Section title="Court name">
        <input
          autoFocus={!editing}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder="e.g. Court A"
          aria-label="Court name"
          className={INPUT}
        />
      </Section>

      <Section
        title="Booking hours"
        hint="Customers can book slots between these times. Closing at or before the opening time means the court stays open past midnight."
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">Opens</span>
            <select value={open} onChange={(e) => setOpen(e.target.value)} className={INPUT}>
              {HOUR_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {timeLabel(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">Closes</span>
            <select value={close} onChange={(e) => setClose(e.target.value)} className={INPUT}>
              {HOUR_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {timeLabel(t)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="inline-flex items-center gap-2 text-[12px] text-slate">
          <Clock size={14} className="text-muted" />
          Bookable {hoursLabel({ open, close })}
          {closesNextDay(open, close) && <span className="text-muted">(closes the next day)</span>}
        </p>
        {!editing && (
          <p className="text-xs text-muted">New courts start with the default hours. You can change them any time.</p>
        )}
      </Section>

      <Section title="Pricing" hint="Per hour. Peak applies during your peak window.">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">Standard rate (₹/hr)</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={hourly}
              onChange={(e) => setHourly(e.target.value)}
              className={INPUT}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">Peak rate (₹/hr)</span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              value={peak}
              onChange={(e) => setPeak(e.target.value)}
              className={INPUT}
            />
          </label>
        </div>
        {!ratesOk && <p className="text-[12px] text-negative">Enter a rate of zero or more.</p>}
      </Section>

      <Section title="Photos" hint={`Up to ${MAX_COURT_IMAGES}. The first is shown first.`}>
        <ImageGallery values={images} onChange={setImages} max={MAX_COURT_IMAGES} />
      </Section>

      <Section title="Facilities" hint="Floodlights, washroom, parking, seating…">
        <div className="flex gap-2">
          <input
            value={amenity}
            onChange={(e) => setAmenity(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addAmenity()
              }
            }}
            placeholder="Add a facility and press Enter"
            aria-label="Add a facility"
            className={INPUT}
          />
          <button
            type="button"
            onClick={addAmenity}
            disabled={!amenity.trim()}
            className="shrink-0 rounded-lg border border-border-card bg-white px-3.5 text-sm font-medium text-ink shadow-control hover:bg-surface-muted disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {amenities.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {amenities.map((a) => (
              <li key={a} className="inline-flex items-center gap-1 rounded-md bg-surface-muted py-1 pl-2.5 pr-1 text-xs text-slate">
                {a}
                <button
                  type="button"
                  onClick={() => setAmenities(amenities.filter((x) => x !== a))}
                  aria-label={`Remove ${a}`}
                  className="flex size-5 items-center justify-center rounded text-muted hover:bg-black/5 hover:text-ink"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {editing && (
        <Section title="Availability" hint="Switch off for maintenance. It disappears from booking but keeps its history.">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-ink">Open for booking</span>
            <Toggle checked={bookable} onChange={() => setBookable((v) => !v)} />
          </div>
          {!bookable && (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason, e.g. resurfacing until Friday (optional)"
              aria-label="Reason it is unavailable"
              className={INPUT}
            />
          )}
        </Section>
      )}
    </Drawer>
  )
}
