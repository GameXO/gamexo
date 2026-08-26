import { Wallet } from 'lucide-react'
import { money } from '../data/booking'
import type { InvoiceData } from './invoice'

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 text-sm text-ink">{value}</p>
    </div>
  )
}

export default function BookingTicket({ invoice, className = '' }: { invoice: InvoiceData; className?: string }) {
  const confirmed = Boolean(invoice.bookingId)

  return (
    <div className={`flex w-full flex-col gap-5 rounded-2xl bg-white p-6 font-mono ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted">{invoice.facility.name}</p>
          <p className="font-sans text-xl font-semibold text-ink">
            {invoice.sport?.name} · {invoice.court?.name}
          </p>
          {confirmed && (
            <p className="mt-1 text-xs text-slate">
              Booking {invoice.bookingId} · <span className="font-medium text-flame">Due</span>
            </p>
          )}
        </div>
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border-input text-slate">
          <Wallet size={17} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Date" value={invoice.dateLabel} />
        <Field label="Time" value={invoice.timeRange ?? '—'} />
        <Field label="Duration" value={invoice.duration} />
        <Field label="Players" value={invoice.customer.players || '—'} />
      </div>

      <Field
        label="Booked by"
        value={`${invoice.customer.name || '—'}${invoice.customer.phone ? ` · ${invoice.customer.phone}` : ''}`}
      />

      <div className="flex items-center gap-1 overflow-hidden">
        {Array.from({ length: 30 }).map((_, i) => (
          <span key={i} className="size-1 shrink-0 rounded-full bg-border-card" />
        ))}
      </div>

      <div className="flex flex-col gap-2 text-sm">
        {invoice.items.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-ink">
            <span className="text-slate">{item.label}</span>
            <span>{money(item.amount)}</span>
          </div>
        ))}
        <div className="border-t border-border-card pt-2">
          <div className="flex items-center justify-between text-ink">
            <span className="text-slate">Subtotal</span>
            <span>{money(invoice.subtotal)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-ink">
            <span className="text-slate">GST 18%</span>
            <span>{money(invoice.gst)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border-card pt-3">
        <p className="font-sans text-base text-ink">{confirmed ? 'Amount due' : 'Total'}</p>
        <p className={`font-sans text-lg font-semibold ${confirmed ? 'text-flame' : 'text-ink'}`}>
          {money(invoice.total)}
        </p>
      </div>
      {confirmed && <p className="-mt-2 text-right text-[11px] text-muted">Settle this at the counter</p>}
    </div>
  )
}
