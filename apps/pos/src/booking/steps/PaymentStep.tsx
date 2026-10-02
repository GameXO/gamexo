import { Download, Pencil } from 'lucide-react'
import { useCourts, useQuote, useSports } from '../../api/hooks'
import { money, startsAtISO } from '../../lib/format'
import { downloadInvoicePdf } from '../../lib/invoicePdf'
import type { PaymentMethodId } from '../../lib/paymentMethods'
import { buildProvisionalInvoice } from '../invoice'
import { useCurrentIssuer } from '../../branch/useCurrentIssuer'
import { traySelections } from '../offers'
import type { Draft } from '../types'
import { asset } from '../../lib/asset'

const arrowRight = asset('pos/checkin/arrow-right-check.svg')

const METHODS: { id: PaymentMethodId; label: string }[] = [
  { id: 'card', label: 'CC' },
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
]

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5">
      <p className="text-[clamp(0.4375rem,0.83vh,0.5rem)] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="text-[clamp(0.625rem,1.15vh,0.6875rem)] font-semibold text-ink">{value}</p>
    </div>
  )
}

export default function PaymentStep({
  draft,
  setDraft,
  processing,
  onPay,
  onEditStep,
}: {
  draft: Draft
  setDraft: (patch: Partial<Draft>) => void
  processing: boolean
  onPay: () => void
  onEditStep: (step: number) => void
}) {
  const sportsQuery = useSports()
  const courtsQuery = useCourts(draft.sportId || undefined)
  const issuer = useCurrentIssuer()
  const sport = sportsQuery.data?.find((s) => s.id === draft.sportId)
  const court = courtsQuery.data?.find((c) => c.id === draft.courtId)

  const startsAt = draft.date && draft.startHour != null ? startsAtISO(draft.date, draft.startHour) : null
  const equipment = traySelections(draft.equipment)
  const quoteQuery = useQuote(
    court && startsAt ? { courtId: court.id, startsAt, durationMin: draft.hours * 60, equipment } : null,
  )

  const invoice = buildProvisionalInvoice(draft, sport, court, quoteQuery.data, issuer)
  const pricingReady = !quoteQuery.isPending && !quoteQuery.error

  // No upsell rail here by design: kit is chosen in the Add-Ons step, and repeating the
  // catalogue on the payment screen pushed the payment panel itself off the tablet.

  return (
    <div className="flex w-full flex-1 flex-col gap-[clamp(0.75rem,2dvh,1.25rem)] lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-[clamp(0.75rem,2dvh,1.25rem)]">
        {quoteQuery.error && (
          <p role="alert" className="text-[clamp(0.6875rem,1.25vh,0.75rem)] text-negative">
            Could not price this booking: {quoteQuery.error instanceof Error ? quoteQuery.error.message : 'unknown error'}
          </p>
        )}

        <div className="flex w-full flex-col gap-[clamp(0.5rem,1.5dvh,1rem)] rounded-2xl bg-white p-[clamp(0.85rem,1.6vw,1.25rem)]">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-[clamp(0.8125rem,1.46vh,0.875rem)] font-bold text-ink">
                {invoice.sportName} · {invoice.courtName}
              </p>
              <div className="flex items-center gap-1 text-[clamp(0.5625rem,1.04vh,0.625rem)]">
                {invoice.bookingId ? (
                  <>
                    <span className="text-muted">Booking {invoice.bookingRef} ·</span>
                    <span className="font-semibold text-flame">{invoice.balanceDue > 0 ? 'Due' : 'Paid'}</span>
                  </>
                ) : (
                  <span className="font-semibold text-flame">Provisional</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => downloadInvoicePdf(invoice)}
                aria-label="Download PDF"
                className="flex size-9 items-center justify-center rounded-lg bg-surface text-ink hover:bg-surface-muted"
              >
                <Download size={15} strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={() => onEditStep(1)}
                className="flex items-center gap-1.5 rounded-lg bg-surface px-3 py-2 text-[clamp(0.5625rem,1.04vh,0.625rem)] font-semibold text-ink hover:bg-surface-muted"
              >
                <Pencil size={13} strokeWidth={2} />
                Edit
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-0.5">
            <p className="text-[clamp(0.4375rem,0.83vh,0.5rem)] font-semibold uppercase tracking-wide text-muted">Booked by</p>
            <p className="text-[clamp(0.625rem,1.15vh,0.6875rem)] font-semibold text-ink">
              {invoice.customer.name || '—'}
              {invoice.customer.phone ? ` · ${invoice.customer.phone}` : ''}
            </p>
          </div>

          <div className="border-t border-border-card" />

          <div className="flex flex-col gap-3">
            <div className="flex gap-4">
              <Field label="Date" value={invoice.dateLabel} />
              <Field label="Time" value={invoice.timeRange ?? '—'} />
            </div>
            <div className="flex gap-4">
              <Field label="Duration" value={invoice.duration} />
              <Field label="Players" value={invoice.customer.players || '—'} />
            </div>
          </div>

          <div className="border-t border-border-card" />

          <div className="flex flex-col gap-2">
            {invoice.items.map((item, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-[clamp(0.625rem,1.15vh,0.6875rem)]">
                <span className="text-muted">{item.label}</span>
                <span className="font-semibold text-ink">{money(item.amount)}</span>
              </div>
            ))}
            <div className="border-t border-dashed border-border-card" />
            <div className="flex items-center justify-between text-[clamp(0.625rem,1.15vh,0.6875rem)]">
              <span className="text-muted">Subtotal</span>
              <span className="font-semibold text-ink">{money(invoice.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-[clamp(0.625rem,1.15vh,0.6875rem)]">
              <span className="text-muted">CGST 9%</span>
              <span className="font-semibold text-ink">{money(invoice.cgst)}</span>
            </div>
            <div className="flex items-center justify-between text-[clamp(0.625rem,1.15vh,0.6875rem)]">
              <span className="text-muted">SGST 9%</span>
              <span className="font-semibold text-ink">{money(invoice.sgst)}</span>
            </div>
          </div>

          <div className="border-t border-border-card" />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-[clamp(0.6875rem,1.25vh,0.75rem)] font-bold text-ink">{draft.payNow ? 'Total' : 'Amount due'}</p>
              <p className="text-[clamp(0.4375rem,0.83vh,0.5rem)] text-muted">{draft.payNow ? 'Charged now' : 'Settle this at the counter'}</p>
            </div>
            <p className={`text-[clamp(0.9375rem,1.67vh,1rem)] font-extrabold ${draft.payNow ? 'text-ink' : 'text-flame'}`}>{money(invoice.total)}</p>
          </div>
        </div>

      </div>

      <div className="flex w-full flex-col gap-[clamp(0.5rem,1.5dvh,1rem)] rounded-2xl bg-white p-[clamp(0.85rem,1.6vw,1.25rem)] lg:w-[340px] lg:shrink-0">
        <p className="text-[clamp(0.95rem,1.3vw,1.125rem)] font-bold text-ink">Choose your payment method</p>

        <div className="flex flex-col gap-[clamp(0.35rem,1dvh,0.625rem)]">
          {METHODS.map((m) => {
            const active = draft.payNow && draft.paymentMethod === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setDraft({ payNow: true, paymentMethod: m.id })}
                className={`flex h-[clamp(2.4rem,5.5dvh,3.5rem)] items-center justify-center rounded-xl text-[clamp(0.875rem,1.1vw,1rem)] font-bold transition-colors ${
                  active ? 'bg-ink text-white' : 'bg-surface text-ink hover:bg-surface-muted'
                }`}
              >
                {m.label}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => setDraft({ payNow: false })}
            className={`flex h-[clamp(2.4rem,5.5dvh,3.5rem)] items-center justify-center rounded-xl text-[clamp(0.875rem,1.1vw,1rem)] font-bold transition-colors ${
              !draft.payNow ? 'bg-lime text-ink' : 'bg-surface text-ink hover:bg-surface-muted'
            }`}
          >
            Pay Later
          </button>
        </div>

        <p className="text-[clamp(0.6875rem,0.9vw,0.75rem)] font-medium text-muted">
          {draft.payNow
            ? 'Payment is recorded immediately against this booking.'
            : 'The booking is created as due and can be settled later at checkout.'}
        </p>

        <button
          type="button"
          disabled={processing || !pricingReady}
          onClick={onPay}
          className="flex h-[clamp(2.4rem,5dvh,3.125rem)] shrink-0 items-center justify-center gap-2 rounded-xl bg-ink text-[clamp(0.6875rem,1.25vh,0.75rem)] font-bold text-white disabled:opacity-50"
        >
          {processing ? (
            'Creating booking…'
          ) : (
            <>
              {draft.payNow ? `Charge ${money(invoice.total)}` : `Check in · ${money(invoice.total)} due`}
              <img src={arrowRight} alt="" className="size-[1.125rem]" />
            </>
          )}
        </button>
      </div>
    </div>
  )
}
