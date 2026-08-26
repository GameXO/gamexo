import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { SEARCHABLE_PAGES } from '../data/navigation'
import type { View } from '../App'

export default function HeaderSearch({ onNavigate }: { onNavigate: (view: View) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = query.trim().toLowerCase()
  const results = (q ? SEARCHABLE_PAGES.filter((p) => p.label.toLowerCase().includes(q)) : SEARCHABLE_PAGES).slice(0, 8)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => setActiveIndex(0), [query, open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  function close() {
    setOpen(false)
    setQuery('')
  }

  function select(view: View) {
    onNavigate(view)
    close()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      close()
      inputRef.current?.blur()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const picked = results[activeIndex]
      if (picked) select(picked.view)
    }
  }

  return (
    <div ref={wrapperRef} className="relative h-9 w-9 shrink-0">
      <div
        className={`absolute right-0 top-0 flex h-9 items-center overflow-hidden rounded-lg border border-border-input bg-white shadow-[0px_1px_2px_0px_rgba(82,88,102,0.09)] transition-[width] duration-200 ease-out ${
          open ? 'w-[260px] md:w-[380px]' : 'w-9 cursor-pointer'
        }`}
        onClick={() => !open && setOpen(true)}
      >
        <span className="flex size-9 shrink-0 items-center justify-center">
          <Search size={16} className="text-slate" />
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search Anything..."
          tabIndex={open ? 0 : -1}
          className="h-9 min-w-0 flex-1 bg-transparent pr-3 text-sm text-ink placeholder:text-muted focus:outline-none"
        />
      </div>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[260px] overflow-hidden rounded-lg border border-border-card bg-white py-1.5 shadow-[0px_10px_30px_-5px_rgba(15,73,106,0.25)] md:w-[380px]">
          {results.length === 0 ? (
            <p className="px-3.5 py-2.5 text-sm text-muted">No pages match “{query}”.</p>
          ) : (
            results.map((page, i) => (
              <button
                key={page.view}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => select(page.view)}
                className={`flex w-full cursor-pointer items-center justify-between px-3.5 py-2 text-left text-sm transition-colors ${
                  i === activeIndex ? 'bg-surface-muted text-ink' : 'text-slate'
                }`}
              >
                <span>{page.label}</span>
                {page.group && <span className="text-xs text-muted">{page.group}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
