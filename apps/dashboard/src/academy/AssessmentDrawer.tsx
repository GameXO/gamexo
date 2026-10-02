/**
 * Review a student: an overall score, the skills behind it, and a note.
 *
 * Each review is kept, so the profile can show a trend rather than only today's number.
 * The skills start from the student's last review — a coach adjusting six sliders by a
 * point is a thirty-second job, whereas re-entering them from blank would not get done.
 *
 * The overall score follows the average of the skills until the reviewer types their
 * own: a coach's overall impression is allowed to differ from the arithmetic (a child
 * who lifts every match is more than a mean of drills), but it should not have to be
 * calculated by hand either.
 */
import { useState } from 'react'
import { Check, Loader2, Plus, X } from 'lucide-react'
import Drawer from '../ui/Drawer'
import { ApiError } from '../api/client'
import { toISO } from '../data/booking'
import { useAddAssessment, useSports } from '../api/hooks'

type Skill = { name: string; score: number }

const DEFAULT_SKILLS = ['Technique', 'Fitness', 'Footwork', 'Game sense', 'Teamwork', 'Attitude']

const INPUT =
  'w-full rounded-lg border border-border-card bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lime'

const average = (skills: Skill[]) =>
  skills.length ? Math.round((skills.reduce((s, k) => s + k.score, 0) / skills.length) * 2) / 2 : 0

export default function AssessmentDrawer({
  student,
  initialSkills,
  defaultSportId,
  onClose,
}: {
  student: { id: string; name: string }
  initialSkills: Skill[]
  defaultSportId?: string | null
  onClose: () => void
}) {
  const { data: sports } = useSports(true)
  const add = useAddAssessment()
  const today = toISO(new Date())

  const [sportId, setSportId] = useState(defaultSportId ?? '')
  const [date, setDate] = useState(today)
  const [skills, setSkills] = useState<Skill[]>(
    initialSkills.length ? initialSkills.map((s) => ({ ...s })) : DEFAULT_SKILLS.map((name) => ({ name, score: 5 })),
  )
  const [rating, setRating] = useState<string | null>(null) // null = follow the average
  const [comment, setComment] = useState('')
  const [newSkill, setNewSkill] = useState('')
  const [error, setError] = useState<string | null>(null)

  const avg = average(skills)
  const shown = rating ?? String(avg)
  const ratingNumber = Number(shown)
  const ratingValid = shown.trim() !== '' && ratingNumber >= 0 && ratingNumber <= 10
  const dateValid = date !== '' && date <= today

  const setScore = (name: string, score: number) =>
    setSkills((cur) => cur.map((s) => (s.name === name ? { ...s, score } : s)))

  const addSkill = () => {
    const name = newSkill.trim()
    if (!name || skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) return
    setSkills((cur) => [...cur, { name, score: 5 }])
    setNewSkill('')
  }

  async function save() {
    setError(null)
    try {
      await add.mutateAsync({
        studentId: student.id,
        body: {
          sport_id: sportId || null,
          assessed_on: date,
          rating: ratingNumber,
          skills,
          comment: comment.trim() || null,
        },
      })
      onClose()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.isForbidden
            ? 'Only a manager or admin can record a review.'
            : err.message
          : 'Could not save the review. Please try again.',
      )
    }
  }

  return (
    <Drawer
      title="Add a review"
      subtitle={student.name}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!ratingValid || !dateValid || add.isPending}
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

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">Sport</span>
          <select value={sportId} onChange={(e) => setSportId(e.target.value)} className={INPUT}>
            <option value="">General</option>
            {(sports ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">Date</span>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={INPUT} />
        </label>
      </div>
      {!dateValid && <p className="-mt-3 text-xs text-negative">A review cannot be dated in the future.</p>}

      <div className="flex flex-col gap-3">
        <p className="text-[12px] font-medium text-ink">Skills</p>
        {skills.map((skill) => (
          <div key={skill.name} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-sm text-ink" title={skill.name}>
              {skill.name}
            </span>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={skill.score}
              onChange={(e) => setScore(skill.name, Number(e.target.value))}
              aria-label={`${skill.name} score`}
              className="h-1.5 flex-1 accent-ink"
            />
            <span className="w-9 shrink-0 text-right text-sm font-medium text-ink">{skill.score}</span>
            <button
              type="button"
              onClick={() => setSkills((cur) => cur.filter((s) => s.name !== skill.name))}
              aria-label={`Remove ${skill.name}`}
              className="text-muted hover:text-negative"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addSkill()
              }
            }}
            placeholder="Add a skill, e.g. Backhand"
            className={INPUT}
          />
          <button
            type="button"
            onClick={addSkill}
            disabled={!newSkill.trim()}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border-card px-3 text-sm text-slate disabled:opacity-40"
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink">Overall rating (0–10)</span>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={shown}
            onChange={(e) => setRating(e.target.value)}
            className={`${INPUT} max-w-[110px]`}
            aria-label="Overall rating"
          />
          {rating !== null && skills.length > 0 && (
            <button type="button" onClick={() => setRating(null)} className="text-xs text-lime-ink underline">
              Use the average ({avg})
            </button>
          )}
          {rating === null && skills.length > 0 && (
            <span className="text-xs text-muted">Average of the skills — type to override.</span>
          )}
        </div>
        {!ratingValid && <p className="text-xs text-negative">Enter a rating between 0 and 10.</p>}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink">Coach&rsquo;s note</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="What is going well, and what to work on next. A parent will read this."
          className={INPUT}
        />
      </label>
    </Drawer>
  )
}
