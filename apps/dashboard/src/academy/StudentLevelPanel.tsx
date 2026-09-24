/**
 * Where a student stands, per sport, and how they got there.
 *
 * Per sport rather than one level per student: a child can be advanced at tennis
 * and a beginner at football, and a single figure would force one of those to be
 * a lie.
 *
 * The history is shown alongside the current standing because the question a
 * parent asks is "has she moved up this year?", which a single current level
 * cannot answer. Re-assessments that keep a student where they are get recorded
 * too — a review that confirms the status quo is still a review, and dropping it
 * makes a carefully-tended ladder look untended.
 */
import { useState } from 'react'
import { ArrowRight, Loader2, X } from 'lucide-react'
import {
  SKILL_LEVELS,
  usePromoteStudent,
  useSports,
  useStudentLevels,
  useStudentPromotions,
  type SkillLevel,
} from '../api/hooks'

const TITLE: Record<SkillLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
}

export default function StudentLevelPanel({
  studentId,
  studentName,
  onClose,
}: {
  studentId: string
  studentName: string
  onClose: () => void
}) {
  const { data: sports } = useSports(true)
  const { data: levels, isLoading } = useStudentLevels(studentId)
  const { data: promotions } = useStudentPromotions(studentId)
  const promote = usePromoteStudent()

  const [sportId, setSportId] = useState('')
  const [level, setLevel] = useState<SkillLevel | ''>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const sportName = (id: string) => (sports ?? []).find((s) => s.id === id)?.name ?? 'Sport'
  const currentFor = (id: string) => (levels ?? []).find((l) => l.sport_id === id)?.level

  const submit = async () => {
    if (!sportId || !level) return
    setError(null)
    try {
      await promote.mutateAsync({
        studentId,
        body: { sport_id: sportId, to_level: level, note: note.trim() || null },
      })
      setNote('')
      setLevel('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border-card px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">{studentName}</h2>
            <p className="mt-0.5 text-sm text-slate">Level by sport</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-muted">
            <X size={18} />
          </button>
        </header>

        <div className="flex flex-col gap-5 px-5 py-5">
          <section>
            <p className="text-[13px] font-medium text-ink">Standing</p>
            {isLoading && <p className="mt-2 text-sm text-muted">Loading…</p>}
            {!isLoading && (levels ?? []).length === 0 && (
              <p className="mt-2 text-sm text-muted">
                Not assessed in any sport yet. That is not the same as beginner —
                it means nobody has looked.
              </p>
            )}
            <div className="mt-2 flex flex-col gap-2">
              {(levels ?? []).map((l) => (
                <div
                  key={l.sport_id}
                  className="flex items-center justify-between rounded-lg border border-border-card px-3 py-2"
                >
                  <span className="text-sm text-ink">{sportName(l.sport_id)}</span>
                  <span className="text-sm text-slate">
                    {TITLE[l.level as SkillLevel]}
                    <span className="ml-2 text-xs text-muted">reviewed {l.assessed_on}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border-soft bg-surface-muted/40 p-4">
            <p className="text-[13px] font-medium text-ink">Record an assessment</p>
            <div className="mt-3 flex flex-col gap-3">
              <select
                value={sportId}
                onChange={(e) => setSportId(e.target.value)}
                className="rounded-lg border border-border-card bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lime"
              >
                <option value="">Which sport…</option>
                {(sports ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {currentFor(s.id) ? ` — now ${TITLE[currentFor(s.id) as SkillLevel]}` : ''}
                  </option>
                ))}
              </select>

              <div className="flex flex-wrap gap-2">
                {SKILL_LEVELS.map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setLevel(lvl)}
                    className={`rounded-full px-3 py-1.5 text-sm ${
                      level === lvl ? 'bg-ink text-white' : 'border border-border-card text-slate'
                    }`}
                  >
                    {TITLE[lvl]}
                  </button>
                ))}
              </div>

              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note (optional)"
                className="rounded-lg border border-border-card bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lime"
              />

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="button"
                onClick={submit}
                disabled={!sportId || !level || promote.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {promote.isPending && <Loader2 size={15} className="animate-spin" />}
                Record
              </button>
            </div>
          </section>

          <section>
            <p className="text-[13px] font-medium text-ink">History</p>
            {(promotions ?? []).length === 0 && (
              <p className="mt-2 text-sm text-muted">Nothing recorded yet.</p>
            )}
            <div className="mt-2 flex flex-col gap-2">
              {(promotions ?? []).map((p) => (
                <div key={p.id} className="rounded-lg border border-border-card px-3 py-2">
                  <div className="flex items-center gap-2 text-sm text-ink">
                    <span className="text-muted">{sportName(p.sport_id)}</span>
                    {p.from_level ? (
                      <>
                        <span>{TITLE[p.from_level as SkillLevel]}</span>
                        <ArrowRight size={13} className="text-muted" />
                      </>
                    ) : (
                      <span className="text-xs text-muted">first assessment</span>
                    )}
                    <span className="font-medium">{TITLE[p.to_level as SkillLevel]}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    {p.assessed_on}
                    {p.assessed_by && ` · ${p.assessed_by}`}
                  </p>
                  {p.note && <p className="mt-1 text-sm text-slate">{p.note}</p>}
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  )
}
