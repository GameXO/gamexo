/**
 * The two charts the student profile needs, drawn as plain SVG.
 *
 * Hand-rolled rather than a chart library: a radar and a short line are a few dozen
 * lines each, and both have to render identically on screen and stay legible at the
 * narrow widths a tablet gives a card. No tooltips on purpose — every value is
 * printed on the chart, so nothing depends on hovering.
 */
import type { ReactNode } from 'react'

type Skill = { name: string; score: number }

export function SkillRadar({
  skills,
  previous = [],
}: {
  skills: Skill[]
  /** The review before this one, drawn dashed behind for comparison. */
  previous?: Skill[]
}) {
  // A polygon needs three corners. With fewer, bars read better than a sliver.
  if (skills.length < 3) return <SkillBars skills={skills} />

  const size = 300
  const c = size / 2
  const radius = 92
  const n = skills.length
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const point = (i: number, score: number) => {
    const r = (Math.max(0, Math.min(10, score)) / 10) * radius
    return [c + r * Math.cos(angle(i)), c + r * Math.sin(angle(i))] as const
  }
  const polygon = (items: Skill[]) => items.map((s, i) => point(i, s.score).join(',')).join(' ')
  const prevByName = new Map(previous.map((p) => [p.name, p.score]))
  // Only plotted when it can be compared like for like: every current skill present.
  const prevAligned = skills.every((s) => prevByName.has(s.name))
    ? skills.map((s) => ({ name: s.name, score: prevByName.get(s.name)! }))
    : []

  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Skill radar" className="mx-auto w-full max-w-[340px]">
      {[2, 4, 6, 8, 10].map((ring) => (
        <polygon
          key={ring}
          points={skills.map((_, i) => point(i, ring).join(',')).join(' ')}
          fill="none"
          stroke="var(--color-border-card)"
          strokeWidth={1}
        />
      ))}
      {skills.map((_, i) => {
        const [x, y] = point(i, 10)
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="var(--color-border-card)" strokeWidth={1} />
      })}

      {prevAligned.length > 0 && (
        <polygon
          points={polygon(prevAligned)}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      )}
      <polygon
        points={polygon(skills)}
        fill="var(--color-lime)"
        fillOpacity={0.35}
        stroke="var(--color-lime-ink)"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {skills.map((s, i) => {
        const [px, py] = point(i, s.score)
        const lx = c + (radius + 22) * Math.cos(angle(i))
        const ly = c + (radius + 22) * Math.sin(angle(i))
        const anchor = Math.abs(lx - c) < 8 ? 'middle' : lx > c ? 'start' : 'end'
        return (
          <g key={s.name}>
            <circle cx={px} cy={py} r={3.5} fill="var(--color-lime-ink)" />
            <text x={lx} y={ly - 2} textAnchor={anchor} fontSize={11} fill="var(--color-ink)" fontWeight={500}>
              {s.name}
            </text>
            <text x={lx} y={ly + 11} textAnchor={anchor} fontSize={11} fill="var(--color-slate)">
              {s.score}/10
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function SkillBars({ skills }: { skills: Skill[] }) {
  if (skills.length === 0) return null
  return (
    <div className="flex flex-col gap-3">
      {skills.map((s) => (
        <div key={s.name}>
          <div className="flex justify-between text-sm">
            <span className="text-ink">{s.name}</span>
            <span className="text-slate">{s.score}/10</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-surface-muted">
            <div className="h-2 rounded-full bg-lime-ink" style={{ width: `${s.score * 10}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export type TrendPoint = { label: string; value: number | null }

/**
 * A line over a few labelled points. A `null` value is a gap in the line, not a zero:
 * a month with no sessions marked is missing data, and drawing it as 0% would read as
 * a collapse in attendance.
 */
export function LineChart({
  points,
  max,
  unit = '',
  ticks,
  emptyMessage = 'Not enough data yet.',
  children,
}: {
  points: TrendPoint[]
  max: number
  unit?: string
  ticks: number[]
  emptyMessage?: string
  children?: ReactNode
}) {
  const filled = points.filter((p) => p.value !== null)
  if (filled.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">{emptyMessage}</p>
  }

  const w = 360
  const h = 170
  const left = 30
  const right = 12
  const top = 14
  const bottom = 28
  const x = (i: number) =>
    points.length === 1 ? (left + w - right) / 2 : left + (i * (w - left - right)) / (points.length - 1)
  const y = (v: number) => top + (1 - Math.max(0, Math.min(max, v)) / max) * (h - top - bottom)

  // Split into runs so a gap breaks the line instead of bridging it.
  const runs: { x: number; y: number }[][] = []
  points.forEach((p, i) => {
    if (p.value === null) {
      runs.push([])
      return
    }
    if (runs.length === 0) runs.push([])
    runs[runs.length - 1].push({ x: x(i), y: y(p.value) })
  })

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Trend" className="w-full">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={w - right} y1={y(t)} y2={y(t)} stroke="var(--color-border-card)" strokeWidth={1} />
            <text x={left - 6} y={y(t) + 3.5} textAnchor="end" fontSize={11} fill="var(--color-muted)">
              {t}
            </text>
          </g>
        ))}
        {runs
          .filter((r) => r.length > 1)
          .map((r, i) => (
            <polyline
              key={i}
              points={r.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="var(--color-lime-ink)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        {points.map((p, i) =>
          p.value === null ? null : (
            <g key={i}>
              <circle cx={x(i)} cy={y(p.value)} r={3.5} fill="var(--color-lime-ink)" />
              <text x={x(i)} y={y(p.value) - 8} textAnchor="middle" fontSize={11} fill="var(--color-ink)" fontWeight={500}>
                {p.value}
                {unit}
              </text>
            </g>
          ),
        )}
        {points.map((p, i) => (
          <text key={i} x={x(i)} y={h - 8} textAnchor="middle" fontSize={11} fill="var(--color-slate)">
            {p.label}
          </text>
        ))}
      </svg>
      {children}
    </div>
  )
}
