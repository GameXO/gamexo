import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react'
import { ALL_PERMISSIONS, type StaffMember } from '../../lib/db'
import { sportById } from '../../data/booking'

const roleTone = (role: StaffMember['role']) =>
  role === 'admin' ? 'bg-ink text-white' : role === 'coach' ? 'bg-lime/25 text-lime-ink' : 'bg-surface-muted text-slate'

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function StaffDetail({
  member,
  onBack,
  onManageAccess,
}: {
  member: StaffMember
  onBack: () => void
  onManageAccess: () => void
}) {
  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <button type="button" onClick={onBack} className="flex w-fit items-center gap-1.5 text-sm font-medium text-slate">
        <ArrowLeft size={15} /> Back to staff
      </button>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-full bg-lime-ink text-sm font-semibold text-lime">
          {member.name
            .split(' ')
            .map((p) => p[0])
            .slice(0, 2)
            .join('')}
        </div>
        <div>
          <p className="text-lg font-semibold text-ink">{member.name}</p>
          <div className="mt-1 flex items-center gap-2">
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
          </div>
        </div>
      </div>

      <div className="grid w-full grid-cols-1 gap-4 rounded-2xl border border-border-card bg-white p-5 shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)] sm:grid-cols-2">
        <Field label="Phone" value={member.phone} />
        <Field label="Email" value={member.email || '—'} />
        <Field label="Joining date" value={member.joiningDate} />
        <Field label="Last login" value={formatDateTime(member.lastLogin)} />
        <Field
          label="Sports assigned"
          value={member.sportsAssigned.length ? member.sportsAssigned.map((id) => sportById(id)?.name || id).join(', ') : '—'}
        />
        <Field label="Specialty" value={member.specialty || '—'} />
      </div>

      <div className="flex w-full flex-col gap-3 rounded-2xl border border-border-card bg-white p-5 shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-ink" />
            <p className="text-sm font-semibold text-ink">Permissions</p>
          </div>
          <button
            type="button"
            onClick={onManageAccess}
            className="flex items-center gap-1.5 rounded-lg border border-border-input bg-white px-3 py-1.5 text-xs font-medium text-ink"
          >
            <KeyRound size={13} /> Manage Access
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ALL_PERMISSIONS.map((perm) => (
            <span
              key={perm.id}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                member.permissions.includes(perm.id) ? 'bg-lime/20 text-lime-ink' : 'bg-surface-muted text-muted'
              }`}
            >
              {perm.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm font-medium text-ink">{value}</p>
    </div>
  )
}
