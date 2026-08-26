/**
 * One customer identity, one join. A person's membership status, academy
 * enrollment and booking history all resolve from their phone number here —
 * nothing about them is hand-set or duplicated per module.
 */
import { balanceOf, type Booking, type Sale } from './booking'
import { membershipStatus, planById, type MembershipRecord, type Tier } from './membership'
import { programById, type Student } from './academy'
import * as db from '../lib/db'

export type CustomerProfile = {
  name: string
  phone: string
  email: string
  visits: number
  bookings: Booking[]
  sales: Sale[]
  memberships: MembershipRecord[]
  students: Student[]
  totalBookings: number
  totalSpent: number
  outstandingDues: number
  activeMembership: MembershipRecord | null
  membershipTier: Tier | null
  academyPrograms: string[]
}

export function getCustomerProfile(phone: string): CustomerProfile | null {
  const customer = db.findCustomer(phone)
  if (!customer) return null

  const bookings = db.getBookings().filter((b) => b.customer.phone === phone)
  const sales = db.getSales().filter((s) => s.customer.phone === phone)
  const memberships = db.membershipsForCustomer(phone)
  const students = db.studentsForCustomer(phone)

  const totalSpent =
    bookings.reduce((sum, b) => sum + b.paidTotal, 0) +
    sales.reduce((sum, s) => sum + s.paidTotal, 0) +
    memberships.reduce((sum, m) => sum + m.paidTotal, 0) +
    students.reduce((sum, s) => sum + s.paidTotal, 0)

  const outstandingDues =
    bookings.reduce((sum, b) => sum + balanceOf(b), 0) +
    sales.reduce((sum, s) => sum + balanceOf(s), 0) +
    memberships.reduce((sum, m) => sum + balanceOf(m), 0) +
    students.reduce((sum, s) => sum + balanceOf(s), 0)

  const activeMembership =
    memberships.find((m) => membershipStatus(m) === 'active' || membershipStatus(m) === 'expiring') || null

  return {
    ...customer,
    bookings,
    sales,
    memberships,
    students,
    totalBookings: bookings.length,
    totalSpent,
    outstandingDues,
    activeMembership,
    membershipTier: activeMembership ? (planById(activeMembership.planId)?.tier ?? null) : null,
    academyPrograms: students.filter((s) => s.status === 'active').map((s) => programById(s.programId)?.name || ''),
  }
}

export function listMemberDirectory(): CustomerProfile[] {
  return db
    .getCustomers()
    .map((c) => getCustomerProfile(c.phone))
    .filter((p): p is CustomerProfile => p !== null)
}
