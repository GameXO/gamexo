import { useEffect, useState } from 'react'
import { Banknote, Check, CreditCard, Smartphone, Wallet, X } from 'lucide-react'
import { PAYMENT_METHODS, SPORTS, money, toISO } from '../data/booking'
import { batchesForProgram, coachesForSport, programsForSport, type Student } from '../data/academy'
import * as db from '../lib/db'

const METHOD_ICON: Record<string, typeof Smartphone> = { upi: Smartphone, card: CreditCard, cash: Banknote, wallet: Wallet }

const inputClass =
  'w-full rounded-lg border border-border-input bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none'

export default function EnrollWizard({ onClose, onEnrolled }: { onClose: () => void; onEnrolled: () => void }) {
  const [step, setStep] = useState(1)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [sportId, setSportId] = useState(SPORTS[0].id)
  const [programId, setProgramId] = useState('')
  const [batchId, setBatchId] = useState('')
  const [coachId, setCoachId] = useState('')
  const [method, setMethod] = useState('upi')
  const [success, setSuccess] = useState<Student | null>(null)

  const phoneOk = /^\d{10}$/.test(phone)
  const modes = db.getPaymentModes()
  const availableMethods = PAYMENT_METHODS.filter((m) => modes[m.id] !== false)

  useEffect(() => {
    if (!phoneOk) return
    const match = db.findCustomer(phone)
    if (match) {
      setName(match.name)
      setEmail(match.email)
    }
  }, [phone, phoneOk])

  const programs = programsForSport(sportId)
  const program = programs.find((p) => p.id === programId) || programs[0]
  const batches = program ? batchesForProgram(program.id) : []
  const batch = batches.find((b) => b.id === batchId) || batches[0]
  const coaches = coachesForSport(sportId)
  const coach = coaches.find((c) => c.id === coachId) || coaches[0]

  const canNext = step === 1 ? phoneOk && name.trim().length > 1 : step === 2 ? !!program : step === 3 ? !!batch : true

  const confirm = () => {
    if (!program || !batch) return
    const id = `AC${Math.floor(10000 + Math.random() * 89999)}`
    const record: Student = {
      id,
      customer: { name: name.trim(), phone, email },
      sportId,
      programId: program.id,
      batchId: batch.id,
      coachId: coach?.id || '',
      startDate: toISO(new Date()),
      fee: program.fee,
      gst: program.gst,
      total: program.total,
      paidTotal: program.total,
      status: 'active',
      sessionsAttended: 0,
      createdAt: new Date().toISOString(),
    }
    db.saveStudent(record)
    db.upsertCustomer({ name: record.customer.name, phone, email })
    setSuccess(record)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-[520px] flex-col gap-5 overflow-y-auto rounded-2xl bg-white p-6"
      >
        {success ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-lime">
              <Check size={24} className="text-lime-ink" />
            </div>
            <div>
              <p className="text-lg font-semibold text-ink">Enrolled</p>
              <p className="mt-1 text-sm text-slate">
                {program?.name} · {batch?.days} · {batch?.time}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onEnrolled()
                onClose()
              }}
              className="flex h-11 items-center justify-center rounded-full px-8 text-sm text-[#fefefe]"
              style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold text-ink">Enroll student</p>
              <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
                <X size={20} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {['Student', 'Program', 'Batch', 'Payment'].map((label, i) => (
                <div key={label} className="flex flex-1 items-center gap-2">
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      i + 1 <= step ? 'bg-lime text-lime-ink' : 'bg-surface-muted text-muted'
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className={`hidden text-xs sm:inline ${i + 1 === step ? 'text-ink' : 'text-muted'}`}>{label}</span>
                  {i < 3 && <span className="h-px flex-1 bg-border-card" />}
                </div>
              ))}
            </div>

            {step === 1 && (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-slate">Phone number</span>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">+91</span>
                    <input
                      className={`${inputClass} pl-11`}
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="90000 00000"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    />
                  </div>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-slate">Name</span>
                  <input className={inputClass} placeholder="Student's name" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-slate">Email (optional)</span>
                  <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-2">
                  {SPORTS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        setSportId(s.id)
                        setProgramId('')
                      }}
                      className={`rounded-full px-4 py-2 text-sm transition-colors ${
                        sportId === s.id ? 'bg-ink text-bone' : 'bg-surface-muted text-slate'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {programs.map((p) => {
                    const active = program?.id === p.id
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setProgramId(p.id)}
                        className={`flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition-colors ${
                          active ? 'border-ink bg-ink text-bone' : 'border-border-card bg-white text-ink'
                        }`}
                      >
                        <span className="text-sm font-semibold">{p.name}</span>
                        <span className="text-lg font-semibold">{money(p.total)}/mo</span>
                        <span className={`text-xs ${active ? 'text-bone/70' : 'text-muted'}`}>
                          {p.sessionsPerWeek}x/week · {p.blurb}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-slate">Batch</span>
                  {batches.map((b) => {
                    const active = batch?.id === b.id
                    const enrolled = db.studentsInBatch(b.id).length
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setBatchId(b.id)}
                        className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-left transition-colors ${
                          active ? 'border-ink bg-surface-muted' : 'border-border-card bg-white'
                        }`}
                      >
                        <div>
                          <p className="text-sm text-ink">{b.days}</p>
                          <p className="text-xs text-muted">{b.time}</p>
                        </div>
                        <span className="text-xs text-muted">
                          {enrolled}/{b.capacity}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-slate">Coach</span>
                  <div className="flex flex-wrap gap-2">
                    {coaches.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCoachId(c.id)}
                        className={`rounded-full px-4 py-2 text-sm transition-colors ${
                          (coach?.id || coaches[0]?.id) === c.id ? 'bg-ink text-bone' : 'bg-surface-muted text-slate'
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                    {coaches.length === 0 && <p className="text-sm text-muted">No coach on staff yet.</p>}
                  </div>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-2">
                  {availableMethods.map((m) => {
                    const Icon = METHOD_ICON[m.id]
                    const active = method === m.id
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMethod(m.id)}
                        className={`flex items-center gap-2 rounded-lg border p-3 text-sm transition-colors ${
                          active ? 'border-ink bg-ink text-bone' : 'border-border-card bg-white text-ink'
                        }`}
                      >
                        <Icon size={16} /> {m.name}
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center justify-between border-t border-border-card pt-3">
                  <span className="text-sm text-slate">First month due</span>
                  <span className="text-lg font-semibold text-ink">{money(program?.total || 0)}</span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              {step > 1 ? (
                <button type="button" onClick={() => setStep((s) => s - 1)} className="text-sm text-slate hover:text-ink">
                  Back
                </button>
              ) : (
                <span />
              )}
              {step < 4 ? (
                <button
                  type="button"
                  disabled={!canNext}
                  onClick={() => setStep((s) => s + 1)}
                  className="flex h-10 items-center justify-center rounded-full px-6 text-sm text-[#fefefe] disabled:opacity-40"
                  style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={confirm}
                  className="flex h-10 items-center justify-center rounded-full px-6 text-sm text-[#fefefe]"
                  style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
                >
                  Confirm &amp; charge {money(program?.total || 0)}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
