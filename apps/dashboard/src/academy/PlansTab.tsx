/**
 * Plans: the programmes an academy sells and the batches that fill them.
 *
 * Grouped by sport and then age band, because that is the question staff arrive with —
 * "what do you run for eight-year-olds?" — and because the band is enforced at
 * enrolment, so it belongs in the grouping rather than in a small tag nobody reads.
 *
 * Creating and editing a plan happens here too, in place: "New plan" swaps the grid for
 * the full programme editor (the same one in Settings), so an admin never has to leave
 * the screen where they can see what they are filling.
 */
import { useMemo, useState } from 'react'
import { ArrowLeft, Plus, Users } from '../ui/icons'
import {
  DEFAULT_AGE_BOUNDS,
  DURATION_LABEL,
  PLAN_DURATIONS,
  ageBoundsFor,
  useBatches,
  useCoaches,
  useProgramsList,
  useSports,
  type AgeBand,
  type ProgramOut,
} from '../api/hooks'
import { AcademyPrograms } from '../settings/AcademyPrograms'
import PlanCard, { monthlyEquivalent, tiersByPrice, type PlanTier } from '../ui/PlanCard'
import BatchDrawer from './BatchDrawer'
import { LEVEL_TITLE, rupees } from './format'
import { useIsManager } from './permissions'

const BAND_TITLE: Record<string, string> = { kids: 'Kids', adults: 'Adults' }
const LEVEL_RANK: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 }
const SKILL_TIER: Record<string, PlanTier> = { beginner: 'basic', intermediate: 'standard', advanced: 'premium' }
const rankOf = (p: ProgramOut) => (p.skill_level ? LEVEL_RANK[p.skill_level] : 99)

function bandLabel(program: ProgramOut): string {
  const bounds = ageBoundsFor(program)
  if (!program.age_band) return bounds ? `Ages ${bounds[0]}–${bounds[1]}` : 'Any age'
  const [lo, hi] = bounds ?? DEFAULT_AGE_BOUNDS[program.age_band as AgeBand]
  return `${BAND_TITLE[program.age_band]} · ${lo}–${hi}`
}

