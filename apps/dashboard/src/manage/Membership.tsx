/**
 * Manage → Membership: the one place plans are defined.
 *
 * API-backed. It used to run on `planOverrides.ts`, which layered localStorage
 * edits over a generated mock catalogue — so a plan "created" here existed only
 * in that browser, and the memberships actually sold against the API knew
 * nothing about it.
 *
 * Grouped by category rather than by sport, because a plan on the server has a
 * free-text category and no sport: one membership usually covers the venue, not
 * a single court type.
 *
 * Two behaviours inherited from the API and worth stating plainly in the UI:
 *
 *   **A term priced at zero is not sold.** That is how a plan says "yearly
 *   only", and `POST /memberships` refuses anything else. So the card shows the
 *   terms that exist rather than a single headline price.
 *
 *   **Plans are retired, not deleted.** The foreign key from a subscription is
 *   RESTRICT, so a plan anyone holds cannot be removed. Retiring hides it from
 *   new sales and leaves existing members alone — which is what "delete" was
 *   always meant to do here.
 */
import { useState } from 'react'
import { Eye, Pause, Pencil, Play } from 'lucide-react'
import RowActionsMenu from '../ui/RowActionsMenu'
import ConfirmDialog from '../ui/ConfirmDialog'
import {
  DURATION_LABEL,
  planPrice,
  sellableDurations,
  useMembershipPlans,
  useSaveMembershipPlan,
  type MembershipPlanOut,
} from '../api/hooks'
import PlanFormDrawer from './membership/PlanFormDrawer'
import PlanDetail from './membership/PlanDetail'

const rupees = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

export default function Membership() {
  const { data: plans, isLoading } = useMembershipPlans(true)
  const save = useSaveMembershipPlan()

  const [detailId, setDetailId] = useState<string | null>(null)
  const [formPlan, setFormPlan] = useState<MembershipPlanOut | 'new' | null>(null)
  const [confirmRetire, setConfirmRetire] = useState<MembershipPlanOut | null>(null)
  const [error, setError] = useState<string | null>(null)

  const all = plans ?? []
  const detailPlan = detailId ? (all.find((p) => p.id === detailId) ?? null) : null
  if (detailPlan) return <PlanDetail plan={detailPlan} onBack={() => setDetailId(null)} />

  const setActive = async (plan: MembershipPlanOut, is_active: boolean) => {
    setError(null)
    try {
      await save.mutateAsync({ planId: plan.id, body: { is_active } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that plan.')
    }
  }

  const actionsFor = (plan: MembershipPlanOut) => [
    { label: 'View', icon: Eye, onClick: () => setDetailId(plan.id) },
    { label: 'Edit', icon: Pencil, onClick: () => setFormPlan(plan) },
    plan.is_active
      ? { label: 'Retire', icon: Pause, danger: true, onClick: () => setConfirmRetire(plan) }
      : { label: 'Offer again', icon: Play, onClick: () => setActive(plan, true) },
  ]

  // Uncategorised plans last, so a venue that never sets a category still reads
  // as one list rather than a section called "Other" above everything.
  const categories = [...new Set(all.map((p) => p.category ?? ''))].sort((a, b) =>
    a === '' ? 1 : b === '' ? -1 : a.localeCompare(b),
  )

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg text-ink">Membership</p>
          <p className="text-sm text-slate">
            Plans this academy sells. Price the terms you offer; leave the rest at zero.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormPlan('new')}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white"
        >
          + New Membership
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-negative/30 bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {isLoading && <p className="text-sm text-muted">Loading plans…</p>}

      {!isLoading && all.length === 0 && (
        <div className="rounded-xl border border-border-card bg-white p-6">
          <p className="text-sm font-medium text-ink">No plans yet</p>
          <p className="mt-1 text-sm text-slate">
            Create one and it becomes sellable from the Members screen straight away.
          </p>
        </div>
      )}

      {categories.map((category) => {
        const inCategory = all.filter((p) => (p.category ?? '') === category)
        if (inCategory.length === 0) return null
        return (
          <PlanSection
            key={category || 'uncategorised'}
            title={category || 'All members'}
            plans={inCategory}
            actionsFor={actionsFor}
            onOpen={setDetailId}
          />
        )
      })}

      {formPlan && (
        <PlanFormDrawer
          plan={formPlan === 'new' ? null : formPlan}
          saving={save.isPending}
          onClose={() => setFormPlan(null)}
          onSave={async (body) => {
            setError(null)
            try {
              // Branched rather than passing `planId: maybeUndefined`, so the
              // create path is type-checked as needing a full body.
              await (formPlan === 'new'
                ? save.mutateAsync({ body })
                : save.mutateAsync({ planId: formPlan.id, body }))
              setFormPlan(null)
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not save that plan.')
            }
          }}
        />
      )}

      {confirmRetire && (
        <ConfirmDialog
          title={`Retire ${confirmRetire.name}?`}
          message={
            (confirmRetire.active_count ?? 0) > 0
              ? `${confirmRetire.active_count} member${
                  confirmRetire.active_count === 1 ? '' : 's'
                } hold this plan. They keep it and can still renew — it just stops being offered to new members.`
              : 'It stops being offered to new members. You can put it back any time.'
          }
          confirmLabel="Retire"
          danger
          onCancel={() => setConfirmRetire(null)}
          onConfirm={() => {
            setActive(confirmRetire, false)
            setConfirmRetire(null)
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
  plans: MembershipPlanOut[]
  actionsFor: (
    plan: MembershipPlanOut,
  ) => { label: string; icon: typeof Eye; danger?: boolean; onClick: () => void }[]
  onOpen: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => {
          const terms = sellableDurations(plan)
          return (
            <div
              key={plan.id}
              className={`flex flex-col gap-2 rounded-xl border bg-white p-4 shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)] ${
                plan.is_active ? 'border-border-card' : 'border-border-card opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => onOpen(plan.id)} className="text-left">
                  <p className="text-sm font-semibold text-ink">{plan.name}</p>
                </button>
                <RowActionsMenu actions={actionsFor(plan)} />
              </div>

              <div className="flex flex-col gap-0.5">
                {terms.map((d) => (
                  <p key={d} className="text-sm text-slate">
                    <span className="text-muted">{DURATION_LABEL[d]}</span>{' '}
                    <span className="font-medium text-ink">{rupees(planPrice(plan, d))}</span>
                  </p>
                ))}
                {terms.length === 0 && (
                  <p className="text-sm text-amber-700">No term priced — can't be sold</p>
                )}
              </div>

              {(plan.benefits ?? []).length > 0 && (
                <p className="text-xs text-muted">{(plan.benefits ?? []).join(' · ')}</p>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                {(plan.active_count ?? 0) > 0 && (
                  <span className="text-[11px] text-slate">
                    {plan.active_count} member{plan.active_count === 1 ? '' : 's'}
                  </span>
                )}
                {!plan.is_active && (
                  <span className="w-fit rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-muted">
                    Retired
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
