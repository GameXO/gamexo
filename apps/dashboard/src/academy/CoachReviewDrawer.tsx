/**
 * Record feedback on a coach — what a student or parent said, entered by whoever heard it.
 *
 * The coach's rating becomes the average of everything recorded here, so a single
 * enthusiastic parent does not define it but a pattern does. Reception can enter these:
 * feedback tends to arrive at the front desk, not in a manager's inbox.
 */
import { useEffect, useState } from 'react'
import { Check, Loader2, Star } from 'lucide-react'
import Drawer from '../ui/Drawer'
import { ApiError } from '../api/client'
import { toISO } from '../data/booking'
import { useAddCoachReview, useStudents } from '../api/hooks'

const INPUT =
  'w-full rounded-lg border border-border-card bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lime'

export default function CoachReviewDrawer({
  coach,
  onClose,
}: {
  coach: { id: string; name: string }
  onClose: () => void
}) {
  const [find, setFind] = useState('')
  const [query, setQuery] = useState('')
  // Searched on the server, because an academy can have more students than one page
  // holds — and debounced, so typing a name is one request rather than one per letter.
  useEffect(() => {
    const t = setTimeout(() => setQuery(find.trim()), 300)
    return () => clearTimeout(t)
  }, [find])
  const { data: students } = useStudents(query || undefined)
  const add = useAddCoachReview()
  const today = toISO(new Date())

  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [studentId, setStudentId] = useState('')
  const [from, setFrom] = useState('')
  const [comment, setComment] = useState('')
  const [date, setDate] = useState(today)
  const [error, setError] = useState<string | null>(null)

  const shown = hover || rating
  const dateValid = date !== '' && date <= today

  async function submit() {
    setError(null)
    try {
      await add.mutateAsync({
        coachId: coach.id,
        body: {
          rating,
          comment: comment.trim() || null,
          student_id: studentId || null,
          reviewer_name: from.trim() || null,
          reviewed_on: date,
        },
      })
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the review. Please try again.')
    }
  }

  return (
    <Drawer
      title="Add a review"
      subtitle={coach.name}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={rating === 0 || !dateValid || add.isPending}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {add.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Save review
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-border-card px-4 py-2.5 text-sm text-slate">
            Cancel
          </button>
        </div>
      }
    >
      {error && (
        <p role="alert" className="rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-[12px] font-medium text-ink">Rating</p>
        <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
              aria-pressed={rating === n}
              className="p-0.5"
            >
              <Star size={30} className={n <= shown ? 'fill-amber-400 text-amber-400' : 'text-border-input'} />
            </button>
          ))}
          <span className="ml-2 text-sm text-slate">{shown ? `${shown} / 5` : 'Tap a star'}</span>
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink">From which student?</span>
        <input
          value={find}
          onChange={(e) => setFind(e.target.value)}
          placeholder="Search by name or student ID"
          className={INPUT}
        />
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className={INPUT}>
          <option value="">Not a student on file</option>
          {(students?.items ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.student_no}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">The parent’s name is recorded if there is one.</span>
      </label>

      {!studentId && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">Who said it?</span>
          <input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="e.g. Meera, Aarav’s mother"
            className={INPUT}
          />
        </label>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink">What they said</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Optional, but the words are what make a rating useful."
          className={INPUT}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink">Date</span>
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={INPUT} />
        {!dateValid && <span className="text-xs text-negative">A review cannot be dated in the future.</span>}
      </label>
    </Drawer>
  )
}
