/**
 * Sports & Courts — the screen a turf actually configures itself from.
 *
 * Two levels. The grid of sports is the top, and drilling into one shows its
 * courts. That shape follows the data: a court cannot exist without a sport, and
 * a flat list of every court at a multi-sport venue is unreadable by about the
 * twentieth row.
 *
 * Replaces the read-only version that rendered a static array from
 * facilityData.ts. Everything here reads and writes the API.
 */
import { useState } from 'react'
import { ArrowLeft, Plus, Star } from 'lucide-react'
import ConfirmDialog from '../ui/ConfirmDialog'
import Toggle from '../manage/Toggle'
import CourtDrawer, { type CourtDraft } from './CourtDrawer'
import AddSportModal from './AddSportModal'
import {
  useDeleteSport,
  useRawCourts,
  useRawSports,
  useUpdateSport,
  type FacilityCourtOut,
} from '../api/hooks'
import { ApiError, mediaUrl } from '../api/client'
import type { components } from '../api/schema'

type SportOut = components['schemas']['SportOut']
type CourtOut = FacilityCourtOut

export default function CourtsOverview({ onStartBooking }: { onStartBooking: () => void }) {
  const [openSportId, setOpenSportId] = useState<string | null>(null)

  const sports = useRawSports()
  const courts = useRawCourts()

  const openSport = sports.data?.find((s) => s.id === openSportId) ?? null

  if (sports.isPending) {
    return <Centered>Loading your sports…</Centered>
  }

  if (openSport) {
    return (
      <CourtsForSport
        sport={openSport}
        courts={(courts.data ?? []).filter((c) => c.sport_id === openSport.id)}
        onBack={() => setOpenSportId(null)}
        onStartBooking={onStartBooking}
      />
    )
  }

  return (
    <SportsGrid
      sports={sports.data ?? []}
      courts={courts.data ?? []}
      onOpen={setOpenSportId}
    />
  )
}

/* ── Level 1: the sports ──────────────────────────────────────────────────── */

