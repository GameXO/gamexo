/**
 * Add a staff member, or edit one.
 *
 * Adding creates a real login: the server generates the username
 * (`rahul-joshi.staff@your-slug`) and returns it once, so this drawer ends on a
 * hand-over panel rather than closing — the admin has to give that username to the
 * person, and it is not shown again. Editing changes role, contact details, shift and
 * status; a person cannot demote or deactivate themselves, and the server says so.
 */
import { useState } from 'react'
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react'
import Drawer from '../../ui/Drawer'
import { ApiError, type StaffRole, type StaffStatus } from '../../api/client'
import { useCreateStaff, useUpdateStaff, type StaffOut } from '../../api/hooks'
import { ROLE_META, ROLE_ORDER, SHIFTS } from './staffRoles'

const INPUT =
  'w-full rounded-lg border border-border-input bg-white px-3.5 py-2.5 text-[14px] text-ink outline-none placeholder:text-muted focus:border-lime-ink'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-muted">{hint}</span>}
    </label>
  )
}

/** Readable, unambiguous, and not guessable: no 0/O or 1/l to misread over the phone. */
function suggestPassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(12))
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('')
}

export default function StaffDrawer({
  member,
  isSelf,
  onClose,
  onDone,
}: {
  /** Omit to add. */
  member?: StaffOut
  isSelf?: boolean
  onClose: () => void
  onDone: (message: string) => void
}) {
  const create = useCreateStaff()
  const update = useUpdateStaff()

  const [name, setName] = useState(member?.full_name ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [phone, setPhone] = useState(member?.phone ?? '')
  const [shift, setShift] = useState(member?.shift ?? '')
  const [role, setRole] = useState<StaffRole>((member?.role as StaffRole) ?? 'reception')
  const [status, setStatus] = useState<StaffStatus>((member?.status as StaffStatus) ?? 'active')
  const [password, setPassword] = useState(() => (member ? '' : suggestPassword()))
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ username: string; email: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const pending = create.isPending || update.isPending
  const shifts = shift && !SHIFTS.includes(shift) ? [shift, ...SHIFTS] : SHIFTS

  const problem = !name.trim()
    ? 'Enter their name.'
    : !member && !/^\S+@\S+\.\S+$/.test(email.trim())
      ? 'Enter a valid email address.'
      : !member && password.length < 8
        ? 'The password needs at least 8 characters.'
        : null

  async function submit() {
    setError(null)
    try {
      if (member) {
        await update.mutateAsync({
          userId: member.id,
          body: {
            full_name: name.trim(),
            role,
            phone: phone.trim() || null,
            shift: shift || null,
            status,
          },
        })
        onDone(`${name.trim()} updated.`)
      } else {
        const made = await create.mutateAsync({
          email: email.trim(),
          password,
          full_name: name.trim(),
          role,
          phone: phone.trim() || null,
          shift: shift || null,
        })
        setCreated({ username: made.username, email: made.email, password })
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.isForbidden
            ? 'Only an admin can add or change staff.'
            : err.status === 409
              ? err.message
              : err.message
          : 'Could not save. Please try again.',
      )
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — the text is on screen to read out instead */
    }
  }

  if (created) {
    const sheet = `Sign in at ${location.origin}\nUsername: ${created.username}\nPassword: ${created.password}`
    return (
      <Drawer
        title="Staff member added"
        subtitle={name}
        onClose={() => {
          onDone(`${name.trim()} added.`)
        }}
        footer={
          <button
            type="button"
            onClick={() => onDone(`${name.trim()} added.`)}
            className="w-full rounded-lg bg-ink px-4 py-2.5 text-[14px] font-medium text-white"
          >
            Done
          </button>
        }
      >
        <p className="rounded-xl border border-border-card bg-white p-4 text-[14px] leading-relaxed text-slate">
          Give {name.split(' ')[0]} these details now. The username is shown only once, and the password is not stored
          anywhere you can read it back.
        </p>
        <dl className="flex flex-col gap-3 rounded-xl border border-border-card bg-white p-4 text-[14px]">
          <div>
            <dt className="text-[12px] text-muted">Username</dt>
            <dd className="break-all font-medium text-ink">{created.username}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">Password</dt>
            <dd className="font-mono text-ink">{created.password}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">Email</dt>
            <dd className="break-all text-ink">{created.email}</dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={() => void copy(sheet)}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-input bg-white px-4 py-2.5 text-[14px] font-medium text-ink hover:bg-hover"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copied' : 'Copy sign-in details'}
        </button>
      </Drawer>
    )
  }

  return (
    <Drawer
      title={member ? 'Edit staff member' : 'Add a staff member'}
      subtitle={member ? member.username : 'They get their own login, with the access of the role you choose.'}
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="text-[13px] text-negative">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={Boolean(problem) || pending}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-lime px-4 py-2.5 text-[14px] font-medium text-lime-ink hover:brightness-95 disabled:opacity-40"
            >
              {pending && <Loader2 size={16} className="animate-spin" />}
              {member ? 'Save changes' : 'Add staff member'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border-input bg-white px-4 py-2.5 text-[14px] text-ink hover:bg-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      }
    >
      <Field label="Full name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={INPUT} autoFocus />
      </Field>

      <Field
        label="Email"
        hint={member ? 'Email cannot be changed here.' : 'Where their mail goes. They sign in with the username we create.'}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={Boolean(member)}
          className={`${INPUT} disabled:bg-surface-muted disabled:text-muted`}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Phone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className={INPUT} />
        </Field>
        <Field label="Shift">
          <select value={shift} onChange={(e) => setShift(e.target.value)} className={INPUT}>
            <option value="">Not set</option>
            {shifts.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13px] font-medium text-ink">Role</legend>
        {ROLE_ORDER.map((r) => {
          const meta = ROLE_META[r]
          const selected = role === r
          // Cannot demote yourself: the server refuses, so do not offer it.
          const blocked = !meta.available || (isSelf === true && r !== 'admin')
          return (
            <label
              key={r}
              className={`flex items-start gap-3 rounded-xl border p-3.5 ${
                selected ? 'border-ink bg-white' : 'border-border-card bg-white'
              } ${blocked ? 'cursor-not-allowed opacity-55' : 'cursor-pointer hover:border-border-input'}`}
            >
              <input
                type="radio"
                name="role"
                value={r}
                checked={selected}
                disabled={blocked}
                onChange={() => setRole(r)}
                className="mt-1 accent-black"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
                  {meta.label}
                  {!meta.available && (
                    <span className="rounded-full border border-border-soft px-2 py-px text-[11px] font-normal text-muted">
                      Soon
                    </span>
                  )}
                </span>
                <span className="block text-[13px] text-slate">{meta.summary}</span>
              </span>
            </label>
          )
        })}
        {isSelf && <p className="text-[12px] text-muted">You can’t change your own role.</p>}
      </fieldset>

      {member ? (
        <Field label="Status" hint={isSelf ? 'You can’t deactivate your own account.' : 'Inactive and on-leave staff cannot sign in.'}>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StaffStatus)}
            disabled={isSelf}
            className={`${INPUT} disabled:bg-surface-muted disabled:text-muted`}
          >
            <option value="active">Active</option>
            <option value="on-leave">On leave</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
      ) : (
        <Field label="Password" hint="At least 8 characters. You will see it once more after adding them.">
          <div className="flex gap-2">
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${INPUT} font-mono`}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setPassword(suggestPassword())}
              aria-label="Suggest another password"
              title="Suggest another"
              className="flex shrink-0 items-center justify-center rounded-lg border border-border-input bg-white px-3 text-slate hover:bg-hover hover:text-ink"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </Field>
      )}

      {problem && name.trim() !== '' && <p className="text-[12px] text-muted">{problem}</p>}
    </Drawer>
  )
}
