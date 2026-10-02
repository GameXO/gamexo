import type { View } from '../App'

import { asset } from '../lib/asset'
import { SETTINGS_NAV, type SettingsSectionId } from '../settings/settingsNav'

const dashboardSquare = asset('dashboard/dashboard-square.svg')
const dices = asset('dashboard/dices.svg')
const shoppingCartAdd = asset('dashboard/shopping-cart-add.svg')
const calendar = asset('dashboard/calendar.svg')
const storeManagement = asset('dashboard/store-management.svg')
const packageDelivered = asset('dashboard/package-delivered.svg')
const mortarboard = asset('dashboard/mortarboard.svg')
const olympicTorch = asset('dashboard/olympic-torch.svg')
const userPlusDark = asset('dashboard/user-plus-dark.svg')
const settingsIcon = asset('dashboard/settings.svg')
const helpIcon = asset('dashboard/help-square-rounded.svg')

export type NavItem = { label: string; icon: string; view?: View; submenu?: boolean }

/** The sidebar's own list — kept here (not in Sidebar.tsx) so the header search
 *  can index the same destinations without duplicating them. */
export const primaryItems: NavItem[] = [
  { label: 'Dashboard', icon: dashboardSquare, view: 'dashboard' },
  { label: 'Active Courts', icon: dices, view: 'activeCourts' },
  { label: 'Add ons', icon: shoppingCartAdd, view: 'addons' },
  { label: 'Bookings', icon: calendar, view: 'bookings' },
  { label: 'Members', icon: userPlusDark, view: 'members' },
  { label: 'Manage', icon: storeManagement, submenu: true },
  { label: 'Sales', icon: storeManagement, view: 'sales' },
  { label: 'Inventory', icon: packageDelivered, view: 'equipment' },
  { label: 'Academy', icon: mortarboard, view: 'academy' },
  { label: 'Events', icon: olympicTorch, view: 'events' },
]

/** Day-to-day records. Configuration — plans, staff, payments, notifications,
 *  integrations — lives under Settings, not here, so nothing is reachable twice. */
export const manageItems: { label: string; view: View }[] = [
  { label: 'Sports & Courts', view: 'manageCourts' },
  { label: 'Users', view: 'manageUsers' },
  { label: 'Invoices', view: 'manageInvoices' },
  { label: 'Discount Coupons', view: 'manageCoupons' },
]

/** The platform operator's own item. Kept out of `manageItems` so it can never
 *  be shown to an academy by accident — the sidebar appends it only for
 *  `ops@gamexo`. See auth/identity.ts. */
export const opsItems: { label: string; view: View }[] = [
  { label: 'All Academies', view: 'opsTenants' },
]

export const isManageView = (view: View) => view.startsWith('manage')

/** Flat, searchable index of every real destination in the app — backs the
 *  header's quick-search. The "Manage" row itself is a submenu toggle, not a
 *  destination, so it's excluded in favour of its children. */
export const SEARCHABLE_PAGES: {
  label: string
  view: View
  group?: string
  /** For `settings` entries: the section to open rather than the last one used. */
  section?: SettingsSectionId
}[] = [
  ...primaryItems
    .filter((item): item is NavItem & { view: View } => !!item.view)
    .map((item) => ({ label: item.label, view: item.view })),
  ...manageItems.map((item) => ({ label: item.label, view: item.view, group: 'Manage' })),
  { label: 'Help Center', view: 'helpCenter' as View },
  { label: 'Settings', view: 'settings' as View },
  ...SETTINGS_NAV.flatMap((group) =>
    group.items.map((item) => ({
      label: item.label,
      view: 'settings' as View,
      group: 'Settings',
      section: item.id,
    })),
  ),
]

/** Pinned to the bottom of the sidebar. Settings opens a panel of its sections, the
 *  way Manage does — for an admin; anyone else gets a plain link. */
export const helpItem: NavItem = { label: 'Help Center', icon: helpIcon, view: 'helpCenter' }
export const settingsItem: NavItem = { label: 'Settings', icon: settingsIcon, view: 'settings', submenu: true }
