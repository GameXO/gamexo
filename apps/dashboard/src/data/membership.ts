import { GST_RATE, SPORTS, toPaise, type Sport } from './booking'

export type Tier = 'bronze' | 'silver' | 'gold'

export type MembershipPlan = {
  id: string
  sportId: string
  name: string
  tier: Tier
  months: number
  fee: number
  gst: number
  total: number
  discount: number
  sessionsPerMonth: number
  blurb: string
}

const TIER_LABEL: Record<Tier, string> = { gold: 'Elite', silver: 'Pro', bronze: 'Starter' }
const TIER_MONTHS: Record<Tier, number> = { bronze: 1, silver: 3, gold: 12 }
const TIER_MULTIPLE: Record<Tier, number> = { bronze: 4, silver: 10, gold: 32 }
const TIER_DISCOUNT: Record<Tier, number> = { bronze: 0.1, silver: 0.15, gold: 0.25 }
const TIER_SESSIONS: Record<Tier, number> = { bronze: 4, silver: 5, gold: 6 }
const TIER_BLURB: Record<Tier, string> = {
  bronze: 'A month at a time. Stop whenever they like.',
  silver: 'A season up front for a better court rate.',
  gold: "The regulars' plan — the best rate the venue does.",
}

function buildPlan(sport: Sport, tier: Tier): MembershipPlan {
  const fee = toPaise(sport.from * TIER_MULTIPLE[tier])
  const gst = toPaise(fee * GST_RATE)
  return {
    id: `${sport.id}-${tier}`,
    sportId: sport.id,
    name: `${sport.name} ${TIER_LABEL[tier]}`,
    tier,
    months: TIER_MONTHS[tier],
    fee,
    gst,
    total: fee + gst,
    discount: TIER_DISCOUNT[tier],
    sessionsPerMonth: TIER_SESSIONS[tier],
    blurb: TIER_BLURB[tier],
  }
}

export const MEMBERSHIP_PLANS: MembershipPlan[] = SPORTS.flatMap((sport) =>
  (['bronze', 'silver', 'gold'] as Tier[]).map((tier) => buildPlan(sport, tier)),
)

export const planById = (id: string) => MEMBERSHIP_PLANS.find((p) => p.id === id)
export const plansForSport = (sportId: string) => MEMBERSHIP_PLANS.filter((p) => p.sportId === sportId)

export function addMonths(iso: string, months: number) {
  const d = new Date(`${iso}T00:00:00`)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

export type MembershipStatus = 'active' | 'expiring' | 'expired' | 'frozen'

export type MembershipRecord = {
  id: string
  customer: { name: string; phone: string; email: string }
  planId: string
  startDate: string
  endDate: string
  fee: number
  gst: number
  total: number
  paidTotal: number
  sessionsUsed: number
  frozen: boolean
  payment: { method: string; status: string } | null
  createdAt: string
}

/** Status is derived from the dates and the frozen flag, never stored on its own. */
export function membershipStatus(m: MembershipRecord, today = new Date()): MembershipStatus {
  if (m.frozen) return 'frozen'
  const end = new Date(`${m.endDate}T23:59:59`)
  const daysLeft = Math.ceil((end.getTime() - today.getTime()) / 86400000)
  if (daysLeft < 0) return 'expired'
  if (daysLeft <= 7) return 'expiring'
  return 'active'
}

export const TIER_ORDER: Tier[] = ['bronze', 'silver', 'gold']
