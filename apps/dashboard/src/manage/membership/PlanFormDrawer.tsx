/**
 * Create or edit a membership plan.
 *
 * One plan carries four prices, one per term, rather than a single price and a
 * duration. That is the server's model and it is the right one: "Gold" is one
 * thing a member can be on monthly or yearly, not two plans that happen to share
 * a name and drift apart the first time someone edits only one of them.
 *
 * **Zero means the term is not sold.** The server refuses a membership on a term
 * priced at zero, so this is how an academy expresses "yearly only" without a
 * separate switch per term. Said in the form, because an empty box otherwise
 * reads as "not filled in yet".
 */
import { useState } from 'react'
import Drawer from '../../ui/Drawer'
import {
  DURATION_LABEL,
  PLAN_DURATIONS,
  planPrice,
  type MembershipPlanOut,
  type PlanDuration,
} from '../../api/hooks'
import type { MembershipPlanBody } from '../../api/client'

const field =
  'rounded-lg border border-border-input bg-surface px-3 py-2.5 text-ink outline-none focus:border-ink'

/** An empty box means zero — "not sold" — not "leave unchanged". */
const amount = (v: string) => (v.trim() === '' ? '0' : String(Number(v)))

export default function PlanFormDrawer({
  plan,
  saving,
  onClose,
  onSave,
}: {
  plan: MembershipPlanOut | null
  saving?: boolean
  onClose: () => void
  onSave: (body: MembershipPlanBody) => void
}) {
  const [name, setName] = useState(plan?.name ?? '')
  const [category, setCategory] = useState(plan?.category ?? '')
  const [prices, setPrices] = useState<Record<PlanDuration, string>>({
    '1m': plan ? String(planPrice(plan, '1m') || '') : '',
    '3m': plan ? String(planPrice(plan, '3m') || '') : '',
    '6m': plan ? String(planPrice(plan, '6m') || '') : '',
    '12m': plan ? String(planPrice(plan, '12m') || '') : '',
  })
  const [joiningFee, setJoiningFee] = useState(String(Number(plan?.joining_fee ?? 0) || ''))
  const [discountPct, setDiscountPct] = useState(String(plan?.discount_pct ?? 0))
  const [maxVisits, setMaxVisits] = useState(plan?.max_visits == null ? '' : String(plan.max_visits))
  const [benefits, setBenefits] = useState((plan?.benefits ?? []).join('\n'))

  const priced = PLAN_DURATIONS.filter((d) => Number(prices[d] || 0) > 0)
  const canSave = name.trim().length > 1 && priced.length > 0 && !saving

  return (
    <Drawer
      title={plan ? 'Edit plan' : 'New Membership'}
      subtitle={plan?.name}
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={!canSave}
          onClick={() =>
            onSave({
              name: name.trim(),
              category: category.trim() || null,
              price_1m: amount(prices['1m']),
              price_3m: amount(prices['3m']),
              price_6m: amount(prices['6m']),
              price_12m: amount(prices['12m']),
              joining_fee: amount(joiningFee),
              discount_pct: Number(discountPct) || 0,
              max_visits: maxVisits.trim() === '' ? null : Number(maxVisits),
              benefits: benefits
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            })
          }
          className="flex h-11 w-full items-center justify-center rounded-lg bg-ink text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      }
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-slate">Plan name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Gold Membership"
          className={field}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-slate">Category</span>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Optional — groups plans on the list"
          className={field}
        />
      </label>

      <div className="flex flex-col gap-1.5 text-sm">
        <span className="text-slate">Price per term (₹)</span>
        <p className="text-xs text-muted">
          Leave a term at zero and it is not offered — members can't be signed up on
          it, and staff won't see it when picking a duration.
        </p>
        <div className="mt-1 grid grid-cols-2 gap-3">
          {PLAN_DURATIONS.map((d) => (
            <label key={d} className="flex flex-col gap-1.5">
              <span className="text-xs text-muted">{DURATION_LABEL[d]}</span>
              <input
                type="number"
                min={0}
                value={prices[d]}
                onChange={(e) => setPrices({ ...prices, [d]: e.target.value })}
                placeholder="0"
                className={field}
              />
            </label>
          ))}
        </div>
        {priced.length === 0 && (
          <span className="text-xs text-amber-700">
            Price at least one term, or this plan can't be sold at all.
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate">Joining fee (₹)</span>
          <input
            type="number"
            min={0}
            value={joiningFee}
            onChange={(e) => setJoiningFee(e.target.value)}
            placeholder="0"
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate">Discount % on court hire</span>
          <input
            type="number"
            min={0}
            max={100}
            value={discountPct}
            onChange={(e) => setDiscountPct(e.target.value)}
            className={field}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-slate">Visits included</span>
        <input
          type="number"
          min={0}
          value={maxVisits}
          onChange={(e) => setMaxVisits(e.target.value)}
          placeholder="Unlimited"
          className={field}
        />
        <span className="text-xs text-muted">Leave blank for unlimited.</span>
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-slate">Benefits</span>
        <textarea
          value={benefits}
          onChange={(e) => setBenefits(e.target.value)}
          rows={3}
          placeholder={'Priority booking\nGuest passes'}
          className={field}
        />
        <span className="text-xs text-muted">One per line.</span>
      </label>
    </Drawer>
  )
}