export default function PlansTab({ onViewBatch }: { onViewBatch: (batchId: string) => void }) {
  const isManager = useIsManager()
  const { data: sports } = useSports(true)
  const { data: programs, isLoading } = useProgramsList()
  const { data: batches } = useBatches()
  const { data: coaches } = useCoaches()
  const [sportFilter, setSportFilter] = useState<string | undefined>()
  const [managing, setManaging] = useState(false)
  const [batchFor, setBatchFor] = useState<{ programId?: string } | null>(null)

  const coachName = useMemo(
    () => new Map((coaches?.items ?? []).map((c) => [c.id, c.name])),
    [coaches],
  )
  const sportName = (id: string) =>
    id === 'unassigned' ? 'Unassigned' : ((sports ?? []).find((s) => s.id === id)?.name ?? 'Sport')

  const batchesFor = useMemo(() => {
    const byProgram = new Map<string, NonNullable<typeof batches>>()
    for (const b of batches ?? []) {
      const list = byProgram.get(b.program_id) ?? []
      list.push(b)
      byProgram.set(b.program_id, list)
    }
    return byProgram
  }, [batches])

  // A programme that names a skill level is tiered by it (beginner → Basic, advanced →
  // Premium); the rest are ranked by price, as membership plans are. Ranked across every
  // programme so a card keeps its tier through the sport filter.
  const tiers = useMemo(() => {
    const out = new Map<string, PlanTier>()
    const unleveled: { id: string; monthly: number }[] = []
    for (const p of programs ?? []) {
      const level = p.skill_level ? SKILL_TIER[p.skill_level] : undefined
      if (level) out.set(p.id, level)
      else {
        unleveled.push({
          id: p.id,
          monthly: monthlyEquivalent({
            '1m': Number(p.fee_1m ?? 0),
            '3m': Number(p.fee_3m ?? 0),
            '6m': Number(p.fee_6m ?? 0),
            '12m': Number(p.fee_12m ?? 0),
          }),
        })
      }
    }
    for (const [id, tier] of tiersByPrice(unleveled)) out.set(id, tier)
    return out
  }, [programs])

  /** Sport → band → programmes, each sorted up the ladder. */
  const grouped = useMemo(() => {
    const out = new Map<string, Map<string, ProgramOut[]>>()
    for (const p of programs ?? []) {
      const sportKey = p.sport_id ?? 'unassigned'
      if (sportFilter && sportKey !== sportFilter) continue
      const bands = out.get(sportKey) ?? new Map<string, ProgramOut[]>()
      const list = bands.get(p.age_band ?? 'any') ?? []
      list.push(p)
      bands.set(p.age_band ?? 'any', list)
      out.set(sportKey, bands)
    }
    for (const bands of out.values()) for (const list of bands.values()) list.sort((a, b) => rankOf(a) - rankOf(b))
    return out
  }, [programs, sportFilter])

  // Only sports that actually have a programme are worth a chip.
  const sportsWithPlans = useMemo(() => {
    const ids = new Set((programs ?? []).map((p) => p.sport_id ?? 'unassigned'))
    return [...ids]
  }, [programs])

  if (managing) {
    return (
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => setManaging(false)}
          className="inline-flex items-center gap-1.5 self-start text-sm text-slate hover:text-ink"
        >
          <ArrowLeft size={15} /> Back to plans
        </button>
        <div className="max-w-3xl">
          <AcademyPrograms />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by sport">
          {sportsWithPlans.length > 1 &&
            [undefined, ...sportsWithPlans].map((id) => (
              <button
                key={id ?? 'all'}
                type="button"
                aria-pressed={sportFilter === id}
                onClick={() => setSportFilter(id)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  sportFilter === id ? 'bg-ink text-white' : 'border border-border-card bg-white text-slate hover:text-ink'
                }`}
              >
                {id ? sportName(id) : 'All sports'}
              </button>
            ))}
        </div>

        {isManager && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setBatchFor({})}
              disabled={(programs ?? []).length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-card bg-white px-3 py-2 text-sm font-medium text-ink disabled:opacity-40"
            >
              <Plus size={15} /> Add batch
            </button>
            <button
              type="button"
              onClick={() => setManaging(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white"
            >
              <Plus size={15} /> New plan
            </button>
          </div>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted">Loading plans…</p>}

      {!isLoading && (programs ?? []).length === 0 && (
        <div className="rounded-xl border border-border-card bg-white p-6">
          <p className="text-sm font-medium text-ink">No plans yet</p>
          <p className="mt-1 text-sm text-slate">
            Start with one plan per sport and age group — kids and adults — then add batches (the
            days and times people actually turn up) under each.
          </p>
          {isManager && (
            <button
              type="button"
              onClick={() => setManaging(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white"
            >
              <Plus size={15} /> Create your first plan
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-6">
        {[...grouped.entries()].map(([sportId, bands]) => (
          <div key={sportId} className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-ink">{sportName(sportId)}</p>

            {[...bands.entries()].map(([bandKey, list]) => (
              <div key={bandKey} className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  {bandKey === 'any' ? 'Any age' : BAND_TITLE[bandKey]}
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
                  {list.map((program) => {
                    const programBatches = batchesFor.get(program.id) ?? []
                    const fees = PLAN_DURATIONS.map((d) => ({
                      d,
                      amount: Number(program[`fee_${d}` as keyof ProgramOut] ?? 0),
                    })).filter((f) => f.amount > 0)
                    const enrolledTotal = programBatches.reduce((sum, batch) => sum + (batch.enrolled ?? 0), 0)
                    const perks = [
                      program.classes_per_month ? `${program.classes_per_month} sessions/month` : null,
                      program.delivery_type === 'private' ? 'Private coaching' : null,
                      program.max_students ? `Up to ${program.max_students} students` : null,
                    ].filter((p): p is string => p !== null)
                    return (
                      <PlanCard
                        key={program.id}
                        tier={tiers.get(program.id) ?? 'standard'}
                        name={program.name}
                        subtitle={[
                          bandLabel(program),
                          program.skill_level && LEVEL_TITLE[program.skill_level as keyof typeof LEVEL_TITLE],
                          program.coach_id && coachName.get(program.coach_id),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        status={{
                          label: program.is_active === false ? 'Retired' : 'Offered',
                          tone: program.is_active === false ? 'neutral' : 'positive',
                        }}
                        dimmed={program.is_active === false}
                        prices={fees.map((f) => ({ label: DURATION_LABEL[f.d], amount: rupees(f.amount) }))}
                        noPriceMessage="No fee set — can't be enrolled"
                        perks={perks}
                        footerStart={
                          <>
                            <Users size={13} />
                            {enrolledTotal > 0 ? `${enrolledTotal} enrolled` : 'No students yet'}
                          </>
                        }
                        footerEnd={
                          isManager && (
                            <button
                              type="button"
                              onClick={() => setBatchFor({ programId: program.id })}
                              className="inline-flex items-center gap-1 text-xs font-medium text-ink hover:underline"
                            >
                              <Plus size={12} /> Add batch
                            </button>
                          )
                        }
                      >
                        <div className="flex flex-col gap-1.5">
                          {programBatches.map((batch) => {
                            const enrolled = batch.enrolled ?? 0
                            const capacity = batch.capacity ?? 0
                            const pct = capacity ? Math.min(100, (enrolled / capacity) * 100) : 0
                            return (
                              <button
                                key={batch.id}
                                type="button"
                                onClick={() => onViewBatch(batch.id)}
                                title="See who is in this batch"
                                className="rounded-lg bg-surface-muted px-3 py-2 text-left text-xs transition-colors hover:bg-surface-muted/60"
                              >
                                <span className="flex items-center justify-between gap-3">
                                  <span className="text-ink">
                                    {[batch.schedule, batch.time_label].filter(Boolean).join(' · ') || batch.name}
                                  </span>
                                  <span className={batch.is_full ? 'font-medium text-negative' : 'text-muted'}>
                                    {batch.is_full ? 'Full' : `${enrolled}/${capacity}`}
                                  </span>
                                </span>
                                <span className="mt-1.5 block h-1 rounded-full bg-border-soft">
                                  <span
                                    className={`block h-1 rounded-full ${batch.is_full ? 'bg-negative' : pct >= 80 ? 'bg-amber-400' : 'bg-positive'}`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </span>
                                {batch.coach_id && coachName.get(batch.coach_id) && (
                                  <span className="mt-1 flex items-center gap-1 text-muted">
                                    <Users size={11} /> {coachName.get(batch.coach_id)}
                                  </span>
                                )}
                              </button>
                            )
                          })}
                          {programBatches.length === 0 && (
                            <p className="text-xs text-muted">No batches scheduled.</p>
                          )}
                        </div>
                      </PlanCard>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {batchFor && programs && (
        <BatchDrawer
          programs={programs}
          initialProgramId={batchFor.programId}
          onClose={() => setBatchFor(null)}
        />
      )}
    </div>
  )
}
