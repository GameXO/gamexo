import { useState } from 'react'
import { type Draft } from '../../data/booking'
import { useCourts, useSports } from '../../api/hooks'
import arrowRight from '../../assets/figma/arrow-right-01.svg'

/** Keeps the two fetch states below from drifting apart visually. */
function Status({ error, empty, what }: { error?: unknown; empty?: boolean; what: string }) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-negative">
        Could not load {what}: {error instanceof Error ? error.message : 'unknown error'}
      </p>
    )
  }
  if (empty) return <p className="text-sm text-slate">No {what} yet.</p>
  return <p className="text-sm text-slate">Loading {what}…</p>
}

function OfflineBadge() {
  const [online, setOnline] = useState(false)
  return (
    <button
      type="button"
      onClick={() => setOnline((v) => !v)}
      className={`flex shrink-0 items-center justify-end overflow-hidden rounded-xl px-3.5 py-2.5 transition-colors ${
        online ? 'bg-positive' : 'bg-flame'
      }`}
    >
      <p className="whitespace-nowrap text-sm text-[#fefefe]">{online ? 'Online' : 'Offline'}</p>
    </button>
  )
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
    setDraft({ sportId, courtId: null, startHour: null })
    setCourtListOpen(true)
  }

  if (!courtListOpen) {
    return (
      <div className="flex w-full flex-col gap-5">
        <div className="flex w-full items-center justify-between">
          <p className="text-[clamp(1rem,1.3vw,1.125rem)] font-medium text-ink">What do you want to play?</p>
          <OfflineBadge />
        </div>
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
              <div className="h-[clamp(6rem,12vw,8.5rem)] w-full">
                <img src={sport.image} alt="" className="size-full object-cover" />
              </div>
              <div className="flex w-full flex-col items-start gap-1.5 p-[clamp(0.875rem,1.6vw,1.125rem)]">
                <p className="text-[clamp(0.8125rem,1vw,0.875rem)] font-medium text-slate">{sport.fieldsLabel}</p>
                <p className="text-[clamp(1.05rem,1.6vw,1.25rem)] font-bold text-ink">{sport.name}</p>
                <div className="flex items-center gap-2 text-[clamp(0.8125rem,1vw,0.875rem)] font-medium">
                  <p className="text-slate">Starts from</p>
                  <p className="font-semibold text-positive">₹{sport.from}/hr</p>
                </div>
              </div>
            </button>
          ))}
        </div>
        )}
      </div>
    )
  }

  const sport = sportsQuery.data?.find((s) => s.id === draft.sportId)
  const courts = courtsQuery.data ?? []

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex w-full items-center justify-between">
        <p className="text-[clamp(1rem,1.3vw,1.125rem)] font-medium text-ink">{sport?.name}</p>
        <OfflineBadge />
      </div>

      {courtsQuery.isPending || courtsQuery.error || courts.length === 0 ? (
        <Status error={courtsQuery.error} empty={!courtsQuery.isPending && courts.length === 0} what="courts" />
      ) : (
      <div className="grid w-full grid-cols-1 gap-[clamp(0.75rem,1.6vw,1.25rem)] sm:grid-cols-2 xl:grid-cols-3">
        {courts.map((court) => {
          const active = draft.courtId === court.id
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
                    ₹{court.price}<span className="font-medium text-muted">/hr</span>
                  </p>
                </div>
                <p className="text-[clamp(0.875rem,1vw,0.9375rem)] font-medium text-muted">{court.surface}</p>
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
