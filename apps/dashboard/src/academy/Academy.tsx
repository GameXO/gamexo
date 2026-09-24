/**
 * Academy — programmes, batches, students and where each student stands.
 *
 * Reads the API, not localStorage. Programmes are defined in Settings → Academy
 * Programmes; this screen is where they are filled, the same split as membership
 * plans and members.
 *
 * Programmes are grouped by sport and then by age band, because that is the
 * question staff actually arrive with — "what do you run for eight-year-olds?" —
 * and because the band is enforced at enrolment. Showing it in the grouping
 * rather than as a small tag means nobody has to discover the rule by being
 * refused by it.
 */
import { useMemo, useState } from 'react'
import { GraduationCap, Users } from 'lucide-react'
import {
  DEFAULT_AGE_BOUNDS,
  DURATION_LABEL,
  PLAN_DURATIONS,
  ageBoundsFor,
  useBatches,
  useCoaches,
  useProgramsList,
  useSports,
  useStudents,
  type AgeBand,
  type ProgramOut,
} from '../api/hooks'
import EnrollWizard from './EnrollWizard'
import StudentLevelPanel from './StudentLevelPanel'

const rupees = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

const TITLE: Record<string, string> = {
  kids: 'Kids',
  adults: 'Adults',
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

/** Beginner first, so a sport's programmes read as a ladder rather than an
 *  alphabetical list. Unlevelled programmes sink to the bottom. */
const LEVEL_RANK: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 }
const rankOf = (p: ProgramOut) => (p.skill_level ? LEVEL_RANK[p.skill_level] : 99)

function bandLabel(program: ProgramOut): string {
  const bounds = ageBoundsFor(program)
  if (!program.age_band) return bounds ? `Ages ${bounds[0]}–${bounds[1]}` : 'Any age'
  const [lo, hi] = bounds ?? DEFAULT_AGE_BOUNDS[program.age_band as AgeBand]
  return `${TITLE[program.age_band]} · ${lo}–${hi}`
}

