import { ChevronRight } from 'lucide-react'
import { stockStatus, useUpdateInventoryItem, type InventoryItem } from '../api/hooks'
import { money } from '../data/booking'
import Toggle from '../manage/Toggle'
import { itemCode } from './helpers'

const STATUS_LABEL = { 'in-stock': 'In Stock', 'low-stock': 'Low Stock', 'out-of-stock': 'Out of Stock' } as const
const STATUS_DOT = { 'in-stock': 'bg-positive', 'low-stock': 'bg-flame', 'out-of-stock': 'bg-negative' } as const

export default function InventoryTable({
  items,
  sportName,
  selectedIds,
  onToggleSelect,
  onSelectItem,
}: {
  items: InventoryItem[]
  sportName: (id: string | null) => string
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onSelectItem: (id: string) => void
}) {
  const update = useUpdateInventoryItem()

  return (
    <div className="overflow-hidden rounded-xl border border-border-card bg-white">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border-card text-xs uppercase tracking-wide text-muted">
            <th className="w-10 px-4 py-3">
              <span className="sr-only">Select</span>
            </th>
            <th className="px-4 py-3 font-medium">Item ID</th>
            <th className="px-4 py-3 font-medium">Item</th>
            <th className="px-4 py-3 font-medium">Sport</th>
            <th className="px-4 py-3 font-medium">Price</th>
            <th className="px-4 py-3 font-medium">Stock</th>
            <th className="px-4 py-3 font-medium">Published</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="w-10 px-4 py-3">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const status = stockStatus(item)
            return (
              <tr
                key={item.id}
                onClick={() => onSelectItem(item.id)}
                className="cursor-pointer border-b border-border-card last:border-0 hover:bg-surface-muted"
              >
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => onToggleSelect(item.id)}
                    className="size-4 accent-black"
                  />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{itemCode(item.id)}</td>
                <td className="px-4 py-3 font-medium text-ink">{item.name}</td>
                <td className="px-4 py-3 text-slate">{sportName(item.sportId)}</td>
                <td className="px-4 py-3 text-slate">{money(item.price)}</td>
                <td className="px-4 py-3 text-slate">{item.qtyAvailable} in stock</td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2.5">
                    <Toggle
                      checked={item.publishedToPos}
                      disabled={update.isPending && update.variables?.id === item.id}
                      onChange={() => update.mutate({ id: item.id, patch: { publishedToPos: !item.publishedToPos } })}
                    />
                    <span className={`text-xs font-medium ${item.publishedToPos ? 'text-positive' : 'text-muted'}`}>
                      {item.publishedToPos ? 'Live in POS' : 'Hidden'}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                    <span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
                    {STATUS_LABEL[status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted">
                  <ChevronRight size={16} />
                </td>
              </tr>
            )
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan={9} className="px-4 py-10 text-center text-sm text-muted">
                No items match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
