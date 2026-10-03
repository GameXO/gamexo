import { X } from './icons'
import type { ReactNode } from 'react'

export default function Drawer({
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  /** A logo or glyph shown before the title. */
  icon?: ReactNode
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
        className="fixed inset-0 z-40 animate-fade-in bg-black/30"
      />
      <div className="fixed inset-y-0 right-0 z-50 flex h-screen w-full max-w-[440px] animate-slide-in flex-col overflow-y-auto border-l border-border-soft bg-page shadow-pop">
        <div className="flex shrink-0 items-center gap-3 border-b border-border-soft px-5 py-4">
          {icon}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold text-ink">{title}</p>
            {subtitle && <p className="truncate text-xs text-slate">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border-input bg-white hover:bg-hover"
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
