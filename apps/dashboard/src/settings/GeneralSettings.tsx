/**
 * Settings → General: the business, and the branches it trades from.
 *
 * Two layers, deliberately kept apart:
 *
 *   **Business information** is the legal entity — name, contact, registered address
 *   and the GSTIN printed when a branch has none of its own. One per academy.
 *
 *   **Branches** are the physical turfs. Each has its own address, phone and
 *   (optionally) GSTIN, and owns a set of courts. A booking takes its branch from
 *   its court, and the invoice prints that branch — so the details entered here are
 *   what a customer is handed, not decoration. The POS tablet is pointed at one
 *   branch and shows only its courts.
 *
 * A branch is never deleted, only closed: courts and years of bookings point at it,
 * and an invoice for a branch that no longer exists is one nobody can reprint.
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Pencil, Phone, Plus, Star } from 'lucide-react'
import Drawer from '../ui/Drawer'
import { SettingsPanel, SettingsRow } from './SettingsPanel'
import { ApiError } from '../api/client'
import {
  useAllCourts,
  useBranches,
  useBusinessSettings,
  useMakeDefaultBranch,
  useSaveBranch,
  useSaveBusinessSettings,
  type BranchOut,
} from '../api/hooks'

const INPUT =
  'w-full rounded-lg border border-border-card bg-white px-3.5 py-2.5 text-sm text-ink shadow-control outline-none transition-colors placeholder:text-muted focus:border-lime-ink'

const messageOf = (err: unknown, fallback: string) =>
  err instanceof ApiError
    ? err.isForbidden
      ? 'Only an admin can change this.'
      : err.message
    : fallback

function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${wide ? 'sm:col-span-2 xl:col-span-2' : ''}`}>
      <span className="text-[12px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}

/* ── Business information ─────────────────────────────────────────────────── */

type BusinessDraft = {
  business_name: string
  phone: string
  email: string
  gst_number: string
  address: string
  city: string
}

const blank = (v: string | null | undefined) => v ?? ''
const orNull = (v: string) => (v.trim() === '' ? null : v.trim())

