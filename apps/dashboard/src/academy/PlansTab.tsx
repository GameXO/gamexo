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
import { ArrowLeft, Plus, Users } from 'lucide-react'
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
import BatchDrawer from './BatchDrawer'
import { LEVEL_TITLE, rupees } from './format'
import { useIsManager } from './permissions'

const BAND_TITLE: Record<string, string> = { kids: 'Kids', adults: 'Adults' }
const LEVEL_RANK: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 }
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
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {list.map((program) => {
                    const programBatches = batchesFor.get(program.id) ?? []
                    const fees = PLAN_DURATIONS.map((d) => ({
                      d,
                      amount: Number(program[`fee_${d}` as keyof ProgramOut] ?? 0),
                    })).filter((f) => f.amount > 0)
                    return (
                      <div key={program.id} className="flex flex-col gap-3 rounded-xl border border-border-card bg-white p-4">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">{program.name}</p>
                          <p className="mt-0.5 text-xs text-muted">
                            {bandLabel(program)}
                            {program.skill_level && ` · ${LEVEL_TITLE[program.skill_level as keyof typeof LEVEL_TITLE]}`}
                            {program.coach_id && coachName.get(program.coach_id) && ` · ${coachName.get(program.coach_id)}`}
                          </p>
                        </div>

                        {fees.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {fees.map((f) => (
                              <span key={f.d} className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-slate">
                                <span className="font-medium text-positive">{rupees(f.amount)}</span> /{' '}
                                {DURATION_LABEL[f.d].toLowerCase()}
                              </span>
                            ))}
                          </div>
                        )}

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

                        {isManager && (
                          <button
                            type="button"
                            onClick={() => setBatchFor({ programId: program.id })}
                            className="inline-flex items-center gap-1 self-start text-xs font-medium text-lime-ink hover:underline"
                          >
                            <Plus size={12} /> Add batch
                          </button>
                        )}
                      </div>
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
