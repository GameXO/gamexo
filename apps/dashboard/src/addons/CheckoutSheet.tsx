import { useEffect, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { courtById, listEquipment, money, priceEquipment, type Booking } from '../data/booking'
import { useAttachKitToBooking, useOpenCounterTab, useTodaysBookings } from '../api/hooks'
import { ApiError } from '../api/client'
import * as db from '../lib/db'

const inputClass =
  'w-full rounded-lg border border-border-input bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none'

type Mode = 'booking' | 'new'

function defaultDueBack() {
  return new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16)
}

/** Returnable gear opens a rental — deposit and due-back date — which is tracked
 *  locally because the API has no rental model yet; the deposit is a refundable
 *  hold, not revenue, so it is deliberately not part of the invoice.
 *
 *  Stock is NOT deducted here any more. Both checkout paths now issue through the
 *  API's movement ledger, and doing it in both places would count every item twice. */
function openRentals(tray: Record<string, number>, customer: { name: string; phone: string }, dueBackAt: string) {
  const items = listEquipment()
  let depositTotal = 0
  for (const [id, qty] of Object.entries(tray)) {
    const item = items.find((e) => e.id === id)
    if (!item?.returnable) continue
    db.issueRental({
      itemId: id,
      qty,
      deposit: (item.deposit || 0) * qty,
      customer,
      issuedAt: new Date().toISOString(),
      dueBackAt: new Date(dueBackAt).toISOString(),
    })
    depositTotal += (item.deposit || 0) * qty
  }
  return depositTotal
}

