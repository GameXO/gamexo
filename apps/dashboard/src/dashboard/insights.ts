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

/* ── The dashboard's selected period ───────────────────────────────────────
 * One range, chosen in the header, that every "current period" card reads. The
 * preset is carried alongside the instants because it is what decides the
 * comparison a stat card makes and the wording it uses — a calendar month
 * compares against the previous calendar month, not the preceding 30 days.
 */
export type RangePreset = 'today' | 'month' | 'custom'
export type DashboardRange = DateRange & { label: string; preset: RangePreset }

export function todayPreset(): DashboardRange {
  return { ...todayRange(), label: 'Today', preset: 'today' }
}

export function monthPreset(): DashboardRange {
  const { fromISO, toISO } = monthRange(0)
  return { fromISO, toISO, label: 'This Month', preset: 'month' }
}

const dayLabel = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

/** Builds a range from two inclusive `YYYY-MM-DD` values, as the half-open
 *  instants `date_from`/`date_to` expect — so the end day is included in full
 *  rather than cut off at midnight. Parsed without a `Z` so the bounds land on
 *  the viewer's own midnight, matching every other range builder here. */
export function customPreset(fromDate: string, toDate: string): DashboardRange {
  const start = new Date(`${fromDate}T00:00:00`)
  const lastDay = new Date(`${toDate}T00:00:00`)
  const end = new Date(lastDay)
  end.setDate(end.getDate() + 1)
  return {
    fromISO: start.toISOString(),
    toISO: end.toISOString(),
    label: fromDate === toDate ? dayLabel(start) : `${dayLabel(start)} – ${dayLabel(lastDay)}`,
    preset: 'custom',
  }
}

/** The window a card compares the selected period against: the previous
 *  calendar month for a month, otherwise the equal-length span immediately
 *  before it — which for "today" is exactly yesterday. */
export function previousPeriod(range: DashboardRange): DateRange {
  if (range.preset === 'month') {
    const { fromISO, toISO } = monthRange(-1)
    return { fromISO, toISO }
  }
  const from = new Date(range.fromISO).getTime()
  const span = new Date(range.toISO).getTime() - from
  return { fromISO: new Date(from - span).toISOString(), toISO: range.fromISO }
}

/** How the two halves of a period-over-period comparison are named. Kept short
 *  — these sit under the bars of the comparison chart, in a column as wide as
 *  one bar. A calendar month keeps its own name ("Aug 2026") rather than
 *  "Previous", since that is what the chart used to read and it is more use. */
export function periodLabels(range: DashboardRange): { current: string; previous: string } {
  if (range.preset === 'month') return { current: monthRange(0).label, previous: monthRange(-1).label }
  if (range.preset === 'today') return { current: 'Today', previous: 'Yesterday' }
  return { current: 'Selected', previous: 'Previous' }
}

export function comparisonCaption(preset: RangePreset): string {
  if (preset === 'today') return 'vs yesterday'
  if (preset === 'month') return 'vs last month'
  return 'vs previous period'
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
