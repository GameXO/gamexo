import type { View } from '../App'

import {
  Calendar,
  Cashier,
  CartPlus,
  FootballPitch,
  GraduationCap,
  HelpCircle,
  Layers,
  LayoutGrid,
  Package,
  Settings2,
  Trophy,
  UsersRound,
  type IconComponent,
} from '../ui/icons'
import { SETTINGS_NAV, type SettingsSectionId } from '../settings/settingsNav'

export type NavItem = { label: string; icon: IconComponent; view?: View; submenu?: boolean }

/** The sidebar's own list — kept here (not in Sidebar.tsx) so the header search
 *  can index the same destinations without duplicating them. */
export const primaryItems: NavItem[] = [
  { label: 'Dashboard', icon: LayoutGrid, view: 'dashboard' },
  { label: 'Active Courts', icon: FootballPitch, view: 'activeCourts' },
  { label: 'Add ons', icon: CartPlus, view: 'addons' },
  { label: 'Bookings', icon: Calendar, view: 'bookings' },
  { label: 'Members', icon: UsersRound, view: 'members' },
  { label: 'Manage', icon: Layers, submenu: true },
  { label: 'Sales', icon: Cashier, view: 'sales' },
  { label: 'Inventory', icon: Package, view: 'equipment' },
  { label: 'Academy', icon: GraduationCap, view: 'academy' },
  { label: 'Events', icon: Trophy, view: 'events' },
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

/** Settings is the last row of the sidebar's main list and opens a panel, the way Manage
 *  does: its sections for an admin, and Help Center beneath them for everyone. */
export const helpItem: NavItem = { label: 'Help Center', icon: HelpCircle, view: 'helpCenter' }
export const settingsItem: NavItem = { label: 'Settings', icon: Settings2, view: 'settings', submenu: true }
