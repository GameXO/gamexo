import type { ReactNode } from 'react'
import Card from './Card'

/**
 * A compact figure card — the label in the header band, the number and an optional
 * sub-line on the panel. The dashboard's big `StatCard` carries a trend; this is the
 * one for a strip of counts on an inner page.
 */
export default function StatTile({
  label,
  value,
  sub,
  tone,
  loading = false,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  /** A text-colour class for the figure, e.g. `text-positive`. */
  tone?: string
  loading?: boolean
}) {
  return (
    <Card title={label} compact>
      {loading ? (
        <div className="h-7 w-20 animate-pulse rounded bg-surface-muted" />
      ) : (
        <p className={`font-display text-2xl font-semibold ${tone ?? 'text-ink'}`}>{value}</p>
      )}
      {sub && !loading && <p className="mt-0.5 text-xs text-slate">{sub}</p>}
    </Card>
  )
}
