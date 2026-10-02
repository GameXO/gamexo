import { sourceLabel, type Issuer } from '../branch/issuer'
import { formalDate, toISO, toPaise } from '../lib/format'
import type { EquipmentItem } from '../api/hooks'
import type { InvoiceData } from '../booking/invoice'
import { trayLines } from '../booking/offers'

/** A kit-only sale has no court and no backing booking — the API has nowhere to store an
 *  anonymous sale yet, so this stays a local counter receipt (same limitation the admin
 *  dashboard's own "Sales" screen has today). Attaching kit to a booking in play, by
 *  contrast, goes through the real API — see CheckoutSheet's other tab. */
export function buildQuickSaleReceipt(
  tray: Record<string, number>,
  items: EquipmentItem[],
  customer: { name: string; phone: string; email: string; customerId: string },
  paidNow: boolean,
  issuer: Issuer,
): InvoiceData {
  // Priced through the shared offer helper so the receipt cannot disagree with the
  // price the shop card showed — a pack of three is one line at the pack price,
  // not three singles.
  const lines = trayLines(tray, items).map((l) => ({
    label: l.label,
    detail: `× ${l.qty}`,
    amount: l.amount,
  }))
  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0)
  // toPaise, not Math.round — the same rule as booking/invoice.ts. Rounding to
  // whole rupees here made the counter receipt disagree with the amount actually
  // taken, and split an odd GST figure into two halves that did not add back up.
  const gst = toPaise(subtotal * 0.18)
  const cgst = toPaise(gst / 2)
  const total = subtotal + gst
  const today = toISO(new Date())

  return {
    facility: issuer,
    source: sourceLabel('counter'),
    invoiceNo: null,
    bookingId: null,
    // A shop sale with no court behind it, so there is no booking to reference.
    bookingRef: null,
    confirmed: true,
    sportName: '',
    courtName: '',
    date: today,
    dateLabel: 'Today',
    formalDate: formalDate(today),
    timeRange: null,
    duration: '',
    customer: { ...customer, players: '' },
    items: lines,
    subtotal,
    discount: 0,
    gst,
    cgst,
    sgst: gst - cgst,
    total,
    amountPaid: paidNow ? total : 0,
    balanceDue: paidNow ? 0 : total,
    paymentMethod: null,
  }
}
