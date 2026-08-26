export type MembershipTier = 'Basic' | 'Silver' | 'Gold' | 'Platinum'

export const MEMBERSHIP_TIERS: { name: MembershipTier; minVisits: number; perk: string }[] = [
  { name: 'Basic', minVisits: 0, perk: 'Standard access with pay-as-you-go pricing.' },
  { name: 'Silver', minVisits: 2, perk: 'Early access to weekend slots.' },
  { name: 'Gold', minVisits: 4, perk: 'Priority booking slots and member-only offers.' },
  { name: 'Platinum', minVisits: 8, perk: 'Priority access, free locker usage, and loyalty perks.' },
]

export function tierForVisits(visits: number): MembershipTier {
  if (visits >= 8) return 'Platinum'
  if (visits >= 4) return 'Gold'
  if (visits >= 2) return 'Silver'
  return 'Basic'
}
