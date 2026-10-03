import { useState } from 'react'
import Stepper from './Stepper'
import SelectSportCourt from './steps/SelectSportCourt'
import SelectSlot from './steps/SelectSlot'
import DateTime from './steps/DateTime'
import PlayerDetails from './steps/PlayerDetails'
import AddOns from './steps/AddOns'
import PaymentStep from './steps/PaymentStep'
import Confirmation from './steps/Confirmation'
import { courtById, emptyDraft, type Draft } from '../data/booking'
import { useBookingQuote, useCreateBooking } from '../api/hooks'
import { ApiError } from '../api/client'
import * as db from '../lib/db'
import { asset } from '../lib/asset'

const arrowRight = asset('dashboard/arrow-right-01.svg')

/**
 * Two ways through the same booking:
 *
 *   1 · Step by step — pick a sport and court, *then* the day and time.
 *   2 · One page     — sport, court, day and time together, so a court's free hours
 *                      can be compared without going back.
 *
 * They share everything after the time is chosen, and the draft survives a switch, so
 * changing view halfway keeps what was picked. The choice is remembered per browser.
 */
type View = 'classic' | 'single'
type StepId = 'sport' | 'when' | 'slot' | 'player' | 'addons' | 'pay'

const FLOWS: Record<View, { id: StepId; label: string }[]> = {
  classic: [
    { id: 'sport', label: 'Select Sports & Court' },
    { id: 'when', label: 'Date & Time' },
    { id: 'player', label: 'Player Details' },
    { id: 'addons', label: 'Add Ons' },
    { id: 'pay', label: 'Payments' },
  ],
  single: [
    { id: 'slot', label: 'Sport, Court & Time' },
    { id: 'player', label: 'Player Details' },
    { id: 'addons', label: 'Add Ons' },
    { id: 'pay', label: 'Payments' },
  ],
}

const VIEW_KEY = 'gamexo.bookingView'

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'classic' ? 'classic' : 'single'
  } catch {
    return 'single'
  }
}

function canContinue(id: StepId, draft: Draft, courtListOpen: boolean) {
  if (id === 'sport') return courtListOpen && !!draft.courtId
  if (id === 'when') return draft.startHour != null
  if (id === 'player') return draft.customer.name.trim().length > 1 && /^\d{10}$/.test(draft.customer.phone)
  return true
}

const VIEW_OPTIONS: { id: View; number: string; label: string; hint: string }[] = [
  { id: 'classic', number: '1', label: 'Step by step', hint: 'Pick the sport and court, then the day and time' },
  { id: 'single', number: '2', label: 'One page', hint: 'Sport, court, day and time together on one page' },
]

