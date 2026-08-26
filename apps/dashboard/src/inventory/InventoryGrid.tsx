import { ShoppingBag } from 'lucide-react'
import { stockStatus, useUpdateInventoryItem, type InventoryItem } from '../api/hooks'
import { money } from '../data/booking'
import Toggle from '../manage/Toggle'

export default function InventoryGrid({
  items,
  sportName,
  onSelectItem,
}: {
  items: InventoryItem[]
  sportName: (id: string | null) => string
  onSelectItem: (id: string) => void
}) {
  const update = useUpdateInventoryItem()

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border-card bg-white px-4 py-10 text-center text-sm text-muted">
        No items match these filters.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => {
        const status = stockStatus(item)
        return (
          <div
            key={item.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelectItem(item.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectItem(item.id)
              }
            }}
            className="flex cursor-pointer flex-col items-start gap-3 rounded-xl border border-border-card bg-surface p-4 text-left transition-colors hover:border-ink/25"
          >
            <div className="flex w-full items-start justify-between gap-2">
              <div className="flex size-10 items-center justify-center overflow-hidden rounded-full bg-surface-muted text-ink">
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" className="size-full object-cover" />
                ) : (
                  <ShoppingBag size={18} strokeWidth={1.75} />
                )}
              </div>
              <div onClick={(e) => e.stopPropagation()} title={item.publishedToPos ? 'Live in POS' : 'Hidden from POS'}>
                <Toggle
                  checked={item.publishedToPos}
                  disabled={update.isPending && update.variables?.id === item.id}
                  onChange={() => update.mutate({ id: item.id, patch: { publishedToPos: !item.publishedToPos } })}
                />
              </div>
            </div>

            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold text-ink">{item.name}</p>
              <p className="text-xs text-muted">{sportName(item.sportId)}</p>
            </div>

            <div className="flex w-full items-center justify-between border-t border-border-card pt-2.5">
              <span className="text-sm font-medium text-positive">{money(item.price)}</span>
              {status === 'in-stock' ? (
                <span className="text-xs text-muted">{item.qtyAvailable} left</span>
              ) : (
                <span className={`text-xs font-medium ${status === 'out-of-stock' ? 'text-negative' : 'text-flame'}`}>
                  {status === 'out-of-stock' ? 'Out of stock' : `Low stock (${item.qtyAvailable})`}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
