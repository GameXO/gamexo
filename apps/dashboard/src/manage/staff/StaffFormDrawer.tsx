import { useState } from 'react'
import type { StaffMember, StaffRole } from '../../lib/db'
import Drawer from '../../ui/Drawer'

const ROLES: StaffRole[] = ['admin', 'staff', 'coach']

/** The editable slice of a staff record — everything else is filled by the caller. */
export type StaffFormFields = {
  name: string
  phone: string
  email: string
  role: StaffRole
  specialty: string
  sportsAssigned: string[]
}

export default function StaffFormDrawer({
  member,
  fixedRole,
  onClose,
  onSave,
}: {
  member: StaffMember | null
  /**
   * Pins the role and hides the picker. The Coaches page creates coaches and
   * nothing else, so offering the dropdown there would let a "coach" be filed
   * as an admin from a screen that would then stop listing them.
   */
  fixedRole?: StaffRole
  onClose: () => void
  onSave: (fields: StaffFormFields) => void
}) {
  const [name, setName] = useState(member?.name ?? '')
  const [phone, setPhone] = useState(member?.phone ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [role, setRole] = useState<StaffRole>(fixedRole ?? member?.role ?? 'staff')
  const [specialty, setSpecialty] = useState(member?.specialty ?? '')

  const canSave = name.trim().length > 1 && /^\d{10}$/.test(phone)

  return (
    <Drawer
      title={`${member ? 'Edit' : 'Add'} ${fixedRole ?? 'staff'}`}
      subtitle={member ? member.name : undefined}
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={!canSave}
          onClick={() =>
            onSave({
              name: name.trim(),
              phone,
              email: email.trim(),
              role,
              specialty: specialty.trim(),
              sportsAssigned: member?.sportsAssigned ?? [],
            })
          }
          className="flex h-11 w-full items-center justify-center rounded-lg bg-ink text-sm font-medium text-white disabled:opacity-40"
        >
          Save
        </button>
      }
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-slate">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-border-input bg-surface px-3 py-2.5 text-ink outline-none focus:border-ink"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-slate">Phone</span>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
          inputMode="numeric"
          className="rounded-lg border border-border-input bg-surface px-3 py-2.5 text-ink outline-none focus:border-ink"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-slate">Email</span>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          className="rounded-lg border border-border-input bg-surface px-3 py-2.5 text-ink outline-none focus:border-ink"
        />
      </label>
      {!fixedRole && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            className="rounded-lg border border-border-input bg-surface px-3 py-2.5 capitalize text-ink outline-none focus:border-ink"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
      )}
      {role === 'coach' && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-slate">Specialty</span>
          <input
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            placeholder="e.g. Badminton"
            className="rounded-lg border border-border-input bg-surface px-3 py-2.5 text-ink outline-none focus:border-ink"
          />
        </label>
      )}
    </Drawer>
  )
}
