/**
 * Local-first storage. Bookings, sales, customers and stock all live here so
 * the counter never waits on a network — localStorage stands in for the
 * on-device SQLite the shipping app would use, same read/write shape.
 */
import { useEffect, useState } from 'react'
import type { Booking, Customer, Rental, Sale } from '../data/booking'
import type { MembershipRecord } from '../data/membership'
import type { Student } from '../data/academy'

const NS = 'xcourt'
const key = (name: string) => `${NS}.${name}`

function read<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key(name))
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write<T>(name: string, value: T) {
  try {
    localStorage.setItem(key(name), JSON.stringify(value))
  } catch {
    /* storage full or blocked — session still works, it just won't persist */
  }
  emit()
}

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())
export function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Nudges every `useDbVersion()` subscriber to re-render without an actual
 *  localStorage write — used when something outside this module (the published
 *  equipment catalogue, synced from the API) changes in place. */
export function notifyChanged() {
  emit()
}

/* ---------- bookings ---------- */

export const getBookings = () => read<Booking[]>('bookings', [])

export function saveBooking(booking: Booking) {
  const all = getBookings()
  const idx = all.findIndex((b) => b.id === booking.id)
  if (idx >= 0) all[idx] = booking
  else all.unshift(booking)
  write('bookings', all)
  return booking
}

export const getBooking = (id: string) => getBookings().find((b) => b.id === id)

/** Seed a handful of today's bookings so Add-ons has real games to attach kit to. */
export function seedBookingsIfEmpty(make: () => Booking[]) {
  if (read('bookingsSeeded', false)) return
  write('bookingsSeeded', true)
  write('bookings', make())
}

/* ---------- counter sales (kit sold without a court) ---------- */

export const getSales = () => read<Sale[]>('sales', [])

export function saveSale(sale: Sale) {
  const all = getSales()
  const idx = all.findIndex((s) => s.id === sale.id)
  if (idx >= 0) all[idx] = sale
  else all.unshift(sale)
  write('sales', all)
  return sale
}

/* ---------- customers ---------- */

export const getCustomers = () => read<Customer[]>('customers', [])

export function upsertCustomer(customer: { name: string; phone: string; email?: string }) {
  if (!customer?.phone) return
  const all = getCustomers()
  const idx = all.findIndex((c) => c.phone === customer.phone)
  const merged: Customer =
    idx >= 0
      ? { ...all[idx], ...customer, visits: (all[idx].visits || 1) + 1 }
      : { name: customer.name, phone: customer.phone, email: customer.email || '', visits: 1 }
  if (idx >= 0) all[idx] = merged
  else all.unshift(merged)
  write('customers', all)
}

export const findCustomer = (phone: string) => getCustomers().find((c) => c.phone === phone)

/* ---------- inventory ---------- */

export const getStockAdjustments = () => read<Record<string, number>>('stock', {})

export function adjustStock(itemId: string, delta: number) {
  const stock = getStockAdjustments()
  stock[itemId] = (stock[itemId] || 0) + delta
  write('stock', stock)
}

/** Deduct one sale's worth of items from shelf stock in one go. */
export function issueStock(equipment: Record<string, number>) {
  for (const [itemId, qty] of Object.entries(equipment)) adjustStock(itemId, -qty)
}

/* ---------- equipment catalogue overrides (admin-managed, layered over the static catalogue) ---------- */

export type EquipmentOverride = {
  stock: number
  activeForSale: boolean
  sports: string[]
  name?: string
  hint?: string
  price?: number
  returnable?: boolean
  deposit?: number
}

export const getEquipmentOverrides = () => read<Record<string, EquipmentOverride>>('equipmentOverrides', {})

export function getEquipmentOverride(itemId: string, fallback: EquipmentOverride): EquipmentOverride {
  return getEquipmentOverrides()[itemId] || fallback
}

function patchEquipmentOverride(itemId: string, fallback: EquipmentOverride, patch: Partial<EquipmentOverride>) {
  const all = getEquipmentOverrides()
  all[itemId] = { ...(all[itemId] || fallback), ...patch }
  write('equipmentOverrides', all)
}

