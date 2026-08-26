import { FACILITY_PROFILE } from '../facility/facilityData'
import { courtById, hour12, money, priceDraft, sportById, toISO, toPaise, type Draft } from '../data/booking'
import type { BookingQuote } from '../api/hooks'

/** Today / Tomorrow / "Wed, 12 Aug" — matches the relative-day chips used elsewhere in booking. */
export function dayLabel(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** "01 Aug 2026" — the formal date used on the printed/PDF invoice header. */
export function formalDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const num = (v: string | number | null | undefined) => Number(v ?? 0)

/**
 * `quote` is the server's price for this draft. When it is present the invoice
 * bills from it, because peak and weekend rating happen in the backend and the
 * UI's own `priceDraft` cannot reproduce them — showing a total the API would not
 * charge is worse than showing one a moment later. Without it (the quote is still
 * in flight, or the caller has no reason to fetch one) the local estimate stands
 * in, and the numbers agree for any court on a flat rate.
 */
export function buildInvoice(
  draft: Draft,
  opts: { bookingId?: string | null; quote?: BookingQuote | null } = {},
) {
  const court = draft.courtId ? courtById(draft.courtId) : null
  const sport = draft.sportId ? sportById(draft.sportId) : null
  const local = priceDraft(draft)
  const quote = opts.quote ?? null

  const slotTotal = quote ? num(quote.court_charge) : local.slotTotal
  const subtotal = quote
    ? num(quote.court_charge) + num(quote.equipment_charge) - num(quote.discount)
    : local.subtotal
  const gst = quote ? num(quote.taxes) : local.gst
  const total = quote ? num(quote.total) : local.total

  // GST is a flat 18% in the pricing model; split evenly into CGST/SGST for the
  // invoice line items. Halved at paise precision — rounding to rupees turned
  // ₹334.80 into ₹167 + ₹167.80, two unequal halves of one tax.
  const cgst = toPaise(gst / 2)
  const sgst = toPaise(gst - cgst)
  const date = draft.date || toISO(new Date())
  const timeRange =
    draft.startHour != null ? `${hour12(draft.startHour)} – ${hour12(draft.startHour + draft.hours)}` : null

  // The rate the server actually applied, when it told us — that is what makes a
  // peak-hour line read honestly instead of quoting the court's base price.
  const hourlyRate = quote ? num(quote.rate_applied) : (court?.price ?? 0)
  const equipmentLines = quote
    ? (quote.equipment ?? []).map((l) => ({
        label: l.name,
        detail: `× ${l.qty}`,
        amount: num(l.rate) * l.qty,
      }))
    : local.lines.map((l) => ({ label: l.name, detail: `× ${l.qty}`, amount: l.amount }))

  const items = [
    ...(court || quote
      ? [
          {
            label: `${court?.name ?? 'Court'} — court hire`,
            detail: `${money(hourlyRate)} × ${draft.hours} hr`,
            amount: slotTotal,
          },
        ]
      : []),
    ...equipmentLines,
  ]

  return {
    facility: FACILITY_PROFILE,
    bookingId: opts.bookingId ?? null,
    court,
    sport,
    date,
    dateLabel: dayLabel(date),
    formalDate: formalDate(date),
    timeRange,
    duration: `${draft.hours} hr`,
    customer: draft.customer,
    items,
    subtotal,
    gst,
    cgst,
    sgst,
    total,
    /** True while the server's price is still pending, so callers can hold off on
     *  presenting the local estimate as final. */
    provisional: quote === null,
  }
}

export type InvoiceData = ReturnType<typeof buildInvoice>

export function invoiceSummaryText(inv: InvoiceData) {
  const lines = [
    inv.facility.name,
    inv.bookingId ? `Booking ${inv.bookingId} · Confirmed` : 'Provisional invoice',
    `${inv.sport?.name ?? ''} · ${inv.court?.name ?? ''}`,
    `${inv.dateLabel}${inv.timeRange ? `, ${inv.timeRange}` : ''}`,
    '',
    ...inv.items.map((i) => `${i.label} — ${money(i.amount)}`),
    '',
    `Subtotal: ${money(inv.subtotal)}`,
    `CGST 9%: ${money(inv.cgst)}`,
    `SGST 9%: ${money(inv.sgst)}`,
    `Total: ${money(inv.total)}`,
  ]
  return lines.join('\n')
}
