/**
 * The last step before money changes hands: pick a plan, then pay.
 *
 * The two halves are one screen on purpose. Splitting "choose" from "pay" adds a
 * click and a page between a decision and the action that completes it, and this is
 * the exact point in the funnel where people leave.
 */
import { useEffect, useState } from 'react'
import {
  ApiError,
  api,
  rupees,
  type BillingPeriod,
  type Plan,
  type Signup,
  type Verified,
} from '../api/client'
import { Alert, Button, ChevronRight } from '../ui/primitives'
import { WizardShell } from './WizardShell'
import { DismissedError, openCheckout } from './razorpay'

export function PlanStep({
  token,
  signup,
  onPaid,
  onBack,
}: {
  token: string
  signup: Signup
  onPaid: (result: Verified) => void
  onBack: () => void
}) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [period, setPeriod] = useState<BillingPeriod>('monthly')
  const [selected, setSelected] = useState<string | null>(signup.plan_code)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    api
      .plans()
      .then((list) => {
        setPlans(list)
        setSelected((current) => current ?? list.find((p) => p.popular)?.code ?? list[0]?.code ?? null)
      })
      .catch(() => setError('Could not load the plans. Please reload the page.'))
  }, [])

  const plan = plans.find((p) => p.code === selected) ?? null
  const price = plan ? (period === 'yearly' ? plan.price_yearly_paise : plan.price_monthly_paise) : 0

  async function pay() {
    if (!plan) return
    setBusy(true)
    setError(null)
    setNote(null)

    try {
      const order = await api.createOrder(token, { plan_code: plan.code, billing_period: period })

      // No Razorpay keys on the API, so there is no sheet to open. The stand-in
      // runs the same server-side verification a real payment does — see
      // app/modules/billing/razorpay.py — it just signs the payment itself.
      if (order.provider === 'mock') {
        setNote('No payment gateway is configured — completing this signup in test mode.')
        onPaid(await api.mockPay(token))
        return
      }

      const result = await openCheckout({
        keyId: order.key_id,
        orderId: order.order_id,
        amountPaise: order.amount_paise,
        currency: order.currency,
        businessName: order.business_name ?? 'Your venue',
        description: `${plan.name} · ${period === 'yearly' ? 'yearly' : 'monthly'}`,
        prefill: {
          name: order.prefill_name,
          email: order.prefill_email,
          contact: order.prefill_contact,
        },
      })

      onPaid(await api.verifyPayment(token, result))
    } catch (err) {
      if (err instanceof DismissedError) {
        // Closing the sheet is not a failure. Saying "payment cancelled" in red
        // over a screen nobody was charged on reads as though something broke.
        setNote('Payment cancelled. Nothing has been charged.')
      } else {
        setError(
          err instanceof ApiError || err instanceof Error
            ? err.message
            : 'Something went wrong starting the payment.',
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <WizardShell
      title="Pick the plan that fits your venue"
      subtitle="Cancel any time. Every plan includes setup and migration help."
      footer={
        <div className="space-y-3">
          <Button className="w-full" onClick={pay} loading={busy} disabled={busy || !plan}>
            {plan ? `Pay ${rupees(price)} and start` : 'Choose a plan'} <ChevronRight />
          </Button>
          <button
            type="button"
            onClick={onBack}
            disabled={busy}
            className="w-full text-[14px] font-medium text-slate hover:text-ink disabled:opacity-50"
          >
            Back
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <div className="flex justify-center">
          <div className="inline-flex rounded-full border border-border-soft bg-white p-1">
            {(['monthly', 'yearly'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPeriod(option)}
                aria-pressed={period === option}
                className={`rounded-full px-5 py-2 text-[14px] font-medium capitalize transition ${
                  period === option ? 'bg-ink text-white' : 'text-slate hover:text-ink'
                }`}
              >
                {option}
                {option === 'yearly' && (
                  <span className={period === 'yearly' ? 'text-lime' : 'text-positive'}>
                    {' '}
                    · 2 months free
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {plans.map((p) => {
            const on = p.code === selected
            const amount = period === 'yearly' ? p.price_yearly_paise : p.price_monthly_paise
            return (
              <button
                key={p.code}
                type="button"
                onClick={() => setSelected(p.code)}
                aria-pressed={on}
                className={`w-full rounded-2xl border p-5 text-left transition ${
                  on ? 'border-ink bg-lime/10' : 'border-border-soft bg-white hover:border-ink'
                }`}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-display text-[18px] font-bold text-ink">
                    {p.name}
                    {p.popular && (
                      <span className="ml-2 rounded-full bg-lime px-2.5 py-1 align-middle font-sans text-[11px] font-semibold text-lime-ink">
                        Most popular
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-display text-[20px] font-bold text-ink tabular-nums">
                    {rupees(amount)}
                    <span className="text-[13px] font-medium text-muted">
                      /{period === 'yearly' ? 'yr' : 'mo'}
                    </span>
                  </span>
                </div>
                <p className="mt-1.5 text-[14px] text-slate">{p.tagline}</p>

                {on && (
                  <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
                    {p.features.map((feature) => (
                      <li key={feature} className="flex gap-2 text-[13px] text-slate">
                        <span aria-hidden className="text-positive">
                          ✓
                        </span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                )}
              </button>
            )
          })}
        </div>

        {note && (
          <p className="rounded-xl border border-border-soft bg-surface-muted px-4 py-3 text-[13px] text-slate">
            {note}
          </p>
        )}
        {error && <Alert>{error}</Alert>}

        <p className="text-center text-[12px] text-muted">
          Payments are processed by Razorpay. We never see your card details.
        </p>
      </div>
    </WizardShell>
  )
}
