/**
 * Staff — everyone who can sign in to this venue.
 *
 * Two tabs: the people, and what each kind of login is allowed to do. The list is the
 * real one from `/staff`, so adding someone here creates an account that can actually
 * sign in, and deactivating one locks them out at their next request. (This screen
 * used to edit a local mock list, which made people appear and vanish without ever
 * touching a login.)
 */
import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Plus, Search } from 'lucide-react'
import { ApiError } from '../api/client'
import { useStaff, useUpdateStaff, type StaffOut } from '../api/hooks'
import { useAuth } from '../auth/AuthProvider'
import ConfirmDialog from '../ui/ConfirmDialog'
import RowActionsMenu from '../ui/RowActionsMenu'
import Tabs from '../ui/Tabs'
import { useToast } from '../ui/useToast'
import StaffDrawer from './staff/StaffDrawer'
import { ROLE_META, ROLE_ORDER, ago } from './staff/staffRoles'

const TABS = ['All members', 'Roles'] as const

type SortKey = 'name' | 'role' | 'last' | 'status'

const STATUS: Record<string, { label: string; dot: string }> = {
  active: { label: 'Active', dot: 'bg-positive' },
  'on-leave': { label: 'On leave', dot: 'bg-amber-500' },
  inactive: { label: 'Inactive', dot: 'bg-muted' },
}

const roleLabel = (role: string) => ROLE_META[role as keyof typeof ROLE_META]?.label ?? role

function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.inactive
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border-input bg-white py-1 pl-2.5 pr-3 text-[13px] text-ink">
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime-ink text-[12px] font-medium text-lime">
      {initials || '?'}
    </span>
  )
}

function SortHead({
  label,
  k,
  sort,
  onSort,
  className = '',
}: {
  label: string
  k: SortKey
  sort: { key: SortKey; desc: boolean }
  onSort: (k: SortKey) => void
  className?: string
}) {
  const on = sort.key === k
  const Icon = !on ? ChevronsUpDown : sort.desc ? ArrowDown : ArrowUp
  return (
    <th className={`px-5 py-3.5 text-left text-[14px] font-medium text-ink ${className}`} aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1.5 hover:text-ink">
        {label}
        <Icon size={14} className={on ? 'text-ink' : 'text-muted'} />
      </button>
    </th>
  )
}

