import { toISO, type Booking, type Court } from '../data/booking'
import { playState, type PlayState } from './slots'

export const todayISO = () => toISO(new Date())

export function bookingWindow(booking: Booking) {
  const start = new Date(booking.date + 'T00:00:00').getTime() + booking.startHour * 3_600_000
  const end = start + booking.hours * 3_600_000
  return { start, end }
}

/** A finished-early booking reads as done regardless of the clock; otherwise it's pure clock math. */
export function effectiveState(booking: Booking, now: number): PlayState {
  if (booking.status === 'completed') return 'done'
  const { start, end } = bookingWindow(booking)
  return playState(start, end, false, now)
}

export type CourtOccupancy = {
  court: Court
  state: 'live' | 'upcoming' | 'free'
  booking: Booking | null
}

/**
 * One entry per physical court: whoever's playing now, else whoever's next, else free.
 *
 * Courts are passed in rather than read from the shared `COURTS` array. That array
 * is repointed at the API at runtime by `SportCourtBridge`, so reading it here made
 * the board depend on render order — mount before the bridge resolved and every
 * court silently vanished.
 */
export function courtOccupancy(
  courts: Court[],
  bookings: Booking[],
  now: number,
): CourtOccupancy[] {
  const today = todayISO()
  const todays = bookings.filter((b) => b.date === today)
  return courts.map((court) => {
    const forCourt = todays.filter((b) => b.courtId === court.id)
    const live = forCourt.find((b) => effectiveState(b, now) === 'live')
    const upcoming = forCourt
      .filter((b) => effectiveState(b, now) === 'upcoming')
      .sort((a, b) => a.startHour - b.startHour)[0]
    const state: CourtOccupancy['state'] = live ? 'live' : upcoming ? 'upcoming' : 'free'
    return { court, state, booking: live || upcoming || null }
  })
}

/** +1hr is only safe if nothing else on this court starts before the new end time. */
export function canExtend(booking: Booking, all: Booking[]) {
  const newEndHour = booking.startHour + booking.hours + 1
  return !all.some(
    (o) =>
      o.id !== booking.id &&
      o.courtId === booking.courtId &&
      o.date === booking.date &&
      o.startHour < newEndHour &&
      o.startHour + o.hours > booking.startHour + booking.hours,
  )
}
