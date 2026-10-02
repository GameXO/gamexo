import { Download, Mail, MessageCircle } from 'lucide-react'
import { emptyDraft } from '../../booking/types'
import { buildConfirmedInvoice, invoiceSummaryText } from '../../booking/invoice'
import BookingTicket from '../../booking/BookingTicket'
import { downloadInvoicePdf } from '../../lib/invoicePdf'
import { shareByEmail, shareOnWhatsApp } from '../../lib/share'
import { money } from '../../lib/format'
import SuccessGraphic from '../../checkin/SuccessGraphic'
import HomeCountdownButton from '../../ui/HomeCountdown'
import type { CheckoutBooking } from '../useCheckout'
import { usePosBusinessName, type InvoiceOut } from '../../api/hooks'

export default function Settled({
  booking,
  invoice,
  amount,
  method,
  onHome,
}: {
  booking: CheckoutBooking
  invoice?: InvoiceOut
  amount: number
  method: 'upi' | 'cash'
  onHome: () => void
}) {
  const invoiceData = buildConfirmedInvoice(booking, emptyDraft(), invoice, usePosBusinessName())
  const summary = invoiceSummaryText(invoiceData)

  return (
    <div className="flex w-full max-w-[480px] flex-col items-center gap-[clamp(1.25rem,2.5vw,1.75rem)]">
      <div
        className="flex flex-col items-center gap-1.5 text-center"
        style={{ animation: 'slide-in-right 0.55s cubic-bezier(0.16,1,0.3,1) both' }}
      >
        <SuccessGraphic className="w-full max-w-[140px]" />
        <p className="font-display text-[clamp(1.25rem,2vw,1.5rem)] font-bold text-ink">Payment settled</p>
        <p className="text-[clamp(0.9375rem,1.2vw,1.0625rem)] font-semibold text-muted">
          {money(amount)} via {method === 'upi' ? 'UPI' : 'Cash'}
        </p>
      </div>

      <div id="invoice-print-area" className="w-full" style={{ animation: 'fade-in-up 0.5s ease-out 0.35s both' }}>
        <BookingTicket invoice={invoiceData} />
      </div>

      <div className="grid w-full grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => downloadInvoicePdf(invoiceData)}
          className="flex items-center justify-center gap-2 rounded-xl bg-surface-muted py-[clamp(0.875rem,1.6vw,1.125rem)] text-[clamp(0.9375rem,1.1vw,1rem)] font-bold text-ink"
        >
          <Download size={17} strokeWidth={2} />
          PDF
        </button>
        <button
          type="button"
          onClick={() => shareOnWhatsApp(summary, booking.customer_phone ?? '')}
          className="flex items-center justify-center gap-2 rounded-xl bg-surface-muted py-[clamp(0.875rem,1.6vw,1.125rem)] text-[clamp(0.9375rem,1.1vw,1rem)] font-bold text-ink"
        >
          <MessageCircle size={17} strokeWidth={2} />
          WhatsApp
        </button>
      </div>

      <button
        type="button"
        onClick={() => shareByEmail(`Invoice — ${invoiceData.facility.name}`, summary)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-surface-muted py-[clamp(0.875rem,1.6vw,1.125rem)] text-[clamp(0.9375rem,1.1vw,1rem)] font-bold text-ink"
      >
        <Mail size={17} strokeWidth={2} />
        Email invoice
      </button>

      <HomeCountdownButton onHome={onHome} />
    </div>
  )
}
