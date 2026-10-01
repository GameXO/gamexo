import { useState } from 'react'
import { useCourts, useSports } from '../../api/hooks'
import { money } from '../../lib/format'
import type { Draft } from '../types'
import { asset } from '../../lib/asset'

const arrowRight = asset('pos/checkin/arrow-right-check.svg')

function Status({ error, empty, what }: { error?: unknown; empty?: boolean; what: string }) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-negative">
        Could not load {what}: {error instanceof Error ? error.message : 'unknown error'}
      </p>
    )
  }
  if (empty) return <p className="text-sm text-muted">No {what} yet.</p>
  return <p className="text-sm text-muted">Loading {what}…</p>
}

export default function SelectSportCourt({
  draft,
  setDraft,
  courtListOpen,
  setCourtListOpen,
  onPickCourt,
}: {
  draft: Draft
  setDraft: (patch: Partial<Draft>) => void
  courtListOpen: boolean
  setCourtListOpen: (open: boolean) => void
  onPickCourt: (courtId: string) => void
}) {
  const sportsQuery = useSports()
  const courtsQuery = useCourts(draft.sportId || undefined)

  const pickSport = (sportId: string) => {
    setDraft({ sportId, courtId: null, date: null, startHour: null })
    setCourtListOpen(true)
  }

  if (!courtListOpen) {
    return (
      <div className="flex w-full flex-col gap-5">
        <p className="text-[clamp(1rem,1.3vw,1.125rem)] font-medium text-ink">What&apos;s the walk-in playing?</p>
        {sportsQuery.data === undefined || sportsQuery.data.length === 0 ? (
          <Status error={sportsQuery.error} empty={sportsQuery.data?.length === 0} what="sports" />
        ) : (
          <div className="grid w-full grid-cols-2 gap-[clamp(0.75rem,1.6vw,1.25rem)] sm:grid-cols-3 lg:grid-cols-4">
            {sportsQuery.data.map((sport) => (
              <button
                key={sport.id}
                type="button"
                onClick={() => pickSport(sport.id)}
                className="flex flex-col items-start overflow-hidden rounded-2xl bg-surface text-left transition-transform hover:-translate-y-0.5"
              >
                <SportArt image={sport.image} icon={sport.icon} bgColor={sport.bgColor} />
                <div className="flex w-full flex-col items-start gap-1.5 p-[clamp(0.875rem,1.6vw,1.125rem)]">
                  <p className="text-[clamp(1.05rem,1.6vw,1.25rem)] font-bold text-ink">{sport.name}</p>
                  <p className="text-[clamp(0.8125rem,1vw,0.875rem)] font-medium text-muted">{sport.fieldsLabel}</p>
                  <p className="text-[clamp(0.8125rem,1vw,0.875rem)] font-semibold text-positive">
                    From {money(sport.from)}/hr
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const sport = sportsQuery.data?.find((s) => s.id === draft.sportId)
  const courts = (courtsQuery.data ?? []).filter((c) => c.bookable)

  return (
    <div className="flex w-full flex-col gap-5">
      <p className="text-[clamp(1rem,1.3vw,1.125rem)] font-medium text-ink">{sport?.name}</p>

      {courtsQuery.isPending || courtsQuery.error || courts.length === 0 ? (
        <Status error={courtsQuery.error} empty={!courtsQuery.isPending && courts.length === 0} what="courts" />
      ) : (
        <div className="grid w-full grid-cols-1 gap-[clamp(0.75rem,1.6vw,1.25rem)] sm:grid-cols-2 xl:grid-cols-3">
          {courts.map((court) => {
            const active = draft.courtId === court.id
            const occupied = court.status === 'occupied'
            return (
              <div
                key={court.id}
                className={`flex h-full flex-col overflow-hidden rounded-2xl border-[3px] bg-white shadow-[0px_20px_45px_-15px_rgba(0,0,0,0.12)] transition-colors ${
                  active ? 'border-lime' : 'border-white'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onPickCourt(court.id)}
                  className="flex w-full flex-1 flex-col items-start gap-3 px-[clamp(1.1rem,1.8vw,1.375rem)] pb-3 pt-[clamp(1.1rem,1.8vw,1.375rem)] text-left"
                >
                  <div className="flex w-full items-start justify-between">
                    <p className="text-[clamp(1.15rem,1.8vw,1.375rem)] font-bold text-ink">{court.name}</p>
                    <p className="text-[clamp(0.9375rem,1.1vw,1rem)] font-semibold text-ink">
                      {money(court.price)}<span className="font-medium text-muted">/hr</span>
                    </p>
                  </div>
                  <p className="text-[clamp(0.875rem,1vw,0.9375rem)] font-medium text-muted">{court.sportName}</p>
                  {occupied && (
                    <span className="rounded-full bg-flame/15 px-2.5 py-1 text-xs font-semibold text-flame">
                      In play right now — pick a later slot
                    </span>
                  )}
                  <p className="text-[clamp(0.8125rem,0.95vw,0.875rem)] text-muted">{court.amenities.join(' · ')}</p>
                </button>

                <div className="flex w-full items-center justify-end bg-surface-muted px-[clamp(1.1rem,1.8vw,1.375rem)] py-3">
                  <button
                    type="button"
                    onClick={() => onPickCourt(court.id)}
                    className="flex shrink-0 items-center gap-1.5 rounded-xl bg-ink py-2 pl-3.5 pr-2.5 text-[clamp(0.8125rem,0.95vw,0.875rem)] font-bold text-white"
                  >
                    Pick Slot
                    <img src={arrowRight} alt="" className="size-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}


/**
 * The sport's photo from the asset CDN, or — when it has none (a sport a venue
 * created itself, or one nobody has uploaded a photo for) — its own icon on its own
 * tint. The photo URL always exists; only loading it says whether there is one.
 */
function SportArt({ image, icon, bgColor }: { image: string; icon?: string; bgColor?: string }) {
  const [missing, setMissing] = useState(false)
  return (
    <div
      className="flex h-[clamp(6rem,12vw,8.5rem)] w-full items-center justify-center bg-surface-muted"
      style={missing && bgColor ? { backgroundColor: bgColor } : undefined}
    >
      {missing ? (
        <span aria-hidden className="text-[clamp(2.5rem,5vw,3.5rem)] leading-none">
          {icon || '🏅'}
        </span>
      ) : (
        <img src={image} alt="" className="size-full object-cover" onError={() => setMissing(true)} />
      )}
    </div>
  )
}