export const setEquipmentStock = (itemId: string, stock: number, fallback: EquipmentOverride) =>
  patchEquipmentOverride(itemId, fallback, { stock: Math.max(0, Math.round(stock)) })

export const setEquipmentActive = (itemId: string, activeForSale: boolean, fallback: EquipmentOverride) =>
  patchEquipmentOverride(itemId, fallback, { activeForSale })

export const setEquipmentSports = (itemId: string, sports: string[], fallback: EquipmentOverride) =>
  patchEquipmentOverride(itemId, fallback, { sports })

export const setEquipmentDetails = (itemId: string, patch: Partial<EquipmentOverride>, fallback: EquipmentOverride) =>
  patchEquipmentOverride(itemId, fallback, patch)

/* ---------- equipment rentals (returnable gear, checked out and back) ---------- */

export const getRentals = () => read<Rental[]>('rentals', [])

/** "Issued" for an item is never stored — it's always this: rentals still out. */
export const openRentalsFor = (itemId: string) => getRentals().filter((r) => r.itemId === itemId && r.status === 'out')

/** Checking gear out is one atomic move: it leaves the shelf and a rental record is opened. */
export function issueRental(rental: Omit<Rental, 'id' | 'status' | 'returnedAt'>) {
  const record: Rental = { ...rental, id: `RT${Math.floor(10000 + Math.random() * 89999)}`, status: 'out', returnedAt: null }
  write('rentals', [record, ...getRentals()])
  adjustStock(rental.itemId, -rental.qty)
  return record
}

/** Coming back 'ok' returns it to the shelf; 'lost' or 'maintenance' keep it off the floor. */
export function returnRental(rentalId: string, outcome: 'ok' | 'lost' | 'maintenance') {
  const all = getRentals()
  const rental = all.find((r) => r.id === rentalId)
  if (!rental) return
  rental.status = outcome === 'ok' ? 'returned' : outcome
  rental.returnedAt = new Date().toISOString()
  write('rentals', all)
  if (outcome === 'ok') adjustStock(rental.itemId, rental.qty)
}

/** A maintenance hold is resolved separately — it comes back to the shelf once fixed. */
export function resolveMaintenance(rentalId: string) {
  const all = getRentals()
  const rental = all.find((r) => r.id === rentalId)
  if (!rental || rental.status !== 'maintenance') return
  rental.status = 'returned'
  write('rentals', all)
  adjustStock(rental.itemId, rental.qty)
}

/* ---------- memberships ---------- */

export const getMemberships = () => read<MembershipRecord[]>('memberships', [])

export function saveMembership(membership: MembershipRecord) {
  const all = getMemberships()
  const idx = all.findIndex((m) => m.id === membership.id)
  if (idx >= 0) all[idx] = membership
  else all.unshift(membership)
  write('memberships', all)
  return membership
}

export const membershipsForCustomer = (phone: string) => getMemberships().filter((m) => m.customer.phone === phone)

/* ---------- membership plan admin (price/benefit overrides layered over the generated catalogue,
   same shape as equipmentOverrides — plus fully custom plans that don't map to a generated sport-tier) ---------- */

export type PlanStatus = 'active' | 'paused' | 'deleted'
export type PlanOverride = { price?: number; discountPercent?: number; benefits?: string; status: PlanStatus }

export const getPlanOverrides = () => read<Record<string, PlanOverride>>('planOverrides', {})

export function patchPlanOverride(id: string, patch: Partial<PlanOverride>) {
  const all = getPlanOverrides()
  const existing: PlanOverride = all[id] || { status: 'active' }
  all[id] = { ...existing, ...patch }
  write('planOverrides', all)
}

export type CustomPlan = {
  id: string
  name: string
  price: number
  durationMonths: number
  discountPercent: number
  benefits: string
  sportsIncluded: string[]
  status: PlanStatus
  createdAt: string
}

export const getCustomPlans = () => read<CustomPlan[]>('customPlans', [])

