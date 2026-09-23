import { useMemo } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useBookingsInRange, useSports, type BookingOut } from '../api/hooks'
import {
  formatINRCompact,
  pctChange,
  periodLabels,
  previousPeriod,
  revenueBySport,
  type DashboardRange,
  type SportRevenueRow,
} from '../dashboard/insights'
import chartPie from '../assets/figma/chart-pie.svg'

const TRACK_HEIGHT = 120
const BAR_WIDTH = 56
const SEGMENT_GAP = 2
/** Space the flow ribbons run through, between the two bars. */
const RIBBON_GAP = 96
const CHART_WIDTH = BAR_WIDTH * 2 + RIBBON_GAP

/**
 * One green ramp stepped by lightness, in this app's own revenue-green family
 * rather than a second hue. Ordered biggest-sport-palest at the baseline up to
 * the darkest at the top, so the thin slices at the top of the stack get the
 * strongest contrast. Validated as an ordinal ramp against the card surface
 * (`#fdfdfd`): monotone lightness, every adjacent gap over 0.06 L, and the
 * light end clears the 2:1 floor at 2.45:1.
 *
 * A turf rarely runs more than a handful of sports, so the top 4 by combined
 * revenue take these steps and everything past that folds into one "Other"
 * slot rather than stretching the ramp until neighbouring steps stop reading
 * apart. Same hue for every slice means the legend and the hover chip — not
 * the color — are what actually name a sport.
 */
const SEGMENT_COLORS = ['#45b87e', '#23945a', '#1a6f3f', '#12522d']
const OTHER_COLOR = '#0b3a20'
const MAX_SEGMENTS = 4

type Segment = { key: string; label: string; color: string; previous: number; current: number }

/**
 * Sport is the breakdown, not something invented for this card — it's the
 * same dimension `SportPopularityCard` already renders (`revenueBySport`),
 * reused here so a "Football" slice means the same thing on both cards.
 *
 * The two bars are the selected period and the one immediately before it, so
 * this reads as month-over-month while the header sits on "This Month" and as
 * day-over-day or span-over-span once it does not.
 */
