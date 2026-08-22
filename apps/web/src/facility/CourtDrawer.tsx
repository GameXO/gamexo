/**
 * Everything about one court, in the app's usual right-hand sheet.
 *
 * Create and edit are the same form. A new court arrives here pre-filled rather
 * than blank — a turf's second court is almost always its first one with a
 * different name, and an empty form makes the owner retype the price, the timings
 * and the facilities every time.
 */
import { useState } from 'react'
import Drawer from '../ui/Drawer'
import ConfirmDialog from '../ui/ConfirmDialog'
import ChipInput from '../ui/ChipInput'
import Toggle from '../manage/Toggle'
import CourtImages from './CourtImages'
import { useCreateCourt, useUpdateCourt, useDeleteCourt, type FacilityCourtOut } from '../api/hooks'
import { ApiError } from '../api/client'

type CourtOut = FacilityCourtOut

/** Offered as one-tap chips on the facilities field — the things a turf actually
 *  advertises, so the common case is tapping rather than typing. */
const FACILITY_SUGGESTIONS = [
  'Floodlights',
  'Washroom',
  'Parking',
  'Seating',
  'Drinking water',
  'Changing room',
  'First aid',
  'Cafeteria',
  'Air conditioned',
  'Net provided',
  'Turf grass',
  'Wooden flooring',
  'Spectator area',
  'Lockers',
]

const inputClass =
  'w-full rounded-lg border border-border-input bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-ink'

export type CourtDraft = {
  name: string
  code: string
  hourly_rate: string
  peak_rate: string
  open: string
  close: string
  amenities: string[]
  images: string[]
  rating: string
  openSlots: boolean
  slotCapacity: string
  isBookable: boolean
  maintenanceNote: string
}

function draftFrom(court: CourtOut | null, fallback: Partial<CourtDraft> = {}): CourtDraft {
  const hours = (court?.operating_hours ?? {}) as Record<string, string>
  return {
    name: court?.name ?? fallback.name ?? '',
    code: court?.code ?? fallback.code ?? '',
    hourly_rate: String(court?.hourly_rate ?? fallback.hourly_rate ?? ''),
    peak_rate: String(court?.peak_rate ?? fallback.peak_rate ?? ''),
    open: hours.open ?? fallback.open ?? '06:00',
    close: hours.close ?? fallback.close ?? '22:00',
    amenities: court?.amenities ?? fallback.amenities ?? [],
    images: court?.images ?? [],
    rating: court?.rating != null ? String(court.rating) : '',
    openSlots: court?.open_slots_enabled ?? false,
    slotCapacity: court?.slot_capacity != null ? String(court.slot_capacity) : '',
    isBookable: court?.is_bookable ?? true,
    maintenanceNote: court?.maintenance_note ?? '',
  }
}

