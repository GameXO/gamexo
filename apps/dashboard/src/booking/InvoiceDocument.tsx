import { ArrowLeft, Download } from 'lucide-react'
import { money } from '../data/booking'
import type { InvoiceData } from './invoice'

export default function InvoiceDocument({
  invoice,
  onBack,
  onDownloadPdf,
}: {
  invoice: InvoiceData
  onBack?: () => void
  onDownloadPdf: () => void
}) {
  const confirmed = Boolean(invoice.bookingId)

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex w-full items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-slate hover:text-ink"
            >
              <ArrowLeft size={15} />
              Back
            </button>
          )}
          <p className="font-display text-3xl font-semibold text-ink">Invoice</p>
          <p className="text-sm text-slate">{confirmed ? 'Due at the counter' : 'Provisional until confirmed'}</p>
        </div>

        <button
          type="button"
          onClick={onDownloadPdf}
          className="flex shrink-0 items-center gap-2 rounded-full border border-border-input bg-white px-4 py-2.5 text-sm font-medium text-ink shadow-[0px_1px_2px_0px_rgba(82,88,102,0.09)] hover:bg-surface-muted"
        >
          <Download size={15} />
          PDF
        </button>
      </div>

      <div className="flex w-full flex-col gap-6 rounded-2xl bg-white p-6 font-mono sm:p-8">
        <div className="flex w-full items-start justify-between gap-4">
          <div>
            <p className="font-sans text-lg font-semibold text-ink">{invoice.facility.name}</p>
            <p className="mt-1 text-xs text-slate">{invoice.facility.addressLine}</p>
            <p className="text-xs text-slate">{invoice.facility.pincode}</p>
            <p className="text-xs text-slate">GSTIN {invoice.facility.gstin}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-flame">
              {confirmed ? 'Due' : 'Provisional'}
            </p>
            <p className="mt-1 text-xs text-slate">{invoice.formalDate}</p>
          </div>
        </div>

        <div className="border-t border-dashed border-border-card" />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted">Billed to</p>
            <p className="mt-1 text-sm text-ink">{invoice.customer.name || '—'}</p>
            <p className="text-xs text-slate">{invoice.customer.phone ? `+91 ${invoice.customer.phone}` : '—'}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted">Playing</p>
            <p className="mt-1 text-sm text-ink">
              {invoice.dateLabel}
              {invoice.timeRange ? `, ${invoice.timeRange}` : ''}
            </p>
            <p className="text-xs text-slate">
              {invoice.court?.name} · {invoice.court?.surface}
            </p>
          </div>
        </div>

        <div className="border-t border-dashed border-border-card" />

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted">
            <span>Item</span>
            <span>Amount</span>
          </div>
          {invoice.items.map((item, i) => (
            <div key={i} className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-ink">{item.label}</p>
                <p className="text-xs text-muted">{item.detail}</p>
              </div>
              <p className="shrink-0 text-sm text-ink">{money(item.amount)}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-dashed border-border-card" />

        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between text-ink">
            <span className="text-slate">Subtotal</span>
            <span>{money(invoice.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between text-ink">
            <span className="text-slate">CGST 9%</span>
            <span>{money(invoice.cgst)}</span>
          </div>
          <div className="flex items-center justify-between text-ink">
            <span className="text-slate">SGST 9%</span>
            <span>{money(invoice.sgst)}</span>
          </div>
        </div>

        <div className="border-t border-border-card" />

        <div className="flex items-center justify-between">
          <p className="font-sans text-base text-ink">Grand total</p>
          <p className="font-sans text-2xl font-semibold text-ink">{money(invoice.total)}</p>
        </div>

        <p className="text-xs leading-relaxed text-muted">
          Cancel free up to 4 hours before the slot. Equipment is issued at the counter against this invoice and
          returned at the end of play.
        </p>
      </div>
    </div>
  )
}
