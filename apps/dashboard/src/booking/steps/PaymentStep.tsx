import { money, type Draft } from '../../data/booking'
import type { BookingQuote } from '../../api/hooks'
import { buildInvoice } from '../invoice'
import { downloadInvoicePdf } from '../../lib/invoicePdf'
import InvoiceDocument from '../InvoiceDocument'
import BookingTicket from '../BookingTicket'
import { STEPS } from '../Stepper'

export default function PaymentStep({
  draft,
  processing,
  quote,
  quoteLoading,
  error,
  onPay,
  onEditStep,
}: {
  draft: Draft
  processing: boolean
  quote?: BookingQuote | null
  quoteLoading?: boolean
  error?: string | null
  onPay: () => void
  onEditStep: (step: number) => void
}) {
  const invoice = buildInvoice(draft, { quote })

  return (
    <div className="flex w-full flex-col gap-5 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <InvoiceDocument invoice={invoice} onDownloadPdf={() => downloadInvoicePdf(invoice)} />
      </div>

      <div className="flex w-full flex-col gap-4 lg:w-[380px] lg:shrink-0">
        <BookingTicket invoice={invoice} />

        <div className="flex w-full flex-col gap-1 rounded-2xl bg-white p-4">
          {STEPS.map((label, i) => {
            const step = i + 1
            const done = step < 5
            return (
              <button
                key={label}
                type="button"
                onClick={() => onEditStep(step)}
                className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-surface-muted"
              >
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    done ? 'bg-lime text-lime-ink' : 'bg-ink text-white'
                  }`}
                >
                  {step}
                </span>
                <span className="text-sm text-ink">{label}</span>
              </button>
            )
          })}
        </div>

        {error && (
          <p role="alert" className="rounded-2xl border border-negative/30 bg-negative/5 px-4 py-3 text-sm text-negative">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onEditStep(1)}
            className="flex h-12 shrink-0 items-center justify-center rounded-xl border border-border-input bg-white px-6 text-sm font-medium text-ink"
          >
            Edit
          </button>
          <button
            type="button"
            // Confirming against an unpriced draft would bill a number nobody has
            // seen, so the button waits for the quote.
            disabled={processing || quoteLoading}
            onClick={onPay}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-ink text-sm font-bold text-white disabled:opacity-70"
          >
            {processing
              ? 'Creating booking…'
              : quoteLoading
                ? 'Pricing…'
                : `Create booking · ${money(invoice.total)}`}
          </button>
        </div>
        <p className="text-center text-[11px] text-muted">
          The booking is created as a due payment and can be settled later from the active court checkout.
        </p>
      </div>
    </div>
  )
}
