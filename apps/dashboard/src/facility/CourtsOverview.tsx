import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { FACILITY_SPORTS, FACILITY_COURTS, facilitySportById } from './facilityData'
import SportIcon from './SportIcon'
import { money } from '../data/booking'
import chevronDown from '../assets/figma/chevron-down.svg'

export default function CourtsOverview({ onStartBooking }: { onStartBooking: () => void }) {
  const [sportFilter, setSportFilter] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const courts = sportFilter ? FACILITY_COURTS.filter((c) => c.sportId === sportFilter) : FACILITY_COURTS
  const activeLabel = sportFilter ? facilitySportById(sportFilter)?.label : 'All Sports'

  return (
    <div className="flex flex-1 flex-col items-start gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="flex w-full items-center justify-between gap-3">
        <p className="text-lg text-ink">Courts Overview</p>

        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-3 rounded-lg border border-border-input bg-surface px-3.5 py-2 shadow-[0px_1px_2px_0px_rgba(82,88,102,0.09)]"
          >
            <span className="text-sm font-medium text-ink">{activeLabel}</span>
            <img src={chevronDown} alt="" className="h-2.5 w-auto shrink-0" />
          </button>

          {open && (
            <>
              <button
                type="button"
                aria-label="Close filter"
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-10"
              />
              <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-lg border border-border-card bg-white py-1 shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    setSportFilter(null)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center px-3.5 py-2 text-left text-sm ${
                    sportFilter === null ? 'font-semibold text-ink' : 'text-slate hover:bg-surface-muted'
                  }`}
                >
                  All Sports
                </button>
                {FACILITY_SPORTS.map((sport) => (
                  <button
                    key={sport.id}
                    type="button"
                    onClick={() => {
                      setSportFilter(sport.id)
                      setOpen(false)
                    }}
                    className={`flex w-full items-center px-3.5 py-2 text-left text-sm ${
                      sportFilter === sport.id ? 'font-semibold text-ink' : 'text-slate hover:bg-surface-muted'
                    }`}
                  >
                    {sport.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {courts.map((court) => {
          const sport = facilitySportById(court.sportId)!
          return (
            <div
              key={court.id}
              className="flex flex-col gap-6 rounded-xl border border-dashed border-border-input bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {sport.label}
                  </p>
                  <p className="text-base font-semibold text-ink">{court.name}</p>
                </div>
                <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-slate">
                  <SportIcon sportId={sport.id} />
                </div>
              </div>

              <div className="flex items-end justify-between">
                <div>
                  <p className="text-sm font-medium text-positive">Free now</p>
                  <p className="text-sm font-semibold text-ink">{money(court.price)}/hr</p>
                </div>
                <button
                  type="button"
                  onClick={onStartBooking}
                  aria-label={`Book ${court.name}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-lime text-lime-ink transition-transform hover:scale-105"
                >
                  <Plus size={17} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
