import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type RowAction = {
  label: string
  onClick: () => void
  icon?: LucideIcon
  danger?: boolean
  disabled?: boolean
}

const MENU_WIDTH = 248
const ROW_HEIGHT = 42
const GAP = 4
const EDGE = 8

/**
 * The ⋮ menu at the end of a table row or card.
 *
 * The menu is drawn in a portal on `document.body` and positioned with `fixed`, not
 * absolutely inside the row. Tables and cards around here clip their overflow (they
 * scroll sideways, or round their corners), and a menu living inside one was cut off —
 * with a short table it showed as a sliver and grew a scrollbar. Out on the body there
 * is nothing to clip it. It opens downward and flips above the button when there is no
 * room below, and closes on scroll or resize rather than being left floating over a
 * row that has moved.
 */
export default function RowActionsMenu({ actions }: { actions: RowAction[] }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const open = pos !== null

  useEffect(() => {
    if (!open) return
    const close = () => setPos(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    // Capture: scrolling any ancestor (not just the window) moves the button.
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  const toggle = () => {
    if (open) return setPos(null)
    const r = trigger.current?.getBoundingClientRect()
    if (!r) return
    const height = actions.length * ROW_HEIGHT + 16
    const below = r.bottom + GAP
    const top = below + height > window.innerHeight - EDGE ? Math.max(EDGE, r.top - GAP - height) : below
    const left = Math.min(Math.max(EDGE, r.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - EDGE)
    setPos({ left, top })
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="flex size-9 items-center justify-center rounded-lg border border-transparent text-slate hover:border-border-input hover:bg-hover aria-expanded:border-border-input aria-expanded:bg-hover"
      >
        <MoreHorizontal size={18} />
      </button>

      {pos &&
        createPortal(
          // Events in a portal still bubble to React ancestors — a clickable row or
          // card around this menu must not treat a menu click as its own.
          <div onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setPos(null)}
              className="fixed inset-0 z-[70] cursor-default"
            />
            <div
              role="menu"
              style={{ left: pos.left, top: pos.top, width: MENU_WIDTH }}
              className="fixed z-[71] origin-top-right animate-pop overflow-hidden rounded-xl border border-border-card bg-white p-1.5"
            >
              {actions.map((action, i) => {
                const Icon = action.icon
                // A rule before the first destructive action, so "Delete" is never the
                // next thing under the cursor after a harmless one.
                const separate = action.danger && i > 0 && !actions[i - 1].danger
                return (
                  <div key={action.label}>
                    {separate && <div className="-mx-1.5 my-1.5 border-t border-border-card" />}
                    <button
                      type="button"
                      role="menuitem"
                      disabled={action.disabled}
                      onClick={() => {
                        setPos(null)
                        action.onClick()
                      }}
                      style={{ height: ROW_HEIGHT }}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 text-left text-[14px] disabled:opacity-40 ${
                        action.danger ? 'text-negative hover:bg-negative/5' : 'text-ink hover:bg-hover'
                      }`}
                    >
                      {Icon && <Icon size={15} />}
                      {action.label}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
