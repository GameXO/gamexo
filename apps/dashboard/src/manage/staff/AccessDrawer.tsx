import { useState } from 'react'
import { ALL_PERMISSIONS, type Permission, type StaffMember } from '../../lib/db'
import Drawer from '../../ui/Drawer'

export default function AccessDrawer({
  member,
  onClose,
  onSave,
}: {
  member: StaffMember
  onClose: () => void
  onSave: (permissions: Permission[]) => void
}) {
  const [selected, setSelected] = useState<Set<Permission>>(new Set(member.permissions))

  const toggle = (id: Permission) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Drawer
      title="Permissions"
      subtitle={member.name}
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={() => onSave([...selected])}
          className="flex h-11 w-full items-center justify-center rounded-lg bg-ink text-sm font-medium text-white"
        >
          Save
        </button>
      }
    >
      <div className="flex flex-col gap-1 rounded-xl border border-border-card bg-white p-2">
        {ALL_PERMISSIONS.map((perm) => (
          <label
            key={perm.id}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink hover:bg-surface-muted"
          >
            <input
              type="checkbox"
              checked={selected.has(perm.id)}
              onChange={() => toggle(perm.id)}
              className="size-4 accent-black"
            />
            {perm.label}
          </label>
        ))}
      </div>
    </Drawer>
  )
}
