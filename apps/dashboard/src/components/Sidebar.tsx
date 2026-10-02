import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, LogOut, Search, Zap } from 'lucide-react'
import {
  helpItem,
  isManageView,
  manageItems,
  opsItems,
  primaryItems,
  settingsItem,
  type NavItem,
} from '../data/navigation'
import { identityFrom } from '../auth/identity'
import { getImpersonatedTenant, setImpersonatedTenant } from '../auth/platform'
import { useAuth } from '../auth/AuthProvider'
import type { View } from '../App'
import { api } from '../api/client'
import { SETTINGS_NAV, type SettingsSectionId } from '../settings/settingsNav'
import BranchSwitcher from './BranchSwitcher'

import { asset } from '../lib/asset'

const brandLogo = asset('brand/brand-logo.svg')

/** Ask the header search to open — it owns the index and the keyboard handling. */
export const OPEN_SEARCH_EVENT = 'gamexo:open-search'

const ROW =
  'flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[14px] tracking-[-0.01em] text-ink transition-colors'

/** One row of the list. A destination, or — with `onOpen` — a door to a panel. */
function NavRow({
  label,
  icon,
  active,
  onClick,
  hasPanel,
}: {
  label: string
  icon?: string
  active: boolean
  onClick: () => void
  hasPanel?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`${ROW} ${active ? 'bg-hover font-medium' : 'hover:bg-hover/70'}`}
    >
      {icon && (
        <img src={icon} alt="" className={`size-[19px] shrink-0 transition-opacity ${active ? 'opacity-100' : 'opacity-55'}`} />
      )}
      <span className="flex-1 truncate">{label}</span>
      {hasPanel && <ChevronRight size={16} className="shrink-0 text-muted" />}
    </button>
  )
}

type Panel = 'manage' | 'settings' | null

