/**
 * Add a coach, or edit one — the same form, because they are the same facts.
 *
 * Pay sits in its own section and shows only the fields the chosen model uses: a
 * commission coach has no use for a salary box, and a field that does nothing is a
 * field someone fills in and then wonders why the payroll ignores it. The numbers for
 * the models not chosen are kept, though, so flipping from "hourly" to "fixed" and back
 * does not lose what was typed.
 */
import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import Drawer from '../ui/Drawer'
import { ApiError, type CoachBody, type CoachType, type PayModel } from '../api/client'
import { useSaveCoach, useSports, type CoachOut } from '../api/hooks'
import { COACH_TYPES, PAY_MODELS } from './coachFormat'

const INPUT =
  'w-full rounded-lg border border-border-card bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lime'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}

const money = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(Number(v) || ''))

export default function CoachDrawer({
  coach,
  onClose,
  onSaved,
}: {
  /** Omit to add a new coach. */
  coach?: CoachOut
  onClose: () => void
  onSaved?: (coach: CoachOut) => void
}) {
  const { data: sports } = useSports(true)
  const save = useSaveCoach()

  const [name, setName] = useState(coach?.name ?? '')
  const [phone, setPhone] = useState(coach?.phone ?? '')
  const [email, setEmail] = useState(coach?.email ?? '')
  const [gender, setGender] = useState(coach?.gender ?? '')
  const [type, setType] = useState<CoachType>((coach?.type as CoachType) ?? 'full-time')
  const [specialization, setSpecialization] = useState(coach?.specialization ?? '')
  const [experience, setExperience] = useState(String(coach?.experience_years ?? 0))
  const [joined, setJoined] = useState(coach?.joining_date ?? '')
  const [sportIds, setSportIds] = useState<string[]>(coach?.sport_ids ?? [])
  const [morning, setMorning] = useState(coach?.morning_available ?? true)
  const [evening, setEvening] = useState(coach?.evening_available ?? true)
  const [status, setStatus] = useState<'active' | 'inactive' | 'on-leave'>(coach?.status ?? 'active')

  const [model, setModel] = useState<PayModel>(coach?.pay_model ?? 'fixed')
  const [salary, setSalary] = useState(money(coach?.salary))
  const [rate, setRate] = useState(money(coach?.hourly_rate))
  const [pct, setPct] = useState(money(coach?.commission_pct))

  const [error, setError] = useState<string | null>(null)

  const usesSalary = model === 'fixed' || model === 'hybrid'
  const usesRate = model === 'hourly'
  const usesPct = model === 'commission' || model === 'hybrid'

  const pctNumber = Number(pct || 0)
  const problems = [
    !name.trim() && 'Enter the coach’s name.',
    email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim()) && 'That email address does not look right.',
    (Number(salary || 0) < 0 || Number(rate || 0) < 0) && 'Pay cannot be negative.',
    (pctNumber < 0 || pctNumber > 100) && 'Commission is a percentage between 0 and 100.',
    // A zero salary or rate is allowed — a volunteer, or a guest paid by adjustment.
    // A commission coach at 0% is not: that is a pay model that can never pay.
    usesPct && pctNumber === 0 && 'Enter the commission percentage, or pick another pay model.',
  ].filter(Boolean) as string[]

  const toggleSport = (id: string) =>
    setSportIds((cur) => (cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id]))

  async function submit() {
    setError(null)
    const body: CoachBody = {
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      gender: gender || null,
      type,
      specialization: specialization.trim() || null,
      experience_years: Math.max(0, Math.round(Number(experience) || 0)),
      joining_date: joined || null,
      sport_ids: sportIds,
      morning_available: morning,
      evening_available: evening,
      status,
      pay_model: model,
      salary: String(Number(salary || 0)),
      hourly_rate: String(Number(rate || 0)),
      commission_pct: String(pctNumber),
    }
    try {
      const saved = await save.mutateAsync({ coachId: coach?.id, body })
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.isForbidden
            ? 'Only a manager or admin can add or change a coach.'
            : err.status === 409 || /already/i.test(err.message)
              ? 'Another coach already uses that email address.'
              : err.message
          : 'Could not save the coach. Please try again.',
      )
    }
  }

  return (
    <Drawer
      title={coach ? 'Edit coach' : 'Add a coach'}
      subtitle={coach ? `${coach.coach_no} · ${coach.name}` : 'They get the next coach number automatically.'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={problems.length > 0 || save.isPending}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {coach ? 'Save changes' : 'Add coach'}
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

      <Field label="Full name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} autoFocus />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Phone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={INPUT} />
        </Field>
        <Field label="Gender">
          <select value={gender} onChange={(e) => setGender(e.target.value)} className={INPUT}>
            <option value="">—</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Other">Other</option>
          </select>
        </Field>
      </div>

      <Field label="Email" hint="Optional. Each coach needs a different one.">
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={INPUT} />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Type">
          <select value={type} onChange={(e) => setType(e.target.value as CoachType)} className={INPUT}>
            {COACH_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Years of experience">
          <input
            type="number"
            min={0}
            max={80}
            value={experience}
            onChange={(e) => setExperience(e.target.value)}
            className={INPUT}
          />
        </Field>
      </div>

      <Field label="Specialisation" hint="For example “Baseline game and serve technique”.">
        <input value={specialization} onChange={(e) => setSpecialization(e.target.value)} className={INPUT} />
      </Field>

      <div className="flex flex-col gap-2">
        <p className="text-[12px] font-medium text-ink">Sports they coach</p>
        <div className="flex flex-wrap gap-2">
          {(sports ?? []).map((s) => {
            const on = sportIds.includes(s.id)
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleSport(s.id)}
                aria-pressed={on}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  on ? 'border-ink bg-ink text-white' : 'border-border-card text-slate hover:text-ink'
                }`}
              >
                {s.name}
              </button>
            )
          })}
          {sports && sports.length === 0 && <p className="text-xs text-muted">No sports set up yet.</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Joined on">
          <input type="date" value={joined} onChange={(e) => setJoined(e.target.value)} className={INPUT} />
        </Field>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className={INPUT}
          >
            <option value="active">Active</option>
            <option value="on-leave">On leave</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[12px] font-medium text-ink">Available</p>
        <div className="flex gap-4 text-sm text-ink">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={morning} onChange={(e) => setMorning(e.target.checked)} /> Mornings
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={evening} onChange={(e) => setEvening(e.target.checked)} /> Evenings
          </label>
        </div>
      </div>

      <section className="flex flex-col gap-4 rounded-xl border border-border-card bg-white p-4">
        <div>
          <p className="text-sm font-semibold text-ink">How they are paid</p>
          <p className="text-xs text-muted">Payroll works the month’s pay out from this.</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {PAY_MODELS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setModel(m.value)}
              aria-pressed={model === m.value}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                model === m.value ? 'border-ink bg-ink text-white' : 'border-border-card text-ink hover:border-slate'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="-mt-2 text-xs text-slate">{PAY_MODELS.find((m) => m.value === model)?.hint}</p>

        {usesSalary && (
          <Field label="Monthly salary (₹)">
            <input
              type="number"
              min={0}
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              className={INPUT}
              inputMode="decimal"
            />
          </Field>
        )}
        {usesRate && (
          <Field label="Rate per hour (₹)" hint="Counted from sessions marked completed.">
            <input
              type="number"
              min={0}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className={INPUT}
              inputMode="decimal"
            />
          </Field>
        )}
        {usesPct && (
          <Field
            label="Commission (%)"
            hint="Of fees actually received in the month from students in their batches."
          >
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              className={INPUT}
              inputMode="decimal"
            />
          </Field>
        )}
      </section>

      {problems.length > 0 && name.trim() !== '' && <p className="text-xs text-negative">{problems[0]}</p>}
    </Drawer>
  )
}
