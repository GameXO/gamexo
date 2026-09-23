import { useState } from 'react'
import { GraduationCap, Plus } from 'lucide-react'
import StaffFormDrawer, { type StaffFormFields } from './staff/StaffFormDrawer'
import * as db from '../lib/db'

export default function Coaches() {
  db.useDbVersion()
  const coaches = db.getStaff().filter((m) => m.role === 'coach')
  const [adding, setAdding] = useState(false)

  /**
   * A coach is a staff member with the coach role — the same record Manage Staff
   * edits, not a separate roster. Creating it here rather than sending the user
   * off to that screen is the only thing this form shortcuts.
   */
  const addCoach = (fields: StaffFormFields) => {
    db.saveStaffMember({
      id: `ST${Date.now()}`,
      ...fields,
      specialty: fields.specialty || undefined,
      joiningDate: new Date().toISOString().slice(0, 10),
      status: 'active',
      lastLogin: new Date().toISOString(),
      permissions: db.defaultPermissionsFor('coach'),
    })
    setAdding(false)
  }

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <p className="text-lg text-ink">Coaches</p>

      {coaches.length === 0 && (
        <p className="w-full rounded-xl border border-dashed border-border-card px-4 py-6 text-center text-sm text-muted">
          No coaches yet — add one below, or give an existing staff member the "Coach" role under
          Manage Staff.
        </p>
      )}

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

        {/* One more box in the same grid rather than a header button, so it stays
            reachable on an empty roster and keeps the cards' rhythm. */}
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex min-h-[146px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-card p-4 text-slate transition-colors hover:border-lime-ink hover:bg-lime/10"
        >
          <div className="flex size-10 items-center justify-center rounded-full bg-lime/20 text-lime-ink">
            <Plus size={18} />
          </div>
          <span className="text-sm font-semibold text-ink">Add coach</span>
          <span className="text-xs text-muted">Creates a staff member on the coach role</span>
        </button>
      </div>

      {adding && (
        <StaffFormDrawer
          member={null}
          fixedRole="coach"
          onClose={() => setAdding(false)}
          onSave={addCoach}
        />
      )}
    </div>
  )
}
