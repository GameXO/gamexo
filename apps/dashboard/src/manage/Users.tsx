import * as db from '../lib/db'
import { tierForVisits } from './membershipTier'

export default function Users() {
  db.useDbVersion()
  const customers = [...db.getCustomers()].sort((a, b) => b.visits - a.visits)

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <p className="text-lg text-ink">Users</p>

      <div className="w-full overflow-hidden rounded-2xl border border-border-card bg-white shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)]">
        {customers.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">No customers recorded yet.</p>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border-card bg-surface-muted text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Visits</th>
                <th className="px-4 py-3">Tier</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.phone} className="border-b border-border-card last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{c.name}</td>
                  <td className="px-4 py-3 text-slate">{c.phone}</td>
                  <td className="px-4 py-3 text-slate">{c.email || '—'}</td>
                  <td className="px-4 py-3 text-slate">{c.visits}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-lime/20 px-2.5 py-1 text-xs font-medium text-lime-ink">
                      {tierForVisits(c.visits)}
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