export default function Academy() {
  const [wizardOpen, setWizardOpen] = useState(false)
  const [levelsFor, setLevelsFor] = useState<{ id: string; name: string } | null>(null)

  // `true`: these headings label programmes that already exist, and a sport
  // that has since been retired still has to render its name — otherwise every
  // tennis programme collapses under a heading reading "Sport".
  const { data: sports } = useSports(true)
  const { data: programs, isLoading: loadingPrograms } = useProgramsList()
  const { data: batches } = useBatches()
  const { data: coaches } = useCoaches()
  const { data: students, isLoading: loadingStudents } = useStudents()

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
      const bandKey = p.age_band ?? 'any'
      const bands = out.get(sportKey) ?? new Map<string, ProgramOut[]>()
      const list = bands.get(bandKey) ?? []
      list.push(p)
      bands.set(bandKey, list)
      out.set(sportKey, bands)
    }
    for (const bands of out.values()) {
      for (const list of bands.values()) list.sort((a, b) => rankOf(a) - rankOf(b))
    }
    return out
  }, [programs])

  const sportName = (id: string) =>
    id === 'unassigned' ? 'Unassigned' : ((sports ?? []).find((s) => s.id === id)?.name ?? 'Sport')

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between">
        <p className="text-lg text-ink">Coaches, programmes &amp; batches</p>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="flex h-10 items-center justify-center rounded-full px-5 text-sm text-[#fefefe]"
          style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
        >
          Enrol student
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        {(coaches?.items ?? []).map((coach) => (
          <div
            key={coach.id}
            className="flex items-center gap-3 rounded-xl border border-border-card bg-white px-4 py-3"
          >
            <div className="flex size-9 items-center justify-center rounded-full bg-surface-muted text-ink">
              <GraduationCap size={16} />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">{coach.name}</p>
              <p className="text-xs text-muted">{coach.specialization || 'Coach'}</p>
            </div>
          </div>
        ))}
        {(coaches?.items ?? []).length === 0 && (
          <p className="text-sm text-muted">No coaches on staff yet.</p>
        )}
      </div>

      {loadingPrograms && <p className="text-sm text-muted">Loading programmes…</p>}

      {!loadingPrograms && (programs ?? []).length === 0 && (
        <div className="rounded-xl border border-border-card bg-white p-6">
          <p className="text-sm font-medium text-ink">No programmes yet</p>
          <p className="mt-1 text-sm text-slate">
            Set them up in Settings → Academy Programmes. Start with one per sport
            and age group — kids and adults — then add levels as the academy grows.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {[...grouped.entries()].map(([sportId, bands]) => (
          <div key={sportId} className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-ink">{sportName(sportId)}</p>

            {[...bands.entries()].map(([bandKey, list]) => (
              <div key={bandKey} className="flex flex-col gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  {bandKey === 'any' ? 'Any age' : TITLE[bandKey]}
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {list.map((program) => {
                    const programBatches = batchesFor.get(program.id) ?? []
                    const term = PLAN_DURATIONS.find(
                      (d) => Number(program[`fee_${d}` as keyof ProgramOut] ?? 0) > 0,
                    )
                    return (
                      <div
                        key={program.id}
                        className="flex flex-col gap-3 rounded-xl border border-border-card bg-white p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-ink">{program.name}</p>
                            <p className="mt-0.5 text-xs text-muted">
                              {bandLabel(program)}
                              {program.skill_level && ` · ${TITLE[program.skill_level]}`}
                            </p>
                          </div>
                          {term && (
                            <p className="shrink-0 text-sm font-medium text-positive">
                              {rupees(Number(program[`fee_${term}` as keyof ProgramOut]))}
                              <span className="text-xs text-muted">
                                {' '}
                                / {DURATION_LABEL[term].toLowerCase()}
                              </span>
                            </p>
                          )}
                        </div>

                        <div className="flex flex-col gap-1.5">
                          {programBatches.map((batch) => (
                            <div
                              key={batch.id}
                              className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2 text-xs"
                            >
                              <span className="text-ink">
                                {[batch.schedule, batch.time_label].filter(Boolean).join(' · ') ||
                                  batch.name}
                              </span>
                              <span className="text-muted">
                                {batch.enrolled ?? 0}/{batch.capacity} enrolled
                              </span>
                            </div>
                          ))}
                          {programBatches.length === 0 && (
                            <p className="text-xs text-muted">No batches scheduled.</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* `shrink-0` is doing real work here.
       *
       * This card is a flex child of a scrolling column, and `overflow-hidden`
       * means its automatic minimum size resolves to 0 rather than to its
       * content — the spec only applies that minimum when overflow is visible.
       * Without `shrink-0` the card collapses to a couple of pixels and then
       * clips the table inside it, so the register reads as a header and a
       * sliver of one row. It looks like a truncated table; it is a collapsed
       * wrapper.
       */}
      <div className="shrink-0 overflow-hidden rounded-xl border border-border-card bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-card text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">Student</th>
              <th className="px-4 py-3 font-medium">Age</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Progress</th>
            </tr>
          </thead>
          <tbody>
            {(students?.items ?? []).map((s) => (
              <tr key={s.id} className="border-b border-border-card last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{s.name}</p>
                  <p className="text-xs text-muted">{s.student_no}</p>
                </td>
                <td className="px-4 py-3 text-slate">
                  {s.age ?? <span className="text-xs text-amber-700">No date of birth</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-positive/15 px-2.5 py-1 text-xs font-medium capitalize text-positive">
                    {s.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setLevelsFor({ id: s.id, name: s.name })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-card px-2.5 py-1.5 text-xs text-slate"
                  >
                    <Users size={13} />
                    Levels
                  </button>
                </td>
              </tr>
            ))}

            {loadingStudents && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">
                  Loading students…
                </td>
              </tr>
            )}

            {!loadingStudents && (students?.items ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">
                  No students enrolled yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {wizardOpen && (
        <EnrollWizard onClose={() => setWizardOpen(false)} onEnrolled={() => setWizardOpen(false)} />
      )}
      {levelsFor && (
        <StudentLevelPanel
          studentId={levelsFor.id}
          studentName={levelsFor.name}
          onClose={() => setLevelsFor(null)}
        />
      )}
    </div>
  )
}
