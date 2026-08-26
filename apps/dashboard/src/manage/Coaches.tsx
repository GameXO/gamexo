import { GraduationCap } from 'lucide-react'
import * as db from '../lib/db'

export default function Coaches() {
  db.useDbVersion()
  const coaches = db.getStaff().filter((m) => m.role === 'coach')

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <p className="text-lg text-ink">Coaches</p>

      {coaches.length === 0 ? (
        <p className="w-full rounded-xl border border-dashed border-border-card px-4 py-8 text-center text-sm text-muted">
          No coaches yet — assign the "Coach" role to a staff member under Manage Staff.
        </p>
      ) : (
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {coaches.map((c) => (
            <div
              key={c.id}
              className="flex flex-col gap-3 rounded-xl border border-border-card bg-white p-4 shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)]"
            >
              <div className="flex size-10 items-center justify-center rounded-full bg-lime/20 text-lime-ink">
                <GraduationCap size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">{c.name}</p>
                <p className="text-xs text-muted">{c.specialty || 'General coaching'}</p>
              </div>
              <p className="text-xs text-slate">{c.phone}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
