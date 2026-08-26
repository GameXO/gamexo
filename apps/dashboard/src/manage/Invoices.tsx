import { balanceOf, courtById, money } from '../data/booking'
import * as db from '../lib/db'

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

  const rows = [...bookingRows, ...saleRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <p className="text-lg text-ink">Invoices</p>

      <div className="w-full overflow-hidden rounded-2xl border border-border-card bg-white shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)]">
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">No invoices yet.</p>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border-card bg-surface-muted text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border-card last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{row.id}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className="font-medium text-ink">{row.name}</span>
                      <span className="text-xs text-muted">{row.detail}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate">{row.kind}</td>
                  <td className="px-4 py-3 font-medium text-ink">{money(row.amount)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        row.balance > 0 ? 'bg-negative/10 text-negative' : 'bg-lime/20 text-lime-ink'
                      }`}
                    >
                      {row.balance > 0 ? `${money(row.balance)} due` : 'Paid'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
