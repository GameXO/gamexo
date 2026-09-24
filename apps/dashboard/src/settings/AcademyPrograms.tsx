/**
 * Academy programmes — who a course is for, and what a term costs.
 *
 * Two fields here are not decoration:
 *
 *   **Age band** is enforced. Once a programme is kids or adults, enrolment
 *   checks the student's age *at the start of the term* and refuses a mismatch.
 *   Leaving it unset means "any age", which is what every programme created
 *   before this screen existed carries — so nothing that enrolled yesterday
 *   stops working today.
 *
 *   **Level** is not enforced. A batch above a student's assessed level enrols
 *   fine and returns a warning, because stretching a strong beginner is how
 *   anyone improves. Age is a safeguarding matter; level is a coach's call, and
 *   the UI says which is which rather than making them look alike.
 */
import { useState } from 'react'
import { Check, GraduationCap, Loader2, Pencil, Plus, X } from 'lucide-react'
import {
  AGE_BANDS,
  DEFAULT_AGE_BOUNDS,
  DURATION_LABEL,
  PLAN_DURATIONS,
  SKILL_LEVELS,
  ageBoundsFor,
  useCoaches,
  useProgramsList,
  useSaveProgram,
  useSports,
  type AgeBand,
  type PlanDuration,
  type ProgramOut,
  type SkillLevel,
} from '../api/hooks'

const rupees = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

