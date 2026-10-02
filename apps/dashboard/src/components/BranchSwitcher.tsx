import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Plus, Search } from 'lucide-react'
import { useBranches, type BranchOut } from '../api/hooks'
import { useActiveBranch } from '../branch/activeBranch'

const addressOf = (b: BranchOut) => [b.address, b.city].filter(Boolean).join(', ')

type Row = { id: string | null; name: string; hint: string; isDefault?: boolean }

/**
 * The top of the sidebar: the academy's mark and name, and — for an admin with more
 * than one branch — the control that switches which branch the dashboard is looking
 * at. It is one row, the way an account switcher is: the name with up/down chevrons,
 * and a menu that opens beneath it with a search box, the list, and a way to add one.
 *
 * Choosing a branch filters courts, bookings and the dashboard's figures to it;
 * "All branches" removes the filter. Anyone who cannot switch, or an academy with a
 * single branch, sees the same row without the chevrons and without a menu, so the
 * name of the place they are working in is always on screen.
 */
export default function BranchSwitcher({
  business,
  logoUrl,
  fallbackLogo,
  onManage,
}: {
  business: string
  logoUrl: string | null
  fallbackLogo: string
  onManage: () => void
}) {
  const { data: branches } = useBranches(false)
  const { branchId, setBranchId, canSwitch } = useActiveBranch()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)

  const list = useMemo(() => branches ?? [], [branches])
  const switchable = canSwitch && list.length > 1

  const rows: Row[] = useMemo(() => {
    const all: Row[] = [
      { id: null, name: 'All branches', hint: 'Everything, combined' },
      ...list.map((b) => ({ id: b.id, name: b.name, hint: addressOf(b) || 'No address yet', isDefault: b.is_default })),
    ]
    const q = query.trim().toLowerCase()
    return q ? all.filter((r) => r.name.toLowerCase().includes(q) || r.hint.toLowerCase().includes(q)) : all
  }, [list, query])

  useEffect(() => {
    if (!open) return
    search.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => setCursor(0), [query, open])

  function close() {
    setOpen(false)
    setQuery('')
  }

  function choose(id: string | null) {
    setBranchId(id)
    close()
  }

  function toggle() {
    const r = trigger.current?.getBoundingClientRect()
    if (r) {
      // Anchored to the row, but kept on screen on a narrow viewport.
      const width = Math.min(Math.max(r.width, 320), window.innerWidth - 16)
      setAnchor({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + 8, width })
    }
    setOpen((v) => !v)
  }

  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter' && rows[cursor]) {
      e.preventDefault()
      choose(rows[cursor].id)
    }
  }

  const active = list.find((b) => b.id === branchId) ?? null
  const only = list.length === 1 ? list[0] : null
  const branchName = (active ?? only)?.name ?? (list.length > 1 ? 'All branches' : null)

  const mark = (
    <img
      src={logoUrl || fallbackLogo}
      alt=""
      className="size-7 shrink-0 rounded-md object-contain"
    />
  )

  const label = (
    <span className="min-w-0 flex-1 text-left">
      <span className="block truncate text-[14px] font-medium leading-tight tracking-[-0.01em] text-ink" title={business}>
        {business}
      </span>
      {branchName && <span className="mt-0.5 block truncate text-[12px] leading-tight text-slate">{branchName}</span>}
    </span>
  )

  if (!switchable) {
    return (
      <div className="flex w-full items-center gap-2.5 px-1 py-0.5">
        {mark}
        {label}
      </div>
    )
  }

  return (
    <>
      <div className="flex w-full items-center gap-1">
        {mark}
        <button
          ref={trigger}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-hover aria-expanded:bg-hover"
        >
          {label}
          <ChevronsUpDown size={16} className="shrink-0 text-muted" />
        </button>
      </div>

      {open && anchor && (
        <>
          <button
            type="button"
            aria-label="Close branch menu"
            tabIndex={-1}
            onClick={close}
            className="fixed inset-0 z-[55] cursor-default animate-fade-in"
          />
          {/* Fixed, not absolute: the sidebar scrolls, and a menu inside it would be
              clipped by its own overflow. */}
          <div
            style={{ left: anchor.left, top: anchor.top, width: anchor.width }}
            className="fixed z-[56] origin-top-left animate-pop overflow-hidden rounded-xl border border-border-card bg-white"
          >
            <div className="flex items-center gap-2.5 border-b border-border-card px-3.5 py-3">
              <Search size={16} className="shrink-0 text-muted" />
              <input
                ref={search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Search branches…"
                aria-label="Search branches"
                className="no-ring min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-muted"
              />
            </div>

            <div role="listbox" aria-label="Branches" className="max-h-[50vh] overflow-y-auto p-1.5">
              {rows.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted">No branch matches “{query}”.</p>}
              {rows.map((r, i) => {
                const selected = r.id === branchId
                return (
                  <button
                    key={r.id ?? 'all'}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => choose(r.id)}
                    onMouseEnter={() => setCursor(i)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${
                      i === cursor || selected ? 'bg-hover' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-ink">
                        {r.name}
                        {r.isDefault && (
                          <span className="ml-2 rounded-full border border-border-soft px-1.5 py-px text-[11px] font-normal text-slate">
                            Default
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-slate">{r.hint}</span>
                    </span>
                    {selected && <Check size={16} className="shrink-0 text-ink" />}
                  </button>
                )
              })}
            </div>

            <div className="border-t border-border-card p-1.5">
              <button
                type="button"
                onClick={() => {
                  close()
                  onManage()
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[14px] text-ink hover:bg-hover"
              >
                <Plus size={16} className="text-slate" />
                Add or manage branches
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
