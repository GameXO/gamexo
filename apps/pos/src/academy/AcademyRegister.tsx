/**
 * Taking the register, on the counter tablet.
 *
 * The only academy screen the kiosk role can reach, and deliberately so: marking
 * a child present is what a shared device at the door is for, while enrolling
 * students, moving them up a level and anything touching fees stay with a login
 * that names a person.
 *
 * Two choices that matter for a device used by a coach with a class in front of
 * them:
 *
 *   **Nobody is marked until it is sent.** A tap sets a local intent, and one
 *   Send writes the whole batch. The API marks in bulk, which is how a register
 *   is actually taken, and it means a mis-tap is corrected by tapping again
 *   rather than by racing a request.
 *
 *   **Already-marked students come back pre-filled.** Re-opening a session shows
 *   what was recorded, so a coach who marked ten and got interrupted does not
 *   start again — and re-sending updates those rows rather than duplicating them.
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, GraduationCap, Loader2 } from 'lucide-react'
import { TopBar } from '../ui/TopBar'
import { CheckinFooter } from '../checkin/Chrome'
import {
  useMarkAttendance,
  useSessionRoster,
  useTodaysSessions,
  type AttendanceStatus,
  type SessionOut,
} from '../api/hooks'

const STATUSES: { key: AttendanceStatus; label: string }[] = [
  { key: 'present', label: 'Present' },
  { key: 'late', label: 'Late' },
  { key: 'absent', label: 'Absent' },
]

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

function SessionList({
  sessions,
  onPick,
}: {
  sessions: SessionOut[]
  onPick: (s: SessionOut) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {sessions.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s)}
          className="flex items-center justify-between rounded-2xl border border-border-card bg-white px-4 py-4 text-left"
        >
          <div>
            <p className="font-medium text-ink">{s.batch_name}</p>
            <p className="mt-0.5 text-sm text-muted">
              {timeOf(s.starts_at)} – {timeOf(s.ends_at)} · {s.students_enrolled ?? 0} enrolled
            </p>
          </div>
          {s.status === 'completed' ? (
            <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs text-muted">
              Register taken
            </span>
          ) : (
            <span className="rounded-full bg-lime/20 px-2.5 py-1 text-xs text-lime-ink">Take</span>
          )}
        </button>
      ))}
    </div>
  )
}

export default function AcademyRegister({ onHome }: { onHome: () => void }) {
  const { data: sessions, isLoading } = useTodaysSessions()
  const [active, setActive] = useState<SessionOut | null>(null)
  const { data: roster } = useSessionRoster(active?.id ?? null)
  const mark = useMarkAttendance()

  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({})
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed from what was already recorded, so re-opening a half-taken register
  // resumes rather than restarts. Students with no mark are simply absent from
  // this map, which is what leaves their row untouched below.
  useEffect(() => {
    if (!roster) return
    setMarks(
      Object.fromEntries(
        roster
          .filter((row) => row.status !== null && row.status !== undefined)
          .map((row) => [row.student_id, row.status as AttendanceStatus]),
      ),
    )
  }, [roster])

  const students = useMemo(() => roster ?? [], [roster])
  const markedCount = Object.keys(marks).length

  const send = async () => {
    if (!active) return
    setError(null)
    try {
      await mark.mutateAsync({
        sessionId: active.id,
        marks: Object.entries(marks).map(([student_id, status]) => ({ student_id, status })),
      })
      setSent(true)
      setTimeout(() => {
        setSent(false)
        setActive(null)
        setMarks({})
      }, 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the register.')
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <TopBar
        centerTitle={active ? active.batch_name : 'Academy'}
        onLogoClick={active ? () => setActive(null) : onHome}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-6">
        {!active && (
          <>
            {isLoading && <p className="text-center text-sm text-muted">Loading today's classes…</p>}

            {!isLoading && (sessions ?? []).length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                <span className="flex size-16 items-center justify-center rounded-full bg-surface-muted text-muted">
                  <GraduationCap size={30} strokeWidth={1.75} />
                </span>
                <div className="flex flex-col gap-1.5">
                  <p className="font-display text-2xl font-bold text-ink">No classes today</p>
                  <p className="max-w-xs text-sm text-muted">
                    Sessions scheduled from the dashboard show up here for the register.
                  </p>
                </div>
              </div>
            )}

            {(sessions ?? []).length > 0 && (
              <SessionList sessions={sessions ?? []} onPick={setActive} />
            )}
          </>
        )}

        {active && (
          <>
            <p className="text-sm text-muted">
              {timeOf(active.starts_at)} – {timeOf(active.ends_at)} · {markedCount} of{' '}
              {active.students_enrolled ?? students.length} marked
            </p>

            {students.length === 0 && (
              <p className="rounded-2xl border border-border-card bg-white px-4 py-6 text-center text-sm text-muted">
                Nobody is enrolled in this batch yet.
              </p>
            )}

            <div className="flex flex-col gap-2.5">
              {students.map((row) => (
                <div
                  key={row.student_id}
                  className="rounded-2xl border border-border-card bg-white px-4 py-3"
                >
                  <p className="font-medium text-ink">{row.student_name}</p>
                  <div className="mt-2.5 flex gap-2">
                    {STATUSES.map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setMarks((m) => ({ ...m, [row.student_id]: key }))}
                        className={`flex-1 rounded-xl py-2.5 text-sm font-medium ${
                          marks[row.student_id] === key
                            ? 'bg-ink text-white'
                            : 'bg-surface-muted text-slate'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <p className="rounded-xl bg-negative/10 px-4 py-3 text-sm text-negative">{error}</p>
            )}

            {students.length > 0 && (
              <button
                type="button"
                onClick={send}
                disabled={markedCount === 0 || mark.isPending || sent}
                className="mt-2 flex items-center justify-center gap-2 rounded-2xl bg-ink py-4 text-base font-medium text-white disabled:opacity-40"
              >
                {mark.isPending && <Loader2 size={18} className="animate-spin" />}
                {sent && <Check size={18} />}
                {sent ? 'Register saved' : `Save register (${markedCount})`}
              </button>
            )}
          </>
        )}
      </main>

      <CheckinFooter onHome={onHome} />
    </div>
  )
}