function BusinessInfoCard() {
  const { data: settings, isLoading, isError } = useBusinessSettings()
  const save = useSaveBusinessSettings()
  const [draft, setDraft] = useState<BusinessDraft | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seeded once from the server, then owned by the form. Re-seeding on every refetch
  // would overwrite what somebody is halfway through typing.
  useEffect(() => {
    if (settings && draft === null) {
      setDraft({
        business_name: settings.business_name,
        phone: blank(settings.phone),
        email: blank(settings.email),
        gst_number: blank(settings.gst_number),
        address: blank(settings.address),
        city: blank(settings.city),
      })
    }
  }, [settings, draft])

  const dirty = useMemo(() => {
    if (!settings || !draft) return false
    return (
      draft.business_name !== settings.business_name ||
      draft.phone !== blank(settings.phone) ||
      draft.email !== blank(settings.email) ||
      draft.gst_number !== blank(settings.gst_number) ||
      draft.address !== blank(settings.address) ||
      draft.city !== blank(settings.city)
    )
  }, [settings, draft])

  const set = <K extends keyof BusinessDraft>(k: K, v: string) => {
    setSaved(false)
    setDraft((d) => (d ? { ...d, [k]: v } : d))
  }

  async function onSave() {
    if (!draft) return
    setError(null)
    try {
      await save.mutateAsync({
        business_name: draft.business_name.trim(),
        phone: orNull(draft.phone),
        email: orNull(draft.email),
        gst_number: orNull(draft.gst_number.toUpperCase()),
        address: orNull(draft.address),
        city: orNull(draft.city),
      })
      setSaved(true)
    } catch (err) {
      setError(messageOf(err, 'Could not save your business details. Please try again.'))
    }
  }

  return (
    <SettingsPanel
      title="Business information"
      description="Your registered business. The GSTIN here is printed on the invoice of any branch that doesn't have its own."
      flush
      action={
        <div className="flex shrink-0 items-center gap-3">
          {saved && !dirty && <span className="text-sm text-lime-ink">Saved</span>}
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={!draft || !dirty || save.isPending || !draft.business_name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white shadow-control disabled:opacity-40"
          >
            {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Save changes
          </button>
        </div>
      }
    >
      {isError && (
        <p role="alert" className="mb-4 rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
          Could not load your business details.
        </p>
      )}

      {isLoading || !draft ? (
        <div className="flex flex-col gap-5 py-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : (
        <>
          <SettingsRow label="Business name" description="Shown on invoices, receipts and emails." htmlFor="biz-name">
            <input
              id="biz-name"
              className={INPUT}
              value={draft.business_name}
              onChange={(e) => set('business_name', e.target.value)}
            />
          </SettingsRow>
          <SettingsRow label="GSTIN" description="Used on any branch that has no GSTIN of its own." htmlFor="biz-gstin">
            <input
              id="biz-gstin"
              className={`${INPUT} uppercase`}
              value={draft.gst_number}
              onChange={(e) => set('gst_number', e.target.value)}
              placeholder="36AABCN1234K1Z9"
              maxLength={20}
            />
          </SettingsRow>
          <SettingsRow label="Contact" description="How customers reach the business." htmlFor="biz-phone">
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                id="biz-phone"
                className={INPUT}
                value={draft.phone}
                onChange={(e) => set('phone', e.target.value)}
                inputMode="tel"
                placeholder="Phone"
                aria-label="Phone"
              />
              <input
                className={INPUT}
                value={draft.email}
                onChange={(e) => set('email', e.target.value)}
                inputMode="email"
                placeholder="Email"
                aria-label="Email"
              />
            </div>
          </SettingsRow>
          <SettingsRow label="Registered address" description="The legal address, not a branch." htmlFor="biz-address">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <input
                id="biz-address"
                className={INPUT}
                value={draft.address}
                onChange={(e) => set('address', e.target.value)}
                placeholder="Street address"
                aria-label="Registered address"
              />
              <input
                className={INPUT}
                value={draft.city}
                onChange={(e) => set('city', e.target.value)}
                placeholder="City"
                aria-label="City"
              />
            </div>
          </SettingsRow>

          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
              {error}
            </p>
          )}
        </>
      )}
    </SettingsPanel>
  )
}

/* ── Branches ─────────────────────────────────────────────────────────────── */

type BranchDraft = {
  name: string
  address: string
  city: string
  state: string
  pincode: string
  phone: string
  email: string
  gstin: string
  is_active: boolean
  courtIds: string[]
}

const EMPTY_BRANCH: BranchDraft = {
  name: '',
  address: '',
  city: '',
  state: '',
  pincode: '',
  phone: '',
  email: '',
  gstin: '',
  is_active: true,
  courtIds: [],
}

function draftFrom(branch: BranchOut, courtIds: string[]): BranchDraft {
  return {
    name: branch.name,
    address: blank(branch.address),
    city: blank(branch.city),
    state: blank(branch.state),
    pincode: blank(branch.pincode),
    phone: blank(branch.phone),
    email: blank(branch.email),
    gstin: blank(branch.gstin),
    is_active: branch.is_active,
    courtIds,
  }
}

