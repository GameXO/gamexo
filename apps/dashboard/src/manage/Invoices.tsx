import { balanceOf, courtById, money } from '../data/booking'
import * as db from '../lib/db'
import { DataTable, type Column } from '../ui/Table'

type Row = {
  id: string
  kind: 'Booking' | 'Counter Sale'
  name: string
  detail: string
  amount: number
  balance: number
  createdAt: string
}

const COLUMNS: Column<Row>[] = [
  { key: 'id', header: 'ID', cell: (row) => <span className="font-medium text-ink">{row.id}</span> },
  {
    key: 'customer',
    header: 'Customer',
    cell: (row) => (
      <div className="flex flex-col">
        <span className="font-medium text-ink">{row.name}</span>
        <span className="text-xs text-muted">{row.detail}</span>
      </div>
    ),
  },
  { key: 'type', header: 'Type', cell: (row) => <span className="text-slate">{row.kind}</span> },
  { key: 'amount', header: 'Amount', cell: (row) => <span className="font-medium text-ink">{money(row.amount)}</span> },
  {
    key: 'status',
    header: 'Status',
    cell: (row) => (
      <span
        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
          row.balance > 0 ? 'bg-negative/10 text-negative' : 'bg-lime/20 text-lime-ink'
        }`}
      >
        {row.balance > 0 ? `${money(row.balance)} due` : 'Paid'}
      </span>
    ),
  },
]

export default function Invoices() {
  db.useDbVersion()

  const bookingRows = db.getBookings().map((b) => ({
    id: b.id,
    kind: 'Booking' as const,
    name: b.customer.name,
    detail: courtById(b.courtId)?.name || b.courtId,
    amount: b.total,
    balance: balanceOf(b),
    createdAt: b.createdAt,
  }))
  const saleRows = db.getSales().map((s) => ({
    id: s.id,
    kind: 'Counter Sale' as const,
    name: s.customer.name,
    detail: 'Walk-in',
    amount: s.total,
    balance: balanceOf(s),
    createdAt: s.createdAt,
  }))

  const rows: Row[] = [...bookingRows, ...saleRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <p className="text-lg text-ink">Invoices</p>

      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => row.id}
        empty="No invoices yet."
      />
    </div>
  )
}
