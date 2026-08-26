/**
 * Every academy on the platform — the one screen only `ops@gamexo` can open.
 *
 * Four things an operator can do from here, chosen because each one is something an
 * academy provably cannot do for itself:
 *
 *   * **Open** — impersonation. Every request from there carries
 *     `X-Impersonate-Tenant`, runs against that academy's own RLS policies, and is
 *     audit-logged server-side.
 *   * **Suspend / reactivate** — the kill switch. Bites on the next request: staff
 *     are refused at login and live sessions stop renewing.
 *   * **Plan** — comps, trials and corrections, without pushing a payment through.
 *   * **Reset password** — there is no self-serve reset, so an owner whose welcome
 *     email never arrived has no other way back in.
 *   * **Delete** — permanent, and it takes the academy's bookings, customers,
 *     invoices, payments and staff with it. Guarded by typing the academy's name,
 *     checked again server-side. Suspend is the reversible option and the dialog
 *     says so, because most people reaching for "delete" want that instead.
 *
 * Every mutation here writes an audit row naming the operator — see
 * platform_router.py. Deletion writes a `deleted_tenant` tombstone instead, because
 * the academy's own audit log is one of the things it destroys.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import { getImpersonatedTenant, setImpersonatedTenant } from '../auth/platform'

type Tenant = {
  id: string
  slug: string
  name: string
  status: string
  plan_tier: string
  onboarding_completed: boolean
}

/** Shown once and never retrievable — see the note in the panel itself. */
type Credential = { title: string; lines: { label: string; value: string }[] }

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-positive/10 text-positive',
  trial: 'bg-lime/25 text-lime-ink',
  suspended: 'bg-negative/10 text-negative',
}

const PLANS = ['starter', 'growth', 'pro'] as const

