import { Users, Package, Plus } from 'lucide-react'
import { sportById, balanceOf, money, type Court, type Booking } from '../data/booking'
import { bookingWindow } from './derive'
import { countdown, minutesBetween, formatClock } from './slots'
import SportIcon from '../facility/SportIcon'

export default function CourtCard({
  court,
  state,
  booking,
  now,
  onClick,
}: {
  court: Court
  state: 'live' | 'upcoming' | 'free'
  booking: Booking | null
  now: number
  onClick: () => void
}) {
  const sport = sportById(court.sportId)

  if (state === 'free' || !booking) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex flex-col gap-6 rounded-xl border border-dashed border-border-input bg-surface/60 p-4 text-left transition-colors hover:border-ink"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{sport?.name}</p>
            <p className="text-base font-semibold text-ink">{court.name}</p>
          </div>
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-slate">
            <SportIcon sportId={court.sportId} />
          </div>
        </div>

        <div className="flex items-end justify-between">
          <div>
            <p className="text-sm font-medium text-positive">Free now</p>
            <p className="text-sm font-semibold text-ink">{money(court.price)}/hr</p>
          </div>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime text-lime-ink">
            <Plus size={17} />
          </span>
        </div>
      </button>
    )
  }

  const { end } = bookingWindow(booking)
  const kitCount = Object.values(booking.equipment).reduce((s, q) => s + q, 0)
  const balance = balanceOf(booking)
  const isLive = state === 'live'
  const minsLeft = isLive ? minutesBetween(now, end) : null
  const endingSoon = isLive && minsLeft !== null && minsLeft <= 10

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col gap-6 rounded-xl border p-4 text-left transition-transform hover:-translate-y-0.5 ${
        isLive ? 'border-ink bg-ink text-white' : 'border-border-card bg-surface text-ink'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={`text-[11px] font-semibold uppercase tracking-wide ${isLive ? 'text-white/60' : 'text-muted'}`}>
            {sport?.name}
          </p>
          <p className="text-base font-semibold">{court.name}</p>
        </div>
        <div
          className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${
            isLive ? 'bg-white/10 text-white' : 'bg-surface-muted text-slate'
          }`}
        >
          <SportIcon sportId={court.sportId} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{booking.customer.name}</p>
          {isLive ? (
            endingSoon ? (
              <span className="shrink-0 rounded-full bg-negative px-2 py-0.5 text-[11px] font-semibold text-white">
                Ending soon
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-lime px-2 py-0.5 text-[11px] font-semibold text-lime-ink">
                In play
              </span>
            )
          ) : (
            <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-slate">
              Next up
            </span>
          )}
        </div>
        <p className={`text-xs ${isLive ? 'text-white/70' : 'text-slate'}`}>
          {isLive ? countdown(minsLeft!) : `From ${formatClock(bookingWindow(booking).start)}`}
        </p>
      </div>

      <div className="flex items-end justify-between text-xs">
        <span className={`flex items-center gap-1 ${isLive ? 'text-white/70' : 'text-slate'}`}>
          <Users size={13} /> {booking.customer.players || '-'}
          <Package size={13} className="ml-2" /> {kitCount}
        </span>
        {balance > 0 && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              isLive ? 'bg-white/15 text-white' : 'bg-negative/10 text-negative'
            }`}
          >
            {money(balance)} due
          </span>
        )}
      </div>
    </button>
  )
}