export default function StaffManagement() {
  const { me } = useAuth()
  const selfId = me?.user?.id
  const { toast, notify } = useToast()
  const update = useUpdateStaff()

  const [tab, setTab] = useState<(typeof TABS)[number]>('All members')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false })
  const [drawer, setDrawer] = useState<StaffOut | 'new' | null>(null)
  const [confirm, setConfirm] = useState<{ member: StaffOut; to: 'active' | 'inactive' } | null>(null)

  // Searched on the server, and debounced so typing a name is one request.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading, isError } = useStaff(query || undefined)
  const people = useMemo(() => data?.items ?? [], [data])

  const sorted = useMemo(() => {
    const get: Record<SortKey, (m: StaffOut) => string | number> = {
      name: (m) => m.full_name.toLowerCase(),
      role: (m) => ROLE_ORDER.indexOf(m.role as never) + (m.role === 'kiosk' ? 99 : 0),
      last: (m) => (m.last_login_at ? new Date(m.last_login_at).getTime() : 0),
      status: (m) => m.status,
    }
    const f = get[sort.key]
    return [...people].sort((a, b) => {
      const [x, y] = [f(a), f(b)]
      const r = x < y ? -1 : x > y ? 1 : 0
      return sort.desc ? -r : r
    })
  }, [people, sort])

  const onSort = (key: SortKey) =>
    setSort((cur) => (cur.key === key ? { key, desc: !cur.desc } : { key, desc: false }))

  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const m of people) out[m.role] = (out[m.role] ?? 0) + 1
    return out
  }, [people])

  async function runConfirm() {
    if (!confirm) return
    const { member, to } = confirm
    setConfirm(null)
    try {
      await update.mutateAsync({ userId: member.id, body: { status: to } })
      notify(to === 'inactive' ? `${member.full_name} can no longer sign in.` : `${member.full_name} can sign in again.`)
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not update that person. Please try again.', 'error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'All members' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-[400px]">
              <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email…"
                aria-label="Search staff"
                className="h-11 w-full rounded-lg border border-border-input bg-white pl-10 pr-3 text-[14px] text-ink outline-none placeholder:text-muted focus:border-lime-ink"
              />
            </div>
            <button
              type="button"
              onClick={() => setDrawer('new')}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-lime px-4 text-[14px] font-medium text-lime-ink hover:brightness-95"
            >
              <Plus size={17} /> Add staff member
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border-card bg-white">
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr className="border-b border-border-card">
                  <SortHead label="Name" k="name" sort={sort} onSort={onSort} />
                  <SortHead label="Role" k="role" sort={sort} onSort={onSort} />
                  <th className="px-5 py-3.5 text-left text-[14px] font-medium text-ink">Username</th>
                  <th className="px-5 py-3.5 text-left text-[14px] font-medium text-ink">Shift</th>
                  <SortHead label="Last sign-in" k="last" sort={sort} onSort={onSort} />
                  <SortHead label="Status" k="status" sort={sort} onSort={onSort} />
                  <th className="w-16 px-5 py-3.5" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => {
                  const self = m.id === selfId
                  const counter = m.role === 'kiosk'
                  return (
                    <tr key={m.id} className="border-b border-border-card last:border-0 hover:bg-hover/40">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <Avatar name={m.full_name} />
                          <div className="min-w-0">
                            <p className="truncate text-[14px] font-medium text-ink">
                              {m.full_name}
                              {self && <span className="ml-2 text-[12px] font-normal text-muted">You</span>}
                            </p>
                            <p className="truncate text-[13px] text-slate">{m.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-[14px] text-ink">{roleLabel(m.role)}</td>
                      <td className="px-5 py-4 text-[13px] text-slate">
                        <span className="break-all">{m.username}</span>
                      </td>
                      <td className="px-5 py-4 text-[14px] text-slate">{m.shift ?? <span className="text-muted">—</span>}</td>
                      <td className="px-5 py-4 text-[14px] text-slate">{ago(m.last_login_at)}</td>
                      <td className="px-5 py-4">
                        <StatusPill status={m.status} />
                      </td>
                      <td className="px-5 py-4 text-right">
                        {!counter && (
                          <RowActionsMenu
                            actions={[
                              { label: 'Edit details and role', onClick: () => setDrawer(m) },
                              m.status === 'active'
                                ? {
                                    label: 'Deactivate',
                                    disabled: self,
                                    onClick: () => setConfirm({ member: m, to: 'inactive' }),
                                  }
                                : { label: 'Activate', onClick: () => setConfirm({ member: m, to: 'active' }) },
                            ]}
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}

                {isLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-border-card last:border-0">
                      <td colSpan={7} className="px-5 py-4">
                        <div className="h-9 animate-pulse rounded-lg bg-surface-muted" />
                      </td>
                    </tr>
                  ))}
                {isError && (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-[14px] text-negative">
                      Could not load staff. Only an admin can see this list.
                    </td>
                  </tr>
                )}
                {!isLoading && !isError && sorted.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-[14px] text-muted">
                      {query ? `No one matches “${query}”.` : 'No staff yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'Roles' && (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...ROLE_ORDER, 'kiosk' as const].map((r) => {
            const meta = ROLE_META[r]
            return (
              <section key={r} className="rounded-xl border border-border-card bg-white p-5">
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-[17px] text-ink">{meta.label}</h3>
                  {!meta.available && r !== 'kiosk' && (
                    <span className="rounded-full border border-border-soft px-2 py-px text-[11px] text-muted">Soon</span>
                  )}
                  <span className="flex-1" />
                  <span className="text-[13px] text-slate">
                    {counts[r] ?? 0} {(counts[r] ?? 0) === 1 ? 'person' : 'people'}
                  </span>
                </div>
                <p className="mt-1 text-[14px] text-slate">{meta.summary}</p>
                <ul className="mt-4 flex flex-col gap-2 text-[14px] text-ink">
                  {meta.can.map((c) => (
                    <li key={c} className="flex gap-2.5">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-positive" />
                      {c}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 border-t border-border-card pt-3 text-[13px] text-slate">{meta.cannot}</p>
              </section>
            )
          })}
        </div>
      )}

      {drawer && (
        <StaffDrawer
          key={drawer === 'new' ? 'new' : drawer.id}
          member={drawer === 'new' ? undefined : drawer}
          isSelf={drawer !== 'new' && drawer.id === selfId}
          onClose={() => setDrawer(null)}
          onDone={(message) => {
            setDrawer(null)
            notify(message)
          }}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.to === 'inactive' ? `Deactivate ${confirm.member.full_name}?` : `Activate ${confirm.member.full_name}?`}
          message={
            confirm.to === 'inactive'
              ? 'They will be signed out and cannot sign in again until you reactivate them. Their history stays.'
              : 'They will be able to sign in again with their existing username and password.'
          }
          confirmLabel={confirm.to === 'inactive' ? 'Deactivate' : 'Activate'}
          danger={confirm.to === 'inactive'}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void runConfirm()}
        />
      )}

      {toast}
    </div>
  )
}
