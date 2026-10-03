import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Menu } from '../ui/icons'
import HeaderSearch from './HeaderSearch'
import DateRangePicker from './DateRangePicker'
import type { View } from '../App'
import type { DashboardRange } from '../dashboard/insights'
import type { SettingsSectionId } from '../settings/settingsNav'

import { asset } from '../lib/asset'

const bell = asset('dashboard/bell.svg')
const calendarPlus = asset('dashboard/calendar-plus.svg')

const today = new Date().toLocaleDateString('en-US', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

/** One line under each page's title. Kept here, by title, so every screen that
 *  already passes `title` gets its description without being touched. */
const DESCRIPTIONS: Record<string, string> = {
  Dashboard: "A live view of today's courts, bookings and revenue.",
  'New Booking': "Pick a sport and a court, then take the customer's details and payment.",
  'Add-ons': 'Equipment and extras that can be added to a booking.',
  Bookings: 'Every booking across your courts — search, filter and manage them.',
  'Active Courts': 'Which courts are in play right now, and which are free.',
  Members: 'Memberships, renewals and who is due.',
  Academy: 'Students, plans and coaches, and where each student stands.',
  Inventory: 'Stock on hand and where equipment has gone.',
  Sales: 'Money taken across bookings, memberships and the counter.',
  Events: 'Tournaments and events at your venue.',
  Settings: 'Your venue, team, payments and preferences.',
  'Sports & Courts': 'The sports you offer and the courts they are played on.',
  Users: 'The people who sign in to this venue.',
  Invoices: 'Invoices raised and what is still owed on them.',
  'Discount Coupons': 'Codes that take money off a booking.',
  'Help Center': 'Guides and answers for running the venue on gamexo.',
  'All Academies': 'Every academy on the platform.',
}

/**
 * The top of every screen, in two tiers: a slim bar for the things that belong to
 * the whole app (the page trail, search, notifications, the date), then the page's own
 * title and a line saying what it is for.
 *
 * The title block is there to say where you are when you arrive, and it is dead weight
 * once you are reading. So it folds away as the page scrolls — its height eases to
 * nothing, handing the room to the content — and the page's name moves up into the bar
 * as a trail (`Manage › Sports & Courts`), so you are never left without it. Scrolling
 * back to the top unfolds it again.
 */
export default function Header({
  onMenuClick,
  onNavigate,
  title = 'Dashboard',
  crumbs,
  description,
  dateIcon = calendarPlus,
  range,
  onRangeChange,
}: {
  onMenuClick: () => void
  onNavigate: (view: View, section?: SettingsSectionId) => void
  title?: string
  /** The trail shown in the bar once the title has folded away. Defaults to just the
   *  title; a screen inside a group passes the group first, e.g. `['Manage', 'Users']`. */
  crumbs?: string[]
  /** Overrides the line under the title. Most screens leave it to `DESCRIPTIONS`. */
  description?: string
  /** Callers still pass a page icon; the header no longer draws one. */
  icon?: string
  dateIcon?: string
  /** Given only by a screen that reads a selected period. Without it the date
   *  sits there as a plain label, which is all every other screen wants. */
  range?: DashboardRange
  onRangeChange?: (next: DashboardRange) => void
}) {
  const blurb = description ?? DESCRIPTIONS[title]
  const trail = crumbs && crumbs.length > 0 ? crumbs : [title]

  const headerRef = useRef<HTMLElement>(null)
  const [folded, setFolded] = useState(false)

  // The page's scroller is a sibling of this header, and it differs from screen to
  // screen, so listen on the column that holds them both (scroll does not bubble, hence
  // capture) and react only to a scroller that is most of the column — not a table or
  // list scrolling inside the page.
  useEffect(() => {
    const column = headerRef.current?.parentElement
    if (!column) return
    const onScroll = (event: Event) => {
      const el = event.target
      if (!(el instanceof HTMLElement) || el === column || !column.contains(el)) return
      if (el.clientHeight < column.clientHeight * 0.5) return
      const room = el.scrollHeight - el.clientHeight
      // Two thresholds, not one: it folds past 48px but only unfolds back at the very
      // top, and only folds at all when the page has real room to scroll. Folding gives
      // the content ~70px, so on a barely-scrollable page the extra height would bring
      // it back to the top and unfold it again — flickering at the threshold.
      setFolded((was) => (was ? el.scrollTop > 4 : el.scrollTop > 48 && room > 220))
    }
    column.addEventListener('scroll', onScroll, true)
    return () => column.removeEventListener('scroll', onScroll, true)
  }, [])

  // A new screen starts at its top, with its title showing.
  useEffect(() => setFolded(false), [title])

  return (
    <header ref={headerRef} className="w-full shrink-0 border-b border-border-soft bg-white">
      <div className="flex h-[60px] items-center gap-2 border-b border-border-soft px-4 sm:gap-3 sm:px-6">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open menu"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border-input bg-white hover:bg-hover lg:hidden"
        >
          <Menu size={18} className="text-ink" />
        </button>

        <nav
          aria-label="Breadcrumb"
          aria-hidden={!folded}
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-sm transition-[opacity,transform] duration-200 ${
            folded ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
          }`}
        >
          {trail.map((crumb, i) => (
            <span key={crumb + i} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <ChevronRight size={14} className="shrink-0 text-muted" />}
              <span className={`truncate ${i === trail.length - 1 ? 'font-medium text-ink' : 'text-slate'}`}>{crumb}</span>
            </span>
          ))}
        </nav>

        <HeaderSearch onNavigate={onNavigate} />

        <button
          type="button"
          aria-label="Notifications"
          className="relative flex size-9 shrink-0 items-center justify-center rounded-lg border border-border-input bg-white hover:bg-hover"
        >
          <img src={bell} alt="" className="h-[18px] w-auto" />
          <span className="absolute right-[7px] top-[7px] size-2 rounded-full border-2 border-white bg-notify" />
        </button>

        {range && onRangeChange ? (
          <DateRangePicker range={range} onChange={onRangeChange} icon={dateIcon} />
        ) : (
          <div className="hidden h-9 shrink-0 items-center gap-2.5 rounded-lg border border-border-input bg-white px-3.5 md:flex">
            <span className="whitespace-nowrap text-sm text-ink">{today}</span>
            <img src={dateIcon} alt="" className="size-[18px]" />
          </div>
        )}
      </div>

      {/* Height eases between its natural size and zero via the 1fr -> 0fr grid trick,
          which animates without measuring the content. */}
      <div
        aria-hidden={folded}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          folded ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-4 py-4 sm:px-6">
            <h1 className="truncate font-display text-xl font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
            {blurb && <p className="mt-1 max-w-3xl text-[12px] leading-snug text-slate">{blurb}</p>}
          </div>
        </div>
      </div>
    </header>
  )
}