const TITLE: Record<string, string> = {
  kids: 'Kids',
  adults: 'Adults',
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

type Draft = {
  name: string
  sport_id: string
  skill_level: SkillLevel | ''
  age_band: AgeBand | ''
  age_min: string
  age_max: string
  coach_id: string
  max_students: string
  session_freq: string
  fees: Record<PlanDuration, string>
  is_active: boolean
}

const EMPTY: Draft = {
  name: '',
  sport_id: '',
  skill_level: '',
  age_band: '',
  age_min: '',
  age_max: '',
  coach_id: '',
  max_students: '12',
  session_freq: '',
  fees: { '1m': '', '3m': '', '6m': '', '12m': '' },
  is_active: true,
}

function toDraft(p: ProgramOut): Draft {
  return {
    name: p.name,
    sport_id: p.sport_id ?? '',
    skill_level: (p.skill_level as SkillLevel) ?? '',
    age_band: (p.age_band as AgeBand) ?? '',
    age_min: p.age_min == null ? '' : String(p.age_min),
    age_max: p.age_max == null ? '' : String(p.age_max),
    coach_id: p.coach_id ?? '',
    max_students: String(p.max_students ?? 12),
    session_freq: p.session_freq ?? '',
    fees: {
      '1m': String(Number(p.fee_1m ?? 0) || ''),
      '3m': String(Number(p.fee_3m ?? 0) || ''),
      '6m': String(Number(p.fee_6m ?? 0) || ''),
      '12m': String(Number(p.fee_12m ?? 0) || ''),
    },
    is_active: p.is_active ?? true,
  }
}

const amount = (v: string) => (v.trim() === '' ? '0' : String(Number(v)))

function ProgramForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  draft: Draft
  onChange: (d: Draft) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  error: string | null
}) {
  // Retired sports included, and labelled. Excluding them would silently blank
  // the sport of any programme attached to one the moment somebody opened it to
  // edit something else — the select would find no matching option, fall back to
  // the empty one, and save that.
  const { data: sports } = useSports(true)
  const { data: coaches } = useCoaches()
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v })

  const bandDefaults = draft.age_band ? DEFAULT_AGE_BOUNDS[draft.age_band] : null
  const priced = PLAN_DURATIONS.filter((d) => Number(draft.fees[d] || 0) > 0)

  return (
    <div className="rounded-2xl border border-border-card bg-surface p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">Programme name</span>
          <input
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Kids Football — Beginners"
            className="rounded-lg border border-border-card bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-lime"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">Sport</span>
          <select
            value={draft.sport_id}
            onChange={(e) => set('sport_id', e.target.value)}
            className="rounded-lg border border-border-card bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-lime"
          >
            <option value="">Select a sport…</option>
            {(sports ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isActive === false ? ' (retired)' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-5 rounded-xl border border-border-soft bg-surface-muted/40 p-4">
        <p className="text-[13px] font-medium text-ink">Who it's for</p>
        <p className="mt-1 text-xs leading-relaxed text-slate">
          Enforced at enrolment against the student's date of birth, judged on the
          first day of the term. Leave it unset to admit any age.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => set('age_band', '')}
            className={`rounded-full px-3 py-1.5 text-sm ${
              draft.age_band === ''
                ? 'bg-ink text-white'
                : 'border border-border-card text-slate'
            }`}
          >
            Any age
          </button>
          {AGE_BANDS.map((band) => (
            <button
              key={band}
              type="button"
              onClick={() => set('age_band', band)}
              className={`rounded-full px-3 py-1.5 text-sm ${
                draft.age_band === band
                  ? 'bg-ink text-white'
                  : 'border border-border-card text-slate'
              }`}
            >
              {TITLE[band]}
            </button>
          ))}
        </div>

        {draft.age_band && bandDefaults && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate">Youngest</span>
              <input
                inputMode="numeric"
                value={draft.age_min}
                onChange={(e) => set('age_min', e.target.value)}
                placeholder={String(bandDefaults[0])}
                className="rounded-lg border border-border-card bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-lime"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate">Oldest</span>
              <input
                inputMode="numeric"
                value={draft.age_max}
                onChange={(e) => set('age_max', e.target.value)}
                placeholder={String(bandDefaults[1])}
                className="rounded-lg border border-border-card bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-lime"
              />
            </label>
            <p className="text-xs text-muted sm:col-span-2">
              Leave blank for the {TITLE[draft.age_band].toLowerCase()} default of{' '}
              {bandDefaults[0]}–{bandDefaults[1]}. Set them for a U-14 squad or similar.
            </p>
          </div>
        )}
      </div>

      <div className="mt-5">
        <p className="text-[13px] font-medium text-ink">Level</p>
        <p className="mt-1 text-xs leading-relaxed text-slate">
          A guide, not a gate — a student below this level can still be enrolled,
          and staff see a note when they are.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => set('skill_level', '')}
            className={`rounded-full px-3 py-1.5 text-sm ${
              draft.skill_level === ''
                ? 'bg-ink text-white'
                : 'border border-border-card text-slate'
            }`}
          >
            Mixed ability
          </button>
          {SKILL_LEVELS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => set('skill_level', lvl)}
              className={`rounded-full px-3 py-1.5 text-sm ${
                draft.skill_level === lvl
                  ? 'bg-ink text-white'
                  : 'border border-border-card text-slate'
              }`}
            >
              {TITLE[lvl]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <p className="text-[13px] font-medium text-ink">Fees by term</p>
        <p className="mt-1 text-xs leading-relaxed text-slate">
          Leave a term at zero and it is not offered.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          {PLAN_DURATIONS.map((d) => (
            <label key={d} className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate">{DURATION_LABEL[d]}</span>
              <input
                inputMode="numeric"
                value={draft.fees[d]}
                onChange={(e) => set('fees', { ...draft.fees, [d]: e.target.value })}
                placeholder="0"
                className="rounded-lg border border-border-card bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-lime"
              />
            </label>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">Head coach</span>
          <select
            value={draft.coach_id}
            onChange={(e) => set('coach_id', e.target.value)}
            className="rounded-lg border border-border-card bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-lime"
          >
            <option value="">Unassigned</option>
            {(coaches?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">Max students</span>
          <input
            inputMode="numeric"
            value={draft.max_students}
            onChange={(e) => set('max_students', e.target.value)}
            className="rounded-lg border border-border-card bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-lime"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">Sessions</span>
          <input
            value={draft.session_freq}
            onChange={(e) => set('session_freq', e.target.value)}
            placeholder="3 / week"
            className="rounded-lg border border-border-card bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-lime"
          />
        </label>
      </div>

      <label className="mt-4 flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={draft.is_active}
          onChange={(e) => set('is_active', e.target.checked)}
          className="size-4 accent-lime"
        />
        <span className="text-sm text-ink">Open for enrolment</span>
      </label>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !draft.name.trim() || priced.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          Save programme
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-2 rounded-lg border border-border-card px-4 py-2 text-sm text-slate"
        >
          <X size={15} />
          Cancel
        </button>
      </div>
    </div>
  )
}

export function AcademyPrograms() {
  const { data: programs, isLoading } = useProgramsList(true)
  const { data: sports } = useSports(true)
  const save = useSaveProgram()

  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  const sportName = (id: string | null | undefined) =>
    (sports ?? []).find((s) => s.id === id)?.name ?? ''

  const submit = async () => {
    setError(null)
    try {
      await save.mutateAsync({
        programId: editing === 'new' ? undefined : (editing ?? undefined),
        body: {
          name: draft.name.trim(),
          sport_id: draft.sport_id || null,
          skill_level: draft.skill_level || null,
          age_band: draft.age_band || null,
          // Only meaningful alongside a band; cleared with it so a programme
          // switched back to "any age" does not keep invisible bounds.
          age_min: draft.age_band && draft.age_min.trim() ? Number(draft.age_min) : null,
          age_max: draft.age_band && draft.age_max.trim() ? Number(draft.age_max) : null,
          coach_id: draft.coach_id || null,
          max_students: Number(draft.max_students) || 12,
          session_freq: draft.session_freq.trim() || null,
          fee_1m: amount(draft.fees['1m']),
          fee_3m: amount(draft.fees['3m']),
          fee_6m: amount(draft.fees['6m']),
          fee_12m: amount(draft.fees['12m']),
          is_active: draft.is_active,
        },
      })
      setEditing(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this programme.')
    }
  }

  return (
    <section className="rounded-2xl border border-border-card bg-surface p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lime/20 text-lime-ink">
            <GraduationCap size={20} />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Academy Programmes</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate">
              Courses this academy runs, who they're for, and what a term costs.
            </p>
          </div>
        </div>
        {editing === null && (
          <button
            type="button"
            onClick={() => {
              setDraft(EMPTY)
              setError(null)
              setEditing('new')
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white"
          >
            <Plus size={15} />
            New programme
          </button>
        )}
      </div>

      <div className="mt-5 flex flex-col gap-3">
        {editing === 'new' && (
          <ProgramForm
            draft={draft}
            onChange={setDraft}
            onSave={submit}
            onCancel={() => setEditing(null)}
            saving={save.isPending}
            error={error}
          />
        )}

        {isLoading && <p className="text-sm text-muted">Loading programmes…</p>}

        {!isLoading && (programs ?? []).length === 0 && editing === null && (
          <p className="text-sm text-muted">
            No programmes yet. Start with one per sport and age group — kids and
            adults football, say — then add levels as the academy grows.
          </p>
        )}

        {(programs ?? []).map((p) => {
          if (editing === p.id) {
            return (
              <ProgramForm
                key={p.id}
                draft={draft}
                onChange={setDraft}
                onSave={submit}
                onCancel={() => setEditing(null)}
                saving={save.isPending}
                error={error}
              />
            )
          }
          const bounds = ageBoundsFor(p)
          return (
            <article
              key={p.id}
              className="flex items-start justify-between gap-4 rounded-2xl border border-border-card p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-ink">{p.name}</h3>
                  {sportName(p.sport_id) && (
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-slate">
                      {sportName(p.sport_id)}
                    </span>
                  )}
                  {p.age_band && (
                    <span className="rounded-full bg-lime/20 px-2 py-0.5 text-xs text-lime-ink">
                      {TITLE[p.age_band]} {bounds && `· ${bounds[0]}–${bounds[1]}`}
                    </span>
                  )}
                  {p.skill_level && (
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-slate">
                      {TITLE[p.skill_level]}
                    </span>
                  )}
                  {!p.is_active && (
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-muted">
                      Closed
                    </span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {PLAN_DURATIONS.filter((d) => Number(p[`fee_${d}` as keyof ProgramOut] ?? 0) > 0).map(
                    (d) => (
                      <span key={d} className="text-sm text-slate">
                        <span className="text-muted">{DURATION_LABEL[d]}</span>{' '}
                        {rupees(Number(p[`fee_${d}` as keyof ProgramOut]))}
                      </span>
                    ),
                  )}
                </div>

                {!p.age_band && (
                  <p className="mt-1 text-xs text-muted">
                    Any age — no check runs at enrolment.
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setDraft(toDraft(p))
                  setError(null)
                  setEditing(p.id)
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-card px-3 py-1.5 text-sm text-slate"
              >
                <Pencil size={14} />
                Edit
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}
