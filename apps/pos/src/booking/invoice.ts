import { FACILITY_PROFILE } from '../facility/facilityData'
import { dayLabel, formalDate, hour12, money, toISO, toPaise } from '../lib/format'
import type { BookingDetail, Court, InvoiceOut, QuoteOut, Sport } from '../api/hooks'
import type { Draft } from './types'

export type InvoiceLine = { label: string; detail: string; amount: number }

export type InvoiceData = {
  facility: typeof FACILITY_PROFILE
  invoiceNo: string | null
  bookingId: string | null
  /** `XCB0042` — what the customer is asked for at the counter. Null until the
   *  booking is actually created, since the number is allocated server-side. */
  bookingRef: string | null
  confirmed: boolean
  sportName: string
  courtName: string
  date: string
  dateLabel: string
  formalDate: string
  timeRange: string | null
  duration: string
  customer: { name: string; phone: string; email: string; customerId: string; players: string }
  items: InvoiceLine[]
  subtotal: number
  discount: number
  gst: number
  cgst: number
  sgst: number
  total: number
  amountPaid: number
  balanceDue: number
  paymentMethod: string | null
}

function splitGst(gst: number) {
  // toPaise, not Math.round. Rounding to whole rupees split ₹334.80 into ₹167 and
  // ₹167.80 — two halves of one tax that are not equal, on a document a customer
  // may hand to an accountant. Halving at paise precision keeps them equal, and
  // deriving sgst by subtraction keeps the pair summing to gst exactly.
  const cgst = toPaise(gst / 2)
  return { cgst, sgst: toPaise(gst - cgst) }
}

/** Provisional invoice for the wizard's Payment step — priced by the server (`/bookings/quote`)
 *  so what the counter sees is exactly what Create Booking will charge, peak rates included. */
export function buildProvisionalInvoice(
  draft: Draft,
  sport: Sport | undefined,
  court: Court | undefined,
  quote: QuoteOut | undefined,
): InvoiceData {
  const date = draft.date || toISO(new Date())
  const timeRange = draft.startHour != null ? `${hour12(draft.startHour)} – ${hour12(draft.startHour + draft.hours)}` : null

  const courtCharge = quote ? Number(quote.court_charge) : (court?.price || 0) * draft.hours
  const equipmentCharge = quote ? Number(quote.equipment_charge) : 0
  const discount = quote ? Number(quote.discount) : 0
  const gst = quote ? Number(quote.taxes) : 0
  const { cgst, sgst } = splitGst(gst)
  const total = quote ? Number(quote.total) : courtCharge + equipmentCharge - discount

  const items: InvoiceLine[] = [
    ...(court
      ? [{ label: `${court.name} — court hire`, detail: `${draft.hours} hr`, amount: courtCharge }]
      : []),
    ...(quote?.equipment ?? []).map((l) => ({ label: l.name, detail: `× ${l.qty}`, amount: l.qty * Number(l.rate) })),
  ]

  return {
    facility: FACILITY_PROFILE,
    invoiceNo: null,
    bookingId: null,
    bookingRef: null,
    confirmed: false,
    sportName: sport?.name ?? '',
    courtName: court?.name ?? '',
    date,
    dateLabel: dayLabel(date),
    formalDate: formalDate(date),
    timeRange,
    duration: `${draft.hours} hr`,
    customer: draft.customer,
    items,
    subtotal: courtCharge + equipmentCharge - discount,
    discount,
    gst,
    cgst,
    sgst,
    total,
    amountPaid: 0,
    balanceDue: total,
    paymentMethod: null,
  }
}

/** Final invoice, built from the server's own booking + (optional) formal invoice record —
 *  every number on it is what actually landed in the database. */
export function buildConfirmedInvoice(booking: BookingDetail, draft: Draft, invoice?: InvoiceOut): InvoiceData {
  const starts = new Date(booking.starts_at)
  const date = toISO(starts)
  const startHour = starts.getHours()
  const hours = booking.duration_min / 60

  const courtCharge = Number(booking.court_charge)
  const equipmentCharge = Number(booking.equipment_charge)
  const discount = Number(booking.discount)
  const gst = Number(booking.taxes)
  const { cgst, sgst } = splitGst(gst)

  const items: InvoiceLine[] = [
    { label: `${booking.court_name || 'Court'} — court hire`, detail: `${hours} hr`, amount: courtCharge },
    ...booking.equipment.map((l) => ({ label: l.name, detail: `× ${l.qty}`, amount: l.qty * Number(l.rate) })),
  ]

  return {
    facility: FACILITY_PROFILE,
    invoiceNo: invoice?.invoice_no ?? null,
    bookingId: booking.id,
    bookingRef: booking.reference,
    confirmed: true,
    sportName: booking.sport_name ?? '',
    courtName: booking.court_name ?? '',
    date,
    dateLabel: dayLabel(date),
    formalDate: formalDate(date),
    timeRange: `${hour12(startHour)} – ${hour12(startHour + hours)}`,
    duration: `${hours} hr`,
    customer: {
      name: booking.customer_name || draft.customer.name,
      phone: booking.customer_phone || draft.customer.phone,
      email: draft.customer.email,
      customerId: draft.customer.customerId,
      players: draft.customer.players,
    },
    items,
    subtotal: courtCharge + equipmentCharge - discount,
    discount,
    gst,
    cgst,
    sgst,
    total: Number(booking.total),
    amountPaid: Number(booking.amount_paid),
    balanceDue: Number(booking.balance_due),
    paymentMethod: booking.payment_method,
  }
}

export function invoiceSummaryText(inv: InvoiceData) {
  const lines = [
    inv.facility.name,
    inv.bookingRef ? `Booking ${inv.bookingRef}${inv.invoiceNo ? ` · Invoice ${inv.invoiceNo}` : ''}` : 'Provisional invoice',
    `${inv.sportName} · ${inv.courtName}`,
    `${inv.dateLabel}${inv.timeRange ? `, ${inv.timeRange}` : ''}`,
    '',
    ...inv.items.map((i) => `${i.label} — ${money(i.amount)}`),
    '',
    `Subtotal: ${money(inv.subtotal)}`,
    `CGST 9%: ${money(inv.cgst)}`,
    `SGST 9%: ${money(inv.sgst)}`,
    `Total: ${money(inv.total)}`,
    inv.confirmed ? `${inv.balanceDue > 0 ? `Balance due: ${money(inv.balanceDue)}` : 'Paid in full'}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}
