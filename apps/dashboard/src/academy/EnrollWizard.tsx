/**
 * Enrol a student in a batch, against the API.
 *
 * Three things this screen has to get right, all of them about being refused:
 *
 *   **A payer is required.** The API allows a student with no linked customer,
 *   and the fee invoice then belongs to nobody and never shows on a family's
 *   balance. Rather than loosening the server, the wizard insists here — find
 *   the customer by phone or create one.
 *
 *   **Date of birth is required** whenever the chosen programme has an age band,
 *   because the server refuses without it. Asked for up front, not discovered at
 *   submit.
 *
 *   **An age refusal is not a generic error.** It comes back as a 400 carrying
 *   `student_age`, `age_min` and `age_max`, and it means "this is the wrong
 *   batch for this child" — so it is rendered as guidance with the programmes
 *   that *would* fit, not as a red toast that leaves staff stuck.
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import {
  DURATION_LABEL,
  PLAN_DURATIONS,
  ageBoundsFor,
  useBatches,
  useCreateCustomer,
  useCreateStudent,
  useCustomers,
  useEnrolStudent,
  useProgramsList,
  useSports,
  useStudents,
  type PlanDuration,
  type ProgramOut,
} from '../api/hooks'
import { ApiError } from '../api/client'

const inputClass =
  'w-full rounded-lg border border-border-input bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none'

const rupees = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

/** Age on a given day, computed the same way the server does it. */
function ageOn(dob: string, on: Date): number | null {
  if (!dob) return null
  const born = new Date(dob)
  if (Number.isNaN(born.getTime())) return null
  let age = on.getFullYear() - born.getFullYear()
  const before =
    on.getMonth() < born.getMonth() ||
    (on.getMonth() === born.getMonth() && on.getDate() < born.getDate())
  return before ? age - 1 : age
}

