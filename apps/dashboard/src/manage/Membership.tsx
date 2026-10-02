/**
 * Members → Plans: the one place plans are defined.
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
import { useMemo, useState } from 'react'
import { ChevronRight, Eye, Pause, Pencil, Play, Plus, Search, Users } from 'lucide-react'
import RowActionsMenu from '../ui/RowActionsMenu'
import ConfirmDialog from '../ui/ConfirmDialog'
import StatusPill from '../ui/StatusPill'
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

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'offered', label: 'Offered' },
  { id: 'retired', label: 'Retired' },
] as const
type Filter = (typeof FILTERS)[number]['id']

const ALL = '__all__'

type Action = { label: string; icon: typeof Eye; danger?: boolean; onClick: () => void }

export default function Membership() {
  const { data: plans, isLoading } = useMembershipPlans(true)
  const save = useSaveMembershipPlan()

  const [detailId, setDetailId] = useState<string | null>(null)
  const [formPlan, setFormPlan] = useState<MembershipPlanOut | 'new' | null>(null)
  const [confirmRetire, setConfirmRetire] = useState<MembershipPlanOut | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  // 'all', or a category name ('' being plans with no category).
  const [category, setCategory] = useState<string>(ALL)

  const all = useMemo(() => plans ?? [], [plans])
  const detailPlan = detailId ? (all.find((p) => p.id === detailId) ?? null) : null

  const counts = useMemo(
    () => ({
      all: all.length,
      offered: all.filter((p) => p.is_active).length,
      retired: all.filter((p) => !p.is_active).length,
    }),
    [all],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((p) => {
      if (filter === 'offered' && !p.is_active) return false
      if (filter === 'retired' && p.is_active) return false
      if (!q) return true
      return p.name.toLowerCase().includes(q) || (p.category ?? '').toLowerCase().includes(q)
    })
  }, [all, filter, query])

  const setActive = async (plan: MembershipPlanOut, is_active: boolean) => {
    setError(null)
    try {
      await save.mutateAsync({ planId: plan.id, body: { is_active } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update that plan.')
    }
  }

  const actionsFor = (plan: MembershipPlanOut): Action[] => [
    { label: 'View', icon: Eye, onClick: () => setDetailId(plan.id) },
    { label: 'Edit', icon: Pencil, onClick: () => setFormPlan(plan) },
    plan.is_active
      ? { label: 'Retire', icon: Pause, danger: true, onClick: () => setConfirmRetire(plan) }
      : { label: 'Offer again', icon: Play, onClick: () => setActive(plan, true) },
  ]

  // One tab per category, from *all* plans so a tab does not vanish because the search
  // happens to match nothing in it. Uncategorised plans last, so a venue that never
  // sets a category still reads as one list rather than a tab called "Other" up front.
  const categories = useMemo(
    () =>
      [...new Set(all.map((p) => p.category ?? ''))].sort((a, b) =>
        a === '' ? 1 : b === '' ? -1 : a.localeCompare(b),
      ),
    [all],
  )
  const tabCount = (key: string) =>
    key === ALL ? visible.length : visible.filter((p) => (p.category ?? '') === key).length

  // A category whose last plan was just moved elsewhere falls back to All.
  const activeCategory = category === ALL || categories.includes(category) ? category : ALL
  const shown = activeCategory === ALL ? visible : visible.filter((p) => (p.category ?? '') === activeCategory)

  const list = (
    <div className="flex flex-col gap-6">
      {categories.length > 1 && (
        <div role="tablist" aria-label="Plan categories" className="-mt-1 flex gap-6 overflow-x-auto border-b border-border-soft">
          {[{ key: ALL, label: 'All' }, ...categories.map((c) => ({ key: c, label: c || 'General' }))].map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={activeCategory === t.key}
              onClick={() => setCategory(t.key)}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 pb-2.5 text-sm font-medium transition-colors ${
                activeCategory === t.key
                  ? 'border-ink text-ink'
                  : 'border-transparent text-slate hover:text-ink'
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs font-normal text-muted">{tabCount(t.key)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-72">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search plans"
              aria-label="Search plans"
              className="w-full rounded-lg border border-border-card bg-white py-2.5 pl-9 pr-3.5 text-sm text-ink shadow-control outline-none placeholder:text-muted focus:border-lime-ink"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-surface-muted p-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                  filter === f.id ? 'bg-white font-medium text-ink shadow-control' : 'text-slate hover:text-ink'
                }`}
              >
                {f.label}
                <span className="ml-1.5 text-xs text-muted">{counts[f.id]}</span>
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setFormPlan('new')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-control"
        >
          <Plus size={15} />
          New plan
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-negative/30 bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {isLoading && <p className="text-sm text-muted">Loading plans…</p>}

      {!isLoading && all.length === 0 && (
        <div className="rounded-xl border border-dashed border-border-soft bg-white px-6 py-14 text-center">
          <p className="text-sm font-medium text-ink">No plans yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate">
            Create one and it becomes sellable from the Members tab straight away. Price the terms
            you offer and leave the rest at zero.
          </p>
        </div>
      )}

      {!isLoading && all.length > 0 && shown.length === 0 && (
        <p className="rounded-xl border border-dashed border-border-soft bg-white px-6 py-12 text-center text-sm text-muted">
          No plans match.
        </p>
      )}

      {shown.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
          {shown.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              actions={actionsFor(plan)}
              showCategory={activeCategory === ALL && categories.length > 1}
              onOpen={() => setDetailId(plan.id)}
            />
          ))}
        </div>
      )}
    </div>
  )

  return (
    <>
      {detailPlan ? (
        <PlanDetail plan={detailPlan} onBack={() => setDetailId(null)} onEdit={() => setFormPlan(detailPlan)} />
      ) : (
        list
      )}

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
    </>
  )
}

function PlanCard({
  plan,
  actions,
  showCategory,
  onOpen,
}: {
  plan: MembershipPlanOut
  actions: Action[]
  /** Only worth saying when the list mixes categories — inside a category tab it is
   *  the same word on every card. */
  showCategory: boolean
  onOpen: () => void
}) {
  const terms = sellableDurations(plan)
  const benefits = plan.benefits ?? []
  const discount = Number(plan.discount_pct ?? 0)
  const joining = Number(plan.joining_fee ?? 0)
  const members = plan.active_count ?? 0

  const perks = [
    discount > 0 ? `${discount}% off court hire` : null,
    plan.max_visits == null ? 'Unlimited visits' : `${plan.max_visits} visits`,
    joining > 0 ? `${rupees(joining)} joining fee` : null,
  ].filter((p): p is string => p !== null)

  return (
    <article
      onClick={onOpen}
      className={`group flex cursor-pointer flex-col rounded-xl border border-border-card bg-white shadow-card transition-colors hover:border-border-soft ${
        plan.is_active ? '' : 'opacity-70'
      }`}
    >
      <header className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
            className="block max-w-full truncate text-left text-[14px] font-semibold text-ink hover:underline"
          >
            {plan.name}
          </button>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill label={plan.is_active ? 'Offered' : 'Retired'} tone={plan.is_active ? 'positive' : 'neutral'} />
            {showCategory && <span className="text-xs text-muted">{plan.category || 'General'}</span>}
          </div>
        </div>
        {/* The menu sits inside a clickable card, so it must not also open the plan. */}
        <div onClick={(e) => e.stopPropagation()} className="-mr-2 -mt-1 shrink-0">
          <RowActionsMenu actions={actions} />
        </div>
      </header>

      <div className="mx-5 mt-4 border-t border-dashed border-border-soft pt-4">
        {terms.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
            {terms.map((d) => (
              <div key={d}>
                <dt className="text-xs text-muted">{DURATION_LABEL[d]}</dt>
                <dd className="mt-0.5 text-base font-semibold text-ink">{rupees(planPrice(plan, d))}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-amber-700">No term priced — can't be sold</p>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 px-5 pb-4 pt-4">
        <ul className="flex flex-wrap gap-1.5">
          {perks.map((perk) => (
            <li key={perk} className="rounded-md bg-surface-muted px-2 py-1 text-xs text-slate">
              {perk}
            </li>
          ))}
        </ul>
        {benefits.length > 0 && (
          <p className="line-clamp-2 text-[12px] leading-relaxed text-muted">{benefits.join(' · ')}</p>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-dashed border-border-soft px-5 py-3 text-xs">
        <span className="inline-flex items-center gap-1.5 text-slate">
          <Users size={13} />
          {members > 0 ? `${members} member${members === 1 ? '' : 's'}` : 'No members yet'}
        </span>
        <span className="inline-flex items-center gap-0.5 font-medium text-ink">
          Details
          <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </footer>
    </article>
  )
}
