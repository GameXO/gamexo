/**
 * Pure aggregation over real API data for the turf dashboard.
 *
 * Nothing here invents a number — every function reduces `BookingOut[]` (or a
 * pair of real KPI snapshots) into the shape a dashboard card renders. Date
 * range builders live here too, so every card asking for "today" or "this
 * month" means the same instant.
 */
import type { BookingOut } from '../api/hooks'

export type DateRange = { fromISO: string; toISO: string }

export function todayRange(): DateRange {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { fromISO: start.toISOString(), toISO: end.toISOString() }
}

export function yesterdayRange(): DateRange {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - 1)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { fromISO: start.toISOString(), toISO: end.toISOString() }
}

/** Calendar month, `offset` months from the current one (0 = this month,
 *  -1 = last month). Bounds are the first-of-month instants the API's
 *  `date_from`/`date_to` (half-open) expect. */
export function monthRange(offset = 0): DateRange & { label: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1)
  return {
    fromISO: start.toISOString(),
    toISO: end.toISOString(),
    // Matches the backend's `strftime("%b %Y")` month label on RevenuePoint,
    // so a report row can be looked up by this string.
    label: start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
  }
}

/** First-of-month instant `n` months back — the left edge of a rolling
 *  revenue-trend window. */
export function monthsAgoStart(n: number): string {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() - n, 1).toISOString()
}

/** The last `n` month labels ending this month, in the same `"%b %Y"` shape
 *  the backend's RevenuePoint uses — so a month with no payments at all (the
 *  aggregate query only emits a row per month it has one) can be zero-filled
 *  instead of vanishing from the trend line. A zero here is a real "no revenue
 *  that month", not an invented figure. */
export function lastNMonthLabels(n: number): string[] {
  const now = new Date()
  const labels: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    labels.push(d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }))
  }
  return labels
}

const money = (v: string | number | null | undefined) => Number(v ?? 0)

export function formatINRCompact(amount: number): string {
  const abs = Math.abs(amount)
  if (abs >= 1_00_00_000) return `₹${(amount / 1_00_00_000).toFixed(2)}Cr`
  if (abs >= 1_00_000) return `₹${(amount / 1_00_000).toFixed(1)}L`
  if (abs >= 1_000) return `₹${(amount / 1_000).toFixed(1)}K`
  return `₹${Math.round(amount)}`
}

