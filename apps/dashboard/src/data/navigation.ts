import type { View } from '../App'

import dashboardSquare from '../assets/figma/dashboard-square.svg'
import dices from '../assets/figma/dices.svg'
import shoppingCartAdd from '../assets/figma/shopping-cart-add.svg'
import calendar from '../assets/figma/calendar.svg'
import storeManagement from '../assets/figma/store-management.svg'
import packageDelivered from '../assets/figma/package-delivered.svg'
import mortarboard from '../assets/figma/mortarboard.svg'
import olympicTorch from '../assets/figma/olympic-torch.svg'
import userPlusDark from '../assets/figma/user-plus-dark.svg'

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

export const manageItems: { label: string; view: View }[] = [
  { label: 'Sports & Courts', view: 'manageCourts' },
  { label: 'Coaches', view: 'manageCoaches' },
  { label: 'Users', view: 'manageUsers' },
  { label: 'Membership', view: 'manageMembership' },
  { label: 'Invoices', view: 'manageInvoices' },
  { label: 'Discount Coupons', view: 'manageCoupons' },
  { label: 'Payment Modes', view: 'managePaymentModes' },
  { label: 'Integrations', view: 'manageIntegrations' },
  { label: 'Notifications', view: 'manageNotifications' },
  { label: 'Manage Staff', view: 'manageStaff' },
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
export const SEARCHABLE_PAGES: { label: string; view: View; group?: string }[] = [
  ...primaryItems
    .filter((item): item is NavItem & { view: View } => !!item.view)
    .map((item) => ({ label: item.label, view: item.view })),
  ...manageItems.map((item) => ({ label: item.label, view: item.view, group: 'Manage' })),
  { label: 'Help Center', view: 'helpCenter' as View },
  { label: 'Settings', view: 'settings' as View },
]
