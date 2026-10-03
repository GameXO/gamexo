import * as db from '../lib/db'
import { tierForVisits } from './membershipTier'
import { DataTable, type Column } from '../ui/Table'

type Customer = ReturnType<typeof db.getCustomers>[number]

const COLUMNS: Column<Customer>[] = [
  { key: 'name', header: 'Name', cell: (c) => <span className="font-medium text-ink">{c.name}</span> },
  { key: 'phone', header: 'Phone', cell: (c) => <span className="text-slate">{c.phone}</span> },
  { key: 'email', header: 'Email', cell: (c) => <span className="text-slate">{c.email || '—'}</span> },
  { key: 'visits', header: 'Visits', cell: (c) => <span className="text-slate">{c.visits}</span> },
  {
    key: 'tier',
    header: 'Tier',
    cell: (c) => (
      <span className="rounded-full bg-lime/20 px-2.5 py-1 text-xs font-medium text-lime-ink">
        {tierForVisits(c.visits)}
      </span>
    ),
  },
]

export default function Users() {
  db.useDbVersion()
  const customers = [...db.getCustomers()].sort((a, b) => b.visits - a.visits)

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <p className="text-lg text-ink">Users</p>

      <DataTable
        columns={COLUMNS}
        rows={customers}
        rowKey={(c) => c.phone}
        empty="No customers recorded yet."
      />
    </div>
  )
}
