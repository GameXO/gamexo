import { useState } from 'react'
import Drawer from '../../ui/Drawer'
import type { EffectivePlan } from './planOverrides'

export default function PlanFormDrawer({
  plan,
  onClose,
  onSave,
}: {
  plan: EffectivePlan | null
  onClose: () => void
  onSave: (fields: { name: string; price: number; discountPercent: number; benefits: string; durationMonths: number }) => void
}) {
  const [name, setName] = useState(plan?.name ?? '')
  const [price, setPrice] = useState(plan?.price ?? 1000)
  const [durationMonths, setDurationMonths] = useState(plan?.durationMonths ?? 1)
  const [discountPercent, setDiscountPercent] = useState(plan?.discountPercent ?? 10)
  const [benefits, setBenefits] = useState(plan?.benefits ?? '')

  const canSave = name.trim().length > 1 && price > 0

  return (
    <Drawer
      title={plan ? 'Edit plan' : 'New Membership'}
      subtitle={plan?.name}
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={!canSave}
          onClick={() => onSave({ name: name.trim(), price, discountPercent, benefits: benefits.trim(), durationMonths })}
          className="flex h-11 w-full items-center justify-center rounded-lg bg-ink text-sm font-medium text-white disabled:opacity-40"
        >
          Save
        </button>
      }
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-slate">Plan name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!!plan && !plan.isCustom}
          placeholder="e.g. Gold Membership"
          className="rounded-lg border border-border-input bg-surface px-3 py-2.5 text-ink outline-none focus:border-ink disabled:opacity-60"
        />
        {plan && !plan.isCustom && (
          <span className="text-xs text-muted">Name is tied to the sport & tier and can't be changed here.</span>
        )}
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate">Price / period (₹)</span>
          <input
            type="number"
            min={1}
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            className="rounded-lg border border-border-input bg-surface px-3 py-2.5 text-ink outline-none focus:border-ink"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate">Duration (months)</span>
          <input
            type="number"
            min={1}
            value={durationMonths}
            disabled={!!plan && !plan.isCustom}
            onChange={(e) => setDurationMonths(Number(e.target.value))}
            className="rounded-lg border border-border-input bg-surface px-3 py-2.5 text-ink outline-none focus:border-ink disabled:opacity-60"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-slate">Discount % on court hire</span>
        <input
          type="number"
          min={0}
          max={100}
          value={discountPercent}
          onChange={(e) => setDiscountPercent(Number(e.target.value))}
          className="rounded-lg border border-border-input bg-surface px-3 py-2.5 text-ink outline-none focus:border-ink"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-slate">Benefits</span>
        <textarea
          value={benefits}
          onChange={(e) => setBenefits(e.target.value)}
          rows={3}
          placeholder="What members get with this plan"
          className="rounded-lg border border-border-input bg-surface px-3 py-2.5 text-ink outline-none focus:border-ink"
        />
      </label>
    </Drawer>
  )
}