/** `Kondapur Turf Arena` -> `kondapur-turf-arena`, the same shape the API accepts. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

export default function AllTenants() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [credential, setCredential] = useState<Credential | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Tenant | null>(null)

  const load = useCallback(async () => {
    try {
      setTenants((await api.listAllTenants()) as Tenant[])
      setError(null)
    } catch (err) {
      // 401/403 here means a tenant account reached a platform screen. The nav
      // already hides it, so this is the belt to that braces — and it says so
      // plainly rather than rendering an empty table that looks like no data.
      setError(
        err instanceof ApiError && (err.isUnauthenticated || err.isForbidden)
          ? 'This screen is for platform operators only.'
          : 'Could not load the academy list.',
      )
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** One mutation at a time, with the row disabled while it runs. */
  const run = useCallback(
    async (tenantId: string, action: () => Promise<void>) => {
      setBusyId(tenantId)
      setError(null)
      try {
        await action()
        await load()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'That did not work. Try again.')
      } finally {
        setBusyId(null)
      }
    },
    [load],
  )

  const toggleSuspended = (tenant: Tenant) => {
    const suspending = tenant.status !== 'suspended'
    // The only confirm on this screen. Suspending is the one action here that is
    // immediately visible to somebody else's customers.
    if (
      suspending &&
      !window.confirm(
        `Suspend ${tenant.name}?\n\nIts staff will be signed out and refused at login until you reactivate it. You can still open it yourself.`,
      )
    ) {
      return
    }
    void run(tenant.id, async () => {
      await api.updateTenant(tenant.id, { status: suspending ? 'suspended' : 'active' })
    })
  }

  const changePlan = (tenant: Tenant, plan: (typeof PLANS)[number]) => {
    if (plan === tenant.plan_tier) return
    void run(tenant.id, async () => {
      await api.updateTenant(tenant.id, { plan_tier: plan })
    })
  }

  const resetPassword = (tenant: Tenant) => {
    if (
      !window.confirm(
        `Reissue the admin password for ${tenant.name}?\n\nThe current password stops working immediately. You will see the new one once.`,
      )
    ) {
      return
    }
    void run(tenant.id, async () => {
      const result = await api.resetTenantPassword(tenant.id)
      setCredential({
        title: `New password for ${tenant.name}`,
        lines: [
          { label: 'Username', value: result.username },
          { label: 'Password', value: result.password },
          { label: 'Contact email', value: result.email },
        ],
      })
    })
  }

  const filtered = (tenants ?? []).filter((t) =>
    query.trim()
      ? `${t.name} ${t.slug}`.toLowerCase().includes(query.trim().toLowerCase())
      : true,
  )

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">All academies</h2>
          <p className="mt-1 text-sm text-slate">
            {tenants === null
              ? 'Loading…'
              : `${tenants.length} academ${tenants.length === 1 ? 'y' : 'ies'} on the platform.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or slug"
            className="w-full max-w-xs rounded-lg border border-border-input bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lime-ink"
          />
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="shrink-0 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90"
          >
            New academy
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </p>
      )}

      {credential && (
        <CredentialPanel credential={credential} onDismiss={() => setCredential(null)} />
      )}

      {creating && (
        <NewAcademyForm
          onClose={() => setCreating(false)}
          onCreated={(cred) => {
            setCreating(false)
            setCredential(cred)
            void load()
          }}
        />
      )}

      {deleting && (
        <DeleteDialog
          tenant={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(slug) => {
            setDeleting(null)
            // An operator can reach this screen from inside an academy. Deleting the
            // one they are impersonating would leave every subsequent request naming
            // a tenant that no longer exists.
            if (getImpersonatedTenant() === slug) setImpersonatedTenant(null)
            void load()
          }}
        />
      )}

      {tenants !== null && !error && (
        <div className="overflow-x-auto rounded-xl border border-border-card bg-surface">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border-card text-left text-[12px] uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Academy</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Set up</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((tenant) => {
                const busy = busyId === tenant.id
                const suspended = tenant.status === 'suspended'
                return (
                  <tr
                    key={tenant.id}
                    className={`border-b border-border-card last:border-0 ${busy ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium text-ink">{tenant.name}</td>
                    <td className="px-4 py-3 font-mono text-[13px] text-slate">{tenant.slug}</td>
                    <td className="px-4 py-3">
                      <select
                        value={tenant.plan_tier}
                        disabled={busy}
                        onChange={(e) =>
                          changePlan(tenant, e.target.value as (typeof PLANS)[number])
                        }
                        className="rounded-lg border border-border-input bg-white px-2 py-1 text-[13px] capitalize text-ink outline-none focus:border-lime-ink disabled:opacity-50"
                      >
                        {/* A tier the API does not know about would 422, so the
                            options are the enum rather than whatever is stored. A
                            legacy value still shows, as its own disabled option. */}
                        {!PLANS.includes(tenant.plan_tier as (typeof PLANS)[number]) && (
                          <option value={tenant.plan_tier} disabled>
                            {tenant.plan_tier}
                          </option>
                        )}
                        {PLANS.map((plan) => (
                          <option key={plan} value={plan}>
                            {plan}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[12px] font-medium capitalize ${
                          STATUS_STYLES[tenant.status] ?? 'bg-surface-muted text-slate'
                        }`}
                      >
                        {tenant.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate">
                      {/* An academy that paid but never finished the wizard is the
                          one row an operator actually needs to spot. */}
                      {tenant.onboarding_completed ? (
                        'Complete'
                      ) : (
                        <span className="text-negative">Onboarding unfinished</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <RowAction disabled={busy} onClick={() => resetPassword(tenant)}>
                          Reset password
                        </RowAction>
                        <RowAction
                          disabled={busy}
                          danger={!suspended}
                          onClick={() => toggleSuspended(tenant)}
                        >
                          {suspended ? 'Reactivate' : 'Suspend'}
                        </RowAction>
                        <RowAction disabled={busy} danger onClick={() => setDeleting(tenant)}>
                          Delete
                        </RowAction>
                        {/* Stepping in is impersonation: every request from here on
                            carries X-Impersonate-Tenant, runs against that academy's
                            own RLS policies, and is audit-logged server-side. */}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setImpersonatedTenant(tenant.slug)}
                          className="rounded-lg border border-border-soft bg-white px-3 py-1.5 text-[13px] font-medium text-ink hover:border-ink disabled:opacity-50"
                        >
                          Open
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate">
                    {query ? 'No academy matches that search.' : 'No academies yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RowAction({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-2.5 py-1.5 text-[13px] font-medium disabled:opacity-50 ${
        danger ? 'text-negative hover:bg-negative/10' : 'text-slate hover:bg-surface-muted'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * Credentials the server will never show again.
 *
 * Only dismissable by an explicit click — no auto-hide, no closing on outside click.
 * The operator is mid-way through reading a password to somebody, and a panel that
 * disappears on a stray click has lost it for good.
 */
function CredentialPanel({
  credential,
  onDismiss,
}: {
  credential: Credential
  onDismiss: () => void
}) {
  return (
    <div className="mb-4 rounded-xl border border-lime-ink/20 bg-lime/15 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-display text-[15px] font-semibold text-lime-ink">
            {credential.title}
          </p>
          <p className="mt-0.5 text-[13px] text-lime-ink/80">
            Shown once. Copy it now — it cannot be retrieved again.
          </p>
          <dl className="mt-3 space-y-1.5">
            {credential.lines.map((line) => (
              <div key={line.label} className="flex flex-wrap items-baseline gap-2">
                <dt className="w-28 shrink-0 text-[12px] uppercase tracking-wide text-lime-ink/70">
                  {line.label}
                </dt>
                <dd className="select-all break-all font-mono text-[13px] text-lime-ink">
                  {line.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-lg bg-lime-ink px-3 py-1.5 text-[13px] font-medium text-lime"
        >
          Done
        </button>
      </div>
    </div>
  )
}

/**
 * Onboarding an academy by hand — a venue that paid offline, or a demo.
 *
 * No password field. One is generated server-side and shown once, because an
 * operator inventing a password for somebody else's account produces a weaker one
 * that then has to be transmitted anyway.
 */
function NewAcademyForm({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (credential: Credential) => void
}) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [ownerName, setOwnerName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The slug follows the name until the operator overrides it, then stops — the
  // usual rule, and the one that stops a careful edit being undone by a later
  // keystroke in the name field.
  const effectiveSlug = slugEdited ? slug : slugify(name)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await api.createTenant({
        slug: effectiveSlug,
        name: name.trim(),
        admin: { email: email.trim(), full_name: ownerName.trim() },
      })
      onCreated({
        title: `${created.tenant.name} is ready`,
        lines: [
          { label: 'Admin', value: created.admin.username },
          { label: 'Password', value: created.admin_password ?? '(chosen by you)' },
          { label: 'Counter', value: created.kiosk_username ?? '—' },
          { label: 'Counter pw', value: created.kiosk_password ?? '—' },
          { label: 'Contact email', value: created.admin.email },
        ],
      })
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not create that academy. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-4 rounded-xl border border-border-card bg-surface p-4"
    >
      <p className="font-display text-[15px] font-semibold text-ink">New academy</p>
      <p className="mt-0.5 text-[13px] text-slate">
        Creates the venue, its owner login and its counter login. Passwords are
        generated and shown once.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Labelled label="Academy name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            placeholder="Kondapur Turf Arena"
            className="w-full rounded-lg border border-border-input bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lime-ink"
          />
        </Labelled>
        <Labelled label="Address (subdomain)">
          <input
            value={effectiveSlug}
            onChange={(e) => {
              setSlugEdited(true)
              setSlug(slugify(e.target.value))
            }}
            required
            minLength={2}
            maxLength={63}
            placeholder="kondapur-turf-arena"
            className="w-full rounded-lg border border-border-input bg-white px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-lime-ink"
          />
        </Labelled>
        <Labelled label="Owner name">
          <input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            required
            maxLength={200}
            placeholder="Vasu Pal"
            className="w-full rounded-lg border border-border-input bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lime-ink"
          />
        </Labelled>
        <Labelled label="Owner email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={320}
            placeholder="owner@theirturf.com"
            className="w-full rounded-lg border border-border-input bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lime-ink"
          />
        </Labelled>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[13px] text-negative">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create academy'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-2 text-sm font-medium text-slate hover:bg-surface-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

/**
 * The last thing between a click and an academy that no longer exists.
 *
 * Typing the name is the guard, and it is a real one rather than theatre: the button
 * stays disabled until it matches exactly, so the operator has to have read which
 * row they are on. The server checks the same string again — this dialog is a
 * courtesy, not the control.
 *
 * Suspend is offered here, prominently, because "delete this" almost always means
 * "stop this working" and only sometimes means "destroy the records". Somebody who
 * wanted the reversible one should find it at the moment they are about to not get
 * it.
 */
function DeleteDialog({
  tenant,
  onClose,
  onDeleted,
}: {
  tenant: Tenant
  onClose: () => void
  onDeleted: (slug: string) => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = typed.trim() === tenant.name.trim()

  async function confirm() {
    if (!matches) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteTenant(tenant.id, typed.trim())
      onDeleted(tenant.slug)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete that academy.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-academy-title"
        className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl"
      >
        <h3 id="delete-academy-title" className="font-display text-lg font-semibold text-ink">
          Delete {tenant.name}?
        </h3>

        <p className="mt-2 text-sm leading-relaxed text-slate">
          This permanently deletes the academy and everything it holds — bookings,
          customers, staff, invoices and payments. It cannot be undone.
        </p>

        <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-[13px] leading-relaxed text-slate">
          Only stopping them for now?{' '}
          <button
            type="button"
            onClick={onClose}
            className="font-medium text-ink underline underline-offset-2"
          >
            Suspend
          </button>{' '}
          blocks every login and is reversible.
        </p>

        <label className="mt-4 block">
          <span className="text-sm text-ink">
            Type <span className="font-semibold">{tenant.name}</span> to confirm
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            /* Enter submits only once it matches, so the shortcut cannot fire on a
               half-typed name. */
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches && !busy) void confirm()
            }}
            className="mt-2 w-full rounded-lg border border-border-input bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-negative"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-[13px] text-negative">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate hover:bg-surface-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={!matches || busy}
            className="rounded-lg bg-negative px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
    </label>
  )
}
