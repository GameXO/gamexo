import { ChevronRight } from '../ui/icons'
import { Table, TableMessage, Tbody, Td, Th, Thead, Tr } from '../ui/Table'
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
    <Table>
      <Thead>
        <Tr>
          <Th className="w-10">
            <span className="sr-only">Select</span>
          </Th>
          <Th>Item ID</Th>
          <Th>Item</Th>
          <Th>Sport</Th>
          <Th>Price</Th>
          <Th>Stock</Th>
          <Th>Published</Th>
          <Th>Status</Th>
          <Th className="w-10">
            <span className="sr-only">Open</span>
          </Th>
        </Tr>
      </Thead>
      <Tbody>
        {items.map((item) => {
          const status = stockStatus(item)
          return (
            <Tr key={item.id} onClick={() => onSelectItem(item.id)}>
              <Td onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.id)}
                  onChange={() => onToggleSelect(item.id)}
                  className="size-4 accent-black"
                />
              </Td>
              <Td className="font-mono text-xs text-muted">{itemCode(item.id)}</Td>
              <Td className="font-medium text-ink">{item.name}</Td>
              <Td className="text-slate">{sportName(item.sportId)}</Td>
              <Td className="text-slate">{money(item.price)}</Td>
              <Td className="text-slate">{item.qtyAvailable} in stock</Td>
              <Td onClick={(e) => e.stopPropagation()}>
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
              </Td>
              <Td>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                  <span className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
                  {STATUS_LABEL[status]}
                </span>
              </Td>
              <Td className="text-muted">
                <ChevronRight size={16} />
              </Td>
            </Tr>
          )
        })}
        {items.length === 0 && (
          <TableMessage colSpan={9}>
              No items match these filters.
            </TableMessage>
        )}
      </Tbody>
    </Table>
  )
}
