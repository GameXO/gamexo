/**
 * What each login type is for, in one place: the Add/Edit drawer shows it as the
 * choice, and the Roles tab shows it as the reference. Written to describe what the
 * server actually enforces — the guards in `app/auth/deps.py` are the authority, and
 * this only explains them.
 *
 * `available: false` marks a role the server knows about but whose screens are not
 * built yet. Offering it would create a login that signs in to a page with nothing on
 * it, so it is shown, labelled, and not selectable.
 */
import type { StaffRole } from '../../api/client'

export type RoleMeta = {
  label: string
  summary: string
  can: string[]
  cannot: string
  available: boolean
}

export const ROLE_ORDER: StaffRole[] = ['admin', 'manager', 'reception', 'accountant', 'coach']

export const ROLE_META: Record<StaffRole | 'kiosk', RoleMeta> = {
  admin: {
    label: 'Admin',
    summary: 'The owner. Everything, including who has access.',
    can: ['Everything a manager can do', 'Add and change staff', 'Venue settings, payments and integrations'],
    cannot: 'Nothing is off limits.',
    available: true,
  },
  manager: {
    label: 'Manager',
    summary: 'Runs the venue day to day.',
    can: [
      'Bookings, members and inventory',
      'Academy: batches, reviews, coaches and payroll',
      'Reports and the dashboard',
    ],
    cannot: 'Cannot add staff or change venue settings.',
    available: true,
  },
  reception: {
    label: 'Front desk',
    summary: 'Takes bookings and payments at the desk.',
    can: ['Create and edit bookings', 'Enrol students and record fees', 'Look up members and customers'],
    cannot: 'Cannot see coach pay, change settings or manage staff.',
    available: true,
  },
  accountant: {
    label: 'Accountant',
    summary: 'The money side: fees, invoices and payroll.',
    can: ['Invoices and payments', 'Coach payroll and payouts', 'Fee and revenue reports'],
    cannot: 'Cannot edit coaches, plans or staff.',
    available: false,
  },
  coach: {
    label: 'Coach',
    summary: 'Their own classes and the students in them.',
    can: ["Today's sessions and the register", 'Notes on their own students'],
    cannot: "Cannot see fees, other coaches' students, pay or settings.",
    available: false,
  },
  kiosk: {
    label: 'Counter',
    summary: 'The shared tablet at the front desk. Not a person.',
    can: ['Walk-in bookings and payments', "Taking a class register"],
    cannot: 'Cannot read revenue, staff or settings. Its password is reset from Settings.',
    available: false,
  },
}

export const SHIFTS = ['Morning (6AM–2PM)', 'Evening (2PM–10PM)', 'Full day (9AM–6PM)', 'Flexible']

/** "3 days ago", "just now", or "Never" — a sign-in time as a person says it. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
