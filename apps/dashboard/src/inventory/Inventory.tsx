import { useState } from 'react'
import { useInventory, useSports } from '../api/hooks'
import InventoryList from './InventoryList'
import ItemDetail from './ItemDetail'

export default function Inventory() {
  const inventoryQuery = useInventory()
  const sportsQuery = useSports()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const sportName = (id: string | null) => {
    if (id === null) return 'General'
    return sportsQuery.data?.find((s) => s.id === id)?.name ?? 'Unknown sport'
  }

  if (inventoryQuery.isPending) {
    return <div className="flex flex-1 items-center justify-center text-sm text-slate">Loading inventory…</div>
  }

  if (inventoryQuery.error) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p role="alert" className="text-sm text-negative">
          Could not load inventory: {inventoryQuery.error instanceof Error ? inventoryQuery.error.message : 'unknown error'}
        </p>
      </div>
    )
  }

  const items = inventoryQuery.data ?? []

  if (creating) {
    return (
      <div className="flex flex-1 justify-center overflow-y-auto px-4 py-5 sm:px-6">
        <ItemDetail
          item={null}
          sportName={sportName}
          onBack={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            setSelectedId(id)
          }}
          onDeleted={() => setCreating(false)}
        />
      </div>
    )
  }

  const selected = items.find((i) => i.id === selectedId) ?? null
  if (selectedId && selected) {
    return (
      <div className="flex flex-1 justify-center overflow-y-auto px-4 py-5 sm:px-6">
        <ItemDetail
          item={selected}
          sportName={sportName}
          onBack={() => setSelectedId(null)}
          onSaved={() => setSelectedId(selected.id)}
          onDeleted={() => setSelectedId(null)}
        />
      </div>
    )
  }

  return (
    <InventoryList
      items={items}
      sports={sportsQuery.data ?? []}
      sportName={sportName}
      onSelectItem={setSelectedId}
      onAddNew={() => setCreating(true)}
    />
  )
}
