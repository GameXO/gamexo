import { Download } from 'lucide-react'
import { money } from '../lib/format'
import type { InvoiceData } from './invoice'

export default function InvoiceDocument({
  invoice,
  onDownloadPdf,
}: {
  invoice: InvoiceData
  onDownloadPdf: () => void
}) {
  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex w-full items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-display text-3xl font-semibold text-ink">Invoice</p>
          <p className="text-sm text-slate">
            {invoice.confirmed
              ? invoice.balanceDue > 0
                ? 'Balance due at the counter'
                : 'Paid in full'
              : 'Provisional until confirmed'}
          </p>
        </div>

        <button
          type="button"
          onClick={onDownloadPdf}
          className="flex shrink-0 items-center gap-2 rounded-xl bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-muted"
        >
          <Download size={15} strokeWidth={2} />
          PDF
        </button>
      </div>

      <div className="flex w-full flex-col gap-6 rounded-2xl bg-white p-6 font-mono sm:p-8">
        <div className="flex w-full items-start justify-between gap-4">
          <div>
            <p className="font-sans text-lg font-semibold text-ink">{invoice.facility.name}</p>
            {invoice.facility.branchName && (
              <p className="mt-0.5 text-xs font-medium text-ink">{invoice.facility.branchName}</p>
            )}
            {invoice.facility.addressLine && (
              <p className="mt-1 text-xs text-slate">{invoice.facility.addressLine}</p>
            )}
            {invoice.facility.phone && <p className="text-xs text-slate">{invoice.facility.phone}</p>}
            {invoice.facility.gstin && <p className="text-xs text-slate">GSTIN {invoice.facility.gstin}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-flame">
              {invoice.confirmed ? (invoice.balanceDue > 0 ? 'Due' : 'Paid') : 'Provisional'}
            </p>
            <p className="mt-1 text-xs text-slate">{invoice.formalDate}</p>
            {invoice.source && <p className="text-xs text-slate">Source: {invoice.source}</p>}
            {invoice.bookingId && (
              <p className="text-xs text-slate">
                {invoice.invoiceNo ?? invoice.bookingRef}
              </p>
            )}
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
              {invoice.sportName} · {invoice.courtName}
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
          {invoice.discount > 0 && (
            <div className="flex items-center justify-between text-ink">
              <span className="text-slate">Discount</span>
              <span>−{money(invoice.discount)}</span>
            </div>
          )}
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

        {invoice.confirmed && invoice.balanceDue > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-flame/10 px-3.5 py-2.5 text-sm">
            <span className="text-flame">Balance due</span>
            <span className="font-semibold text-flame">{money(invoice.balanceDue)}</span>
          </div>
        )}

        <p className="text-xs leading-relaxed text-muted">
          Cancel free up to 4 hours before the slot. Equipment is issued at the counter against this invoice and
          returned at the end of play.
        </p>
      </div>
    </div>
  )
}