export default function MonthlyRevenueCard({ range }: { range: DashboardRange }) {
  const previous = previousPeriod(range)
  const labels = periodLabels(range)
  const bookings = useBookingsInRange(previous.fromISO, range.toISO)
  // Includes sports since retired — a booking made while one was still active
  // shouldn't lose its label the moment it's turned off.
  const sports = useSports(true)

  const { segments, achieved, target } = useMemo(() => {
    const nameOf = (id: string) => sports.data?.find((s) => s.id === id)?.name ?? 'Other'
    const cutoff = new Date(range.fromISO)
    const all = bookings.data ?? []
    const splitByPeriod = (before: boolean) =>
      all.filter((b: BookingOut) => (new Date(b.starts_at) < cutoff) === before)

    const lastRows = revenueBySport(splitByPeriod(true), nameOf)
    const thisRows = revenueBySport(splitByPeriod(false), nameOf)
    const revenueOf = (rows: SportRevenueRow[], sportId: string) =>
      rows.find((r) => r.sportId === sportId)?.revenue ?? 0

    const combined = new Map<string, { label: string; revenue: number }>()
    for (const row of [...lastRows, ...thisRows]) {
      const entry = combined.get(row.sportId) ?? { label: row.sport, revenue: 0 }
      entry.revenue += row.revenue
      combined.set(row.sportId, entry)
    }
    const ranked = [...combined.entries()].sort((a, b) => b[1].revenue - a[1].revenue)
    const top = ranked.slice(0, MAX_SEGMENTS)
    const rest = ranked.slice(MAX_SEGMENTS)

    const segs: Segment[] = top.map(([sportId, { label }], i) => ({
      key: sportId,
      label,
      color: SEGMENT_COLORS[i],
      previous: revenueOf(lastRows, sportId),
      current: revenueOf(thisRows, sportId),
    }))

    if (rest.length > 0) {
      segs.push({
        key: 'other',
        label: 'Other',
        color: OTHER_COLOR,
        previous: rest.reduce((sum, [id]) => sum + revenueOf(lastRows, id), 0),
        current: rest.reduce((sum, [id]) => sum + revenueOf(thisRows, id), 0),
      })
    }

    return {
      segments: segs,
      achieved: thisRows.reduce((sum, r) => sum + r.revenue, 0),
      target: lastRows.reduce((sum, r) => sum + r.revenue, 0),
    }
  }, [bookings.data, sports.data, range.fromISO])

  const change = pctChange(achieved, target)
  const diff = achieved - target
  const max = Math.max(1, achieved, target)
  const barHeight = (value: number) => (value > 0 ? Math.max(8, (value / max) * TRACK_HEIGHT) : 0)

  /**
   * Where each segment sits in one bar, as offsets up from the baseline. Every
   * segment gets an entry — one with no revenue that month collapses to zero
   * height, which keeps this array index-aligned with `segments` so a ribbon
   * can pair a sport's slice in one month with the same sport's in the other.
   */
  const layoutBar = (periodKey: 'previous' | 'current', total: number) => {
    const totalHeight = barHeight(total)
    const visibleCount = segments.filter((s) => s[periodKey] > 0).length
    const contentHeight = Math.max(0, totalHeight - Math.max(0, visibleCount - 1) * SEGMENT_GAP)
    let cursor = 0
    return segments.map((seg) => {
      const value = seg[periodKey]
      if (value <= 0 || total <= 0) return { seg, value, bottom: cursor, top: cursor }
      const bottom = cursor
      const top = bottom + Math.max(2, (value / total) * contentHeight)
      cursor = top + SEGMENT_GAP
      return { seg, value, bottom, top }
    })
  }

  const lastLayout = layoutBar('previous', target)
  const thisLayout = layoutBar('current', achieved)

  /**
   * `side` is which way the hover chip opens — always into the ribbon gap
   * between the bars, never up over the stack it belongs to.
   */
  const renderBar = (layout: ReturnType<typeof layoutBar>, periodLabel: string, side: 'left' | 'right') => (
    <div className="relative" style={{ width: BAR_WIDTH, height: TRACK_HEIGHT }}>
      {layout.every((s) => s.top <= s.bottom) ? (
        <div className="absolute inset-x-0 bottom-0 rounded-sm bg-border-soft" style={{ height: 4 }} />
      ) : (
        layout.map(({ seg, value, bottom, top }) =>
          top > bottom ? (
            <div
              key={seg.key}
              className="group absolute inset-x-0 rounded transition-[height]"
              style={{ height: top - bottom, bottom, backgroundColor: seg.color }}
            >
              <div
                className={`pointer-events-none absolute top-1/2 z-20 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover:block ${
                  side === 'left' ? 'left-full ml-2' : 'right-full mr-2'
                }`}
              >
                {seg.label} · {formatINRCompact(value)}
                <span className="block text-[10px] font-normal text-white/70">{periodLabel}</span>
              </div>
            </div>
          ) : null,
        )
      )}
    </div>
  )

  return (
    <div className="flex h-full flex-1 flex-col items-start gap-6 self-stretch overflow-hidden rounded-xl border border-border-card bg-surface p-5">
      <div className="flex items-center gap-2.5 py-[9px]">
        <img src={chartPie} alt="" className="size-5" />
        <p className="text-sm font-medium text-ink">
          {labels.current} vs {labels.previous}
        </p>
      </div>

      <div className="flex w-full flex-col items-start gap-1">
        <div className="flex items-baseline gap-2.5">
          <p className="text-[28px] font-semibold leading-[1.2] tracking-[0.28px] text-ink">
            {formatINRCompact(achieved)}
          </p>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
              change.sentiment === 'up' ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative'
            }`}
          >
            {change.sentiment === 'up' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {change.value}
          </span>
        </div>
        <p className="text-xs font-medium text-slate">
          {formatINRCompact(Math.abs(diff))} {diff >= 0 ? 'more' : 'less'} than {labels.previous}
        </p>
      </div>

      <div className="flex w-full flex-1 flex-col items-center justify-end gap-2 pt-2">
        <div className="flex justify-between" style={{ width: CHART_WIDTH }}>
          <span className="text-center text-xs font-medium text-slate" style={{ width: BAR_WIDTH }}>
            {formatINRCompact(target)}
          </span>
          <span className="text-center text-xs font-semibold text-ink" style={{ width: BAR_WIDTH }}>
            {formatINRCompact(achieved)}
          </span>
        </div>

        <div className="relative" style={{ width: CHART_WIDTH, height: TRACK_HEIGHT }}>
          <svg
            className="absolute inset-0"
            width={CHART_WIDTH}
            height={TRACK_HEIGHT}
            viewBox={`0 0 ${CHART_WIDTH} ${TRACK_HEIGHT}`}
            aria-hidden="true"
          >
            {segments.map((seg, i) => {
              const l = lastLayout[i]
              const r = thisLayout[i]
              if (l.top <= l.bottom && r.top <= r.bottom) return null
              // Bezier control points sit halfway across, which is what gives
              // the flow its S-curve instead of a straight taper.
              const xL = BAR_WIDTH
              const xR = CHART_WIDTH - BAR_WIDTH
              const midX = (xL + xR) / 2
              const y = (offset: number) => TRACK_HEIGHT - offset
              return (
                <path
                  key={seg.key}
                  d={`M ${xL} ${y(l.top)} C ${midX} ${y(l.top)} ${midX} ${y(r.top)} ${xR} ${y(r.top)} L ${xR} ${y(r.bottom)} C ${midX} ${y(r.bottom)} ${midX} ${y(l.bottom)} ${xL} ${y(l.bottom)} Z`}
                  fill={seg.color}
                  fillOpacity={0.14}
                />
              )
            })}
          </svg>

          <div className="absolute bottom-0 left-0">{renderBar(lastLayout, labels.previous, 'left')}</div>
          <div className="absolute bottom-0 right-0">{renderBar(thisLayout, labels.current, 'right')}</div>
        </div>

        <div className="flex justify-between" style={{ width: CHART_WIDTH }}>
          <span className="text-center text-xs font-medium text-muted" style={{ width: BAR_WIDTH }}>
            {labels.previous}
          </span>
          <span className="text-center text-xs font-medium text-ink" style={{ width: BAR_WIDTH }}>
            {labels.current}
          </span>
        </div>
      </div>

      {segments.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-card pt-4">
          {segments.map((seg) => (
            <div key={seg.key} className="flex items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
              <span className="text-xs font-medium text-slate">{seg.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
