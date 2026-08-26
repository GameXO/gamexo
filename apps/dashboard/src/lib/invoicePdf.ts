import { jsPDF } from 'jspdf'
import { money } from '../data/booking'
import type { InvoiceData } from '../booking/invoice'

const LEFT = 48
const RIGHT = 548

export function downloadInvoicePdf(inv: InvoiceData) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  let y = 56

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(inv.facility.name, LEFT, y)
  y += 18

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(100)
  doc.text(`${inv.facility.addressLine}, ${inv.facility.pincode}`, LEFT, y)
  y += 14
  doc.text(`GSTIN ${inv.facility.gstin}`, LEFT, y)
  y += 26

  doc.setTextColor(0)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(inv.bookingId ? `Invoice — ${inv.bookingId}` : 'Provisional Invoice', LEFT, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(inv.formalDate, RIGHT, y, { align: 'right' })
  y += 28

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text('BILLED TO', LEFT, y)
  doc.text('PLAYING', 320, y)
  y += 14

  doc.setTextColor(0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(inv.customer.name || '-', LEFT, y)
  doc.text(`${inv.sport?.name ?? ''} · ${inv.court?.name ?? ''}`, 320, y)
  y += 14
  doc.text(inv.customer.phone ? `+91 ${inv.customer.phone}` : '-', LEFT, y)
  doc.text(`${inv.dateLabel}${inv.timeRange ? `, ${inv.timeRange}` : ''}`, 320, y)
  y += 26

  doc.setDrawColor(220)
  doc.line(LEFT, y, RIGHT, y)
  y += 18

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text('ITEM', LEFT, y)
  doc.text('AMOUNT', RIGHT, y, { align: 'right' })
  y += 12
  doc.line(LEFT, y, RIGHT, y)
  y += 16

  doc.setTextColor(0)
  for (const item of inv.items) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(item.label, LEFT, y)
    doc.text(money(item.amount), RIGHT, y, { align: 'right' })
    y += 13
    doc.setFontSize(8)
    doc.setTextColor(140)
    doc.text(item.detail, LEFT, y)
    doc.setTextColor(0)
    y += 16
  }

  y += 4
  doc.setDrawColor(220)
  doc.line(LEFT, y, RIGHT, y)
  y += 20

  const row = (label: string, value: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(bold ? 12 : 10)
    doc.text(label, LEFT, y)
    doc.text(value, RIGHT, y, { align: 'right' })
    y += bold ? 20 : 15
  }
  row('Subtotal', money(inv.subtotal))
  row('CGST 9%', money(inv.cgst))
  row('SGST 9%', money(inv.sgst))
  y += 4
  doc.line(LEFT, y, RIGHT, y)
  y += 18
  row('Grand total', money(inv.total), true)

  y += 22
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(140)
  doc.text(
    'Cancel free up to 4 hours before the slot. Equipment is issued at the counter against this invoice and returned at the end of play.',
    LEFT,
    y,
    { maxWidth: RIGHT - LEFT },
  )

  doc.save(`${inv.bookingId || 'invoice'}.pdf`)
}
