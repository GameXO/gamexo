/**
 * The surface every Settings screen is built from. Deliberately not a card: a flat
 * section on the page's white sheet, a title and one-line description on top, and
 * rows below separated by dotted hairlines. No shell, no heavy corners — the rows
 * are the structure.
 *
 * `flush` means the children draw their own rows (lists, `SettingsRow`s) and the
 * panel adds no padding of its own.
 */
export function SettingsPanel({
  title,
  description,
  action,
  flush = false,
  children,
}: {
  title?: string
  description?: string
  action?: React.ReactNode
  flush?: boolean
  children?: React.ReactNode
}) {
  return (
    <section className="w-full">
      {title && (
        <header className="flex items-start gap-4 border-b border-dashed border-border-soft pb-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description && (
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate">{description}</p>
            )}
          </div>
          {action}
        </header>
      )}
      {children !== undefined && <div className={flush ? '' : 'py-6'}>{children}</div>}
    </section>
  )
}

/** The page-level heading above a section: what this screen is, in one line. */
export function SettingsPageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate">{description}</p>
    </div>
  )
}

/**
 * One setting: what it is on the left, the control on the right, a dotted line
 * between rows. The label column is fixed so every control in a section starts on
 * the same vertical line, which is most of what makes a long settings page scannable.
 */
export function SettingsRow({
  label,
  description,
  children,
  htmlFor,
}: {
  label: string
  description?: string
  children: React.ReactNode
  htmlFor?: string
}) {
  return (
    <div className="grid gap-3 border-b border-dashed border-border-soft py-6 last:border-b-0 lg:grid-cols-[minmax(220px,300px)_minmax(0,1fr)] lg:gap-10">
      <div>
        <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
          {label}
        </label>
        {description && <p className="mt-1 text-[12px] leading-relaxed text-muted">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}
