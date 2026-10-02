/** Small formatting and tone helpers shared by the Academy screens. */
import type { AttentionFlag, SkillLevel } from '../api/hooks'

export const rupees = (n: number | string) =>
  Number(n).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

export const LEVEL_TITLE: Record<SkillLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  competitive: 'Competitive',
}

/** "2 Oct 2026". Takes an ISO date or datetime. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = iso.length <= 10 ? new Date(`${iso}T00:00:00`) : new Date(iso)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "Sep" from "2026-09". */
export function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short' })
}

/**
 * Green, amber or red for an attendance figure. `null` is "no data yet", which is
 * deliberately not any of them — a new joiner is not a problem, and painting their
 * empty cell red would teach staff to ignore the colour.
 */
export function attendanceTone(pct: number | null): { bar: string; text: string } {
  if (pct === null) return { bar: 'bg-border-soft', text: 'text-muted' }
  if (pct >= 85) return { bar: 'bg-positive', text: 'text-positive' }
  if (pct >= 60) return { bar: 'bg-amber-400', text: 'text-amber-700' }
  return { bar: 'bg-negative', text: 'text-negative' }
}

export const FLAG_META: Record<AttentionFlag, { label: string; chip: string }> = {
  repeat_absentee: { label: 'Repeat absences', chip: 'bg-negative/10 text-negative' },
  low_attendance: { label: 'Low attendance', chip: 'bg-amber-50 text-amber-800' },
  renewal_due: { label: 'Renewal due', chip: 'bg-amber-50 text-amber-800' },
  promotion_ready: { label: 'Ready for promotion', chip: 'bg-lime/30 text-lime-ink' },
}

export const STATUS_CHIP: Record<string, string> = {
  active: 'bg-positive/15 text-positive',
  paused: 'bg-amber-50 text-amber-800',
  completed: 'bg-surface-muted text-slate',
  inactive: 'bg-surface-muted text-muted',
}

/** "Term ends in 3 days" / "Term ended 2 days ago" for the fees cell. */
export function renewalText(days: number | null | undefined): string {
  if (days === null || days === undefined) return ''
  if (days < 0) return `Ended ${-days}d ago`
  if (days === 0) return 'Ends today'
  return `Ends in ${days}d`
}
