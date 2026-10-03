import type { ReactNode } from 'react'

/**
 * The one card look for the dashboard, built from the same parts as `Table`: a
 * bordered shell tinted like the page, a quiet header band on that tint, and the
 * content on a white panel whose top corners are rounded over the band.
 *
 * With no `title` there is no band and the card is simply a white bordered
 * panel — what a bare figure or a chart wants. `flush` removes the body padding
 * for content that brings its own (a `Table` with `bare`, a list with row
 * dividers).
 */
export default function Card({
  title,
  icon,
  action,
  flush = false,
  compact = false,
  className = '',
  bodyClassName = '',
  children,
}: {
  title?: ReactNode
  icon?: ReactNode
  /** Sits at the trailing edge of the header band: a link, a count, a toggle. */
  action?: ReactNode
  flush?: boolean
  /** Tighter body padding, for a small figure rather than a panel. */
  compact?: boolean
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  const hasHeader = title != null || action != null
  return (
    <section className={`flex flex-col overflow-hidden rounded-xl border border-border-card bg-page ${className}`}>
      {hasHeader && (
        <header className="flex items-center gap-2.5 px-5 py-3.5">
          {icon}
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-slate">{title}</h2>
          {action}
        </header>
      )}
      <div
        className={`min-h-0 flex-1 bg-surface ${hasHeader ? 'rounded-t-xl border-t border-border-card' : ''} ${
          flush ? '' : compact ? 'px-5 py-4' : 'p-5 sm:p-6'
        } ${bodyClassName}`}
      >
        {children}
      </div>
    </section>
  )
}