function SportsGrid({
  sports,
  courts,
  onOpen,
}: {
  sports: SportOut[]
  courts: CourtOut[]
  onOpen: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<SportOut | null>(null)
  const [error, setError] = useState<string | null>(null)

  const update = useUpdateSport()
  const remove = useDeleteSport()

  const countFor = (sportId: string) => courts.filter((c) => c.sport_id === sportId).length

  async function destroy(sport: SportOut) {
    setConfirmDelete(null)
    setError(null)
    try {
      await remove.mutateAsync(sport.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove that sport.')
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <div>
        <p className="text-lg text-ink">Sports</p>
        <p className="mt-1 text-sm text-slate">
          Pick a sport to manage its courts — prices, timings, photos and open slots.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sports.map((sport) => {
          const count = countFor(sport.id)
          return (
            <div
              key={sport.id}
              className={`flex flex-col gap-4 rounded-xl border border-border-card bg-surface p-5 ${
                sport.is_active ? '' : 'opacity-60'
              }`}
            >
              <button
                type="button"
                onClick={() => onOpen(sport.id)}
                className="flex items-center gap-3 text-left"
              >
                <span
                  aria-hidden
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-xl"
                  style={{ backgroundColor: sport.bg_color ?? '#f2f2f2' }}
                >
                  {sport.icon ?? '🏅'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-base font-semibold text-ink">
                    {sport.name}
                  </span>
                  <span className="block text-sm text-slate">
                    {count === 0 ? 'No courts yet' : `${count} court${count === 1 ? '' : 's'}`}
                    {' · '}₹{Number(sport.price_base ?? 0).toLocaleString('en-IN')}/hr
                  </span>
                </span>
              </button>

              <div className="flex items-center justify-between border-t border-border-soft pt-3">
                <label className="flex items-center gap-2 text-[13px] text-slate">
                  <Toggle
                    checked={sport.is_active ?? true}
                    disabled={update.isPending}
                    onChange={() =>
                      update.mutate({ id: sport.id, body: { is_active: !sport.is_active } })
                    }
                  />
                  {sport.is_active ? 'Offered' : 'Hidden'}
                </label>

                {/* Only offered for a sport with nothing hanging off it. The API
                    refuses the rest anyway; not showing the button is kinder than
                    a 409 the owner had no way to predict. */}
                {count === 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(sport)}
                    className="text-[13px] font-medium text-negative"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          )
        })}

        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-input p-5 text-slate hover:border-ink hover:text-ink"
        >
          <Plus size={20} />
          <span className="text-sm font-medium">Add a sport</span>
        </button>
      </div>

      {adding && <AddSportModal existing={sports} onClose={() => setAdding(false)} />}

      {confirmDelete && (
        <ConfirmDialog
          title={`Remove ${confirmDelete.name}?`}
          message="It will disappear from bookings and the counter. You can add it again later."
          confirmLabel="Remove"
          danger
          onConfirm={() => void destroy(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

/* ── Level 2: one sport's courts ──────────────────────────────────────────── */

function CourtsForSport({
  sport,
  courts,
  onBack,
  onStartBooking,
}: {
  sport: SportOut
  courts: CourtOut[]
  onBack: () => void
  onStartBooking: () => void
}) {
  // `undefined` means the drawer is closed; `null` means it is open on a new
  // court. Two different states that a single nullable would conflate.
  const [editing, setEditing] = useState<CourtOut | null | undefined>(undefined)

  /**
   * A new court starts as a copy of the last one, or as "Court 1" for a sport
   * that has none. The empty state is where this matters most: a sport straight
   * out of onboarding opens with a court already sketched in, priced from the
   * sport's own rate, so the owner confirms rather than composes.
   */
  const nextDraft = (): Partial<CourtDraft> => {
    const last = courts[courts.length - 1]
    const n = courts.length + 1
    return {
      name: `Court ${n}`,
      code: `C${n}`,
      hourly_rate: String(last?.hourly_rate ?? sport.price_base ?? ''),
      peak_rate: String(last?.peak_rate ?? sport.price_peak ?? ''),
      amenities: last?.amenities ?? [],
      open: (last?.operating_hours as Record<string, string> | undefined)?.open ?? '06:00',
      close: (last?.operating_hours as Record<string, string> | undefined)?.close ?? '22:00',
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex size-9 items-center justify-center rounded-lg border border-border-input bg-surface text-ink"
          aria-label="Back to sports"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg text-ink">
            <span aria-hidden className="mr-2">
              {sport.icon ?? '🏅'}
            </span>
            {sport.name}
          </p>
          <p className="text-sm text-slate">
            {courts.length === 0
              ? 'No courts yet'
              : `${courts.length} court${courts.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(null)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white"
        >
          <Plus size={15} />
          Add court
        </button>
      </div>

      {courts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-input p-10 text-center">
          <p className="font-display text-base font-semibold text-ink">
            Add your first {sport.name.toLowerCase()} court
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate">
            Set its price, the hours it is available, and the facilities players get. You can
            add more courts afterwards in a couple of taps.
          </p>
          <button
            type="button"
            onClick={() => setEditing(null)}
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white"
          >
            <Plus size={15} />
            Add court
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {courts.map((court) => (
            <CourtCard key={court.id} court={court} onEdit={() => setEditing(court)} />
          ))}
        </div>
      )}

      {courts.length > 0 && (
        <button
          type="button"
          onClick={onStartBooking}
          className="self-start text-sm font-medium text-ink underline"
        >
          Take a booking on one of these
        </button>
      )}

      {editing !== undefined && (
        <CourtDrawer
          court={editing}
          sportId={sport.id}
          initial={editing === null ? nextDraft() : undefined}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  )
}

function CourtCard({ court, onEdit }: { court: CourtOut; onEdit: () => void }) {
  const hours = (court.operating_hours ?? {}) as Record<string, string>
  const cover = court.images?.[0]

  return (
    <button
      type="button"
      onClick={onEdit}
      className="flex flex-col overflow-hidden rounded-xl border border-border-card bg-surface text-left"
    >
      <div className="relative h-28 w-full bg-page">
        {cover ? (
          <img src={mediaUrl(cover)} alt="" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted">
            No photo
          </div>
        )}

        {!court.is_bookable && (
          <span className="absolute left-2 top-2 rounded-full bg-ink/80 px-2 py-0.5 text-[11px] font-medium text-white">
            Unavailable
          </span>
        )}
        {court.open_slots_enabled && (
          <span className="absolute right-2 top-2 rounded-full bg-lime px-2 py-0.5 text-[11px] font-medium text-lime-ink">
            {court.slot_capacity} slots
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate font-display text-base font-semibold text-ink">
            {court.name}
          </p>
          {court.rating != null && (
            <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-slate">
              <Star size={11} className="fill-current" />
              {Number(court.rating).toFixed(1)}
            </span>
          )}
        </div>

        <p className="text-sm text-slate">
          ₹{Number(court.hourly_rate ?? 0).toLocaleString('en-IN')}/hr
          {hours.open && hours.close ? ` · ${hours.open}–${hours.close}` : ''}
        </p>

        {court.amenities && court.amenities.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {court.amenities.slice(0, 3).map((chip) => (
              <span
                key={chip}
                className="rounded-full bg-page px-2 py-0.5 text-[11px] font-medium text-slate"
              >
                {chip}
              </span>
            ))}
            {court.amenities.length > 3 && (
              <span className="px-1 py-0.5 text-[11px] text-muted">
                +{court.amenities.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-slate">{children}</div>
  )
}
