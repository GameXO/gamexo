/**
 * Record paying a coach for a month.
 *
 * The amount is not typed. It is the server's own working-out for the month — fixed
 * salary, hours taught, commission on fees collected — read back here line by line, so
 * what is on screen is exactly what will be recorded. The only things a person adds are a
 * bonus or deduction (with a reason, so the payslip explains itself) and how the money
 * went out.
 *
 * Recording a payout does not move money; it records that it was moved.
 */
import { useState } from 'react'
import { Check, Loader2 } from '../ui/icons'
import Drawer from '../ui/Drawer'
import { ApiError, type PayoutBody } from '../api/client'
import { toISO } from '../data/booking'
import { useCoachEarnings, useRecordPayout } from '../api/hooks'
import { longMonth } from './coachFormat'
import { rupees } from './format'

const INPUT =
  'w-full rounded-lg border border-border-card bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lime'

const METHODS: { value: NonNullable<PayoutBody['method']>; label: string }[] = [
  { value: 'bank', label: 'Bank transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
]

export default function PayoutDrawer({
  coach,
  month,
  inProgress,
  onClose,
}: {
  coach: { id: string; name: string }
  /** "YYYY-MM" */
  month: string
  /** The month has not finished, so the figures can still change. */
  inProgress?: boolean
  onClose: () => void
}) {
  const { data: earned, isLoading } = useCoachEarnings(coach.id, month)
  const record = useRecordPayout()
  const today = toISO(new Date())

  const [kind, setKind] = useState<'bonus' | 'deduction'>('bonus')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState<NonNullable<PayoutBody['method']>>('bank')
  const [reference, setReference] = useState('')
  const [paidOn, setPaidOn] = useState(today)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const gross = Number(earned?.gross ?? 0)
  const adjust = Math.abs(Number(amount) || 0) * (kind === 'deduction' ? -1 : 1)
  const total = gross + adjust

  const problem =
    adjust !== 0 && !reason.trim()
      ? 'Say what the bonus or deduction is for.'
      : total < 0
        ? 'The deduction is larger than what was earned.'
        : total === 0
          ? 'There is nothing to pay for this month.'
          : paidOn > today
            ? 'The payment date cannot be in the future.'
            : null

  async function submit() {
    setError(null)
    try {
      await record.mutateAsync({
        coachId: coach.id,
        body: {
          month,
          adjustment: String(adjust),
          adjustment_note: adjust !== 0 ? reason.trim() : null,
          method,
          reference: reference.trim() || null,
          paid_on: paidOn,
          note: note.trim() || null,
        },
      })
      onClose()
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 409
            ? `${coach.name} has already been paid for ${longMonth(month)}.`
            : err.isForbidden
              ? 'Only a manager or admin can record a payout.'
              : err.message
          : 'Could not record the payout. Please try again.',
      )
    }
  }

  return (
    <Drawer
      title="Record payout"
      subtitle={`${coach.name} · ${longMonth(month)}`}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-3">
          {problem && amount !== '' && <p className="text-xs text-negative">{problem}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={isLoading || !earned || Boolean(problem) || record.isPending}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {record.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              Record {rupees(total)} paid
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

      {inProgress && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {longMonth(month)} is not over yet. Hours and fees are counted up to today, and the payout is a snapshot —
          later sessions and payments won’t be added to it.
        </p>
      )}

      <section className="rounded-xl border border-border-card bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">How it adds up</p>
        {isLoading || !earned ? (
          <div className="mt-3 h-20 animate-pulse rounded bg-surface-muted" />
        ) : (
          <>
            <ul className="mt-3 flex flex-col gap-2.5">
              {earned.lines.map((l) => (
                <li key={l.label} className="flex items-start justify-between gap-4 text-sm">
                  <span>
                    <span className="block font-medium text-ink">{l.label}</span>
                    <span className="block text-xs text-slate">{l.detail}</span>
                  </span>
                  <span className="shrink-0 font-medium text-ink">{rupees(l.amount)}</span>
                </li>
              ))}
              {earned.lines.length === 0 && <li className="text-sm text-muted">Nothing earned yet.</li>}
            </ul>
            <p className="mt-3 border-t border-border-card pt-3 text-xs text-slate">
              {earned.sessions} {earned.sessions === 1 ? 'session' : 'sessions'} completed · {Number(earned.hours)} h ·{' '}
              {rupees(earned.fees_collected)} collected from their students
            </p>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <p className="text-[12px] font-medium text-ink">Bonus or deduction (optional)</p>
        <div className="flex gap-2">
          <div className="flex shrink-0 overflow-hidden rounded-lg border border-border-card text-sm">
            {(['bonus', 'deduction'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`px-3 py-2 capitalize ${kind === k ? 'bg-ink text-white' : 'text-slate'}`}
              >
                {k}
              </button>
            ))}
          </div>
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="₹ amount"
            className={INPUT}
            inputMode="decimal"
            aria-label="Adjustment amount"
          />
        </div>
        {adjust !== 0 && (
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={kind === 'bonus' ? 'e.g. Tournament prep, extra sessions' : 'e.g. Advance taken on 4 Sep'}
            maxLength={300}
            className={INPUT}
            aria-label="Reason"
          />
        )}
      </section>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">Paid by</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={INPUT}>
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium text-ink">Paid on</span>
          <input type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} className={INPUT} />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink">Reference</span>
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="UTR, UPI id or cheque number"
          maxLength={120}
          className={INPUT}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink">Note</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={INPUT} />
      </label>

      <div className="flex items-center justify-between rounded-xl bg-surface-muted px-4 py-3">
        <span className="text-sm text-slate">Total to record</span>
        <span className="font-display text-xl font-semibold text-ink">{rupees(total)}</span>
      </div>
    </Drawer>
  )
}
