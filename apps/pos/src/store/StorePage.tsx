import { useState } from 'react'
import { ImageOff, ShoppingCart } from 'lucide-react'
import { useEquipment } from '../api/hooks'
import { money } from '../lib/format'
import { offersFor, unitsClaimed, type Offer } from '../booking/offers'
import { TopBar } from '../ui/TopBar'
import { CheckinFooter } from '../checkin/Chrome'
import CheckoutSheet from './CheckoutSheet'
import { asset } from '../lib/asset'

const addIcon = asset('pos/shop/add.svg')
const removeIcon = asset('pos/shop/remove.svg')

function ProductCard({
  offer,
  qty,
  max,
  onAdd,
  onQty,
}: {
  offer: Offer
  qty: number
  /** What this offer can still take, given what its siblings hold. */
  max: number
  onAdd: () => void
  onQty: (qty: number) => void
}) {
  const { item } = offer
  const soldOut = max <= 0
  const active = qty > 0
  const atLimit = qty >= max

  return (
    <div
      role="button"
      tabIndex={soldOut ? -1 : 0}
      aria-disabled={soldOut}
      onClick={() => !active && !soldOut && onAdd()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !active && !soldOut) {
          e.preventDefault()
          onAdd()
        }
      }}
      className={`flex aspect-square w-full flex-col items-stretch gap-[clamp(0.75rem,1.5vw,1rem)] border-4 bg-surface p-[clamp(0.75rem,1.4vw,1rem)] text-left transition-colors ${
        active ? 'border-lime' : 'border-transparent'
      } ${soldOut ? 'cursor-not-allowed opacity-50' : !active ? 'cursor-pointer' : ''}`}
    >
      <div className="relative w-full flex-1 overflow-hidden">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" className="size-full object-contain" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1.5 bg-surface-muted text-muted">
            <ImageOff size={22} strokeWidth={1.5} />
            <span className="text-xs font-medium">No image</span>
          </div>
        )}

        {active && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-lg bg-[#202020] px-2 py-1.5 shadow-[0px_8px_11px_-6px_rgba(0,0,0,0.12)]"
          >
            <button
              type="button"
              aria-label={`Remove one ${item.name}`}
              onClick={() => onQty(qty - 1)}
              className="flex size-4 items-center justify-center text-white"
            >
              <img src={removeIcon} alt="" className="size-full" />
            </button>
            <span className="w-3 text-center text-[11px] font-semibold text-white">{qty}</span>
            <button
              type="button"
              aria-label={`Add one more ${item.name}`}
              disabled={atLimit}
              onClick={() => onQty(qty + 1)}
              className="flex size-4 items-center justify-center text-white disabled:opacity-40"
            >
              <img src={addIcon} alt="" className="size-full" />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col items-start gap-0.5">
        <div className="flex w-full items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-[clamp(0.9375rem,1.3vw,1.125rem)] font-bold text-ink">
            {item.name}
          </p>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
              offer.mode === 'rent' ? 'bg-surface-muted text-muted' : 'bg-lime/30 text-ink'
            }`}
          >
            {offer.label}
          </span>
        </div>
        <p className="text-[clamp(0.8125rem,1vw,0.875rem)] font-medium text-muted">
          {soldOut ? (
            'Sold out'
          ) : (
            <>
              {money(offer.price)}
              {offer.perHour && <span className="text-[0.9em]">/hr</span>}
            </>
          )}
        </p>
      </div>
    </div>
  )
}

export default function StorePage({ onHome }: { onHome: () => void }) {
  const equipmentQuery = useEquipment()
  const items = equipmentQuery.data ?? []
  const categories = ['All', ...new Set(items.map((i) => i.category).filter(Boolean))]
  const [category, setCategory] = useState('All')
  const [tray, setTray] = useState<Record<string, number>>({})
  const [checkoutOpen, setCheckoutOpen] = useState(false)

  // One card per offer: a shuttlecock is Rent / Buy / Pack of 6, three prices.
  const offers = items.flatMap(offersFor)
  const shown = category === 'All' ? offers : offers.filter((o) => o.item.category === category)

  /** Offers of one item share a stock pool — a pack of six leaves six fewer to rent. */
  const headroomFor = (offer: Offer) => {
    const qty = tray[offer.key] || 0
    const spare = Math.floor((offer.item.stock - unitsClaimed(offers, tray, offer.item.id)) / offer.draws)
    return qty + Math.max(0, spare)
  }

  const setQty = (id: string, qty: number, max: number) => {
    setTray((t) => {
      const next = { ...t }
      if (qty > 0) next[id] = Math.min(qty, max)
      else delete next[id]
      return next
    })
  }

  const trayCount = Object.values(tray).reduce((a, qty) => a + qty, 0)
  const clearTray = () => setTray({})

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <TopBar centerTitle="Shop" onLogoClick={onHome} />

      {/* Filters sit outside the scroll region so they stay put while the shelf moves. */}
      {items.length > 0 && (
        <div className="flex w-full shrink-0 flex-wrap gap-[clamp(0.5rem,1.2vw,0.75rem)] px-[clamp(1.25rem,3vw,3rem)] pb-[clamp(0.5rem,1.4dvh,1rem)]">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`flex h-[clamp(2.25rem,4.5vw,3.25rem)] min-w-[85px] items-center justify-center rounded-xl px-[clamp(1rem,1.6vw,1.125rem)] text-[clamp(0.875rem,1vw,1rem)] font-semibold transition-colors ${
                category === c ? 'bg-ink text-white' : 'bg-surface text-ink hover:bg-surface-muted'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto px-[clamp(1.25rem,3vw,3rem)] pb-[clamp(0.75rem,2dvh,1.5rem)]">
        {equipmentQuery.isPending ? (
          <p className="text-sm text-muted">Loading inventory…</p>
        ) : equipmentQuery.error ? (
          <p role="alert" className="text-sm text-negative">
            Could not load equipment: {equipmentQuery.error instanceof Error ? equipmentQuery.error.message : 'unknown error'}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">No equipment configured for sale yet.</p>
        ) : (
          <div
            /* auto-fill in landscape, so the shelf re-flows with however much width there is.
               In portrait the tablet is narrow enough that auto-fill was cramming 5 tiny
               columns in — pin it to 3 there instead, letting each card grow to fill the row. */
            className="grid grid-cols-[repeat(auto-fill,minmax(clamp(8.5rem,15vw,12rem),1fr))] gap-[clamp(0.75rem,1.6vw,1rem)] portrait:grid-cols-3"
          >
            {shown.map((offer) => {
              const max = headroomFor(offer)
              return (
                <ProductCard
                  key={offer.key}
                  offer={offer}
                  qty={tray[offer.key] || 0}
                  max={max}
                  onAdd={() => setQty(offer.key, 1, max)}
                  onQty={(qty) => setQty(offer.key, qty, max)}
                />
              )
            })}
          </div>
        )}
      </main>

      <CheckinFooter
        onBack={onHome}
        onHome={onHome}
        rightExtra={
          <button
            type="button"
            disabled={trayCount === 0}
            onClick={() => setCheckoutOpen(true)}
            className="flex items-center gap-2.5 rounded-xl bg-ink py-1.5 pl-1.5 pr-4 text-[clamp(0.9375rem,1vw,1rem)] font-semibold text-white transition-opacity disabled:opacity-40"
          >
            <span className="flex items-center gap-1.5 rounded-lg bg-lime px-2 py-1.5 text-ink">
              <ShoppingCart size={18} strokeWidth={2} />
              {trayCount}
            </span>
            Continue
          </button>
        }
      />

      {checkoutOpen && (
        <CheckoutSheet
          tray={tray}
          items={items}
          onClose={() => setCheckoutOpen(false)}
          onDone={() => {
            clearTray()
            setCheckoutOpen(false)
          }}
        />
      )}
    </div>
  )
}