export default function Sidebar({
  open,
  onClose,
  view,
  section,
  onNavigate,
}: {
  open: boolean
  onClose: () => void
  view: View
  /** Which settings section is showing, when `view` is `settings`. */
  section: SettingsSectionId
  onNavigate: (view: View, section?: SettingsSectionId) => void
}) {
  const { me, logout } = useAuth()
  const identity = useMemo(() => identityFrom(me), [me])
  const [tenantMenuOpen, setTenantMenuOpen] = useState(false)
  const [tenantOptions, setTenantOptions] = useState<Array<{ id: string; slug: string; name: string }>>([])

  const isAdmin = identity.isOps || identity.role === 'admin'

  // The all-academies view exists only for `ops@gamexo`, so it is appended here
  // rather than living in `manageItems` where an academy could ever see it.
  const manageList = useMemo(
    () => [...manageItems, ...(identity.isOps ? opsItems : [])],
    [identity.isOps],
  )
  const settingsList = useMemo(() => SETTINGS_NAV.flatMap((g) => g.items), [])

  // Only Manage and Settings have anything to open. The panel follows where you are —
  // landing on a manage or settings screen by any route (the header search, a button
  // inside a page) shows its panel, and landing anywhere else shows the main list —
  // and Back closes it without leaving the page.
  const panelFor = (v: View): Panel => (isManageView(v) ? 'manage' : v === 'settings' && isAdmin ? 'settings' : null)
  const [panel, setPanel] = useState<Panel>(() => panelFor(view))
  useEffect(() => {
    setPanel(panelFor(view))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, isAdmin])

  useEffect(() => {
    if (!identity.isOps) return

    let isLive = true
    api.listAllTenants()
      .then((tenants) => {
        if (isLive) setTenantOptions((tenants as Array<{ id: string; slug: string; name: string }>) ?? [])
      })
      .catch(() => {
        if (isLive) setTenantOptions([])
      })

    return () => {
      isLive = false
    }
  }, [identity.isOps])

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className="fixed inset-0 z-30 animate-fade-in bg-black/30 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-screen w-[264px] shrink-0 flex-col border-r border-border-soft bg-white transition-transform duration-300 ease-[var(--ease-spring)] lg:static lg:z-auto lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* An operator inside somebody else's academy needs a way back out, and a
            standing reminder that what they are looking at is not theirs. */}
        {identity.isOps && (
          <button
            type="button"
            onClick={() => setImpersonatedTenant(null)}
            className="mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-lg bg-lime/25 px-2.5 py-2 text-left text-[11px] font-medium text-lime-ink hover:bg-lime/40"
          >
            <span className="flex-1 truncate">Viewing as operator</span>
            <span className="shrink-0 underline underline-offset-2">Leave</span>
          </button>
        )}

        <div className="flex h-[60px] shrink-0 items-center border-b border-border-soft px-3">
          {/* The academy's own name and logo, not the product's: a turf seeing
              "XCourt" in its own sidebar is seeing somebody else's brand. Falls back
              to the gamexo mark only while /auth/me is in flight or nothing was
              uploaded. The same row switches branch when there is more than one. */}
          <BranchSwitcher
            business={identity.business}
            logoUrl={identity.logoUrl}
            fallbackLogo={brandLogo}
            onManage={() => onNavigate('settings', 'general')}
          />
        </div>

        <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 pt-3">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))}
            className="mb-3 flex h-11 w-full shrink-0 items-center gap-3 rounded-lg border border-border-card bg-white px-3 text-left text-[14px] text-muted hover:border-border-input"
          >
            <Search size={17} className="shrink-0" />
            <span className="flex-1">Quick search…</span>
            <kbd className="font-sans text-[12px] text-muted">Ctrl K</kbd>
          </button>

          {panel === null ? (
            <>
              <button
                type="button"
                onClick={() => onNavigate('booking')}
                className="mb-1 flex h-10 w-full shrink-0 items-center gap-3 rounded-lg bg-lime px-2.5 text-left text-[14px] font-medium text-lime-ink hover:brightness-95"
              >
                <Zap size={17} className="shrink-0" />
                <span className="flex-1">New Booking</span>
              </button>

              <div className="flex flex-col gap-0.5">
                {primaryItems.map((item: NavItem) =>
                  item.submenu ? (
                    <NavRow
                      key={item.label}
                      label={item.label}
                      icon={item.icon}
                      hasPanel
                      active={isManageView(view)}
                      onClick={() => {
                        setPanel('manage')
                        onNavigate('manageCourts')
                      }}
                    />
                  ) : (
                    <NavRow
                      key={item.label}
                      label={item.label}
                      icon={item.icon}
                      active={item.view === view}
                      onClick={() => item.view && onNavigate(item.view)}
                    />
                  ),
                )}
              </div>

              <div className="mt-auto flex flex-col gap-0.5 border-t border-border-soft pt-3">
                <NavRow
                  label={helpItem.label}
                  icon={helpItem.icon}
                  active={view === helpItem.view}
                  onClick={() => helpItem.view && onNavigate(helpItem.view)}
                />
                <NavRow
                  label={settingsItem.label}
                  icon={settingsItem.icon}
                  active={view === 'settings'}
                  // Anyone but an admin has no sections to open — a plain link.
                  hasPanel={isAdmin}
                  onClick={() => {
                    if (isAdmin) setPanel('settings')
                    onNavigate('settings')
                  }}
                />
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => setPanel(null)}
                className={`${ROW} mb-1 font-medium hover:bg-hover/70`}
              >
                <ChevronLeft size={18} className="shrink-0 text-slate" />
                <span>{panel === 'manage' ? 'Manage' : 'Settings'}</span>
              </button>

              {panel === 'manage'
                ? manageList.map((item) => (
                    <NavRow
                      key={item.view}
                      label={item.label}
                      active={item.view === view}
                      onClick={() => onNavigate(item.view)}
                    />
                  ))
                : settingsList.map((item) => (
                    <NavRow
                      key={item.id}
                      label={item.label}
                      active={view === 'settings' && item.id === section}
                      onClick={() => onNavigate('settings', item.id)}
                    />
                  ))}
            </div>
          )}
        </nav>

        <div className="relative shrink-0 border-t border-border-soft p-3">
          <button
            type="button"
            onClick={() => identity.isOps && setTenantMenuOpen((o) => !o)}
            className="flex w-full items-center gap-3 rounded-lg p-2 pr-11 text-left hover:bg-hover/70"
            aria-expanded={identity.isOps ? tenantMenuOpen : undefined}
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-lime-ink text-[11px] font-semibold text-lime">
              {identity.initials}
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
              <p className="truncate text-[14px] font-medium tracking-[-0.01em] text-ink">{identity.name}</p>
              {/* The username rather than the role alone: "what do I sign in
                  with" is the question support is actually asked, and the level is
                  readable from the username anyway. */}
              <p className="truncate text-[12px] text-slate" title={identity.username || identity.roleLabel}>
                {identity.username || identity.roleLabel}
              </p>
            </div>
            {identity.isOps && (
              <span className="shrink-0 rounded-full border border-border-soft bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate">
                Switch
              </span>
            )}
          </button>

          {identity.isOps && tenantMenuOpen && (
            <div className="absolute inset-x-3 bottom-full z-50 mb-2 animate-pop overflow-hidden rounded-xl border border-border-card bg-white">
              <button
                type="button"
                onClick={() => {
                  setImpersonatedTenant(null)
                  setTenantMenuOpen(false)
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-medium text-slate hover:bg-hover"
              >
                <span>All academies</span>
                {!getImpersonatedTenant() && (
                  <span className="text-[11px] uppercase tracking-[0.12em] text-lime-ink">Open</span>
                )}
              </button>

              {tenantOptions.map((tenant) => {
                const selected = getImpersonatedTenant() === tenant.slug
                return (
                  <button
                    key={tenant.id}
                    type="button"
                    onClick={() => {
                      setImpersonatedTenant(tenant.slug)
                      setTenantMenuOpen(false)
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-medium text-ink hover:bg-hover"
                  >
                    <span className="truncate">{tenant.name}</span>
                    {selected && <span className="text-[11px] uppercase tracking-[0.12em] text-lime-ink">Open</span>}
                  </button>
                )
              })}
            </div>
          )}

          {/* Its own control rather than the whole chip: at a counter tablet a
              stray tap on your own name should not end the shift's session. */}
          <button
            type="button"
            onClick={logout}
            title="Sign out"
            aria-label="Sign out"
            className="absolute right-5 top-1/2 flex size-8 shrink-0 -translate-y-1/2 items-center justify-center rounded-lg text-slate hover:bg-hover hover:text-ink"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
    </>
  )
}
