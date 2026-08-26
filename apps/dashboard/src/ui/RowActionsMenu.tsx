import { useState } from 'react'
import { MoreVertical } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type RowAction = {
  label: string
  onClick: () => void
  icon?: LucideIcon
  danger?: boolean
  disabled?: boolean
}

export default function RowActionsMenu({ actions }: { actions: RowAction[] }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Row actions"
        onClick={() => setOpen((v) => !v)}
        className="flex size-8 items-center justify-center rounded-lg text-slate hover:bg-surface-muted"
      >
        <MoreVertical size={16} />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10"
          />
          <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-lg border border-border-card bg-white py-1 shadow-lg">
            {actions.map((action) => {
              const Icon = action.icon
              return (
                <button
                  key={action.label}
                  type="button"
                  disabled={action.disabled}
                  onClick={() => {
                    setOpen(false)
                    action.onClick()
                  }}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm disabled:opacity-40 ${
                    action.danger ? 'text-negative hover:bg-negative/5' : 'text-ink hover:bg-surface-muted'
                  }`}
                >
                  {Icon && <Icon size={14} />}
                  {action.label}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