export function saveCustomPlan(plan: CustomPlan) {
  const all = getCustomPlans()
  const idx = all.findIndex((p) => p.id === plan.id)
  if (idx >= 0) all[idx] = plan
  else all.unshift(plan)
  write('customPlans', all)
}

export function patchCustomPlan(id: string, patch: Partial<CustomPlan>) {
  write(
    'customPlans',
    getCustomPlans().map((p) => (p.id === id ? { ...p, ...patch } : p)),
  )
}

export function deleteCustomPlan(id: string) {
  write(
    'customPlans',
    getCustomPlans().filter((p) => p.id !== id),
  )
}

/* ---------- academy enrollments ---------- */

export const getStudents = () => read<Student[]>('students', [])

export function saveStudent(student: Student) {
  const all = getStudents()
  const idx = all.findIndex((s) => s.id === student.id)
  if (idx >= 0) all[idx] = student
  else all.unshift(student)
  write('students', all)
  return student
}

export const studentsForCustomer = (phone: string) => getStudents().filter((s) => s.customer.phone === phone)
export const studentsInBatch = (batchId: string) => getStudents().filter((s) => s.batchId === batchId && s.status === 'active')

/* ---------- staff, roles & access ---------- */

export type StaffRole = 'admin' | 'staff' | 'coach'
export type StaffStatus = 'active' | 'inactive'
export type Permission =
  | 'dashboard'
  | 'bookings'
  | 'equipment'
  | 'payments'
  | 'reports'
  | 'settings'
  | 'staffManagement'
  | 'membership'

export type StaffMember = {
  id: string
  name: string
  phone: string
  email: string
  role: StaffRole
  specialty?: string
  joiningDate: string
  status: StaffStatus
  sportsAssigned: string[]
  lastLogin: string
  permissions: Permission[]
}

export const ALL_PERMISSIONS: { id: Permission; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'bookings', label: 'Bookings' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'payments', label: 'Payments' },
  { id: 'reports', label: 'Reports' },
  { id: 'settings', label: 'Settings' },
  { id: 'staffManagement', label: 'Staff Management' },
  { id: 'membership', label: 'Membership' },
]

const DEFAULT_PERMISSIONS: Record<StaffRole, Permission[]> = {
  admin: ['dashboard', 'bookings', 'equipment', 'payments', 'reports', 'settings', 'staffManagement', 'membership'],
  staff: ['dashboard', 'bookings', 'equipment', 'payments'],
  coach: ['dashboard', 'bookings'],
}

const DEFAULT_STAFF: StaffMember[] = [
  {
    id: 'ST1',
    name: 'Rohan Verma',
    phone: '9820011223',
    email: 'rohan@xcourt.com',
    role: 'admin',
    joiningDate: '2024-01-15',
    status: 'active',
    sportsAssigned: [],
    lastLogin: new Date().toISOString(),
    permissions: DEFAULT_PERMISSIONS.admin,
  },
  {
    id: 'ST2',
    name: 'Priya Nair',
    phone: '9820011224',
    email: 'priya@xcourt.com',
    role: 'staff',
    joiningDate: '2024-03-10',
    status: 'active',
    sportsAssigned: [],
    lastLogin: new Date(Date.now() - 3_600_000).toISOString(),
    permissions: DEFAULT_PERMISSIONS.staff,
  },
  {
    id: 'ST3',
    name: 'Arjun Mehta',
    phone: '9820011225',
    email: 'arjun@xcourt.com',
    role: 'coach',
    specialty: 'Badminton',
    joiningDate: '2024-05-02',
    status: 'active',
    sportsAssigned: ['badminton'],
    lastLogin: new Date(Date.now() - 7_200_000).toISOString(),
    permissions: DEFAULT_PERMISSIONS.coach,
  },
  {
    id: 'ST4',
    name: 'Kavya Reddy',
    phone: '9820011226',
    email: 'kavya@xcourt.com',
    role: 'coach',
    specialty: 'Swimming',
    joiningDate: '2024-06-20',
    status: 'active',
    sportsAssigned: ['swimming'],
    lastLogin: new Date(Date.now() - 86_400_000).toISOString(),
    permissions: DEFAULT_PERMISSIONS.coach,
  },
]

