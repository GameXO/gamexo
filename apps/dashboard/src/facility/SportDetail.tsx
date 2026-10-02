/**
 * One sport: its courts, its facility details, its pricing.
 *
 * Courts are retired two different ways, and the screen says which is which. A court
 * with no history can be removed outright. One that has been booked cannot — a booking
 * is a financial record — so it is *disabled* instead, which takes it out of booking
 * and keeps everything it ever did. The server enforces the difference; the menu just
 * offers both and reports the server's reason when Remove is refused.
 */
import { useMemo, useState } from 'react'
import { ChevronRight, Clock, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import ConfirmDialog from '../ui/ConfirmDialog'
import StatusPill from '../ui/StatusPill'
import RowActionsMenu from '../ui/RowActionsMenu'
import Toggle from '../manage/Toggle'
import { SettingsRow } from '../settings/SettingsPanel'
import { ApiError } from '../api/client'
import {
  useDeleteCourt,
  useDeleteSport,
  useManagedCourts,
  useSaveCourt,
  useSaveSport,
  type CourtRecord,
  type SportRecord,
} from '../api/hooks'
import CourtDrawer from './CourtDrawer'
import { ImageGallery, ImageUploader } from './ImageFields'
import SportThumb from './SportThumb'
import { hoursLabel } from './hours'

const MAX_SPORT_IMAGES = 8

const rupees = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

const INPUT =
  'w-full rounded-lg border border-border-card bg-white px-3.5 py-2.5 text-sm text-ink shadow-control outline-none transition-colors placeholder:text-muted focus:border-lime-ink'

const TABS = ['Courts', 'Facility', 'Pricing'] as const
type Tab = (typeof TABS)[number]

const messageOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

export default function SportDetail({
  sport,
  onBack,
  onNotify,
}: {
  sport: SportRecord
  onBack: () => void
  onNotify: (message: string, tone?: 'success' | 'error') => void
}) {
  const [tab, setTab] = useState<Tab>('Courts')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const saveSport = useSaveSport()
  const deleteSport = useDeleteSport()
  const { data: allCourts } = useManagedCourts()

  const courts = useMemo(
    () => (allCourts ?? []).filter((c) => c.sport_id === sport.id).sort((a, b) => a.name.localeCompare(b.name)),
    [allCourts, sport.id],
  )

  // The switch flips at once (see `useSaveSport`); the toast confirms once the server
  // has agreed, and the switch snaps back with an error if it has not.
  function setActive(is_active: boolean) {
    saveSport.mutate(
      { sportId: sport.id, body: { is_active } },
      {
        onSuccess: () => onNotify(`${sport.name} ${is_active ? 'enabled' : 'disabled'}`),
        onError: (err) => onNotify(messageOf(err, 'Could not update this sport.'), 'error'),
      },
    )
  }

  async function onDelete() {
    setConfirmDelete(false)
    try {
      await deleteSport.mutateAsync(sport.id)
      onNotify(`${sport.name} removed`)
      onBack()
    } catch (err) {
      onNotify(messageOf(err, 'Could not remove this sport.'), 'error')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={onBack}
          className="font-medium text-slate underline-offset-2 hover:text-ink hover:underline"
        >
          Sports
        </button>
        <ChevronRight size={14} className="text-muted" />
        <span className="font-medium text-ink">{sport.name}</span>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <SportThumb sport={sport} className="size-14" />
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-tight text-ink">{sport.name}</h1>
              <StatusPill label={sport.is_active ? 'Active' : 'Disabled'} tone={sport.is_active ? 'positive' : 'neutral'} />
            </div>
            <p className="mt-1 text-sm text-slate">
              {courts.length} {courts.length === 1 ? 'court' : 'courts'} ·{' '}
              {courts.filter((c) => c.is_bookable).length} open for booking
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2.5 text-sm text-slate">
            {sport.is_active ? 'Active' : 'Disabled'}
            <Toggle checked={sport.is_active ?? true} onChange={() => setActive(!sport.is_active)} />
          </label>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={courts.length > 0}
            title={courts.length > 0 ? 'Remove its courts first, or disable the sport instead' : 'Remove this sport'}
            className="inline-flex items-center gap-2 rounded-lg border border-border-card bg-white px-3.5 py-2 text-sm font-medium text-negative shadow-control hover:bg-negative/5 disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-white"
          >
            <Trash2 size={15} />
            Remove sport
          </button>
        </div>
      </header>

      <div role="tablist" className="flex gap-6 border-b border-border-soft">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors ${
              tab === t ? 'border-ink text-ink' : 'border-transparent text-slate hover:text-ink'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div key={tab} className="animate-section-in motion-reduce:animate-none">
        {tab === 'Courts' && <CourtsTab sport={sport} courts={courts} onNotify={onNotify} />}
        {tab === 'Facility' && <FacilityTab sport={sport} onNotify={onNotify} />}
        {tab === 'Pricing' && <PricingTab sport={sport} onNotify={onNotify} />}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Remove ${sport.name}?`}
          message="This deletes the sport. It can't be undone — to hide it without losing anything, disable it instead."
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void onDelete()}
        />
      )}
    </div>
  )
}

/* ── Courts ─────────────────────────────────────────────────────────────── */

function CourtsTab({
  sport,
  courts,
  onNotify,
}: {
  sport: SportRecord
  courts: CourtRecord[]
  onNotify: (message: string, tone?: 'success' | 'error') => void
}) {
  // Unscoped: codes are unique academy-wide, so every branch's courts must be seen.
  const { data: everyCourt } = useManagedCourts(false)
  const saveCourt = useSaveCourt()
  const deleteCourt = useDeleteCourt()
  const [drawer, setDrawer] = useState<CourtRecord | 'new' | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<CourtRecord | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const takenCodes = useMemo(() => new Set((everyCourt ?? []).map((c) => c.code)), [everyCourt])

  // Flips immediately and rolls back on failure — see `useSaveCourt`. Not awaited, so
  // several courts can be switched in a row without waiting on each other.
  function toggleBookable(court: CourtRecord) {
    const enabling = !court.is_bookable
    saveCourt.mutate(
      { courtId: court.id, body: { is_bookable: enabling, ...(enabling ? { maintenance_note: null } : {}) } },
      {
        onSuccess: () => onNotify(`${court.name} ${enabling ? 'enabled' : 'disabled'}`),
        onError: (err) => onNotify(messageOf(err, 'Could not update that court.'), 'error'),
      },
    )
  }

  async function remove(court: CourtRecord) {
    setConfirmRemove(null)
    setBusyId(court.id)
    try {
      await deleteCourt.mutateAsync(court.id)
      onNotify(`${court.name} removed`)
    } catch (err) {
      // The server's reason names the booking count and the alternative — pass it on.
      onNotify(messageOf(err, 'Could not remove that court.'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate">
          Click a court to change its booking hours, pricing and photos.
        </p>
        <button
          type="button"
          onClick={() => setDrawer('new')}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-control"
        >
          <Plus size={15} />
          Add court
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border-card bg-white shadow-card">
        {courts.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm font-medium text-ink">No courts yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate">
              Add a court and it can be booked straight away, with the default hours (6:00 AM – 10:00 PM).
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border-card text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Court</th>
                  <th className="px-3 py-3 font-medium">Booking hours</th>
                  <th className="px-3 py-3 font-medium">Rate</th>
                  <th className="px-3 py-3 font-medium">Open for booking</th>
                  <th className="w-12 px-3 py-3" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {courts.map((court) => {
                  const busy = busyId === court.id
                  return (
                    <tr
                      key={court.id}
                      onClick={() => setDrawer(court)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setDrawer(court)
                        }
                      }}
                      className="cursor-pointer border-b border-border-card/70 transition-colors last:border-0 hover:bg-surface-muted/70 focus-visible:bg-surface-muted/70 focus-visible:outline-none"
                    >
                      <td className="px-5 py-3.5">
                        <p className={`font-semibold ${court.is_bookable ? 'text-ink' : 'text-muted'}`}>{court.name}</p>
                        <p className="text-xs text-muted">
                          {court.is_bookable ? court.code : (court.maintenance_note || 'Disabled')}
                        </p>
                      </td>
                      <td className="px-3 py-3.5 text-slate">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock size={14} className="text-muted" />
                          {hoursLabel(court.operating_hours)}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <p className="font-medium text-ink">{rupees(court.hourly_rate)}/hr</p>
                        <p className="text-xs text-muted">Peak {rupees(court.peak_rate)}/hr</p>
                      </td>
                      <td className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <Toggle checked={court.is_bookable ?? true} disabled={busy} onChange={() => toggleBookable(court)} />
                          {busy && <Loader2 size={14} className="animate-spin text-muted" />}
                        </div>
                      </td>
                      <td className="px-3 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <RowActionsMenu
                          actions={[
                            { label: 'Edit court', icon: Pencil, onClick: () => setDrawer(court) },
                            { label: 'Remove', icon: Trash2, danger: true, onClick: () => setConfirmRemove(court) },
                          ]}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawer && (
        <CourtDrawer
          // Remounted per court so one court's draft never carries into another's.
          key={drawer === 'new' ? 'new' : drawer.id}
          sport={sport}
          court={drawer === 'new' ? null : drawer}
          takenCodes={takenCodes}
          onClose={() => setDrawer(null)}
          onSaved={(message) => {
            setDrawer(null)
            onNotify(message)
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={`Remove ${confirmRemove.name}?`}
          message="This deletes the court. A court that has bookings can't be removed — switch it off with the toggle instead and its history stays intact."
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => void remove(confirmRemove)}
        />
      )}
    </div>
  )
}

/* ── Facility: description and photos ───────────────────────────────────── */

function FormFooter({
  dirty,
  saving,
  onCancel,
  onSave,
}: {
  dirty: boolean
  saving: boolean
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-3 border-t border-dashed border-border-soft py-5">
      <button
        type="button"
        onClick={onCancel}
        disabled={!dirty || saving}
        className="rounded-lg border border-border-card bg-white px-4 py-2 text-sm font-medium text-ink shadow-control disabled:opacity-40"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
        className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white shadow-control disabled:opacity-40"
      >
        {saving && <Loader2 size={14} className="animate-spin" />}
        Save changes
      </button>
    </div>
  )
}

function FacilityTab({
  sport,
  onNotify,
}: {
  sport: SportRecord
  onNotify: (message: string, tone?: 'success' | 'error') => void
}) {
  const save = useSaveSport()
  const initial = {
    description: sport.description ?? '',
    cover: sport.image_url ?? null,
    images: sport.images ?? [],
  }
  const [description, setDescription] = useState(initial.description)
  const [cover, setCover] = useState<string | null>(initial.cover)
  const [images, setImages] = useState<string[]>(initial.images)

  const dirty =
    description !== initial.description ||
    cover !== initial.cover ||
    images.length !== initial.images.length ||
    images.some((u, i) => u !== initial.images[i])

  async function onSave() {
    try {
      await save.mutateAsync({
        sportId: sport.id,
        body: { description: description.trim() || null, image_url: cover, images },
      })
      onNotify('Facility details saved')
    } catch (err) {
      onNotify(messageOf(err, 'Could not save these details.'), 'error')
    }
  }

  return (
    <div>
      <SettingsRow label="Description" description="Describe the facility: surface, lighting, what to bring.">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          maxLength={4000}
          placeholder="e.g. Two floodlit synthetic-turf courts with changing rooms and free parking."
          className={`${INPUT} resize-y leading-relaxed`}
        />
        <p className="mt-1.5 text-right text-xs text-muted">{description.length} / 4000</p>
      </SettingsRow>

      <SettingsRow label="Cover photo" description="Shown in the sports list and on the booking screen.">
        <ImageUploader value={cover} onChange={setCover} label="Upload a cover photo" />
      </SettingsRow>

      <SettingsRow label="Gallery" description="More photos of the facility.">
        <ImageGallery values={images} onChange={setImages} max={MAX_SPORT_IMAGES} />
      </SettingsRow>

      <FormFooter
        dirty={dirty}
        saving={save.isPending}
        onCancel={() => {
          setDescription(initial.description)
          setCover(initial.cover)
          setImages(initial.images)
        }}
        onSave={() => void onSave()}
      />
    </div>
  )
}

/* ── Pricing ────────────────────────────────────────────────────────────── */

const DURATIONS = [30, 45, 60, 90, 120]

function PricingTab({
  sport,
  onNotify,
}: {
  sport: SportRecord
  onNotify: (message: string, tone?: 'success' | 'error') => void
}) {
  const save = useSaveSport()
  const initial = {
    base: String(Number(sport.price_base ?? 0)),
    peak: String(Number(sport.price_peak ?? 0)),
    weekend: String(Number(sport.price_weekend ?? 0)),
    duration: sport.default_duration_min ?? 60,
  }
  const [base, setBase] = useState(initial.base)
  const [peak, setPeak] = useState(initial.peak)
  const [weekend, setWeekend] = useState(initial.weekend)
  const [duration, setDuration] = useState(initial.duration)

  const valid = [base, peak, weekend].every((v) => v.trim() !== '' && Number(v) >= 0)
  const dirty =
    base !== initial.base || peak !== initial.peak || weekend !== initial.weekend || duration !== initial.duration

  async function onSave() {
    try {
      await save.mutateAsync({
        sportId: sport.id,
        body: {
          price_base: base,
          price_peak: peak,
          price_weekend: weekend,
          default_duration_min: duration,
        },
      })
      onNotify('Pricing saved')
    } catch (err) {
      onNotify(messageOf(err, 'Could not save the pricing.'), 'error')
    }
  }

  const money = (value: string, set: (v: string) => void, id: string) => (
    <div className="relative max-w-xs">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">₹</span>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        value={value}
        onChange={(e) => set(e.target.value)}
        className={`${INPUT} pl-8`}
      />
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted">per hour</span>
    </div>
  )

  return (
    <div>
      <p className="mb-2 max-w-3xl text-sm text-slate">
        These are the starting rates for {sport.name}. A new court begins with them, and each court can set its
        own from the Courts tab.
      </p>

      <SettingsRow label="Standard rate" description="Off-peak, weekday hours." htmlFor="rate-base">
        {money(base, setBase, 'rate-base')}
      </SettingsRow>
      <SettingsRow label="Peak rate" description="During your peak window." htmlFor="rate-peak">
        {money(peak, setPeak, 'rate-peak')}
      </SettingsRow>
      <SettingsRow label="Weekend rate" description="Saturdays and Sundays." htmlFor="rate-weekend">
        {money(weekend, setWeekend, 'rate-weekend')}
      </SettingsRow>
      <SettingsRow label="Default slot length" description="How long a booking runs unless the customer chooses otherwise." htmlFor="slot-length">
        <select
          id="slot-length"
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          className={`${INPUT} max-w-xs`}
        >
          {[...new Set([...DURATIONS, initial.duration])].sort((a, b) => a - b).map((m) => (
            <option key={m} value={m}>
              {m} minutes
            </option>
          ))}
        </select>
      </SettingsRow>

      {!valid && <p className="pb-2 text-[12px] text-negative">Enter a rate of zero or more for every field.</p>}

      <FormFooter
        dirty={dirty && valid}
        saving={save.isPending}
        onCancel={() => {
          setBase(initial.base)
          setPeak(initial.peak)
          setWeekend(initial.weekend)
          setDuration(initial.duration)
        }}
        onSave={() => void onSave()}
      />
    </div>
  )
}
