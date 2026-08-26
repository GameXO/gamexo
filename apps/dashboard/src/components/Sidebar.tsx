import { useEffect, useMemo, useState } from 'react'
import { isManageView, manageItems, opsItems, primaryItems } from '../data/navigation'
import { canManageAcademy, identityFrom } from '../auth/identity'
import { setImpersonatedTenant } from '../auth/platform'
import { useAuth } from '../auth/AuthProvider'
import type { View } from '../App'

import brandLogo from '../assets/figma/brand-logo.svg'
import bolt from '../assets/figma/bolt.svg'
import chevronRight from '../assets/figma/chevron-right.svg'
import helpSquareRounded from '../assets/figma/help-square-rounded.svg'
import settings from '../assets/figma/settings.svg'
import selectorChevron from '../assets/figma/selector-chevron.svg'

export default function Sidebar({
  open,
  onClose,
  view,
  onNavigate,
}: {
  open: boolean
  onClose: () => void
  view: View
  onNavigate: (view: View) => void
}) {
  const { me } = useAuth()
  const identity = useMemo(() => identityFrom(me), [me])
  const [manageOpen, setManageOpen] = useState(isManageView(view))

  useEffect(() => {
    if (isManageView(view)) setManageOpen(true)
  }, [view])

  // Staff management and Integrations are admin-only on the server; hiding them
  // here is so a staff member is not shown a page that 403s the moment they open
  // it. The server is still the authority — see auth/identity.ts.
  const visibleManageItems = useMemo(() => {
    const base = canManageAcademy(identity.role, identity.isOps)
      ? manageItems
      : manageItems.filter(
          (item) => item.view !== 'manageStaff' && item.view !== 'manageIntegrations',
        )
    // The all-academies view exists only for `ops@gamexo`, so it is appended here
    // rather than living in `manageItems` where an academy could ever see it.
    return identity.isOps ? [...base, ...opsItems] : base
  }, [identity.role, identity.isOps])

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-[260px] shrink-0 flex-col gap-8 overflow-y-auto border-r-[1.5px] border-border-soft bg-page p-5 transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* The academy's own name and logo, not the product's. This is a
            white-label dashboard — a turf seeing "XCourt" in its own sidebar is
            seeing somebody else's brand. Falls back to the gamexo mark only while
            /auth/me is still in flight or the venue has uploaded nothing. */}
        {/* An operator inside somebody else's academy needs a way back out, and a
            standing reminder that what they are looking at is not theirs. */}
        {identity.isOps && (
          <button
            type="button"
            onClick={() => setImpersonatedTenant(null)}
            className="-mb-4 flex w-full items-center gap-2 rounded-lg bg-lime/25 px-2.5 py-2 text-left text-[12px] font-medium text-lime-ink hover:bg-lime/40"
          >
            <span className="flex-1 truncate">Viewing as operator</span>
            <span className="shrink-0 underline underline-offset-2">Leave</span>
          </button>
        )}

        <div className="flex w-full shrink-0 items-center gap-2">
          {identity.logoUrl ? (
            <img
              src={identity.logoUrl}
              alt=""
              className="size-5 shrink-0 rounded object-contain"
            />
          ) : (
            <img src={brandLogo} alt="" className="size-5 shrink-0" />
          )}
          <p
            className="flex-1 truncate font-display text-[18px] font-semibold text-ink"
            title={identity.business}
          >
            {identity.business}
          </p>
        </div>

        <nav className="flex w-full flex-1 flex-col justify-between">
          {manageOpen ? (
            <div className="flex w-full flex-col gap-1">
              <button
                type="button"
                onClick={() => setManageOpen(false)}
                className="mb-1 flex h-[38px] w-full cursor-pointer items-center gap-2.5 rounded-lg pl-2.5 pr-3 py-2 text-left text-sm font-medium text-ink hover:bg-white/60"
              >
                <img src={chevronRight} alt="" className="size-4 rotate-180" />
                <span>Manage</span>
              </button>

              {visibleManageItems.map((item) => {
                const isActive = item.view === view
                return (
                  <button
                    key={item.view}
                    type="button"
                    onClick={() => onNavigate(item.view)}
                    className={`flex h-[38px] w-full cursor-pointer items-center gap-2.5 rounded-lg pl-8 pr-3 py-2 text-left text-sm transition-colors ${
                      isActive
                        ? 'bg-white text-ink shadow-[0px_4px_10px_0px_rgba(0,0,0,0.05),0px_10px_120px_0px_rgba(15,73,106,0.1)]'
                        : 'text-slate hover:bg-white/60'
                    }`}
                  >
                    <span className="flex-1">{item.label}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex w-full flex-col gap-1">
              <button
                type="button"
                onClick={() => onNavigate('booking')}
                className="flex h-[38px] w-full cursor-pointer items-center gap-2.5 rounded-lg bg-lime pl-2.5 pr-3 py-2 shadow-[0px_4px_10px_0px_rgba(0,0,0,0.05),0px_10px_120px_0px_rgba(15,73,106,0.1)]"
              >
                <img src={bolt} alt="" className="size-[18px]" />
                <span className="flex-1 text-left text-sm text-lime-ink">
                  New Booking
                </span>
              </button>

              {primaryItems.map((item) => {
                const isActive = item.view ? item.view === view : item.label === 'Manage' && isManageView(view)
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      if (item.label === 'Manage') {
                        setManageOpen(true)
                        onNavigate('manageCourts')
                        return
                      }
                      if (item.view) onNavigate(item.view)
                    }}
                    className={`flex h-[38px] w-full cursor-pointer items-center gap-2.5 rounded-lg pl-2.5 pr-3 py-2 text-left text-sm text-slate transition-colors ${
                      isActive
                        ? 'bg-white shadow-[0px_4px_10px_0px_rgba(0,0,0,0.05),0px_10px_120px_0px_rgba(15,73,106,0.1)]'
                        : 'hover:bg-white/60'
                    }`}
                  >
                    <img src={item.icon} alt="" className="size-[18px]" />
                    <span className="flex-1">{item.label}</span>
                    {item.submenu && <img src={chevronRight} alt="" className="size-4" />}
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex w-full shrink-0 flex-col gap-3">
            <div className="flex w-full flex-col gap-1">
              <button
                type="button"
                onClick={() => onNavigate('helpCenter')}
                className="flex h-[38px] w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate hover:bg-white/60"
              >
                <img src={helpSquareRounded} alt="" className="size-[18px]" />
                <span>Help Center</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="flex h-[38px] w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate hover:bg-white/60"
              >
                <img src={settings} alt="" className="h-[18px] w-auto" />
                <span>Settings</span>
              </button>
            </div>

            <div className="h-px w-full bg-border-soft" />

            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-3 rounded-lg p-3 text-left hover:bg-white/60"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lime-ink text-[12px] font-semibold text-lime">
                {identity.initials}
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
                <p className="truncate text-sm font-semibold tracking-[-0.14px] text-ink">
                  {identity.name}
                </p>
                {/* The username rather than the role alone: "what do I sign in
                    with" is the question support is actually asked, and the level
                    is readable from the username anyway. */}
                <p
                  className="truncate text-[11px] font-medium text-slate"
                  title={identity.username || identity.roleLabel}
                >
                  {identity.username || identity.roleLabel}
                </p>
              </div>
              <img src={selectorChevron} alt="" className="h-3 w-auto shrink-0" />
            </button>
          </div>
        </nav>
      </aside>
    </>
  )
}
