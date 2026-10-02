/**
 * Remove a coach — safely.
 *
 * A coach is rarely just a row. They have batches that will be left without a teacher,
 * students listed under them, and often a pay history. So removing one is a short
 * conversation, not a delete button: who takes over, then what will actually happen.
 *
 * The server decides between deleting and archiving (a coach with sessions, reviews or
 * pay on record is kept, made inactive). This screen tells the person which to expect
 * where it can, and reports which happened.
 */
import { useState } from 'react'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import Drawer from '../ui/Drawer'
import { ApiError } from '../api/client'
import { useCoaches, useRemoveCoach, type CoachProfile } from '../api/hooks'

const INPUT =
  'w-full rounded-lg border border-border-card bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lime'

export default function RemoveCoachDrawer({
  profile,
  onClose,
  onRemoved,
}: {
  profile: CoachProfile
  onClose: () => void
  onRemoved: (outcome: 'deleted' | 'archived') => void
}) {
  const { data: coaches } = useCoaches()
  const remove = useRemoveCoach()
  const [successor, setSuccessor] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { coach, stats, batches } = profile
  const open = batches.filter((b) => b.status !== 'completed')
  const others = (coaches?.items ?? []).filter((c) => c.id !== coach.id && c.status === 'active')
  const hasHistory =
    stats.sessions_completed_30d > 0 || stats.review_count > 0 || (profile.pay?.payouts.length ?? 0) > 0

  async function submit() {
    setError(null)
    try {
      const result = await remove.mutateAsync({ coachId: coach.id, reassignTo: successor || undefined })
      onRemoved(result.outcome)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.isForbidden
            ? 'Only a manager or admin can remove a coach.'
            : err.message
          : 'Could not remove the coach. Please try again.',
      )
    }
  }

  return (
    <Drawer
      title="Remove coach"
      subtitle={`${coach.coach_no} · ${coach.name}`}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={remove.isPending}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-negative px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {remove.isPending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            Remove {coach.name.split(' ')[0]}
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-border-card px-4 py-2.5 text-sm text-slate">
            Keep
          </button>
        </div>
      }
    >
      {error && (
        <p role="alert" className="rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </p>
      )}

      {open.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
            <AlertTriangle size={16} />
            {open.length} running {open.length === 1 ? 'batch' : 'batches'} · {stats.students}{' '}
            {stats.students === 1 ? 'student' : 'students'}
          </p>
          <ul className="list-disc pl-5 text-sm text-amber-900">
            {open.map((b) => (
              <li key={b.id}>
                {b.name} <span className="text-amber-800/80">({b.enrolled} students)</span>
              </li>
            ))}
          </ul>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-amber-900">Who takes these over?</span>
            <select value={successor} onChange={(e) => setSuccessor(e.target.value)} className={INPUT}>
              <option value="">Nobody — leave them without a coach</option>
              {others.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.active_batches ? ` (${c.active_batches} batches now)` : ''}
                </option>
              ))}
            </select>
            <span className="text-xs text-amber-800">
              Their students and upcoming sessions move too. Past sessions stay credited to {coach.name}.
            </span>
          </label>
        </section>
      ) : (
        <p className="rounded-xl bg-surface-muted px-4 py-3 text-sm text-slate">
          {coach.name} has no running batches, so nothing needs handing over.
        </p>
      )}

      {profile.pay?.current.status === 'due' && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {coach.name.split(' ')[0]} has {Number(profile.pay.current.gross).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}{' '}
          earned this month that has not been paid. Record that payout first — once a coach is inactive their
          salary stops accruing, so it will not carry over.
        </p>
      )}

      <section className="rounded-xl border border-border-card bg-white p-4 text-sm text-slate">
        <p className="font-medium text-ink">What will happen</p>
        <p className="mt-1">
          {hasHistory
            ? `${coach.name} has taught sessions, been reviewed or been paid, so that history is kept. They will be made inactive — hidden from the active list and no longer assignable — rather than deleted. You can reactivate them later.`
            : `${coach.name} has no sessions, reviews or pay on record, so they will be deleted outright.`}
        </p>
        <p className="mt-2 text-xs text-muted">
          If the coach has pay or sessions you can’t see here yet, the server archives instead of deleting — it never
          loses history.
        </p>
      </section>
    </Drawer>
  )
}