export default function CheckoutSheet({
  tray,
  onClose,
  onDone,
}: {
  tray: Record<string, number>
  onClose: () => void
  onDone: () => void
}) {
  db.useDbVersion()
  const [mode, setMode] = useState<Mode>('booking')
  const [query, setQuery] = useState('')
  const [pickedId, setPickedId] = useState<string | null>(null)

  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [payingNow, setPayingNow] = useState(true)
  const [dueBackAt, setDueBackAt] = useState(defaultDueBack)

  const [success, setSuccess] = useState<{ headline: string; detail: string } | null>(null)

  const totals = priceEquipment(tray)
  const equipmentList = listEquipment()
  const rentalLines = Object.entries(tray).filter(([id]) => equipmentList.find((e) => e.id === id)?.returnable)
  const depositDue = rentalLines.reduce((sum, [id, qty]) => sum + (equipmentList.find((e) => e.id === id)?.deposit || 0) * qty, 0)

  const bookingsQuery = useTodaysBookings()
  const attachKit = useAttachKitToBooking()
  const openTabMutation = useOpenCounterTab()
  const [error, setError] = useState<string | null>(null)

  const openGames = (bookingsQuery.data ?? [])
    .filter((b) => b.status !== 'completed')
    .filter((b) => {
      const q = query.trim().toLowerCase()
      if (!q) return true
      const court = courtById(b.courtId)
      return b.customer.name.toLowerCase().includes(q) || b.customer.phone.includes(q) || court?.name.toLowerCase().includes(q)
    })
    .slice(0, 6)

  const picked = openGames.find((b) => b.id === pickedId) ?? null

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Could not reach the server. Nothing was charged.')

  const attach = () => {
    if (!picked) return
    setError(null)
    attachKit
      .mutateAsync({ bookingId: picked.id, existing: picked.equipment, add: tray })
      .then(() => {
        const deposit = openRentals(tray, { name: picked.customer.name, phone: picked.customer.phone }, dueBackAt)
        setSuccess({
          headline: `Added to ${courtById(picked.courtId)?.name ?? 'the booking'}`,
          detail:
            `${picked.customer.name} · billed to the booking` +
            (deposit > 0 ? ` · ${money(deposit)} deposit collected` : ''),
        })
      })
      .catch(fail)
  }

  const phoneOk = /^\d{10}$/.test(phone)
  const existing = phoneOk ? db.findCustomer(phone) : undefined

  // A phone number we've seen before fills in the name — nothing typed twice.
  useEffect(() => {
    if (!phoneOk) return
    const match = db.findCustomer(phone)
    if (match) setName(match.name)
  }, [phone, phoneOk])

  const openTab = () => {
    if (!phoneOk || !name.trim()) return
    setError(null)
    const customerName = name.trim()

    openTabMutation
      .mutateAsync({
        customerName,
        tray,
        // The invoice carries priced text, so the description is what the customer
        // reads on it — not an id they would have to look up.
        lines: totals.lines.map((l) => ({
          description: l.name,
          qty: l.qty,
          rate: l.qty > 0 ? l.amount / l.qty : l.amount,
          amount: l.amount,
        })),
        payNow: payingNow,
        method: 'upi',
        notes: `Counter sale · ${phone}`,
      })
      .then((invoice) => {
        db.upsertCustomer({ name: customerName, phone, email: existing?.email || '' })
        const deposit = openRentals(tray, { name: customerName, phone }, dueBackAt)
        setSuccess({
          headline: `Tab opened · ${invoice.invoice_no}`,
          detail:
            (payingNow ? 'Paid in full.' : `Balance to collect: ${money(totals.total)}`) +
            (deposit > 0 ? ` · ${money(deposit)} deposit collected` : ''),
        })
      })
      .catch(fail)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full flex-col gap-5 overflow-y-auto rounded-t-2xl bg-white p-6 sm:max-w-[480px] sm:rounded-2xl"
      >
        {success ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-lime">
              <Check size={24} className="text-lime-ink" />
            </div>
            <div>
              <p className="text-lg font-semibold text-ink">{success.headline}</p>
              <p className="mt-1 text-sm text-slate">{success.detail}</p>
            </div>
            <button
              type="button"
              onClick={onDone}
              className="flex h-11 items-center justify-center rounded-full px-8 text-sm text-[#fefefe]"
              style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold text-ink">Checkout</p>
              <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-slate">There is no anonymous sale — every tray lands on a bill or a tab.</p>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-negative/30 bg-negative/5 px-3.5 py-2.5 text-sm text-negative"
              >
                {error}
              </p>
            )}

            {rentalLines.length > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-flame/10 px-3.5 py-2.5">
                <label className="flex flex-1 items-center gap-2 text-xs text-flame">
                  Return by
                  <input
                    type="datetime-local"
                    value={dueBackAt}
                    onChange={(e) => setDueBackAt(e.target.value)}
                    className="rounded-md border border-flame/30 bg-white px-2 py-1 text-xs text-ink"
                  />
                </label>
                <span className="shrink-0 text-xs font-medium text-flame">{money(depositDue)} deposit</span>
              </div>
            )}

            <div className="flex items-center gap-1 rounded-lg bg-surface-muted p-1">
              <button
                type="button"
                onClick={() => setMode('booking')}
                className={`flex-1 rounded-md py-2 text-sm transition-colors ${mode === 'booking' ? 'bg-white text-ink shadow-sm' : 'text-slate'}`}
              >
                A game in play
              </button>
              <button
                type="button"
                onClick={() => setMode('new')}
                className={`flex-1 rounded-md py-2 text-sm transition-colors ${mode === 'new' ? 'bg-white text-ink shadow-sm' : 'text-slate'}`}
              >
                New customer
              </button>
            </div>

            {mode === 'booking' ? (
              <div className="flex flex-col gap-3">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    className={`${inputClass} pl-9`}
                    placeholder="Search name, phone or court"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  {openGames.length === 0 && <p className="py-4 text-center text-sm text-muted">No open games match.</p>}
                  {openGames.map((b) => (
                    <BookingRow key={b.id} booking={b} active={pickedId === b.id} onClick={() => setPickedId(b.id)} />
                  ))}
                </div>

                <button
                  type="button"
                  disabled={!picked}
                  onClick={attach}
                  className="flex h-11 w-full items-center justify-center rounded-full text-sm text-[#fefefe] disabled:opacity-40"
                  style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
                >
                  Add {money(totals.total)} to their bill
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-slate">Phone number</span>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">+91</span>
                    <input
                      className={`${inputClass} pl-11`}
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="90000 00000"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    />
                  </div>
                  {existing && <span className="text-xs text-positive">Welcome back, {existing.name.split(' ')[0]}.</span>}
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-slate">Name</span>
                  <input
                    className={inputClass}
                    placeholder="Customer's name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>

                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={payingNow} onChange={(e) => setPayingNow(e.target.checked)} className="size-4 accent-black" />
                  Paying right now
                </label>

                <div className="flex items-center justify-between border-t border-border-card pt-3 text-sm">
                  <span className="text-slate">Total</span>
                  <span className="font-semibold text-ink">{money(totals.total)}</span>
                </div>

                <button
                  type="button"
                  disabled={!phoneOk || !(name.trim() || existing)}
                  onClick={openTab}
                  className="flex h-11 w-full items-center justify-center rounded-full text-sm text-[#fefefe] disabled:opacity-40"
                  style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
                >
                  {payingNow ? `Charge ${money(totals.total)}` : 'Open tab'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function BookingRow({ booking, active, onClick }: { booking: Booking; active: boolean; onClick: () => void }) {
  const court = courtById(booking.courtId)
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-left transition-colors ${
        active ? 'border-ink bg-surface-muted' : 'border-border-card bg-white hover:border-ink/30'
      }`}
    >
      <div>
        <p className="text-sm font-medium text-ink">{booking.customer.name}</p>
        <p className="text-xs text-muted">
          {court?.name} · {booking.customer.phone}
        </p>
      </div>
      {active && <Check size={16} className="text-ink" />}
    </button>
  )
}
