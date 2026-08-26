import { useMemo, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import Drawer from '../ui/Drawer'
import { useCourts, useUpdateBooking } from '../api/hooks'
import type { Booking } from '../data/booking'

/**
 * Reschedule a booking, move it to another court, or correct who was playing.
 *
 * Desk-admin only. The counter tablet signs in as `kiosk`, which the API refuses
 * on `PATCH /bookings/{id}` — so this screen has no POS equivalent by design.
 *
 * Only fields the user actually touched are sent. That is deliberate: the server
 * distinguishes "equipment omitted" (keep the kit) from "equipment: []" (clear the
 * kit), and sending a whole booking object back would wipe the customer's rackets
 * on every time change.
 */
export default function EditBookingDrawer({
  booking,
  onClose,
}: {
  booking: Booking
  onClose: () => void
}) {
  const courtsQuery = useCourts()
  const update = useUpdateBooking()

  const [courtId, setCourtId] = useState(booking.courtId)
  const [date, setDate] = useState(booking.date)
  // <input type="time"> wants zero-padded 24h. startHour is a whole hour today,
  // but reading minutes off the booking keeps this correct if that ever changes.
  const [time, setTime] = useState(`${String(booking.startHour).padStart(2, '0')}:00`)
  const [durationMin, setDurationMin] = useState(Math.round(booking.hours * 60))
  const [name, setName] = useState(booking.customer.name)
  const [phone, setPhone] = useState(booking.customer.phone)
  const [error, setError] = useState<string | null>(null)

  const courts = courtsQuery.data ?? []

  /** Only what actually changed, so untouched fields are never sent. */
  const changes = useMemo(() => {
    const out: Parameters<typeof update.mutateAsync>[0] = { bookingId: booking.id }
    if (courtId !== booking.courtId) out.courtId = courtId

    const originalTime = `${String(booking.startHour).padStart(2, '0')}:00`
    if (date !== booking.date || time !== originalTime) {
      // Built from local parts, then serialised with the browser's offset. Composing
      // the string by hand would send a local wall-clock time as if it were UTC and
      // silently move every evening booking by the timezone offset.
      const [hh, mm] = time.split(':').map(Number)
      const [y, mo, d] = date.split('-').map(Number)
      out.startsAt = new Date(y, mo - 1, d, hh, mm).toISOString()
    }
    if (durationMin !== Math.round(booking.hours * 60)) out.durationMin = durationMin
    if (name.trim() !== booking.customer.name) out.customerName = name.trim()
    if (phone.trim() !== booking.customer.phone) out.customerPhone = phone.trim()
    return out
    // `update.mutateAsync` appears above only inside a `typeof`, which is erased at
    // compile time — it is not a runtime dependency of this memo.
  }, [booking, courtId, date, time, durationMin, name, phone])

  const dirty = Object.keys(changes).length > 1 // bookingId is always present
  const nameOk = name.trim().length > 0
  const reprices = ['courtId', 'startsAt', 'durationMin'].some((k) => k in changes)

  const save = async () => {
    setError(null)
    try {
      await update.mutateAsync(changes)
      onClose()
    } catch (err) {
      // A 409 here is the double-booking guard, which is enforced by Postgres
      // rather than by anything this form could have checked up front.
      setError(err instanceof Error ? err.message : 'Could not save this booking.')
    }
  }

  return (
    <Drawer
      title="Edit booking"
      subtitle={`${booking.customer.name} · ${booking.id.slice(0, 8)}`}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-3">
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-11 flex-1 rounded-full border border-border-input bg-white text-sm font-medium text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || !nameOk || update.isPending}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-ink text-sm font-medium text-bone disabled:opacity-40"
            >
              {update.isPending && <Loader2 size={15} className="animate-spin" />}
              Save changes
            </button>
          </div>
        </div>
      }
    >
      <Field label="Court">
        <select
          value={courtId}
          onChange={(e) => setCourtId(e.target.value)}
          className="h-11 w-full rounded-lg border border-border-input bg-white px-3 text-sm text-ink"
        >
          {/* The booking's own court is listed even if it is now inactive or under
              maintenance, so opening this form never silently reassigns it. */}
          {!courts.some((c) => c.id === booking.courtId) && (
            <option value={booking.courtId}>Current court</option>
          )}
          {courts.map((court) => (
            <option key={court.id} value={court.id}>
              {court.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-11 w-full rounded-lg border border-border-input bg-white px-3 text-sm text-ink"
          />
        </Field>
        <Field label="Start time">
          <input
            type="time"
            value={time}
            step={900}
            onChange={(e) => setTime(e.target.value)}
            className="h-11 w-full rounded-lg border border-border-input bg-white px-3 text-sm text-ink"
          />
        </Field>
      </div>

      <Field label="Duration">
        <select
          value={durationMin}
          onChange={(e) => setDurationMin(Number(e.target.value))}
          className="h-11 w-full rounded-lg border border-border-input bg-white px-3 text-sm text-ink"
        >
          {[30, 60, 90, 120, 150, 180].map((mins) => (
            <option key={mins} value={mins}>
              {mins < 60 ? `${mins} min` : `${mins / 60} hr${mins > 60 ? 's' : ''}`}
            </option>
          ))}
        </select>
      </Field>

      <div className="h-px bg-border-soft" />

      <Field label="Player name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-11 w-full rounded-lg border border-border-input bg-white px-3 text-sm text-ink"
        />
        {!nameOk && <p className="text-xs text-amber-700">A name is required.</p>}
      </Field>

      <Field label="Player phone">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          className="h-11 w-full rounded-lg border border-border-input bg-white px-3 text-sm text-ink"
        />
      </Field>

      <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-slate">
        Corrections to the name and phone also update this player's customer record, so
        they carry to their next visit. Their other bookings keep the details recorded
        at the time.
      </p>

      {reprices && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Changing the court, date, time or duration re-prices this booking. Equipment
          already on the bill stays at the rate it was charged at. If the new total
          differs from what has been paid, the balance updates too.
        </p>
      )}
    </Drawer>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide text-muted">{label}</span>
      {children}
    </label>
  )
}
