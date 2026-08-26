import type { InventoryItem } from '../api/hooks'

/** Short, human-facing code for a UUID-backed row — same idea as a booking number,
 *  just for inventory. Not stored anywhere; derived fresh from `id` every time. */
export function itemCode(id: string) {
  return `INV-${id.replace(/-/g, '').slice(-6).toUpperCase()}`
}

/** The real unique key the backend requires (`barcode`) is invisible in this UI —
 *  nothing here scans barcodes yet, so one is generated from the name so admins
 *  never have to think about it. */
export function generateBarcode(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'item'
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${slug}-${suffix}`.slice(0, 64)
}

export function exportInventoryCsv(items: InventoryItem[], sportName: (id: string | null) => string) {
  const header = ['Item ID', 'Item', 'Sport', 'Category', 'Price', 'Stock', 'Published', 'Status']
  const rows = items.map((item) => [
    itemCode(item.id),
    item.name,
    sportName(item.sportId),
    item.category,
    String(item.price),
    String(item.qtyAvailable),
    item.publishedToPos ? 'Published' : 'Hidden',
    item.qtyAvailable <= 0 ? 'Out of stock' : item.isLowStock ? 'Low stock' : 'In stock',
  ])
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','))
    .join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
