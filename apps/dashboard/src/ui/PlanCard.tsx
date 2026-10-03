import type { ReactNode } from 'react'
import { Crown } from './icons'
import RowActionsMenu, { type RowAction } from './RowActionsMenu'
import StatusPill, { type StatusTone } from './StatusPill'

/**
 * The one plan card, shared by membership plans and academy plans: a name with its
 * status and tier, the prices by term, the perks as chips, an optional free-form body,
 * and a footer. It is presentational — what a plan *is* stays with the caller.
 *
 * A plan has no stored tier, so the tier is how the card says where it sits on the
 * price ladder: Basic is quiet, Standard carries the brand colour, Premium is gold. See
 * `tiersByPrice` for how the tier is chosen.
 */

export type PlanTier = 'basic' | 'standard' | 'premium'

const TIER: Record<
  PlanTier,
  {
    label: string
    card: string
    bar: string
    badge: string
    price: string
    chip: string
    rule: string
  }
> = {
  basic: {
    label: 'Basic',
    card: 'border-border-card bg-white',
    bar: 'bg-border-soft',
    badge: 'bg-surface-muted text-slate',
    price: 'text-ink',
    chip: 'bg-surface-muted text-slate',
    rule: 'border-border-soft',
  },
  standard: {
    label: 'Standard',
    card: 'border-lime-ink/20 bg-white',
    bar: 'bg-lime-ink',
    badge: 'bg-lime/25 text-lime-ink',
    price: 'text-lime-ink',
    chip: 'bg-lime/15 text-lime-ink',
    rule: 'border-lime-ink/15',
  },
  premium: {
    label: 'Premium',
    card: 'border-amber-300/70 bg-gradient-to-b from-amber-50 to-white',
    bar: 'bg-gradient-to-r from-amber-300 via-amber-500 to-amber-300',
    badge: 'bg-amber-100 text-amber-800',
    price: 'text-amber-900',
    chip: 'bg-amber-100/70 text-amber-900',
    rule: 'border-amber-200',
  },
}

/** What a plan costs per month, from whichever terms it is actually sold by. */
export function monthlyEquivalent(prices: { '1m'?: number; '3m'?: number; '6m'?: number; '12m'?: number }): number {
  const months = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 } as const
  for (const key of ['1m', '3m', '6m', '12m'] as const) {
    const price = prices[key] ?? 0
    if (price > 0) return price / months[key]
  }
  return 0
}

/**
 * Splits plans into thirds by monthly price: the cheapest third is Basic, the dearest
 * Premium, the rest Standard. Ranked across the whole set rather than the filtered
 * view, so a card does not change tier because someone searched. Two plans are Basic
 * and Premium; one on its own is Standard — there is nothing to be higher or lower than.
 */
export function tiersByPrice(plans: { id: string; monthly: number }[]): Map<string, PlanTier> {
  const out = new Map<string, PlanTier>()
  const ranked = [...plans].sort((a, b) => a.monthly - b.monthly)
  const n = ranked.length
  ranked.forEach((plan, i) => {
    if (n === 1) return out.set(plan.id, 'standard')
    if (n === 2) return out.set(plan.id, i === 0 ? 'basic' : 'premium')
    const third = i / (n - 1)
    out.set(plan.id, third < 1 / 3 ? 'basic' : third > 2 / 3 ? 'premium' : 'standard')
  })
  return out
}

export default function PlanCard({
  tier,
  name,
  subtitle,
  status,
  actions,
  prices,
  noPriceMessage = "No term priced — can't be sold",
  perks = [],
  note,
  children,
  footerStart,
  footerEnd,
  onOpen,
  dimmed = false,
}: {
  tier: PlanTier
  name: string
  /** Quiet text after the pills: a category, an age band. */
  subtitle?: ReactNode
  status?: { label: string; tone: StatusTone }
  actions?: RowAction[]
  prices: { label: string; amount: string }[]
  noPriceMessage?: string
  perks?: string[]
  /** A line or two of small print under the perks. */
  note?: string
  /** Anything the plan owns that deserves a place on the card — an academy's batches. */
  children?: ReactNode
  footerStart?: ReactNode
  footerEnd?: ReactNode
  /** Makes the whole card the target; leave out for a card with its own controls. */
  onOpen?: () => void
  dimmed?: boolean
}) {
  const t = TIER[tier]
  return (
    <article
      onClick={onOpen}
      className={`group flex flex-col overflow-hidden rounded-xl border transition-colors ${t.card} ${
        onOpen ? 'cursor-pointer hover:border-border-soft' : ''
      } ${dimmed ? 'opacity-70' : ''}`}
    >
      <div className={`h-1 shrink-0 ${t.bar}`} />

      <header className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          {onOpen ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onOpen()
              }}
              className="block max-w-full truncate text-left text-[14px] font-semibold text-ink hover:underline"
            >
              {name}
            </button>
          ) : (
            <p className="truncate text-[14px] font-semibold text-ink">{name}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {status && <StatusPill label={status.label} tone={status.tone} />}
            <span
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${t.badge}`}
            >
              {tier === 'premium' && <Crown size={12} />}
              {t.label}
            </span>
            {subtitle && <span className="text-xs text-muted">{subtitle}</span>}
          </div>
        </div>
        {/* The menu sits inside a clickable card, so it must not also open the plan. */}
        {actions && (
          <div onClick={(e) => e.stopPropagation()} className="-mr-2 -mt-1 shrink-0">
            <RowActionsMenu actions={actions} />
          </div>
        )}
      </header>

      <div className={`mx-5 mt-4 border-t border-dashed pt-4 ${t.rule}`}>
        {prices.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
            {prices.map((p) => (
              <div key={p.label}>
                <dt className="text-xs text-muted">{p.label}</dt>
                <dd className={`mt-0.5 text-base font-semibold ${t.price}`}>{p.amount}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-amber-700">{noPriceMessage}</p>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 px-5 pb-4 pt-4">
        {perks.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {perks.map((perk) => (
              <li key={perk} className={`rounded-md px-2 py-1 text-xs ${t.chip}`}>
                {perk}
              </li>
            ))}
          </ul>
        )}
        {note && <p className="line-clamp-2 text-[12px] leading-relaxed text-muted">{note}</p>}
        {children}
      </div>

      {(footerStart || footerEnd) && (
        <footer
          className={`flex items-center justify-between border-t border-dashed px-5 py-3 text-xs ${t.rule}`}
        >
          <span className="inline-flex items-center gap-1.5 text-slate">{footerStart}</span>
          <span className="inline-flex items-center gap-0.5 font-medium text-ink">{footerEnd}</span>
        </footer>
      )}
    </article>
  )
}
