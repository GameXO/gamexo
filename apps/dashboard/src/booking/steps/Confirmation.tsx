import { useState } from 'react'
import { Check, Download, Mail, MessageCircle, Printer, RotateCcw, Send } from 'lucide-react'
import type { Draft } from '../../data/booking'
import type { BookingQuote } from '../../api/hooks'
import { buildInvoice, invoiceSummaryText } from '../invoice'
import { downloadInvoicePdf } from '../../lib/invoicePdf'
import { shareOnWhatsApp } from '../../lib/share'
import BookingTicket from '../BookingTicket'

function ActionButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Download
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 items-center justify-center gap-2 rounded-full border border-border-input bg-white px-4 text-sm font-medium text-ink hover:bg-surface-muted"
    >
      <Icon size={15} />
      {label}
    </button>
  )
}

export default function Confirmation({
  draft,
  bookingId,
  quote,
  onDone,
  onBookAnother,
}: {
  draft: Draft
  bookingId: string
  quote?: BookingQuote | null
  onDone: () => void
  onBookAnother: () => void
}) {
  const invoice = buildInvoice(draft, { bookingId, quote })
  const [email, setEmail] = useState(draft.customer.email || '')
  const [queued, setQueued] = useState(false)

  const sendEmail = () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) return
    setQueued(true)
  }

  return (
    <div className="flex w-full max-w-[860px] flex-col items-center gap-6 py-10">
      <div className="flex size-14 items-center justify-center rounded-full bg-lime">
        <Check size={26} className="text-lime-ink" />
      </div>

      <div className="flex flex-col items-center gap-1.5 text-center">
        <p className="font-display text-2xl font-semibold text-ink">Court is yours</p>
        <p className="text-sm text-slate">
          {invoice.sport?.name} · {invoice.court?.name} · {invoice.dateLabel}
          {invoice.timeRange ? `, ${invoice.timeRange}` : ''}
        </p>
      </div>

      <span className="rounded-full bg-ink px-4 py-1.5 font-mono text-sm font-semibold text-white">{bookingId}</span>

      <div className="flex w-full flex-col gap-5 lg:flex-row lg:items-start">
        <div id="invoice-print-area" className="w-full lg:max-w-[380px] lg:shrink-0">
          <BookingTicket invoice={invoice} />
        </div>

        <div className="flex w-full flex-1 flex-col gap-4">
          <button
            type="button"
            onClick={onDone}
            className="flex h-14 w-full items-center justify-center rounded-full text-white shadow-[0px_4px_10px_0px_rgba(0,0,0,0.05),0px_10px_120px_0px_rgba(15,73,106,0.1)]"
            style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
          >
            <span className="text-sm font-medium">Done</span>
          </button>

          <div className="grid w-full grid-cols-2 gap-3">
            <ActionButton icon={Download} label="Invoice PDF" onClick={() => downloadInvoicePdf(invoice)} />
            <ActionButton
              icon={MessageCircle}
              label="WhatsApp"
              onClick={() => shareOnWhatsApp(invoiceSummaryText(invoice))}
            />
            <ActionButton icon={Printer} label="Print" onClick={() => window.print()} />
            <ActionButton icon={RotateCcw} label="Book another" onClick={onBookAnother} />
          </div>

          <div className="flex w-full flex-col gap-2.5 rounded-xl bg-white p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Email the invoice</p>
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setQueued(false)
                }}
                placeholder="name@example.com"
                className="flex-1 rounded-lg border border-border-input bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none"
              />
              <button
                type="button"
                onClick={sendEmail}
                disabled={queued}
                className="flex shrink-0 items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {queued ? <Mail size={15} /> : <Send size={15} />}
                {queued ? 'Queued' : 'Send PDF'}
              </button>
            </div>
            <p className="text-xs text-muted">
              {queued
                ? "Offline — the invoice is on this device. It'll send once you have a connection."
                : 'Offline-friendly: your invoice queues here and sends once you have a connection.'}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 rounded-xl border border-dashed border-border-input px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Before you come</p>
            <ul className="flex flex-col gap-1.5 text-sm text-slate">
              <li>Show this booking ID at the desk — no printout needed.</li>
              <li>Settle the amount due at the counter before or after play.</li>
              <li>Equipment is handed over at the counter and returned after play.</li>
              {invoice.timeRange && (
                <li>Cancel free up to 4 hours before {invoice.timeRange.split('–')[0].trim()}.</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