export default function EnrollWizard({
  onClose,
  onEnrolled,
}: {
  onClose: () => void
  onEnrolled: () => void
}) {
  // Includes retired sports: this filters programmes that already exist, and a
  // programme for a retired sport is still enrollable.
  const { data: sports } = useSports(true)
  const { data: programs } = useProgramsList()
  const { data: batches } = useBatches()
  const { data: studentPage } = useStudents()

  const [phone, setPhone] = useState('')
  const { data: customerPage } = useCustomers(phone.length >= 4 ? phone : undefined)

  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [parentName, setParentName] = useState('')
  const [sportId, setSportId] = useState('')
  const [programId, setProgramId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [duration, setDuration] = useState<PlanDuration>('3m')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ageRefusal, setAgeRefusal] = useState<{ age: number; min: number; max: number } | null>(null)
  const [done, setDone] = useState<{ invoiceNo: string; total: string; warning: string | null } | null>(
    null,
  )

  const phoneOk = /^\d{10}$/.test(phone)
  const match = (customerPage?.items ?? []).find((c) => c.phone === phone)

  useEffect(() => {
    if (match) setName((prev) => prev || match.name)
  }, [match])

  const sportPrograms = useMemo(
    () => (programs ?? []).filter((p) => !sportId || p.sport_id === sportId),
    [programs, sportId],
  )
  const program = sportPrograms.find((p) => p.id === programId) ?? null
  const programBatches = (batches ?? []).filter((b) => b.program_id === program?.id)
  const batch = programBatches.find((b) => b.id === batchId) ?? programBatches[0] ?? null

  const bounds = program ? ageBoundsFor(program) : null
  const age = ageOn(dob, new Date())
  /** Warn before submitting, but never block — the server is the authority, and
   *  the term may start after a birthday that changes the answer. */
  const ageLooksWrong = bounds && age != null && (age < bounds[0] || age > bounds[1])

  const sellable = program
    ? PLAN_DURATIONS.filter((d) => Number(program[`fee_${d}` as keyof ProgramOut] ?? 0) > 0)
    : []

  /** Programmes that would admit this child, for when one refuses them. */
  const alternatives = useMemo(() => {
    if (age == null) return []
    return (programs ?? []).filter((p) => {
      if (sportId && p.sport_id !== sportId) return false
      const b = ageBoundsFor(p)
      return b === null || (age >= b[0] && age <= b[1])
    })
  }, [programs, sportId, age])

  const createCustomer = useCreateCustomer()
  const createStudent = useCreateStudent()
  const enrol = useEnrolStudent()

  const submit = async () => {
    if (!batch) return
    setError(null)
    setAgeRefusal(null)
    setBusy(true)
    try {
      // A payer first, so the fee invoice always lands on somebody's account.
      const customer = match ?? (await createCustomer.mutateAsync({ name: name.trim(), phone }))

      // Reuse a student record for this customer if one already exists, rather
      // than creating a duplicate every term.
      const existing = (studentPage?.items ?? []).find(
        (s) => s.name.toLowerCase() === name.trim().toLowerCase(),
      )
      const student =
        existing ??
        (await createStudent.mutateAsync({
          name: name.trim(),
          parent_name: parentName.trim() || null,
          phone,
          date_of_birth: dob || null,
          customer_id: customer.id,
        }))

      const result = await enrol.mutateAsync({
        student_id: student.id,
        batch_id: batch.id,
        duration,
      })
      setDone({
        invoiceNo: result.invoice_no,
        total: String(result.invoice_total),
        warning: result.level_warning ?? null,
      })
      onEnrolled()
    } catch (err) {
      const details = err instanceof ApiError ? (err.details as Record<string, unknown>) : undefined
      if (details && typeof details.student_age === 'number') {
        setAgeRefusal({
          age: details.student_age as number,
          min: details.age_min as number,
          max: details.age_max as number,
        })
      } else if (details && details.field === 'date_of_birth') {
        setError('This programme has an age limit, so it needs the student’s date of birth.')
      } else {
        setError(err instanceof Error ? err.message : 'Could not complete this enrolment.')
      }
    } finally {
      setBusy(false)
    }
  }

  const ready = phoneOk && name.trim().length > 1 && !!batch && sellable.length > 0

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border-card px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Enrol a student</h2>
            <p className="mt-0.5 text-sm text-slate">Creates the place and its fee invoice together.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-muted">
            <X size={18} />
          </button>
        </header>

        {done ? (
          <div className="flex flex-col gap-4 px-5 py-6">
            <div className="flex items-center gap-2 text-positive">
              <Check size={18} />
              <p className="font-medium">Enrolled</p>
            </div>
            <p className="text-sm text-slate">
              Invoice <span className="font-medium text-ink">{done.invoiceNo}</span> raised for{' '}
              {rupees(Number(done.total))}.
            </p>
            {done.warning && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {done.warning}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-5 px-5 py-5">
            <section className="flex flex-col gap-3">
              <p className="text-[13px] font-medium text-ink">Who is paying</p>
              <input
                className={inputClass}
                placeholder="Phone (10 digits)"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
              {match && (
                <p className="text-xs text-positive">
                  Existing customer — {match.name}. The fee will go on their account.
                </p>
              )}
              <input
                className={inputClass}
                placeholder="Student's full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className={inputClass}
                placeholder="Parent / guardian (optional)"
                value={parentName}
                onChange={(e) => setParentName(e.target.value)}
              />
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-slate">
                  Date of birth
                  {bounds && <span className="text-amber-700"> — required for this programme</span>}
                </span>
                <input
                  type="date"
                  className={inputClass}
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                />
                {age != null && <span className="text-xs text-muted">{age} years old today</span>}
              </label>
            </section>

            <section className="flex flex-col gap-3">
              <p className="text-[13px] font-medium text-ink">Programme</p>
              <select
                className={inputClass}
                value={sportId}
                onChange={(e) => {
                  setSportId(e.target.value)
                  setProgramId('')
                  setBatchId('')
                }}
              >
                <option value="">All sports</option>
                {(sports ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              <select
                className={inputClass}
                value={programId}
                onChange={(e) => {
                  setProgramId(e.target.value)
                  setBatchId('')
                }}
              >
                <option value="">Choose a programme…</option>
                {sportPrograms.map((p) => {
                  const b = ageBoundsFor(p)
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {b ? ` (ages ${b[0]}–${b[1]})` : ''}
                    </option>
                  )
                })}
              </select>

              {ageLooksWrong && bounds && (
                <p className="text-xs text-amber-700">
                  {name || 'This student'} is {age}. This programme takes {bounds[0]}–{bounds[1]}.
                </p>
              )}

              {program && (
                <select
                  className={inputClass}
                  value={batch?.id ?? ''}
                  onChange={(e) => setBatchId(e.target.value)}
                >
                  {programBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {[b.name, b.schedule, b.time_label].filter(Boolean).join(' · ')} — {b.enrolled ?? 0}/
                      {b.capacity}
                    </option>
                  ))}
                  {programBatches.length === 0 && <option value="">No batches scheduled</option>}
                </select>
              )}

              {program && sellable.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {sellable.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDuration(d)}
                      className={`rounded-full px-3 py-1.5 text-sm ${
                        duration === d ? 'bg-ink text-white' : 'border border-border-card text-slate'
                      }`}
                    >
                      {DURATION_LABEL[d]}{' '}
                      {rupees(Number(program[`fee_${d}` as keyof ProgramOut]))}
                    </button>
                  ))}
                </div>
              )}

              {program && sellable.length === 0 && (
                <p className="text-xs text-amber-700">
                  This programme has no term priced, so it can't be enrolled into.
                </p>
              )}
            </section>

            {ageRefusal && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
                <p className="text-sm font-medium text-amber-900">Wrong age group</p>
                <p className="mt-1 text-sm text-amber-900">
                  {name || 'This student'} is {ageRefusal.age} at the start of this term, and this
                  programme takes {ageRefusal.min}–{ageRefusal.max}.
                </p>
                {alternatives.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-amber-900">These would fit:</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {alternatives.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setProgramId(p.id)
                            setBatchId('')
                            setAgeRefusal(null)
                          }}
                          className="rounded-full border border-amber-400 bg-white px-2.5 py-1 text-xs text-amber-900"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-negative/30 bg-negative/5 px-4 py-3 text-sm text-negative">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={submit}
              disabled={!ready || busy}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              Enrol and raise fee
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}
