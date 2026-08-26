import { useState } from 'react'
import {
  X,
  Users,
  Banknote,
  CreditCard,
  Smartphone,
  LogIn,
  LogOut,
  Clock,
  FileText,
  ArrowLeft,
} from 'lucide-react'
import {
  balanceOf,
  courtById,
  equipmentLines,
  money,
  type Booking,
  type Equipment,
} from '../data/booking'
import type { OutstandingTab } from '../api/hooks'
import { bookingWindow } from './derive'
import { formatClock } from './slots'

const PAY_ICONS = { upi: Smartphone, card: CreditCard, cash: Banknote } as const

/** A court booking, or a counter tab — which is an invoice with no booking behind
 *  it. The two differ in more than shape: a tab has free-text lines rather than
 *  equipment ids, and nothing to check in, finish or extend. */
type Subject = { kind: 'booking'; booking: Booking } | { kind: 'tab'; tab: OutstandingTab }

export default function CourtPanel({
  subject,
  onClose,
  onIssueKit,
  onSettle,
  onCheckIn,
  onFinish,
  onExtend,
  canExtend,
  kitOptions,
  remainingStock,
}: {
  subject: Subject
  onClose: () => void
  onIssueKit: (itemId: string) => void
  onSettle: (method: string) => void
  onCheckIn: () => void
  onFinish: () => void
  onExtend: () => void
  canExtend: boolean
  kitOptions: Equipment[]
  remainingStock: Record<string, number>
}) {
  const [showInvoice, setShowInvoice] = useState(false)

  const isBooking = subject.kind === 'booking'
  const booking = isBooking ? subject.booking : null
  const tab = !isBooking ? subject.tab : null
  const court = booking ? courtById(booking.courtId) : null

  const balance = booking ? balanceOf(booking) : tab!.balance
  // A booking's kit resolves through the catalogue by id; a tab's lines are
  // already priced text on the invoice and need no lookup.
  const kitLines = booking
    ? equipmentLines(booking.equipment, booking.hours)
    : tab!.items.map((line) => ({
        id: line.description,
        name: line.description,
        qty: line.qty,
        amount: line.amount,
      }))
  const customerName = booking ? booking.customer.name : tab!.customerName

  // One money shape for both subjects, so the receipt markup below does not have
  // to branch on which kind it is rendering.
  const totals = booking
    ? {
        equipmentTotal: booking.equipmentTotal,
        gst: booking.gst,
        total: booking.total,
        paidTotal: booking.paidTotal,
      }
    : {
        equipmentTotal: tab!.subtotal,
        gst: tab!.gst,
        total: tab!.total,
        paidTotal: tab!.amountPaid,
      }

  return (
    <>
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30"
      />
      <div className="fixed inset-y-0 right-0 z-50 flex h-screen w-full max-w-[420px] flex-col overflow-y-auto bg-page shadow-2xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-border-soft px-5 py-4">
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="truncate text-base font-semibold text-ink">{customerName}</p>
            <p className="text-xs text-slate">
              {booking && court
                ? `${court.name} · ${formatClock(bookingWindow(booking).start)}–${formatClock(bookingWindow(booking).end)}`
                : 'Counter tab'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border-input bg-white"
          >
            <X size={16} className="text-ink" />
          </button>
        </div>

        {showInvoice ? (
          <div className="flex flex-1 flex-col gap-4 p-5">
            <button
              type="button"
              onClick={() => setShowInvoice(false)}
              className="flex w-fit items-center gap-1.5 text-sm font-medium text-slate"
            >
              <ArrowLeft size={15} /> Back to details
            </button>
            <div className="flex flex-col gap-4 rounded-xl border border-border-card bg-surface p-5">
              <div>
                <p className="text-lg font-semibold text-ink">Invoice</p>
                <p className="text-xs text-slate">
                  {customerName}
                  {court ? ` · ${court.name}` : ''}
                </p>
              </div>
              <div className="flex flex-col gap-2 border-t border-dashed border-border-card pt-4 text-sm">
                {booking && (
                  <div className="flex justify-between text-slate">
                    <span>Court time</span>
                    <span className="text-ink">{money(booking.slotTotal)}</span>
                  </div>
                )}
                {kitLines.map((l) => (
                  <div key={l.id} className="flex justify-between text-slate">
                    <span>{l.name} × {l.qty}</span>
                    <span className="text-ink">{money(l.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-slate">
                  <span>GST (18%)</span>
                  <span className="text-ink">{money(totals.gst)}</span>
                </div>
              </div>
              <div className="flex justify-between border-t border-border-card pt-3 text-base font-semibold text-ink">
                <span>Total</span>
                <span>{money(totals.total)}</span>
              </div>
              <div className="flex justify-between text-sm text-slate">
                <span>Paid</span>
                <span>{money(totals.paidTotal)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold">
                <span className={balance > 0 ? 'text-negative' : 'text-positive'}>Balance</span>
                <span className={balance > 0 ? 'text-negative' : 'text-positive'}>{money(balance)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-5 p-5">
            {booking && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1.5 text-xs font-medium text-ink">
                  <Users size={13} /> {booking.customer.players || '-'} players
                </span>
              </div>
            )}

            <div className="flex flex-col gap-3 rounded-xl border border-border-card bg-surface p-4">
              <p className="text-sm font-semibold text-ink">Kit issued</p>
              {kitLines.length === 0 ? (
                <p className="text-xs text-slate">Nothing issued yet.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {kitLines.map((l) => (
                    <div key={l.id} className="flex justify-between text-sm text-ink">
                      <span>{l.name} × {l.qty}</span>
                      <span className="text-slate">{money(l.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-2">
                {kitOptions.map((item) => {
                  const remaining = remainingStock[item.id] ?? 0
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={remaining <= 0}
                      onClick={() => onIssueKit(item.id)}
                      className="rounded-lg border border-border-input bg-white px-2.5 py-1.5 text-xs font-medium text-ink disabled:opacity-30"
                    >
                      + {item.name}
                      <span className="ml-1 text-[10px] text-muted">({remaining})</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-border-card bg-surface p-4 text-sm">
              <p className="mb-1 text-sm font-semibold text-ink">Bill</p>
              {booking && (
                <div className="flex justify-between text-slate">
                  <span>Court time</span>
                  <span className="text-ink">{money(booking.slotTotal)}</span>
                </div>
              )}
              {totals.equipmentTotal > 0 && (
                <div className="flex justify-between text-slate">
                  <span>Kit</span>
                  <span className="text-ink">{money(totals.equipmentTotal)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate">
                <span>GST (18%)</span>
                <span className="text-ink">{money(totals.gst)}</span>
              </div>
              <div className="flex justify-between border-t border-border-card pt-2 font-semibold text-ink">
                <span>Total</span>
                <span>{money(totals.total)}</span>
              </div>
              {balance > 0 ? (
                <>
                  <div className="flex justify-between text-negative">
                    <span className="font-medium">Balance due</span>
                    <span className="font-semibold">{money(balance)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(['cash', 'upi', 'card'] as const).map((method) => {
                      const Icon = PAY_ICONS[method]
                      return (
                        <button
                          key={method}
                          type="button"
                          onClick={() => onSettle(method)}
                          className="flex flex-col items-center gap-1 rounded-lg border border-border-input bg-white py-2.5 text-xs font-medium capitalize text-ink"
                        >
                          <Icon size={16} />
                          {method}
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : (
                <p className="text-xs font-medium text-positive">Fully settled</p>
              )}
            </div>

            {booking && (
              <div className="flex gap-2">
                {booking.status === 'confirmed' && (
                  <button
                    type="button"
                    onClick={onCheckIn}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-lime px-3 py-2.5 text-sm font-semibold text-lime-ink"
                  >
                    <LogIn size={15} /> Check In
                  </button>
                )}
                {booking.status === 'checked-in' && (
                  <button
                    type="button"
                    onClick={onFinish}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-input bg-white px-3 py-2.5 text-sm font-semibold text-ink"
                  >
                    <LogOut size={15} /> Finish
                  </button>
                )}
                <button
                  type="button"
                  disabled={!canExtend}
                  onClick={onExtend}
                  title={canExtend ? undefined : 'Next hour is already booked on this court'}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-input bg-white px-3 py-2.5 text-sm font-semibold text-ink disabled:opacity-40"
                >
                  <Clock size={15} /> +1 hr
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowInvoice(true)}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-border-input bg-white px-3 py-2.5 text-sm font-medium text-ink"
            >
              <FileText size={15} /> View invoice
            </button>
          </div>
        )}
      </div>
    </>
  )
}
