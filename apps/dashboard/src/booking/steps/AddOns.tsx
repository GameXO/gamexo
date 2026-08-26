import { Minus, Package, Plus } from 'lucide-react'
import { equipmentForSport, money, priceEquipment, type Draft } from '../../data/booking'
import { offersFor, unitsClaimed } from '../../addons/offers'
import * as db from '../../lib/db'

export default function AddOns({ draft, setDraft }: { draft: Draft; setDraft: (patch: Partial<Draft>) => void }) {
  db.useDbVersion()
  const items = equipmentForSport(draft.sportId || '')
  const offers = items.flatMap(offersFor)

  const setQty = (key: string, qty: number, max: number) => {
    const next = { ...draft.equipment }
    if (qty > 0) next[key] = Math.min(qty, max)
    else delete next[key]
    setDraft({ equipment: next })
  }

  const drawnFrom = (itemId: string) => unitsClaimed(offers, draft.equipment, itemId)

  const trayCount = Object.values(draft.equipment).reduce((a, b) => a + b, 0)
  // Rentals are per hour, so the tray total depends on the slot the customer picked.
  const trayTotal = priceEquipment(draft.equipment, draft.hours).equipmentTotal

  return (
    <div className="flex w-full flex-col gap-5">
      <p className="text-xl text-ink">Need any kit?</p>

      {items.length === 0 ? (
        <p className="text-sm text-muted">No equipment configured for sale yet.</p>
      ) : (
        <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {offers.map((offer) => {
            const { item } = offer
            const qty = draft.equipment[offer.key] || 0
            const active = qty > 0
            // What this offer could still take, given what its siblings hold.
            const headroom = Math.floor((item.stock - drawnFrom(item.id)) / offer.draws)
            const max = qty + Math.max(0, headroom)
            const soldOut = max <= 0
            const atLimit = qty >= max

            const addFirst = () => {
              if (qty === 0 && !soldOut) setQty(offer.key, 1, max)
            }

            return (
              <div
                key={offer.key}
                role="button"
                tabIndex={soldOut ? -1 : 0}
                aria-disabled={soldOut}
                aria-label={qty === 0 ? `Add ${item.name} (${offer.label})` : undefined}
                onClick={addFirst}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    addFirst()
                  }
                }}
                className={`group relative flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                  active ? 'border-ink bg-lime/10 shadow-sm' : 'border-border-card bg-surface hover:border-ink/25'
                } ${soldOut ? 'cursor-not-allowed opacity-50' : qty === 0 ? 'cursor-pointer' : ''}`}
              >
                {active && (
                  <span className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-lime text-xs font-semibold text-lime-ink shadow-[0px_2px_6px_rgba(0,0,0,0.15)]">
                    {qty}
                  </span>
                )}

                <div
                  className={`flex size-10 items-center justify-center rounded-full transition-colors ${
                    active ? 'bg-lime text-lime-ink' : 'bg-surface-muted text-ink'
                  }`}
                >
                  <Package size={18} strokeWidth={1.75} />
                </div>

                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-ink">{item.name}</p>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        offer.mode === 'rent' ? 'bg-surface-muted text-slate' : 'bg-lime/30 text-lime-ink'
                      }`}
                    >
                      {offer.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {offer.mode === 'rent' && item.deposit
                      ? `${item.hint} · ${money(item.deposit)} deposit`
                      : item.hint}
                  </p>
                </div>

                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-medium text-positive">
                    {money(offer.price)}
                    {offer.perHour && <span className="text-xs text-muted">/hr</span>}
                  </span>

                  {active ? (
                    <span
                      role="group"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-2.5 rounded-full bg-ink px-1.5 py-1 text-bone"
                    >
                      <button
                        type="button"
                        aria-label={`Remove one ${item.name} (${offer.label})`}
                        onClick={() => setQty(offer.key, qty - 1, max)}
                        className="flex size-5 items-center justify-center"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="w-3 text-center text-xs">{qty}</span>
                      <button
                        type="button"
                        aria-label={`Add one more ${item.name} (${offer.label})`}
                        disabled={atLimit}
                        onClick={() => setQty(offer.key, qty + 1, max)}
                        className="flex size-5 items-center justify-center disabled:opacity-40"
                      >
                        <Plus size={12} />
                      </button>
                    </span>
                  ) : (
                    <span className={`text-xs ${soldOut ? 'text-negative' : max <= 5 ? 'text-flame' : 'text-muted'}`}>
                      {soldOut ? 'Sold out' : offer.unit === 'pack' ? `${max} packs left` : `${max} left`}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {trayCount > 0 && (
        <div className="flex w-full items-center justify-between rounded-xl bg-white p-4">
          <p className="text-sm text-slate">
            {trayCount} item{trayCount > 1 ? 's' : ''} added
          </p>
          <p className="text-base font-semibold text-ink">{money(trayTotal)}</p>
        </div>
      )}
    </div>
  )
}
