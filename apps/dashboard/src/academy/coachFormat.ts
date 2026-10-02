/** Labels and one-line summaries for coach pay, shared by the list, profile and payroll. */
import type { CoachOut } from '../api/hooks'
import type { PayModel } from '../api/client'
import { rupees } from './format'

export const PAY_MODELS: { value: PayModel; label: string; hint: string }[] = [
  { value: 'fixed', label: 'Fixed salary', hint: 'The same amount every month.' },
  { value: 'hourly', label: 'Hourly', hint: 'A rate for every hour of completed sessions.' },
  { value: 'commission', label: 'Commission', hint: 'A share of the fees collected from their students.' },
  { value: 'hybrid', label: 'Salary + commission', hint: 'A fixed salary plus a share of fees collected.' },
]

export const PAY_MODEL_LABEL: Record<PayModel, string> = {
  fixed: 'Fixed',
  hourly: 'Hourly',
  commission: 'Commission',
  hybrid: 'Salary + commission',
}

export const COACH_TYPES = [
  { value: 'full-time', label: 'Full-time' },
  { value: 'part-time', label: 'Part-time' },
  { value: 'guest', label: 'Guest' },
  { value: 'visiting', label: 'Visiting' },
] as const

/** "₹55,000 / month", "₹1,500 / hour", "10% of fees", "₹20,000 + 10% of fees". */
export function payTerms(coach: Pick<CoachOut, 'pay_model' | 'salary' | 'hourly_rate' | 'commission_pct'>): string {
  const pct = `${Number(coach.commission_pct ?? 0)}% of fees`
  switch (coach.pay_model) {
    case 'hourly':
      return `${rupees(coach.hourly_rate ?? 0)} / hour`
    case 'commission':
      return pct
    case 'hybrid':
      return `${rupees(coach.salary ?? 0)} + ${pct}`
    default:
      return `${rupees(coach.salary ?? 0)} / month`
  }
}

/** "2026-09" → "September 2026". */
export function longMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
}

/** Shift "YYYY-MM" by whole months. */
export function addMonths(yyyyMm: string, delta: number): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const PAYOUT_STATUS_CHIP: Record<string, string> = {
  paid: 'bg-positive/15 text-positive',
  due: 'bg-amber-50 text-amber-800',
  nothing: 'bg-surface-muted text-muted',
}
