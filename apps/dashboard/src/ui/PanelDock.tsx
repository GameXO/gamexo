/**
 * A docked side panel: opens beside the page and squeezes it, instead of floating
 * over it behind a dark backdrop.
 *
 * `PanelDockProvider` wraps the app shell and renders an empty column at the right
 * edge of the flex row. `SidePanel` portals its contents into that column and
 * claims it, which animates the column's width open — and because the page column
 * is `flex-1 min-w-0`, the page narrows to make room rather than being covered.
 * The panel itself is an inset, rounded card with a gutter on every side.
 *
 * Below the `lg` breakpoint there is no room to squeeze, so the same panel falls
 * back to an inset overlay with a backdrop.
 *
 * Claims are counted, not a boolean: swapping one panel for another unmounts the
 * first and mounts the second in one commit, and a boolean would collapse and
 * re-open the column in between. React batches the two updates, so the count never
 * visibly touches zero.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from './icons'

/** Column width: the 436px card plus a 12px gutter on each side. */
const DOCK_WIDTH = 460
const WIDE = '(min-width: 1024px)'

type Dock = { node: HTMLElement | null; claim: () => () => void }

const DockContext = createContext<Dock | null>(null)

const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(WIDE)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
const useIsWide = () =>
  useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  )

export function PanelDockProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [claims, setClaims] = useState(0)

  const claim = useCallback(() => {
    setClaims((c) => c + 1)
    return () => setClaims((c) => c - 1)
  }, [])
  const value = useMemo(() => ({ node, claim }), [node, claim])

  return (
    <DockContext.Provider value={value}>
      {children}
      <aside
        ref={setNode}
        aria-hidden={claims === 0}
        style={{ width: claims > 0 ? DOCK_WIDTH : 0 }}
        className="hidden h-screen shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.19,1,0.22,1)] motion-reduce:transition-none lg:block"
      />
    </DockContext.Provider>
  )
}

export default function SidePanel({
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
  const dock = useContext(DockContext)
  const wide = useIsWide()
  const docked = Boolean(dock && wide)

  const claim = dock?.claim
  useEffect(() => (docked ? claim?.() : undefined), [docked, claim])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const card = (
    <div className="flex h-full w-full animate-slide-in flex-col overflow-hidden rounded-xl border border-border-soft bg-white">
      <div className="flex shrink-0 items-center gap-3 border-b border-border-card px-5 py-4">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-ink">{title}</p>
          {subtitle && <p className="truncate text-xs text-slate">{subtitle}</p>}
        </div>
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border-input bg-white hover:bg-hover"
        >
          <X size={16} className="text-ink" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">{children}</div>

      {footer && <div className="shrink-0 border-t border-border-card p-5">{footer}</div>}
    </div>
  )

  if (docked) {
    // Fixed width inside the column, so the card does not reflow while the column
    // is still growing — it is revealed, not stretched.
    return dock?.node ? createPortal(<div className="h-full w-[460px] p-3">{card}</div>, dock.node) : null
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="fixed inset-0 z-40 animate-fade-in bg-black/30"
      />
      <div className="fixed inset-y-3 right-3 z-50 w-[calc(100%-1.5rem)] max-w-[436px]">{card}</div>
    </>
  )
}