function ViewToggle({ view, onChange }: { view: View; onChange: (next: View) => void }) {
  return (
    <div
      role="group"
      aria-label="Booking view"
      className="flex items-center gap-1 rounded-lg border border-border-card bg-white p-1"
    >
      {VIEW_OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={view === o.id}
          title={o.hint}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
            view === o.id ? 'bg-ink font-medium text-white' : 'text-slate hover:text-ink'
          }`}
        >
          <span className="font-semibold">{o.number}</span>
          <span className="hidden sm:inline">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export default function BookingFlow({
  onDone,
  initialCourtId,
}: {
  onDone: () => void
  initialCourtId?: string
}) {
  const initialCourt = initialCourtId ? courtById(initialCourtId) : null
  const [view, setViewState] = useState<View>(readView)
  // 1-based position in the current view's list of steps.
  const [step, setStep] = useState(() => (readView() === 'classic' && initialCourt ? 2 : 1))
  const [courtListOpen, setCourtListOpen] = useState(!!initialCourt)
  const [draft, setDraftState] = useState<Draft>(() =>
    initialCourt ? { ...emptyDraft(), sportId: initialCourt.sportId, courtId: initialCourt.id } : emptyDraft(),
  )
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const flow = FLOWS[view]
  const labels = flow.map((s) => s.label)
  const last = flow.length
  const current = flow[step - 1].id

  const createBooking = useCreateBooking()
  // Only priced once the wizard reaches the step that shows money.
  const quoteQuery = useBookingQuote(draft, current === 'pay')

  const setDraft = (patch: Partial<Draft>) => setDraftState((d) => ({ ...d, ...patch }))

  const switchView = (next: View) => {
    if (next === view) return
    // Land on the equivalent step: the two views split "what and when" differently, the
    // rest is shared. A court already chosen lets the step-by-step view skip ahead.
    const target: StepId =
      next === 'single'
        ? current === 'sport' || current === 'when'
          ? 'slot'
          : current
        : current === 'slot'
          ? draft.courtId
            ? 'when'
            : 'sport'
          : current
    const index = FLOWS[next].findIndex((s) => s.id === target)
    try {
      window.localStorage.setItem(VIEW_KEY, next)
    } catch {
      /* private mode: the choice just does not outlive the tab */
    }
    setViewState(next)
    setStep(index + 1)
    if (next === 'classic') setCourtListOpen(!!draft.courtId)
  }

  const goBack = () => {
    if (view === 'classic' && current === 'sport' && courtListOpen) return setCourtListOpen(false)
    if (view === 'classic' && current === 'when') setCourtListOpen(true)
    setStep((s) => Math.max(1, s - 1))
  }

  const goContinue = () => setStep((s) => Math.min(last, s + 1))

  const selectCourt = (courtId: string) => {
    setDraft({ courtId })
    setStep(2)
  }

  const jumpToStep = (s: number) => {
    setStep(s)
    if (view === 'classic' && s >= 2) setCourtListOpen(false)
  }

  const pay = () => {
    setError(null)
    createBooking.mutate(draft, {
      onSuccess: (created) => {
        // No localStorage mirror. It used to exist so the unmigrated screens could
        // still see new bookings, and it was a mistake: the copies outlived two
        // different databases and surfaced as an "Amount Owed" of ₹2,124 for
        // bookings that no longer existed anywhere. Active Courts reads the API
        // now, so there is nothing left to mirror for.
        db.upsertCustomer(draft.customer)
        setBookingId(created.id)
      },
      onError: (err) => {
        setError(
          err instanceof ApiError
            ? err.isConflict
              ? `${err.message} Pick another slot or court.`
              : err.message
            : 'Could not reach the server. The booking was not created.',
        )
      },
    })
  }

  const restart = () => {
    setDraftState(emptyDraft())
    setStep(1)
    setCourtListOpen(false)
    setBookingId(null)
    setError(null)
  }

  const reset = () => {
    restart()
    onDone()
  }

  if (bookingId) {
    return (
      <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-5 sm:px-6">
        <Confirmation
          draft={draft}
          bookingId={bookingId}
          quote={quoteQuery.data}
          onDone={reset}
          onBookAnother={restart}
        />
      </div>
    )
  }

  // The one-page view carries its own pinned bar (summary + Continue), and the first
  // classic step advances by picking a court — neither wants the generic footer.
  const showFooter = current !== 'slot' && current !== 'pay' && !(current === 'sport' && !courtListOpen)
  const showContinue = current !== 'sport'
  const showBack = current !== 'sport' || courtListOpen
  const continueEnabled = canContinue(current, draft, courtListOpen)
  // The pinned bar sits flush against the bottom edge, so the page gives up its own
  // bottom padding there.
  const flush = current === 'slot'

  return (
    <div
      className={`flex flex-1 flex-col items-start justify-between gap-[clamp(1rem,2.5dvh,1.5rem)] overflow-y-auto px-4 pt-[clamp(1rem,2.5dvh,1.5rem)] sm:px-6 ${
        flush ? 'pb-0' : 'pb-[clamp(1rem,2.5dvh,1.5rem)]'
      }`}
    >
      <div className={`flex w-full flex-col items-start gap-[clamp(1rem,2.5dvh,1.5rem)] ${flush ? 'flex-1' : ''}`}>
        <div className="flex w-full flex-wrap items-center justify-center gap-3 xl:relative">
          <Stepper steps={labels} current={step} onSelect={jumpToStep} />
          {current !== 'pay' && (
            <div className="xl:absolute xl:right-0">
              <ViewToggle view={view} onChange={switchView} />
            </div>
          )}
        </div>

        {current === 'slot' && <SelectSlot draft={draft} setDraft={setDraft} onContinue={goContinue} />}
        {current === 'sport' && (
          <SelectSportCourt
            draft={draft}
            setDraft={setDraft}
            courtListOpen={courtListOpen}
            setCourtListOpen={setCourtListOpen}
            onPickCourt={selectCourt}
          />
        )}
        {current === 'when' && <DateTime draft={draft} setDraft={setDraft} />}
        {current === 'player' && <PlayerDetails draft={draft} setDraft={setDraft} />}
        {current === 'addons' && <AddOns draft={draft} setDraft={setDraft} />}
        {current === 'pay' && (
          <PaymentStep
            draft={draft}
            steps={labels}
            processing={createBooking.isPending}
            quote={quoteQuery.data}
            quoteLoading={quoteQuery.isLoading}
            error={error}
            onPay={pay}
            onEditStep={jumpToStep}
          />
        )}
      </div>

      {showFooter && (
        <div className="flex w-full items-center justify-between">
          {showBack ? (
            <button
              type="button"
              onClick={goBack}
              className="flex items-center gap-2 rounded-xl px-4 py-3 text-base text-ink"
            >
              <img src={arrowRight} alt="" className="size-[22px] rotate-180" />
              Back
            </button>
          ) : (
            <span />
          )}

          {showContinue && (
            <button
              type="button"
              disabled={!continueEnabled}
              onClick={goContinue}
              className="flex items-center gap-3 rounded-xl bg-ink py-3 pl-6 pr-4 text-base font-bold text-white disabled:opacity-40"
            >
              Continue
              <img src={arrowRight} alt="" className="size-[22px]" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
