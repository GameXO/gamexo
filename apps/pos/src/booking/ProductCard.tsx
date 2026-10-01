import { ImageOff } from 'lucide-react'
import { money } from '../lib/format'
import type { Offer } from './offers'
import { asset } from '../lib/asset'

const addIcon = asset('pos/shop/add.svg')
const removeIcon = asset('pos/shop/remove.svg')

/** One tile per offer (Rent / Buy / Pack), shared by the dedicated Add-Ons step and
 *  the Payment step's upsell rail — same catalogue, same stock rules, same card. */
export default function ProductCard({
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
      aria-label={qty === 0 ? `Add ${item.name}` : undefined}
      onClick={() => !active && !soldOut && onAdd()}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !active && !soldOut) {
          e.preventDefault()
          onAdd()
        }
      }}
      className={`flex aspect-square w-full flex-col items-stretch gap-2.5 border-4 bg-surface p-[clamp(0.625rem,1.2vw,0.875rem)] text-left transition-colors ${
        active ? 'border-lime' : 'border-transparent'
      } ${soldOut ? 'cursor-not-allowed opacity-50' : !active ? 'cursor-pointer' : ''}`}
    >
      <div className="relative w-full flex-1 overflow-hidden">
        {item.imageUrl ? (
          <img src={item.imageUrl} alt="" className="size-full object-contain" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 bg-surface-muted text-muted">
            <ImageOff size={18} strokeWidth={1.5} />
            <span className="text-[11px] font-medium">No image</span>
          </div>
        )}

        {active && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-1.5 right-1.5 flex items-center gap-1.5 rounded-lg bg-[#202020] px-2 py-1.5 shadow-[0px_8px_11px_-6px_rgba(0,0,0,0.12)]"
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

      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-[clamp(0.8125rem,1vw,0.9375rem)] font-bold leading-tight text-ink">
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
        <p className="text-[clamp(0.75rem,0.9vw,0.8125rem)] font-medium text-muted">
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