/** Fills in any fields missing from an older/partial record already sitting in localStorage. */
function normalizeStaff(m: Partial<StaffMember> & Pick<StaffMember, 'id' | 'name' | 'phone' | 'role'>): StaffMember {
  return {
    email: '',
    joiningDate: new Date().toISOString().slice(0, 10),
    status: 'active',
    sportsAssigned: [],
    lastLogin: new Date().toISOString(),
    permissions: DEFAULT_PERMISSIONS[m.role],
    ...m,
  }
}

export const getStaff = () => read<StaffMember[]>('staff', DEFAULT_STAFF).map(normalizeStaff)

export function saveStaffMember(member: StaffMember) {
  const all = getStaff()
  const idx = all.findIndex((m) => m.id === member.id)
  if (idx >= 0) all[idx] = member
  else all.unshift(member)
  write('staff', all)
}

export function setStaffRole(id: string, role: StaffRole) {
  write(
    'staff',
    getStaff().map((m) => (m.id === id ? { ...m, role, permissions: DEFAULT_PERMISSIONS[role] } : m)),
  )
}

export function setStaffPermissions(id: string, permissions: Permission[]) {
  write(
    'staff',
    getStaff().map((m) => (m.id === id ? { ...m, permissions } : m)),
  )
}

export function setStaffStatus(id: string, status: StaffStatus) {
  write(
    'staff',
    getStaff().map((m) => (m.id === id ? { ...m, status } : m)),
  )
}

export function deleteStaffMember(id: string) {
  write(
    'staff',
    getStaff().filter((m) => m.id !== id),
  )
}

/* ---------- discount coupons ---------- */

export type Coupon = { id: string; code: string; percent: number; expiresAt: string; active: boolean }

export const getCoupons = () => read<Coupon[]>('coupons', [])

export function saveCoupon(coupon: Coupon) {
  write('coupons', [coupon, ...getCoupons()])
}

export function toggleCoupon(id: string) {
  write(
    'coupons',
    getCoupons().map((c) => (c.id === id ? { ...c, active: !c.active } : c)),
  )
}

export function deleteCoupon(id: string) {
  write(
    'coupons',
    getCoupons().filter((c) => c.id !== id),
  )
}

/* ---------- payment modes accepted at the counter ---------- */

const DEFAULT_PAYMENT_MODES: Record<string, boolean> = { upi: true, card: true, cash: true, wallet: true }

export const getPaymentModes = () => read<Record<string, boolean>>('paymentModes', DEFAULT_PAYMENT_MODES)

export function togglePaymentMode(id: string) {
  const modes = getPaymentModes()
  write('paymentModes', { ...modes, [id]: !modes[id] })
}

/* ---------- customer notification preferences ---------- */

export type NotifChannel = 'email' | 'whatsapp' | 'sms'
export type NotifPrefs = Record<string, Record<NotifChannel, boolean>>

const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  bookingConfirmation: { email: true, whatsapp: true, sms: false },
  bookingReminder: { email: true, whatsapp: true, sms: true },
  bookingStarted: { email: false, whatsapp: true, sms: false },
  bookingEndingSoon: { email: false, whatsapp: true, sms: false },
  invoiceSent: { email: true, whatsapp: true, sms: false },
  paymentReminder: { email: true, whatsapp: false, sms: false },
}

export const getNotifPrefs = () => read<NotifPrefs>('notifPrefs', DEFAULT_NOTIF_PREFS)

export function toggleNotifPref(rowId: string, channel: NotifChannel) {
  const prefs = getNotifPrefs()
  const row = prefs[rowId] || { email: false, whatsapp: false, sms: false }
  write('notifPrefs', { ...prefs, [rowId]: { ...row, [channel]: !row[channel] } })
}

/** Bumps on every write so a component can re-read fresh data without caching a stale snapshot. */
export function useDbVersion() {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribe(() => setVersion((n) => n + 1)), [])
  return version
}
