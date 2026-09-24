/**
 * Sell a membership, against the API.
 *
 * Plans and prices are not chosen here in any meaningful sense — they are read
 * from what Settings → Membership Plans defines. Only terms the plan actually
 * prices are offered, because the server refuses a duration priced at zero, and
 * a picker that can produce a rejected request is a picker that will.
 *
 * The subscription and its invoice are created in one transaction on the
 * server, so there is no half-state to clean up if this closes mid-flight.
 */
import { useEffect, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import {
  DURATION_LABEL,
  planPrice,
  sellableDurations,
  useCreateCustomer,
  useCreateMembership,
  useCustomers,
  useMembershipPlans,
  type PlanDuration,
} from '../api/hooks'

const inputClass =
  'w-full rounded-lg border border-border-input bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none'

const rupees = (n: number) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

export default function NewMembershipWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const { data: plans, isLoading } = useMembershipPlans()
  const [phone, setPhone] = useState('')
  const { data: customerPage } = useCustomers(phone.length >= 4 ? phone : undefined)

  const [name, setName] = useState('')
  const [planId, setPlanId] = useState('')
  const [duration, setDuration] = useState<PlanDuration | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ memberNo: string; invoiceNo: string; total: string } | null>(null)

  const phoneOk = /^\d{10}$/.test(phone)
  const match = (customerPage?.items ?? []).find((c) => c.phone === phone)

  useEffect(() => {
    if (match) setName((prev) => prev || match.name)
  }, [match])

  // Only plans that are actually sellable — an active plan with every term at
  // zero would otherwise sit in the list and fail on submit.
  const offered = (plans ?? []).filter((p) => sellableDurations(p).length > 0)
  const plan = offered.find((p) => p.id === planId) ?? null
  const terms = plan ? sellableDurations(plan) : []

  useEffect(() => {
    // Keep the chosen term valid when the plan changes under it.
    if (plan && (!duration || !terms.includes(duration))) setDuration(terms[0] ?? '')
  }, [plan, duration, terms])

  const createCustomer = useCreateCustomer()
  const createMembership = useCreateMembership()

  const confirm = async () => {
    if (!plan || !duration) return
    setError(null)
    setBusy(true)
    try {
      const customer = match ?? (await createCustomer.mutateAsync({ name: name.trim(), phone }))
      const result = await createMembership.mutateAsync({
        customer_id: customer.id,
        plan_id: plan.id,
        duration,
      })
      setDone({
        memberNo: result.subscription.member_no,
        invoiceNo: result.invoice.invoice_no,
        total: String(result.invoice.total),
      })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create this membership.')
    } finally {
      setBusy(false)
    }
  }

  const ready = phoneOk && name.trim().length > 1 && !!plan && !!duration

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border-card px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">New membership</h2>
            <p className="mt-0.5 text-sm text-slate">Creates the membership and its invoice together.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-muted">
            <X size={18} />
          </button>
        </header>

        {done ? (
          <div className="flex flex-col gap-4 px-5 py-6">
            <div className="flex items-center gap-2 text-positive">
              <Check size={18} />
              <p className="font-medium">Membership created</p>
            </div>
            <p className="text-sm text-slate">
              <span className="font-medium text-ink">{done.memberNo}</span> · invoice{' '}
              <span className="font-medium text-ink">{done.invoiceNo}</span> for{' '}
              {rupees(Number(done.total))}.
            </p>
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
              <p className="text-[13px] font-medium text-ink">Member</p>
              <input
                className={inputClass}
                placeholder="Phone (10 digits)"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
              {match && <p className="text-xs text-positive">Existing customer — {match.name}.</p>}
              <input
                className={inputClass}
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </section>

            <section className="flex flex-col gap-3">
              <p className="text-[13px] font-medium text-ink">Plan</p>
              {isLoading && <p className="text-sm text-muted">Loading plans…</p>}
              {!isLoading && offered.length === 0 && (
                <p className="text-sm text-muted">
                  No sellable plans. Define one in Settings → Membership Plans and price
                  at least one term.
                </p>
              )}
              {offered.length > 0 && (
                <select className={inputClass} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  <option value="">Choose a plan…</option>
                  {offered.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.category ? ` · ${p.category}` : ''}
                    </option>
                  ))}
                </select>
              )}

              {plan && (
                <div className="flex flex-wrap gap-2">
                  {terms.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDuration(d)}
                      className={`rounded-full px-3 py-1.5 text-sm ${
                        duration === d ? 'bg-ink text-white' : 'border border-border-card text-slate'
                      }`}
                    >
                      {DURATION_LABEL[d]} {rupees(planPrice(plan, d))}
                    </button>
                  ))}
                </div>
              )}

              {plan && Number(plan.joining_fee ?? 0) > 0 && (
                <p className="text-xs text-muted">
                  Plus a one-off joining fee of {rupees(Number(plan.joining_fee))}.
                </p>
              )}
            </section>

            {error && (
              <div className="rounded-lg border border-negative/30 bg-negative/5 px-4 py-3 text-sm text-negative">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={confirm}
              disabled={!ready || busy}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              Create and invoice
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}
