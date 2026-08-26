export type BulkAction = { label: string; onClick: () => void; danger?: boolean }

export default function BulkActionBar({
  count,
  actions,
  onClear,
}: {
  count: number
  actions: BulkAction[]
  onClear: () => void
}) {
  if (count === 0) return null

  return (
    <div className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-border-card bg-white px-4 py-3 shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)]">
      <p className="text-sm font-medium text-ink">{count} selected</p>
      <button type="button" onClick={onClear} className="text-xs text-muted hover:text-ink">
        Clear
      </button>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              action.danger
                ? 'border-negative/30 text-negative hover:bg-negative/5'
                : 'border-border-input text-ink hover:bg-surface-muted'
            }`}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}
