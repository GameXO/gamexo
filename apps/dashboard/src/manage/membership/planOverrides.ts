import { MEMBERSHIP_PLANS, type MembershipPlan } from '../../data/membership'
import { GST_RATE, toPaise } from '../../data/booking'
import * as db from '../../lib/db'
import type { CustomPlan, PlanOverride } from '../../lib/db'

export type EffectivePlan = {
  id: string
  name: string
  price: number
  total: number
  durationMonths: number
  discountPercent: number
  benefits: string
  sportsIncluded: string[]
  status: 'active' | 'paused'
  isCustom: boolean
  sourceSportId?: string
}

function fromGenerated(plan: MembershipPlan, override?: PlanOverride): EffectivePlan {
  const price = override?.price ?? plan.fee
  const gst = toPaise(price * GST_RATE)
  return {
    id: plan.id,
    name: plan.name,
    price,
    total: price + gst,
    durationMonths: plan.months,
    discountPercent: override?.discountPercent ?? Math.round(plan.discount * 100),
    benefits: override?.benefits ?? plan.blurb,
    sportsIncluded: [plan.sportId],
    status: override?.status === 'deleted' ? 'paused' : override?.status === 'paused' ? 'paused' : 'active',
    isCustom: false,
    sourceSportId: plan.sportId,
  }
}

function fromCustom(plan: CustomPlan): EffectivePlan {
  const gst = toPaise(plan.price * GST_RATE)
  return {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    total: plan.price + gst,
    durationMonths: plan.durationMonths,
    discountPercent: plan.discountPercent,
    benefits: plan.benefits,
    sportsIncluded: plan.sportsIncluded,
    status: plan.status === 'paused' ? 'paused' : 'active',
    isCustom: true,
  }
}

export function listEffectivePlans(includeDeleted = false): EffectivePlan[] {
  const overrides = db.getPlanOverrides()
  const generated = MEMBERSHIP_PLANS.filter((p) => includeDeleted || overrides[p.id]?.status !== 'deleted').map((p) =>
    fromGenerated(p, overrides[p.id]),
  )
  const custom = db
    .getCustomPlans()
    .filter((p) => includeDeleted || p.status !== 'deleted')
    .map(fromCustom)
  return [...generated, ...custom]
}

export const getEffectivePlan = (id: string) => listEffectivePlans(true).find((p) => p.id === id) || null

export function pausePlan(plan: EffectivePlan) {
  if (plan.isCustom) db.patchCustomPlan(plan.id, { status: 'paused' })
  else db.patchPlanOverride(plan.id, { status: 'paused' })
}

export function resumePlan(plan: EffectivePlan) {
  if (plan.isCustom) db.patchCustomPlan(plan.id, { status: 'active' })
  else db.patchPlanOverride(plan.id, { status: 'active' })
}

export function deletePlan(plan: EffectivePlan) {
  if (plan.isCustom) db.deleteCustomPlan(plan.id)
  else db.patchPlanOverride(plan.id, { status: 'deleted' })
}

export function duplicatePlan(plan: EffectivePlan) {
  db.saveCustomPlan({
    id: `CP${Date.now()}`,
    name: `${plan.name} (Copy)`,
    price: plan.price,
    durationMonths: plan.durationMonths,
    discountPercent: plan.discountPercent,
    benefits: plan.benefits,
    sportsIncluded: plan.sportsIncluded,
    status: 'active',
    createdAt: new Date().toISOString(),
  })
}

export function editPlan(
  plan: EffectivePlan,
  fields: { name: string; price: number; discountPercent: number; benefits: string },
) {
  if (plan.isCustom) {
    db.patchCustomPlan(plan.id, fields)
  } else {
    // generated plans keep their catalogue name (tied to sport+tier) — only commercial terms are editable
    db.patchPlanOverride(plan.id, {
      price: fields.price,
      discountPercent: fields.discountPercent,
      benefits: fields.benefits,
    })
  }
}

export function createCustomPlan(fields: {
  name: string
  price: number
  durationMonths: number
  discountPercent: number
  benefits: string
}) {
  db.saveCustomPlan({
    id: `CP${Date.now()}`,
    ...fields,
    sportsIncluded: [],
    status: 'active',
    createdAt: new Date().toISOString(),
  })
}
