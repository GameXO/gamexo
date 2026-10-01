import { Search, XCircle } from 'lucide-react'
import { money, formalDate } from '../../lib/format'
import { timeLabel, bookingTypeLabel, type CheckinBooking } from '../useCheckIn'
import SuccessGraphic from '../SuccessGraphic'
import HomeCountdownButton from '../../ui/HomeCountdown'
import { asset } from '../../lib/asset'

const arrowRight = asset('pos/checkin/arrow-right-check.svg')

function Found({
  booking,
  onRentEquipment,
  onHome,
}: {
  booking: CheckinBooking
  onRentEquipment: () => void
  onHome: () => void
}) {
  const equipmentCount = booking.equipment.reduce((n, l) => n + l.qty, 0)
  const paidInFull = Number(booking.balance_due) <= 0

  return (
    <div className="flex w-full max-w-[720px] flex-col items-center gap-[clamp(1.25rem,2.5vw,1.75rem)]">
      <div className="flex w-full overflow-hidden rounded-2xl border-[3px] border-white bg-surface-muted shadow-[0px_20px_45px_-15px_rgba(0,0,0,0.18)]">
        <div
          className="flex w-[calc(58%-20px)] flex-col gap-[clamp(1rem,2vw,1.375rem)] bg-white px-[clamp(1.25rem,2.5vw,1.5rem)] py-[clamp(1.25rem,2.5vw,1.75rem)]"
          style={{ animation: 'fade-in-up 0.5s ease-out 0.45s both' }}
        >
          <div className="flex flex-col gap-1">
            <p className="text-[clamp(0.75rem,0.9vw,0.8125rem)] font-medium text-muted">
              {booking.reference}
            </p>
            <p className="font-display text-[clamp(1.25rem,2vw,1.5rem)] font-bold text-ink">{booking.customer_name}</p>
          </div>

          <div className="flex flex-col gap-0.5">
            <p className="text-[clamp(1.05rem,1.6vw,1.25rem)] font-bold text-ink">{booking.sport_name ?? 'Court'}</p>
            <p className="text-[clamp(0.875rem,1.1vw,0.9375rem)] font-semibold text-muted">
              {booking.court_name ?? '—'}
            </p>
          </div>

          <p className="text-[clamp(0.8125rem,1vw,0.875rem)] font-medium text-ink">
            {bookingTypeLabel(booking.booking_type)}
          </p>

          <div className="flex flex-col gap-3 rounded-xl border border-black/10 px-[clamp(1rem,1.8vw,1.375rem)] py-[clamp(0.875rem,1.5vw,1.0625rem)]">
            <div className="flex flex-col">
              <p className="text-[clamp(0.75rem,0.9vw,0.8125rem)] font-medium text-muted">Payment</p>
              <p className={`text-[clamp(0.9375rem,1.2vw,1.0625rem)] font-bold ${paidInFull ? 'text-positive' : 'text-flame'}`}>
                {paidInFull ? 'Paid in full' : `${money(booking.balance_due)} due`}
              </p>
            </div>
            <div className="flex flex-col">
              <p className="text-[clamp(0.75rem,0.9vw,0.8125rem)] font-medium text-muted">Date</p>
              <p className="text-[clamp(0.9375rem,1.2vw,1.0625rem)] font-bold text-ink">
                {formalDate(booking.starts_at.slice(0, 10))}
              </p>
            </div>
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col">
                <p className="text-[clamp(0.6875rem,0.8vw,0.75rem)] font-medium text-muted">Duration</p>
                <p className="text-[clamp(0.8125rem,1vw,0.9375rem)] font-bold text-ink">
                  {timeLabel(booking.starts_at)} – {timeLabel(booking.ends_at)}
                </p>
              </div>
              <div className="flex flex-1 flex-col">
                <p className="text-[clamp(0.6875rem,0.8vw,0.75rem)] font-medium text-muted">Add ons</p>
                <p className="text-[clamp(0.8125rem,1vw,0.9375rem)] font-bold text-ink">{equipmentCount} items</p>
              </div>
            </div>
          </div>
        </div>

        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 px-[clamp(1rem,2vw,1.375rem)] py-[clamp(1.5rem,3vw,1.75rem)] text-center"
          style={{ animation: 'slide-in-right 0.55s cubic-bezier(0.16,1,0.3,1) both' }}
        >
          <p className="font-display text-[clamp(1.15rem,1.9vw,1.5rem)] font-bold text-ink">Check In Confirmed</p>
          <p className="text-[clamp(0.9375rem,1.2vw,1.0625rem)] font-semibold text-muted">Enjoy your game</p>
          <SuccessGraphic className="mt-1 w-full max-w-[190px]" />
        </div>
      </div>

      <div className="flex w-full max-w-[380px] flex-col gap-3">
        <button
          type="button"
          onClick={onRentEquipment}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-[clamp(0.875rem,1.6vw,1.125rem)] text-[clamp(1rem,1.2vw,1.125rem)] font-bold text-white"
        >
          Rent equipment
          <img src={arrowRight} alt="" className="size-[clamp(1.1rem,1.4vw,1.5rem)]" />
        </button>

        <HomeCountdownButton onHome={onHome} />
      </div>
    </div>
  )
}

function NotFound({ onRetry, onBookNow }: { onRetry: () => void; onBookNow: () => void }) {
  return (
    <div className="flex w-full max-w-[420px] flex-col items-center gap-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-surface-muted text-muted">
        <XCircle size={30} strokeWidth={1.75} />
      </span>
      <div className="flex flex-col gap-2">
        <p className="font-display text-[clamp(1.15rem,1.9vw,1.5rem)] font-bold text-ink">No booking found</p>
        <p className="text-[clamp(0.9375rem,1.1vw,1rem)] text-muted">
          We couldn't find a booking for that ID within its check-in window. Double check it, ask
          reception for help, or book a court now.
        </p>
      </div>
      <div className="flex w-full flex-col gap-3">
        <button
          type="button"
          onClick={onBookNow}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-[clamp(0.875rem,1.6vw,1.125rem)] text-[clamp(1rem,1.2vw,1.125rem)] font-bold text-white"
        >
          Book a Court Now
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-surface-muted py-[clamp(0.875rem,1.6vw,1.125rem)] text-[clamp(1rem,1.2vw,1.125rem)] font-bold text-ink"
        >
          Try another ID
        </button>
      </div>
    </div>
  )
}

export default function CheckInResult({
  status,
  booking,
  onRentEquipment,
  onHome,
  onRetry,
  onBookNow,
}: {
  status: 'loading' | 'found' | 'not-found'
  booking?: CheckinBooking | null
  onRentEquipment: () => void
  onHome: () => void
  onRetry: () => void
  onBookNow: () => void
}) {
  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3 text-muted">
        <Search size={28} strokeWidth={1.75} className="animate-pulse" />
        <p className="text-sm">Looking up the booking…</p>
      </div>
    )
  }

  if (status === 'found' && booking) {
    return <Found booking={booking} onRentEquipment={onRentEquipment} onHome={onHome} />
  }

  return <NotFound onRetry={onRetry} onBookNow={onBookNow} />
}