export function formatINR(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`
}

export type Sentiment = 'up' | 'down'
export type Trend = { value: string; sentiment: Sentiment; caption: string }

/** Percentage change of `current` over `previous`, for a stat card's trend
 *  line. `previous <= 0` has no meaningful percentage — reported as the plain
 *  swing instead of a divide-by-zero infinity. */
export function pctChange(current: number, previous: number): { value: string; sentiment: Sentiment } {
  if (previous <= 0) {
    if (current <= 0) return { value: '0%', sentiment: 'up' }
    return { value: 'New', sentiment: 'up' }
  }
  const change = ((current - previous) / previous) * 100
  const sign = change >= 0 ? '+' : ''
  return { value: `${sign}${change.toFixed(0)}%`, sentiment: change >= 0 ? 'up' : 'down' }
}

export function diffChange(current: number, previous: number): { value: string; sentiment: Sentiment } {
  const diff = current - previous
  const sign = diff >= 0 ? '+' : ''
  return { value: `${sign}${diff}`, sentiment: diff >= 0 ? 'up' : 'down' }
}

/** Booking count and revenue haven't gone stale for a booking system the way
 *  they would for a subscription business — a booking made today can still be
 *  for a slot next week. `status !== 'cancelled'` (already filtered upstream)
 *  is the only exclusion; `held` never reaches here either. */
export type SportRevenueRow = { sportId: string; sport: string; revenue: number; bookings: number }

export function revenueBySport(bookings: BookingOut[], sportName: (id: string) => string): SportRevenueRow[] {
  const bySport = new Map<string, { revenue: number; bookings: number }>()
  for (const b of bookings) {
    const row = bySport.get(b.sport_id) ?? { revenue: 0, bookings: 0 }
    row.revenue += money(b.total)
    row.bookings += 1
    bySport.set(b.sport_id, row)
  }
  return [...bySport.entries()]
    .map(([sportId, row]) => ({ sportId, sport: sportName(sportId), ...row }))
    .sort((a, b) => b.revenue - a.revenue)
}

/**
 * Revenue split by how the booking arrived — a walk-in at the counter, a
 * booking through the venue's own online gateway, or one a partner platform
 * (Playo, Hudle, …) placed.
 *
 * `booking_type` only distinguishes `walkin`/`online`; the online/third-party
 * split rides on `source_platform`, which a partner-placed booking carries and
 * a direct one does not (see `gateway/dialects/native.py`).
 */
export type ChannelKey = 'walkin' | 'online' | 'third_party'
export type ChannelRevenueRow = { key: ChannelKey; label: string; revenue: number; bookings: number }

const CHANNEL_LABEL: Record<ChannelKey, string> = {
  walkin: 'Walk-in',
  online: 'Online (Direct)',
  third_party: 'Third-Party',
}

export function channelOf(b: Pick<BookingOut, 'booking_type' | 'source_platform'>): ChannelKey {
  if (b.booking_type === 'walkin') return 'walkin'
  return b.source_platform ? 'third_party' : 'online'
}

export function revenueByChannel(bookings: BookingOut[]): ChannelRevenueRow[] {
  const byChannel = new Map<ChannelKey, { revenue: number; bookings: number }>()
  for (const b of bookings) {
    const key = channelOf(b)
    const row = byChannel.get(key) ?? { revenue: 0, bookings: 0 }
    row.revenue += money(b.total)
    row.bookings += 1
    byChannel.set(key, row)
  }
  return (['walkin', 'online', 'third_party'] as const)
    .map((key) => ({ key, label: CHANNEL_LABEL[key], ...(byChannel.get(key) ?? { revenue: 0, bookings: 0 }) }))
    .filter((row) => row.bookings > 0)
    .sort((a, b) => b.revenue - a.revenue)
}

/**
 * The busiest hour of day per sport — "prime hours" a turf prices peak rates
 * around. Hour is read from `starts_at` in the browser's local time, which
 * matches the tenant's own clock for the common case of the desk viewing its
 * own venue's dashboard.
 */
export type PrimeHourRow = { sportId: string; sport: string; hour: number; bookingsAtPeak: number; totalBookings: number }

export function primeHoursBySport(bookings: BookingOut[], sportName: (id: string) => string): PrimeHourRow[] {
  const bySport = new Map<string, Map<number, number>>()
  for (const b of bookings) {
    const hour = new Date(b.starts_at).getHours()
    const hours = bySport.get(b.sport_id) ?? new Map<number, number>()
    hours.set(hour, (hours.get(hour) ?? 0) + 1)
    bySport.set(b.sport_id, hours)
  }

  const rows: PrimeHourRow[] = []
  for (const [sportId, hours] of bySport) {
    let peakHour = 0
    let peakCount = 0
    let total = 0
    for (const [hour, count] of hours) {
      total += count
      if (count > peakCount) {
        peakCount = count
        peakHour = hour
      }
    }
    rows.push({ sportId, sport: sportName(sportId), hour: peakHour, bookingsAtPeak: peakCount, totalBookings: total })
  }
  return rows.sort((a, b) => b.totalBookings - a.totalBookings)
}

export function formatHourRange(hour: number): string {
  const label = (h: number) => {
    const suffix = h < 12 ? 'AM' : 'PM'
    const display = h % 12 || 12
    return `${display} ${suffix}`
  }
  return `${label(hour)} – ${label((hour + 1) % 24)}`
}