const addressLine = (b: Pick<BranchOut, 'address' | 'city' | 'state' | 'pincode'>) =>
  [b.address, b.city, [b.state, b.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ')

function BranchDrawer({
  branch,
  branches,
  onClose,
}: {
  /** `null` adds a new one. */
  branch: BranchOut | null
  branches: BranchOut[]
  onClose: () => void
}) {
  const { data: courts } = useAllCourts()
  const save = useSaveBranch()
  const branchNames = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches])

  const hereNow = useMemo(
    () => (branch ? (courts ?? []).filter((c) => c.branchId === branch.id).map((c) => c.id) : []),
    [branch, courts],
  )
  const [draft, setDraft] = useState<BranchDraft>(() =>
    branch ? draftFrom(branch, []) : EMPTY_BRANCH,
  )
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof BranchDraft>(k: K, v: BranchDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const toggleCourt = (id: string) =>
    set('courtIds', draft.courtIds.includes(id) ? draft.courtIds.filter((c) => c !== id) : [...draft.courtIds, id])

  async function onSave() {
    setError(null)
    const text = (v: string) => (v.trim() === '' ? null : v.trim())
    try {
      await save.mutateAsync({
        branchId: branch?.id,
        body: {
          name: draft.name.trim(),
          address: text(draft.address),
          city: text(draft.city),
          state: text(draft.state),
          pincode: text(draft.pincode),
          phone: text(draft.phone),
          email: text(draft.email),
          gstin: text(draft.gstin.toUpperCase()),
          ...(branch?.is_default ? {} : { is_active: draft.is_active }),
        },
        bringCourtIds: draft.courtIds,
      })
      onClose()
    } catch (err) {
      setError(messageOf(err, 'Could not save this branch. Please try again.'))
    }
  }

  const otherCourts = (courts ?? []).filter((c) => !hereNow.includes(c.id))

  return (
    <Drawer
      title={branch ? `Edit ${branch.name}` : 'Add a branch'}
      subtitle={branch ? undefined : 'Another turf your business runs'}
      onClose={onClose}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={save.isPending || !draft.name.trim()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {branch ? 'Save branch' : 'Add branch'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-card px-4 py-2.5 text-sm text-slate"
          >
            Cancel
          </button>
        </div>
      }
    >
      {error && (
        <p role="alert" className="rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
          {error}
        </p>
      )}

      <div className="grid gap-4">
        <Field label="Branch name">
          <input
            className={INPUT}
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Kondapur"
            autoFocus
          />
        </Field>
        <Field label="Address" hint="Printed on this branch's invoices.">
          <input
            className={INPUT}
            value={draft.address}
            onChange={(e) => set('address', e.target.value)}
            placeholder="Survey 42, Kondapur"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="City">
            <input className={INPUT} value={draft.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="State">
            <input className={INPUT} value={draft.state} onChange={(e) => set('state', e.target.value)} />
          </Field>
          <Field label="Pincode">
            <input
              className={INPUT}
              value={draft.pincode}
              onChange={(e) => set('pincode', e.target.value)}
              inputMode="numeric"
              maxLength={12}
            />
          </Field>
          <Field label="Phone">
            <input
              className={INPUT}
              value={draft.phone}
              onChange={(e) => set('phone', e.target.value)}
              inputMode="tel"
            />
          </Field>
        </div>
        <Field label="Email">
          <input
            className={INPUT}
            value={draft.email}
            onChange={(e) => set('email', e.target.value)}
            inputMode="email"
          />
        </Field>
        <Field
          label="GSTIN"
          hint="Leave empty to print your business GSTIN. A branch registered in another state needs its own."
        >
          <input
            className={`${INPUT} uppercase`}
            value={draft.gstin}
            onChange={(e) => set('gstin', e.target.value)}
            placeholder="36AABCN1234K1Z9"
            maxLength={20}
          />
        </Field>
      </div>

      <div>
        <p className="text-[12px] font-medium text-ink">Courts at this branch</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Tick a court to move it here. A court belongs to exactly one branch, so to take one
          away from this branch, move it to the other one. Bookings already taken stay where
          they were taken.
        </p>
        <div className="mt-3 divide-y divide-dashed divide-border-soft rounded-xl border border-border-card bg-surface">
          {hereNow.map((id) => {
            const court = courts?.find((c) => c.id === id)
            return (
              <div key={id} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
                <Check size={15} className="shrink-0 text-lime-ink" />
                <span className="min-w-0 flex-1 truncate text-ink">{court?.name}</span>
                <span className="text-xs text-muted">{court?.surface}</span>
              </div>
            )
          })}
          {otherCourts.map((court) => (
            <label key={court.id} className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5 text-sm">
              <input
                type="checkbox"
                checked={draft.courtIds.includes(court.id)}
                onChange={() => toggleCourt(court.id)}
                className="size-4 accent-ink"
              />
              <span className="min-w-0 flex-1 truncate text-ink">{court.name}</span>
              <span className="text-xs text-muted">
                {court.surface} · at {branchNames.get(court.branchId ?? '') ?? 'another branch'}
              </span>
            </label>
          ))}
          {courts && courts.length === 0 && (
            <p className="px-3.5 py-3 text-sm text-muted">No courts yet.</p>
          )}
        </div>
      </div>

      {branch && !branch.is_default && (
        <label className="flex items-center justify-between gap-4 rounded-xl border border-border-card bg-surface px-4 py-3">
          <span>
            <span className="block text-[13px] font-medium text-ink">Open for business</span>
            <span className="block text-xs text-muted">
              Closing a branch hides it from the counter. Switch its courts off first.
            </span>
          </span>
          <input
            type="checkbox"
            checked={draft.is_active}
            onChange={(e) => set('is_active', e.target.checked)}
            className="size-4 accent-ink"
          />
        </label>
      )}
    </Drawer>
  )
}

function BranchesCard() {
  const { data: branches, isLoading, isError } = useBranches(true)
  const { data: courts } = useAllCourts()
  const makeDefault = useMakeDefaultBranch()
  const [editing, setEditing] = useState<BranchOut | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const courtCount = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of courts ?? []) if (c.branchId) counts.set(c.branchId, (counts.get(c.branchId) ?? 0) + 1)
    return counts
  }, [courts])

  async function promote(branch: BranchOut) {
    setError(null)
    try {
      await makeDefault.mutateAsync(branch.id)
    } catch (err) {
      setError(messageOf(err, 'Could not change the default branch.'))
    }
  }

  return (
    <SettingsPanel
      title="Branches"
      description="Each turf you run. Its address and GSTIN print on that branch's invoices, and the counter tablet shows only the courts of the branch it's set to."
      flush
      action={
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-white"
        >
          <Plus size={15} />
          Add branch
        </button>
      }
    >
      {(isError || error) && (
        <p role="alert" className="mb-4 rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
          {error ?? 'Could not load your branches.'}
        </p>
      )}

      <div className="divide-y divide-dashed divide-border-soft">
        {isLoading || !branches
          ? Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="py-5">
                <div className="h-4 w-40 animate-pulse rounded bg-surface-muted" />
                <div className="mt-2 h-3 w-72 animate-pulse rounded bg-surface-muted" />
              </div>
            ))
          : branches.map((branch) => {
              const line = addressLine(branch)
              const n = courtCount.get(branch.id) ?? 0
              return (
                <div key={branch.id} className={`flex items-start gap-4 py-5 ${branch.is_active ? '' : 'opacity-60'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[14px] font-medium text-ink">{branch.name}</p>
                      {branch.is_default && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-lime/20 px-2 py-0.5 text-xs text-lime-ink">
                          <Star size={11} /> Default
                        </span>
                      )}
                      {!branch.is_active && (
                        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-slate">
                          Closed
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-slate">
                      {line || 'No address yet — add one so it prints on invoices.'}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                      {branch.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone size={11} /> {branch.phone}
                        </span>
                      )}
                      <span>{branch.gstin ? `GSTIN ${branch.gstin}` : 'Uses business GSTIN'}</span>
                      <span>
                        {n} {n === 1 ? 'court' : 'courts'}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!branch.is_default && branch.is_active && (
                      <button
                        type="button"
                        onClick={() => void promote(branch)}
                        disabled={makeDefault.isPending}
                        className="rounded-lg border border-border-card px-2.5 py-1.5 text-xs text-slate hover:text-ink disabled:opacity-50"
                      >
                        Make default
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditing(branch)}
                      aria-label={`Edit ${branch.name}`}
                      className="flex size-8 items-center justify-center rounded-lg border border-border-card text-slate hover:text-ink"
                    >
                      <Pencil size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
      </div>

      {editing && branches && (
        <BranchDrawer
          // Remounted per branch so the form never carries one branch's draft into another.
          key={editing === 'new' ? 'new' : editing.id}
          branch={editing === 'new' ? null : editing}
          branches={branches}
          onClose={() => setEditing(null)}
        />
      )}
    </SettingsPanel>
  )
}

export function GeneralSettings() {
  return (
    <div className="flex flex-col gap-6">
      <BusinessInfoCard />
      <BranchesCard />
    </div>
  )
}
