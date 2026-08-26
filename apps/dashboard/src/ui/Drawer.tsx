import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export default function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30"
      />
      <div className="fixed inset-y-0 right-0 z-50 flex h-screen w-full max-w-[440px] flex-col overflow-y-auto bg-page shadow-2xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-border-soft px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-ink">{title}</p>
            {subtitle && <p className="truncate text-xs text-slate">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border-input bg-white"
          >
            <X size={16} className="text-ink" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-5 p-5">{children}</div>

        {footer && <div className="shrink-0 border-t border-border-card p-5">{footer}</div>}
      </div>
    </>
  )
}
