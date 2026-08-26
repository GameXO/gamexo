import { useMemo, useState } from 'react'
import { Download, LayoutGrid, Package, Plus, Search, Table2 } from 'lucide-react'
import { useUpdateInventoryItem, useDeleteInventoryItem, type InventoryItem, type StockStatus } from '../api/hooks'
import BulkActionBar from '../ui/BulkActionBar'
import ConfirmDialog from '../ui/ConfirmDialog'
import { exportInventoryCsv } from './helpers'
import InventoryGrid from './InventoryGrid'
import InventoryTable from './InventoryTable'

type ViewMode = 'table' | 'grid'
type PublishedFilter = 'all' | 'published' | 'hidden'
type StatusFilter = 'all' | StockStatus

const selectClass = 'h-10 rounded-lg border border-border-input bg-white px-3 text-sm text-ink'

export default function InventoryList({
  items,
  sports,
  sportName,
  onSelectItem,
  onAddNew,
}: {
  items: InventoryItem[]
  sports: { id: string; name: string }[]
  sportName: (id: string | null) => string
  onSelectItem: (id: string) => void
  onAddNew: () => void
}) {
  const [view, setView] = useState<ViewMode>('table')
  const [query, setQuery] = useState('')
  const [sportFilter, setSportFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [publishedFilter, setPublishedFilter] = useState<PublishedFilter>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  const update = useUpdateInventoryItem()
  const del = useDeleteInventoryItem()

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q) && !item.category.toLowerCase().includes(q)) return false
      if (sportFilter !== 'all') {
        if (sportFilter === 'general' ? item.sportId !== null : item.sportId !== sportFilter) return false
      }
      if (publishedFilter !== 'all') {
        if (publishedFilter === 'published' && !item.publishedToPos) return false
        if (publishedFilter === 'hidden' && item.publishedToPos) return false
      }
      if (statusFilter !== 'all') {
        const status: StockStatus = item.qtyAvailable <= 0 ? 'out-of-stock' : item.isLowStock ? 'low-stock' : 'in-stock'
        if (status !== statusFilter) return false
      }
      return true
    })
  }, [items, query, sportFilter, statusFilter, publishedFilter])

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const bulkPublish = async (publish: boolean) => {
    await Promise.all([...selectedIds].map((id) => update.mutateAsync({ id, patch: { publishedToPos: publish } })))
    setSelectedIds(new Set())
  }

  const bulkDelete = async () => {
    // allSettled, not all — an item with movement history rejects (409) and that
    // should not stop the rest of the batch from deleting.
    await Promise.allSettled([...selectedIds].map((id) => del.mutateAsync(id)))
    setSelectedIds(new Set())
    setConfirmBulkDelete(false)
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-surface-muted text-muted">
          <Package size={24} />
        </div>
        <div>
          <p className="text-base font-semibold text-ink">No inventory items</p>
          <p className="mt-1 text-sm text-slate">Start by creating your first inventory item.</p>
        </div>
        <button
          type="button"
          onClick={onAddNew}
          className="flex h-11 items-center gap-2 rounded-full px-6 text-sm text-white"
          style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
        >
          <Plus size={16} />
          Add Item
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between">
        <p className="text-lg text-ink">Inventory</p>
        <button
          type="button"
          onClick={onAddNew}
          className="flex h-10 items-center gap-2 rounded-full px-5 text-sm text-white"
          style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
        >
          <Plus size={15} />
          Add New Item
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="w-full rounded-lg border border-border-input bg-white py-2.5 pl-9 pr-3.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none"
            placeholder="Search name or category…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <select value={sportFilter} onChange={(e) => setSportFilter(e.target.value)} className={selectClass}>
          <option value="all">All sports</option>
          <option value="general">General</option>
          {sports.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className={selectClass}
        >
          <option value="all">All stock status</option>
          <option value="in-stock">In Stock</option>
          <option value="low-stock">Low Stock</option>
          <option value="out-of-stock">Out of Stock</option>
        </select>

        <select
          value={publishedFilter}
          onChange={(e) => setPublishedFilter(e.target.value as PublishedFilter)}
          className={selectClass}
        >
          <option value="all">All (published or not)</option>
          <option value="published">Published to POS</option>
          <option value="hidden">Hidden from POS</option>
        </select>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg bg-surface-muted p-1">
          <button
            type="button"
            onClick={() => setView('table')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              view === 'table' ? 'bg-white text-ink shadow-sm' : 'text-slate'
            }`}
          >
            <Table2 size={14} />
            Table
          </button>
          <button
            type="button"
            onClick={() => setView('grid')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
              view === 'grid' ? 'bg-white text-ink shadow-sm' : 'text-slate'
            }`}
          >
            <LayoutGrid size={14} />
            Grid
          </button>
        </div>

        <button
          type="button"
          onClick={() => exportInventoryCsv(filtered, sportName)}
          className="flex items-center gap-1.5 text-sm text-slate hover:text-ink"
        >
          <Download size={14} />
          Export
        </button>
      </div>

      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          onClear={() => setSelectedIds(new Set())}
          actions={[
            { label: 'Publish', onClick: () => bulkPublish(true) },
            { label: 'Hide', onClick: () => bulkPublish(false) },
            { label: 'Delete', onClick: () => setConfirmBulkDelete(true), danger: true },
          ]}
        />
      )}

      {view === 'table' ? (
        <InventoryTable
          items={filtered}
          sportName={sportName}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onSelectItem={onSelectItem}
        />
      ) : (
        <InventoryGrid items={filtered} sportName={sportName} onSelectItem={onSelectItem} />
      )}

      {confirmBulkDelete && (
        <ConfirmDialog
          title={`Delete ${selectedIds.size} item(s)?`}
          message="Items with movement history or issued units will be skipped — unpublish those instead."
          confirmLabel="Delete"
          danger
          onConfirm={bulkDelete}
          onCancel={() => setConfirmBulkDelete(false)}
        />
      )}
    </div>
  )
}
