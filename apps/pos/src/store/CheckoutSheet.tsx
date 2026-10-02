import { useEffect, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import {
  useAddEquipmentToBooking,
  useBookingSearch,
  useCourts,
  useRecordPayment,
  type BookingOut,
  type EquipmentItem,
} from '../api/hooks'
import { money, toPaise } from '../lib/format'
import { PAYMENT_METHODS, type PaymentMethodId } from '../lib/paymentMethods'
import { downloadInvoicePdf } from '../lib/invoicePdf'
import { shareOnWhatsApp } from '../lib/share'
import { invoiceSummaryText } from '../booking/invoice'
import {
  addOnKey,
  parseAddOnKey,
  trayTotal as offerTrayTotal,
  type AddOnMode,
  type AddOnUnit,
} from '../booking/offers'
import { buildQuickSaleReceipt } from './receipt'
import { useCurrentIssuer } from '../branch/useCurrentIssuer'
import BookingTicket from '../booking/BookingTicket'

const inputClass =
  'w-full rounded-lg border border-border-input bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none'

type Mode = 'booking' | 'sale'

/** Fold a tray into a booking's existing kit, for the update endpoint — which
 *  replaces the whole list, so anything already billed has to be carried across.
 *
 *  Keyed on the offer (id + rent/buy + single/pack), not the item: a rented racket
 *  and a bought one are two lines at two prices. Lines are matched by
 *  `equipment_id`; older bookings written before that was recorded fall back to
 *  matching the catalogue by name, and return null so the caller bails rather than
 *  silently dropping something the customer has already been charged for.
 *
 *  Name matching is last-resort on purpose — a line's name carries a suffix like
 *  "(pack of 3)", so it will not match the catalogue row it came from. */
function mergeEquipment(existing: BookingOut['equipment'], tray: Record<string, number>, catalog: EquipmentItem[]) {
  const merged = new Map<string, { equipment_id: string; qty: number; mode: AddOnMode; unit: AddOnUnit }>()

  const add = (equipment_id: string, qty: number, mode: AddOnMode, unit: AddOnUnit) => {
    const key = addOnKey(equipment_id, mode, unit)
    const prior = merged.get(key)
    merged.set(key, { equipment_id, qty: (prior?.qty ?? 0) + qty, mode, unit })
  }

  for (const line of existing) {
    const id = line.equipment_id ?? catalog.find((c) => c.name === line.name)?.id
    if (!id) return null
    add(id, line.qty, (line.mode ?? 'rent') as AddOnMode, (line.unit ?? 'single') as AddOnUnit)
  }

  for (const [key, qty] of Object.entries(tray)) {
    if (qty <= 0) continue
    const { id, mode, unit } = parseAddOnKey(key)
    add(id, qty, mode, unit)
  }

  return [...merged.values()]
}

export default function CheckoutSheet({
  tray,
  items,
  onClose,
  onDone,
}: {
  tray: Record<string, number>
  items: EquipmentItem[]
  onClose: () => void
  onDone: () => void
}) {
  const [mode, setMode] = useState<Mode>('booking')
  const [query, setQuery] = useState('')
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [chargeNow, setChargeNow] = useState(false)

  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [payNow, setPayNow] = useState(true)
  const [method, setMethod] = useState<PaymentMethodId>('cash')

  const [success, setSuccess] = useState<{ headline: string; detail: string } | null>(null)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<ReturnType<typeof buildQuickSaleReceipt> | null>(null)

  const trayTotal = offerTrayTotal(tray, items)

  const searchQuery = useBookingSearch(query)
  const courtsQuery = useCourts()
  const issuer = useCurrentIssuer()
  const addEquipment = useAddEquipmentToBooking()
  const recordPayment = useRecordPayment()

  const openGames = searchQuery.data ?? []
  const picked = openGames.find((b) => b.id === pickedId)

  useEffect(() => setMergeError(null), [pickedId])

  const attach = async () => {
    if (!picked) return
    setMergeError(null)
    const merged = mergeEquipment(picked.equipment, tray, items)
    if (!merged) {
      setMergeError("Couldn't match this booking's existing kit to the catalogue — record a payment instead of attaching items.")
      return
    }
    try {
      await addEquipment.mutateAsync({ bookingId: picked.id, equipment: merged })
      if (chargeNow) {
        await recordPayment.mutateAsync({ bookingId: picked.id, amount: trayTotal, method })
      }
      setSuccess({
        headline: `Added to ${courtsQuery.data?.find((c) => c.id === picked.court_id)?.name ?? 'their court'}`,
        detail: `${picked.customer_name} · ${money(trayTotal)} ${chargeNow ? 'charged now' : 'added to their bill'}`,
      })
    } catch (err) {
      setMergeError(err instanceof Error ? err.message : 'Could not update the booking.')
    }
  }

  const phoneOk = /^\d{10}$/.test(phone)

  const openSale = () => {
    if (!phoneOk || !name.trim()) return
    const r = buildQuickSaleReceipt(tray, items, { name: name.trim(), phone, email, customerId }, payNow, issuer)
    setReceipt(r)
    setSuccess({
      headline: 'Counter receipt ready',
      detail: payNow ? `Paid in full · ${money(r.total)}` : `Balance to collect: ${money(r.total)}`,
    })
  }

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex h-[var(--app-height,100dvh)] items-end justify-center bg-black/30 sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full flex-col gap-5 overflow-y-auto rounded-t-2xl bg-white p-6 sm:max-h-[85%] sm:max-w-[480px] sm:rounded-2xl"
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

            {receipt && (
              <div className="flex w-full flex-col gap-3">
                <BookingTicket invoice={receipt} />
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => downloadInvoicePdf(receipt)}
                    className="flex h-10 items-center justify-center rounded-full border border-border-input text-sm text-ink"
                  >
                    Download PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => shareOnWhatsApp(invoiceSummaryText(receipt), receipt.customer.phone)}
                    className="flex h-10 items-center justify-center rounded-full border border-border-input text-sm text-ink"
                  >
                    WhatsApp
                  </button>
                </div>
              </div>
            )}

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

            <p className="text-sm text-slate">Attach this kit to a court in play, or ring it up as a counter sale.</p>

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
                onClick={() => setMode('sale')}
                className={`flex-1 rounded-md py-2 text-sm transition-colors ${mode === 'sale' ? 'bg-white text-ink shadow-sm' : 'text-slate'}`}
              >
                Counter sale
              </button>
            </div>

            {mode === 'booking' ? (
              <div className="flex flex-col gap-3">
                <div className="relative">
                  <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input
                    className={`${inputClass} pl-9`}
                    placeholder="Search name, phone or booking"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  {!searchQuery.isPending && openGames.length === 0 && (
                    <p className="py-4 text-center text-sm text-muted">No open bookings match.</p>
                  )}
                  {openGames.map((b) => (
                    <BookingRow
                      key={b.id}
                      booking={b}
                      courtName={courtsQuery.data?.find((c) => c.id === b.court_id)?.name}
                      active={pickedId === b.id}
                      onClick={() => setPickedId(b.id)}
                    />
                  ))}
                </div>

                {mergeError && (
                  <p role="alert" className="text-xs text-negative">
                    {mergeError}
                  </p>
                )}

                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={chargeNow} onChange={(e) => setChargeNow(e.target.checked)} className="size-4 accent-black" />
                  Charge {money(trayTotal)} now instead of adding it to their bill
                </label>

                <button
                  type="button"
                  disabled={!picked || addEquipment.isPending || recordPayment.isPending}
                  onClick={attach}
                  className="flex h-11 w-full items-center justify-center rounded-full text-sm text-[#fefefe] disabled:opacity-40"
                  style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
                >
                  {addEquipment.isPending || recordPayment.isPending ? 'Updating…' : `Add ${money(trayTotal)} to their bill`}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="rounded-lg bg-surface-muted px-3.5 py-2.5 text-xs text-slate">
                  No court on this sale — it&apos;s a local counter receipt, not stored against a booking.
                </p>

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
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium text-slate">Name</span>
                  <input className={inputClass} placeholder="Customer's name" value={name} onChange={(e) => setName(e.target.value)} />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate">Email (optional)</span>
                    <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-medium text-slate">Customer ID (optional)</span>
                    <input className={inputClass} value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_METHODS.slice(0, 3).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMethod(m.id)}
                      className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                        method === m.id ? 'border-ink bg-surface-muted text-ink' : 'border-border-card text-slate'
                      }`}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>

                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} className="size-4 accent-black" />
                  Paying right now
                </label>

                <div className="flex items-center justify-between border-t border-border-card pt-3 text-sm">
                  <span className="text-slate">Total (incl. GST)</span>
                  <span className="font-semibold text-ink">{money(toPaise(trayTotal * 1.18))}</span>
                </div>

                <button
                  type="button"
                  disabled={!phoneOk || !name.trim()}
                  onClick={openSale}
                  className="flex h-11 w-full items-center justify-center rounded-full text-sm text-[#fefefe] disabled:opacity-40"
                  style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
                >
                  {payNow ? `Charge ${money(toPaise(trayTotal * 1.18))}` : 'Print receipt · pay later'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function BookingRow({
  booking,
  courtName,
  active,
  onClick,
}: {
  booking: BookingOut
  courtName?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-left transition-colors ${
        active ? 'border-ink bg-surface-muted' : 'border-border-card bg-white hover:border-ink/30'
      }`}
    >
      <div>
        <p className="text-sm font-medium text-ink">{booking.customer_name}</p>
        <p className="text-xs text-muted">
          {courtName ?? 'Court'} · {booking.customer_phone}
        </p>
      </div>
      {active && <Check size={16} className="text-ink" />}
    </button>
  )
}
