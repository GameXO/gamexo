import { useState } from 'react'
import { Eye, Pencil, KeyRound, ShieldCheck, UserX, UserCheck, Trash2 } from 'lucide-react'
import * as db from '../lib/db'
import type { StaffMember } from '../lib/db'
import { currentUser } from '../data/mockData'
import RowActionsMenu from '../ui/RowActionsMenu'
import BulkActionBar from '../ui/BulkActionBar'
import ConfirmDialog from '../ui/ConfirmDialog'
import StaffFormDrawer from './staff/StaffFormDrawer'
import AccessDrawer from './staff/AccessDrawer'
import StaffDetail from './staff/StaffDetail'

type Confirm =
  | { type: 'delete'; member: StaffMember }
  | { type: 'deactivate'; member: StaffMember }
  | { type: 'activate'; member: StaffMember }
  | { type: 'resetPassword'; member: StaffMember }
  | { type: 'bulkDelete'; ids: string[] }

const roleTone = (role: StaffMember['role']) =>
  role === 'admin' ? 'bg-ink text-white' : role === 'coach' ? 'bg-lime/25 text-lime-ink' : 'bg-surface-muted text-slate'

export default function StaffManagement() {
  db.useDbVersion()
  const staff = db.getStaff()

  const [detailId, setDetailId] = useState<string | null>(null)
  const [formMember, setFormMember] = useState<StaffMember | 'new' | null>(null)
  const [accessMember, setAccessMember] = useState<StaffMember | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<string | null>(null)

  const flash = (message: string) => {
    setToast(message)
    setTimeout(() => setToast(null), 2500)
  }

  const isSelf = (m: StaffMember) => m.name === currentUser.name

  const detailMember = detailId ? staff.find((m) => m.id === detailId) || null : null

  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const saveForm = (fields: {
    name: string
    phone: string
    email: string
    role: StaffMember['role']
    specialty: string
    sportsAssigned: string[]
  }) => {
    if (formMember && formMember !== 'new') {
      db.saveStaffMember({ ...formMember, ...fields, specialty: fields.specialty || undefined })
      flash('Staff member updated.')
    } else {
      db.saveStaffMember({
        id: `ST${Date.now()}`,
        ...fields,
        specialty: fields.specialty || undefined,
        joiningDate: new Date().toISOString().slice(0, 10),
        status: 'active',
        lastLogin: new Date().toISOString(),
        permissions: db.ALL_PERMISSIONS.filter((p) =>
          fields.role === 'admin' ? true : fields.role === 'staff' ? p.id !== 'staffManagement' && p.id !== 'settings' : p.id === 'dashboard' || p.id === 'bookings',
        ).map((p) => p.id),
      })
      flash('Staff member added.')
    }
    setFormMember(null)
  }

  const runConfirm = () => {
    if (!confirm) return
    if (confirm.type === 'delete') {
      db.deleteStaffMember(confirm.member.id)
      flash(`${confirm.member.name} removed.`)
      if (detailId === confirm.member.id) setDetailId(null)
    } else if (confirm.type === 'deactivate') {
      db.setStaffStatus(confirm.member.id, 'inactive')
      flash(`${confirm.member.name} deactivated.`)
    } else if (confirm.type === 'activate') {
      db.setStaffStatus(confirm.member.id, 'active')
      flash(`${confirm.member.name} activated.`)
    } else if (confirm.type === 'resetPassword') {
      flash(`Password reset link sent to ${confirm.member.email || confirm.member.phone}.`)
    } else if (confirm.type === 'bulkDelete') {
      confirm.ids.forEach((id) => db.deleteStaffMember(id))
      flash(`${confirm.ids.length} staff member(s) removed.`)
      setSelected(new Set())
    }
    setConfirm(null)
  }

  if (detailMember) {
    return (
      <>
        <StaffDetail member={detailMember} onBack={() => setDetailId(null)} onManageAccess={() => setAccessMember(detailMember)} />
        {accessMember && (
          <AccessDrawer
            member={accessMember}
            onClose={() => setAccessMember(null)}
            onSave={(permissions) => {
              db.setStaffPermissions(accessMember.id, permissions)
              setAccessMember(null)
              flash('Permissions updated.')
            }}
          />
        )}
      </>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between">
        <p className="text-lg text-ink">Manage Staff</p>
        <button
          type="button"
          onClick={() => setFormMember('new')}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white"
        >
          + Add Staff
        </button>
      </div>

      {toast && (
        <div className="w-full rounded-lg bg-lime/20 px-4 py-2.5 text-sm font-medium text-lime-ink">{toast}</div>
      )}

      <BulkActionBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
        actions={[
          { label: 'Delete', danger: true, onClick: () => setConfirm({ type: 'bulkDelete', ids: [...selected] }) },
        ]}
      />

      <div className="w-full overflow-hidden rounded-2xl border border-border-card bg-white shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)]">
        {staff.map((member, i) => (
          <div
            key={member.id}
            className={`flex items-center gap-3 px-5 py-3.5 ${i < staff.length - 1 ? 'border-b border-border-card' : ''}`}
          >
            <input
              type="checkbox"
              checked={selected.has(member.id)}
              onChange={() => toggleSelect(member.id)}
              className="size-4 shrink-0 accent-black"
            />
            <button type="button" onClick={() => setDetailId(member.id)} className="flex flex-1 items-center gap-3 text-left">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime-ink text-xs font-semibold text-lime">
                {member.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">{member.name}</p>
                <p className="text-xs text-muted">
                  {member.phone}
                  {member.specialty ? ` · ${member.specialty}` : ''}
                </p>
              </div>
            </button>
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${roleTone(member.role)}`}>
              {member.role}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                member.status === 'active' ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative'
              }`}
            >
              {member.status === 'active' ? 'Active' : 'Inactive'}
            </span>
            <RowActionsMenu
              actions={[
                { label: 'View', icon: Eye, onClick: () => setDetailId(member.id) },
                { label: 'Edit', icon: Pencil, onClick: () => setFormMember(member) },
                { label: 'Reset Password', icon: KeyRound, onClick: () => setConfirm({ type: 'resetPassword', member }) },
                { label: 'Manage Access', icon: ShieldCheck, onClick: () => setAccessMember(member) },
                member.status === 'active'
                  ? {
                      label: 'Deactivate',
                      icon: UserX,
                      disabled: isSelf(member),
                      onClick: () => setConfirm({ type: 'deactivate', member }),
                    }
                  : {
                      label: 'Activate',
                      icon: UserCheck,
                      onClick: () => setConfirm({ type: 'activate', member }),
                    },
                {
                  label: 'Delete',
                  icon: Trash2,
                  danger: true,
                  disabled: isSelf(member),
                  onClick: () => setConfirm({ type: 'delete', member }),
                },
              ]}
            />
          </div>
        ))}
      </div>

      {formMember && (
        <StaffFormDrawer
          member={formMember === 'new' ? null : formMember}
          onClose={() => setFormMember(null)}
          onSave={saveForm}
        />
      )}

      {accessMember && (
        <AccessDrawer
          member={accessMember}
          onClose={() => setAccessMember(null)}
          onSave={(permissions) => {
            db.setStaffPermissions(accessMember.id, permissions)
            setAccessMember(null)
            flash('Permissions updated.')
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={
            confirm.type === 'delete'
              ? `Delete ${confirm.member.name}?`
              : confirm.type === 'bulkDelete'
                ? `Delete ${confirm.ids.length} staff member(s)?`
                : confirm.type === 'deactivate'
                  ? `Deactivate ${confirm.member.name}?`
                  : confirm.type === 'activate'
                    ? `Activate ${confirm.member.name}?`
                    : `Reset password for ${confirm.member.name}?`
          }
          message={
            confirm.type === 'delete' || confirm.type === 'bulkDelete'
              ? 'This removes their account entirely. This cannot be undone.'
              : confirm.type === 'deactivate'
                ? 'They will lose access to the system until reactivated.'
                : confirm.type === 'activate'
                  ? 'They will regain access to the system.'
                  : 'A password reset link will be sent to them.'
          }
          confirmLabel={confirm.type === 'delete' || confirm.type === 'bulkDelete' ? 'Delete' : 'Confirm'}
          danger={confirm.type === 'delete' || confirm.type === 'bulkDelete' || confirm.type === 'deactivate'}
          onCancel={() => setConfirm(null)}
          onConfirm={runConfirm}
        />
      )}
    </div>
  )
}
