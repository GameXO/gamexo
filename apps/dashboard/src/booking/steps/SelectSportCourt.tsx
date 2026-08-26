import { useState } from 'react'
import { Star } from 'lucide-react'
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
      className={`flex shrink-0 items-center justify-end overflow-hidden rounded-lg px-3.5 py-2.5 shadow-[0px_4px_10px_0px_rgba(0,0,0,0.05),0px_10px_120px_0px_rgba(15,73,106,0.1)] transition-colors ${
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
}: {
  draft: Draft
  setDraft: (patch: Partial<Draft>) => void
  courtListOpen: boolean
  setCourtListOpen: (open: boolean) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const sportsQuery = useSports()
  const courtsQuery = useCourts(draft.sportId || undefined)

  const pickSport = (sportId: string) => {
    setDraft({ sportId, courtId: null, startHour: null })
    setCourtListOpen(true)
  }

  const pickCourt = (courtId: string) => {
    setDraft({ courtId })
  }

  if (!courtListOpen) {
    return (
      <div className="flex w-full flex-col gap-5">
        <div className="flex w-full items-center justify-between">
          <p className="text-xl text-ink">What do you want to play?</p>
          <OfflineBadge />
        </div>
        {sportsQuery.data === undefined || sportsQuery.data.length === 0 ? (
          <Status error={sportsQuery.error} empty={sportsQuery.data?.length === 0} what="sports" />
        ) : (
        <div className="content-start flex w-full flex-wrap gap-5">
          {sportsQuery.data.map((sport) => (
            <button
              key={sport.id}
              type="button"
              onClick={() => pickSport(sport.id)}
              className="flex w-[263px] flex-col items-start justify-center gap-4 overflow-hidden rounded-xl border border-surface bg-surface text-left transition-transform hover:-translate-y-0.5"
            >
              <div className="h-[102px] w-full">
                <img src={sport.image} alt="" className="size-full object-cover" />
              </div>
              <div className="flex w-full flex-col items-start gap-3.5 px-2.5 pb-5 pt-2.5">
                <p className="text-sm font-medium leading-[1.5] text-slate">{sport.fieldsLabel}</p>
                <p className="text-[28px] font-semibold leading-[1.2] tracking-[0.28px] text-ink">{sport.name}</p>
                <div className="flex items-center gap-2 text-sm font-medium leading-[1.5]">
                  <p className="text-slate">Starts from</p>
                  <p className="text-positive">₹{sport.from}/hr</p>
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
        <p className="text-xl text-ink">{sport?.name}</p>
        <OfflineBadge />
      </div>

      {courtsQuery.isPending || courtsQuery.error || courts.length === 0 ? (
        <Status error={courtsQuery.error} empty={!courtsQuery.isPending && courts.length === 0} what="courts" />
      ) : (
      <div className="flex w-full flex-wrap items-start gap-5">
        {courts.map((court) => {
          const active = draft.courtId === court.id
          return (
            <div
              key={court.id}
              className={`w-[360px] shrink-0 overflow-hidden rounded-xl border bg-bone shadow-[0px_7px_31px_-13px_rgba(0,0,0,0.25)] transition-colors ${
                active ? 'border-ink' : 'border-black/10'
              }`}
            >
              <button
                type="button"
                onClick={() => pickCourt(court.id)}
                className="flex w-full flex-col items-start gap-5 px-[22px] pb-4 pt-[30px] text-left"
              >
                <div className="flex w-full items-start justify-between font-semibold text-black">
                  <p className="text-[26px] leading-normal">{court.name}</p>
                  <p className="text-base leading-none">
                    ₹{court.price}/<span className="text-black/50">hr</span>
                  </p>
                </div>
                <div className="flex w-full flex-col items-start gap-2.5">
                  <p className="text-base font-normal text-[#606060]">{court.surface}</p>
                  {/* Ratings are not in the API yet — show nothing rather than "0 (0)". */}
                  {court.rating > 0 && (
                    <div className="flex items-center gap-1">
                      <Star size={11} className="fill-black text-black" />
                      <p className="text-sm text-black">{court.rating}</p>
                      <span className="text-[#808080]">·</span>
                      <p className="text-sm text-[#808080]">({court.reviews})</p>
                    </div>
                  )}
                  <p className="text-sm text-[#606060]">{court.amenities.join(' · ')}</p>
                  {expanded === court.id && (
                    <p className="mt-1 text-sm text-[#606060]">
                      Open {court.hours}
                      {court.capacity > 0 && ` · fits up to ${court.capacity} players`}
                    </p>
                  )}
                </div>
              </button>

              <div className="flex w-full items-center justify-between bg-white px-5 py-[11px]">
                <button
                  type="button"
                  onClick={() => setExpanded((id) => (id === court.id ? null : court.id))}
                  className="text-sm text-[#606060] underline decoration-solid underline-offset-2"
                >
                  Court details &amp; Availability
                </button>
                <button
                  type="button"
                  onClick={() => {
                    pickCourt(court.id)
                  }}
                  className="flex shrink-0 items-center gap-1 rounded-full py-1.5 pl-3 pr-2 shadow-[0px_4px_10px_0px_rgba(0,0,0,0.05),0px_10px_120px_0px_rgba(15,73,106,0.1)]"
                  style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
                >
                  <p className="whitespace-nowrap text-sm text-[#fefefe]">Pick Slot</p>
                  <img src={arrowRight} alt="" className="size-5" />
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