export default function CourtDrawer({
  court,
  sportId,
  initial,
  onClose,
}: {
  /** null when creating. */
  court: CourtOut | null
  sportId: string
  initial?: Partial<CourtDraft>
  onClose: () => void
}) {
  const [form, setForm] = useState<CourtDraft>(() => draftFrom(court, initial))
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const create = useCreateCourt()
  const update = useUpdateCourt()
  const remove = useDeleteCourt()

  const set = <K extends keyof CourtDraft>(key: K, value: CourtDraft[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const saving = create.isPending || update.isPending
  const canSave =
    form.name.trim().length > 0 &&
    form.code.trim().length > 0 &&
    form.hourly_rate !== '' &&
    form.peak_rate !== '' &&
    // Mirrors the API's own rule, so the impossible combination cannot be submitted.
    (!form.openSlots || Number(form.slotCapacity) >= 1)

  async function save() {
    setError(null)
    const body = {
      name: form.name.trim(),
      code: form.code.trim(),
      sport_id: sportId,
      hourly_rate: form.hourly_rate,
      peak_rate: form.peak_rate,
      operating_hours: { open: form.open, close: form.close },
      amenities: form.amenities,
      images: form.images,
      rating: form.rating === '' ? null : form.rating,
      open_slots_enabled: form.openSlots,
      // Sent as null when off, so a court that used to allow joining does not keep
      // a stale capacity that would reappear if it were switched back on.
      slot_capacity: form.openSlots ? Number(form.slotCapacity) : null,
      is_bookable: form.isBookable,
      maintenance_note: form.maintenanceNote.trim() || null,
    }

    try {
      if (court) await update.mutateAsync({ id: court.id, body })
      else await create.mutateAsync(body)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this court.')
    }
  }

  async function destroy() {
    setError(null)
    setConfirmDelete(false)
    if (!court) return
    try {
      await remove.mutateAsync(court.id)
      onClose()
    } catch (err) {
      // The 409 here is the useful one: it names how many bookings are in the way
      // and tells the owner to mark the court unavailable instead.
      setError(err instanceof ApiError ? err.message : 'Could not delete this court.')
    }
  }

  return (
    <>
      <Drawer
        title={court ? form.name || 'Court' : 'Add a court'}
        subtitle={court ? court.code : 'It will be bookable as soon as you save.'}
        onClose={onClose}
        footer={
          <div className="flex flex-col gap-3">
            {error && (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              {court && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={remove.isPending}
                  className="rounded-lg border border-border-input px-4 py-2.5 text-sm font-medium text-negative disabled:opacity-40"
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => void save()}
                disabled={!canSave || saving}
                className="flex-1 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {saving ? 'Saving…' : court ? 'Save changes' : 'Add court'}
              </button>
            </div>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input
              autoFocus
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Court 1"
              className={inputClass}
            />
          </Field>
          <Field label="Code" hint="Short label on the counter screen.">
            <input
              value={form.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              placeholder="C1"
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Photos">
          <CourtImages value={form.images} onChange={(images) => set('images', images)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Price / hour" hint="Off-peak rate.">
            <input
              value={form.hourly_rate}
              inputMode="decimal"
              onChange={(e) => set('hourly_rate', e.target.value.replace(/[^\d.]/g, ''))}
              className={inputClass}
            />
          </Field>
          <Field label="Peak price / hour" hint="Evenings and weekends.">
            <input
              value={form.peak_rate}
              inputMode="decimal"
              onChange={(e) => set('peak_rate', e.target.value.replace(/[^\d.]/g, ''))}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Available from">
            <input
              type="time"
              value={form.open}
              onChange={(e) => set('open', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Available to">
            <input
              type="time"
              value={form.close}
              onChange={(e) => set('close', e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Facilities">
          <ChipInput
            value={form.amenities}
            onChange={(amenities) => set('amenities', amenities)}
            suggestions={FACILITY_SUGGESTIONS}
            placeholder="Add a facility"
          />
        </Field>

        <Field label="Rating" hint="Out of 5. Yours to set — leave it blank if you would rather not.">
          <input
            value={form.rating}
            inputMode="decimal"
            placeholder="4.5"
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d.]/g, '')
              if (v === '' || Number(v) <= 5) set('rating', v)
            }}
            className={inputClass}
          />
        </Field>

        <div className="rounded-xl border border-border-card bg-surface p-4">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">Open slots</p>
              <p className="mt-0.5 text-[13px] leading-snug text-slate">
                Let different players join the same session instead of one booking taking the
                whole court.
              </p>
            </div>
            <Toggle checked={form.openSlots} onChange={() => set('openSlots', !form.openSlots)} />
          </div>

          {form.openSlots && (
            <div className="mt-4">
              <Field
                label="Slots per session"
                hint="How many people can join one active session before it is full."
              >
                <input
                  value={form.slotCapacity}
                  inputMode="numeric"
                  placeholder="10"
                  onChange={(e) => set('slotCapacity', e.target.value.replace(/\D/g, ''))}
                  className={inputClass}
                />
              </Field>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border-card bg-surface p-4">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">Available for booking</p>
              <p className="mt-0.5 text-[13px] leading-snug text-slate">
                Turn off while the court is under maintenance. Existing bookings are kept.
              </p>
            </div>
            <Toggle
              checked={form.isBookable}
              onChange={() => set('isBookable', !form.isBookable)}
            />
          </div>

          {!form.isBookable && (
            <div className="mt-4">
              <Field label="Why is it unavailable?">
                <input
                  value={form.maintenanceNote}
                  onChange={(e) => set('maintenanceNote', e.target.value)}
                  placeholder="Resurfacing until Friday"
                  className={inputClass}
                />
              </Field>
            </div>
          )}
        </div>
      </Drawer>

      {confirmDelete && court && (
        <ConfirmDialog
          title={`Delete ${court.name}?`}
          message="This cannot be undone. If the court has bookings you will be asked to mark it unavailable instead."
          confirmLabel="Delete court"
          danger
          onConfirm={() => void destroy()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}
