import { useState } from 'react'
import { Eye, Pencil, Copy, Pause, Play, Trash2 } from 'lucide-react'
import { SPORTS } from '../data/booking'
import { money } from '../data/booking'
import * as db from '../lib/db'
import RowActionsMenu from '../ui/RowActionsMenu'
import ConfirmDialog from '../ui/ConfirmDialog'
import {
  listEffectivePlans,
  pausePlan,
  resumePlan,
  deletePlan,
  duplicatePlan,
  editPlan,
  createCustomPlan,
  type EffectivePlan,
} from './membership/planOverrides'
import PlanFormDrawer from './membership/PlanFormDrawer'
import PlanDetail from './membership/PlanDetail'

export default function Membership() {
  db.useDbVersion()
  const plans = listEffectivePlans()

  const [detailId, setDetailId] = useState<string | null>(null)
  const [formPlan, setFormPlan] = useState<EffectivePlan | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<EffectivePlan | null>(null)

  const detailPlan = detailId ? plans.find((p) => p.id === detailId) || null : null
  if (detailPlan) return <PlanDetail plan={detailPlan} onBack={() => setDetailId(null)} />

  const customPlans = plans.filter((p) => p.isCustom)
  const generatedBySport = SPORTS.map((sport) => ({
    sport,
    plans: plans.filter((p) => !p.isCustom && p.sourceSportId === sport.id),
  }))

  const actionsFor = (plan: EffectivePlan) => [
    { label: 'View', icon: Eye, onClick: () => setDetailId(plan.id) },
    { label: 'Edit', icon: Pencil, onClick: () => setFormPlan(plan) },
    { label: 'Duplicate', icon: Copy, onClick: () => duplicatePlan(plan) },
    plan.status === 'active'
      ? { label: 'Pause', icon: Pause, onClick: () => pausePlan(plan) }
      : { label: 'Resume', icon: Play, onClick: () => resumePlan(plan) },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => setConfirmDelete(plan) },
  ]

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between">
        <p className="text-lg text-ink">Membership</p>
        <button
          type="button"
          onClick={() => setFormPlan('new')}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white"
        >
          + New Membership
        </button>
      </div>

      {customPlans.length > 0 && (
        <PlanSection title="Custom Plans" plans={customPlans} actionsFor={actionsFor} onOpen={setDetailId} />
      )}

      {generatedBySport.map(
        ({ sport, plans: sportPlans }) =>
          sportPlans.length > 0 && (
            <PlanSection key={sport.id} title={sport.name} plans={sportPlans} actionsFor={actionsFor} onOpen={setDetailId} />
          ),
      )}

      {formPlan && (
        <PlanFormDrawer
          plan={formPlan === 'new' ? null : formPlan}
          onClose={() => setFormPlan(null)}
          onSave={(fields) => {
            if (formPlan !== 'new') editPlan(formPlan, fields)
            else createCustomPlan(fields)
            setFormPlan(null)
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.name}?`}
          message="This plan will no longer be offered. Existing members already enrolled are not affected."
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            deletePlan(confirmDelete)
            setConfirmDelete(null)
          }}
        />
      )}
    </div>
  )
}

function PlanSection({
  title,
  plans,
  actionsFor,
  onOpen,
}: {
  title: string
  plans: EffectivePlan[]
  actionsFor: (plan: EffectivePlan) => { label: string; icon: typeof Eye; danger?: boolean; onClick: () => void }[]
  onOpen: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`flex flex-col gap-2 rounded-xl border bg-white p-4 shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)] ${
              plan.status === 'paused' ? 'opacity-60' : 'border-border-card'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <button type="button" onClick={() => onOpen(plan.id)} className="text-left">
                <p className="text-sm font-semibold text-ink">{plan.name}</p>
              </button>
              <RowActionsMenu actions={actionsFor(plan)} />
            </div>
            <p className="text-xl font-semibold text-ink">
              {money(plan.price)}
              {plan.durationMonths === 1 ? '/month' : ` / ${plan.durationMonths}mo`}
            </p>
            <p className="text-xs text-muted">{plan.benefits}</p>
            {plan.status === 'paused' && <span className="w-fit rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-muted">Paused</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
