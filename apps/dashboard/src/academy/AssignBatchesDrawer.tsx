/**
 * Put batches under a coach.
 *
 * Lists every batch that is not already theirs and still running, with who has it now —
 * taking a batch from another coach is a real decision, and the screen says so rather
 * than letting it happen silently. A batch's students and its upcoming sessions move
 * with it; classes already taught stay credited to whoever taught them.
 */
import { useMemo, useState } from 'react'
import { Check, Loader2 } from '../ui/icons'
import Drawer from '../ui/Drawer'
import { ApiError } from '../api/client'
import { useAssignBatches, useBatches, useCoaches } from '../api/hooks'

export default function AssignBatchesDrawer({
  coach,
  onClose,
}: {
  coach: { id: string; name: string }
  onClose: () => void
}) {
  const { data: batches, isLoading } = useBatches()
  const { data: coaches } = useCoaches()
  const assign = useAssignBatches()
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const coachName = useMemo(() => {
    const byId = new Map((coaches?.items ?? []).map((c) => [c.id, c.name]))
    return (id: string | null | undefined) => (id ? (byId.get(id) ?? 'another coach') : null)
  }, [coaches])

  const available = (batches ?? []).filter((b) => b.coach_id !== coach.id && b.status !== 'completed')
  const moving = available.filter((b) => picked.includes(b.id) && b.coach_id)
  const students = moving.reduce((n, b) => n + (b.enrolled ?? 0), 0)

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  async function submit() {
    setError(null)
    try {
      await assign.mutateAsync({ coachId: coach.id, batchIds: picked })
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not assign the batches. Please try again.')
    }
  }

  return (
    <Drawer
      title="Assign batches"
      subtitle={coach.name}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-3">
          {moving.length > 0 && (
            <p className="text-xs text-amber-800">
              {moving.length === 1 ? 'One batch is' : `${moving.length} batches are`} being taken from another coach
              {students > 0 && `, and ${students} ${students === 1 ? 'student moves' : 'students move'} with ${moving.length === 1 ? 'it' : 'them'}`}
              .
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={picked.length === 0 || assign.isPending}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {assign.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {picked.length ? `Assign ${picked.length} ${picked.length === 1 ? 'batch' : 'batches'}` : 'Assign'}
            </button>
            <button type="button" onClick={onClose} className="rounded-lg border border-border-card px-4 py-2.5 text-sm text-slate">
              Cancel
            </button>
          </div>
        </div>
      }
    >
      {error && (
        <p role="alert" className="rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </p>
      )}

      {isLoading && <div className="h-32 animate-pulse rounded-xl bg-surface-muted" />}

      {!isLoading && available.length === 0 && (
        <p className="rounded-xl border border-dashed border-border-card px-4 py-8 text-center text-sm text-muted">
          Every running batch is already with {coach.name}. Create a batch from the Plans tab to give them more.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {available.map((b) => {
          const on = picked.includes(b.id)
          const holder = coachName(b.coach_id)
          return (
            <li key={b.id}>
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-xl border bg-white p-3.5 transition-colors ${
                  on ? 'border-ink' : 'border-border-card hover:border-slate'
                }`}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(b.id)} className="mt-1" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{b.name}</span>
                  <span className="block text-xs text-slate">
                    {[b.schedule, b.time_label].filter(Boolean).join(' · ') || 'No schedule set'}
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {b.enrolled}/{b.capacity} students ·{' '}
                    {holder ? <span className="text-amber-800">Currently {holder}</span> : 'No coach yet'}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </Drawer>
  )
}
