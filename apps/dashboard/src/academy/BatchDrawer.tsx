/**
 * Add a batch to a programme.
 *
 * A programme is *what* is taught and what it costs; a batch is *when and with whom* —
 * "Mon · Wed · Fri, 6:00 – 7:30 PM, Coach Priya, 16 places". Until now there was no
 * screen to create one, so a new academy could define programmes it could never fill.
 *
 * Days and times are picked rather than typed: the schedule and time label are shown
 * everywhere as text, and free-typing them gets "Mon-Wed-Fri", "M/W/F" and "MWF" in the
 * same list.
 */
import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import Drawer from '../ui/Drawer'
import { ApiError } from '../api/client'
import { useCoaches, useCreateBatch, type ProgramOut } from '../api/hooks'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** "18:30" → "6:30 PM". */
function clock(value: string): string {
  const [h, m] = value.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`
}

const INPUT =
  'w-full rounded-lg border border-border-card bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lime'

export default function BatchDrawer({
  programs,
  initialProgramId,
  onClose,
}: {
  programs: ProgramOut[]
  initialProgramId?: string
  onClose: () => void
}) {
  const { data: coaches } = useCoaches()
  const create = useCreateBatch()
  const first = programs.find((p) => p.id === initialProgramId) ?? programs[0]

  const [programId, setProgramId] = useState(first?.id ?? '')
  const program = programs.find((p) => p.id === programId)
  const [name, setName] = useState('')
  const [coachId, setCoachId] = useState(first?.coach_id ?? '')
  const [capacity, setCapacity] = useState(String(first?.max_students ?? 12))
  const [days, setDays] = useState<string[]>([])
  const [from, setFrom] = useState('18:00')
  const [to, setTo] = useState('19:00')
  const [startDate, setStartDate] = useState('')
  const [location, setLocation] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Picking a programme fills in what it already knows, so the common case is a few
  // taps — but only over fields the person has not already touched.
  const pickProgram = (id: string) => {
    setProgramId(id)
    const p = programs.find((x) => x.id === id)
    if (p) {
      setCoachId(p.coach_id ?? '')
      setCapacity(String(p.max_students ?? 12))
    }
  }

  const toggleDay = (d: string) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))

  const timeLabel = `${clock(from)} – ${clock(to)}`
  const schedule = DAYS.filter((d) => days.includes(d)).join(' · ')
  const suggestedName = program ? `${program.name}${days.length ? ` · ${schedule}` : ''}` : ''
  const timesValid = from < to
  const valid = Boolean(programId) && Number(capacity) > 0 && days.length > 0 && timesValid

  async function save() {
    if (!program) return
    setError(null)
    try {
      await create.mutateAsync({
        name: name.trim() || suggestedName,
        program_id: program.id,
        sport_id: program.sport_id ?? null,
        coach_id: coachId || null,
        capacity: Number(capacity),
        schedule,
        time_label: timeLabel,
        location: location.trim() || null,
        start_date: startDate || null,
      })
      onClose()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.isForbidden
            ? 'Only a manager or admin can add batches.'
            : err.message
          : 'Could not add the batch. Please try again.',
      )
    }
  }

  return (
    <Drawer
      title="Add a batch"
      subtitle={program?.name}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!valid || create.isPending}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {create.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Add batch
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

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink">Programme</span>
        <select value={programId} onChange={(e) => pickProgram(e.target.value)} className={INPUT}>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink">Days</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days of the week">
          {DAYS.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days.includes(d)}
              onClick={() => toggleDay(d)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                days.includes(d) ? 'bg-ink text-white' : 'border border-border-card bg-white text-slate'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">From</span>
          <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">To</span>
          <input type="time" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT} />
        </label>
      </div>
      {!timesValid && <p className="-mt-3 text-xs text-negative">The end time must be after the start.</p>}

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink">Batch name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={suggestedName || 'Tennis Beginners · Mon · Wed'}
          className={INPUT}
        />
        <span className="text-xs text-muted">Leave blank to use the suggestion.</span>
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">Coach</span>
          <select value={coachId} onChange={(e) => setCoachId(e.target.value)} className={INPUT}>
            <option value="">Not assigned</option>
            {(coaches?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">Places</span>
          <input
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className={INPUT}
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">Starts on</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">Location</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Court 1" className={INPUT} />
        </label>
      </div>

      {days.length > 0 && timesValid && (
        <p className="rounded-lg bg-surface-muted px-3 py-2.5 text-sm text-slate">
          {schedule} · {timeLabel}
        </p>
      )}
    </Drawer>
  )
}
