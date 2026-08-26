import { useState } from 'react'
import Stepper from './Stepper'
import SelectSportCourt from './steps/SelectSportCourt'
import DateTime from './steps/DateTime'
import PlayerDetails from './steps/PlayerDetails'
import AddOns from './steps/AddOns'
import PaymentStep from './steps/PaymentStep'
import Confirmation from './steps/Confirmation'
import { courtById, emptyDraft, type Draft } from '../data/booking'
import { useBookingQuote, useCreateBooking } from '../api/hooks'
import { ApiError } from '../api/client'
import * as db from '../lib/db'
import arrowRight from '../assets/figma/arrow-right-01.svg'

function canContinue(step: number, draft: Draft, courtListOpen: boolean) {
  if (step === 1) return courtListOpen && !!draft.courtId
  if (step === 2) return draft.startHour != null
  if (step === 3) return draft.customer.name.trim().length > 1 && /^\d{10}$/.test(draft.customer.phone)
  if (step === 4) return true
  return true
}

export default function BookingFlow({
  onDone,
  initialCourtId,
}: {
  onDone: () => void
  initialCourtId?: string
}) {
  const initialCourt = initialCourtId ? courtById(initialCourtId) : null
  const [step, setStep] = useState(initialCourt ? 2 : 1)
  const [courtListOpen, setCourtListOpen] = useState(!!initialCourt)
  const [draft, setDraftState] = useState<Draft>(() =>
    initialCourt ? { ...emptyDraft(), sportId: initialCourt.sportId, courtId: initialCourt.id } : emptyDraft(),
  )
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const createBooking = useCreateBooking()
  // Only priced once the wizard reaches the step that shows money.
  const quoteQuery = useBookingQuote(draft, step === 5)

  const setDraft = (patch: Partial<Draft>) => setDraftState((d) => ({ ...d, ...patch }))

  const goBack = () => {
    if (step === 1 && courtListOpen) return setCourtListOpen(false)
    if (step === 2) {
      setCourtListOpen(true)
      return setStep(1)
    }
    setStep((s) => Math.max(1, s - 1))
  }

  const goContinue = () => setStep((s) => Math.min(5, s + 1))

  const jumpToStep = (s: number) => {
    setStep(s)
    setCourtListOpen(s >= 2 ? false : courtListOpen)
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

  const reset = () => {
    setDraftState(emptyDraft())
    setStep(1)
    setCourtListOpen(false)
    setBookingId(null)
    setError(null)
    onDone()
  }

  const bookAnother = () => {
    setDraftState(emptyDraft())
    setStep(1)
    setCourtListOpen(false)
    setBookingId(null)
    setError(null)
  }

  if (bookingId) {
    return (
      <div className="flex flex-1 flex-col items-center overflow-y-auto px-4 py-5 sm:px-6">
        <Confirmation
          draft={draft}
          bookingId={bookingId}
          quote={quoteQuery.data}
          onDone={reset}
          onBookAnother={bookAnother}
        />
      </div>
    )
  }

  const showBack = step > 1 || courtListOpen
  const continueEnabled = canContinue(step, draft, courtListOpen)

  return (
    <div className="flex flex-1 flex-col items-start justify-between gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="flex w-full flex-col items-start gap-5">
        <Stepper current={step} onSelect={jumpToStep} />

        {step === 1 && (
          <SelectSportCourt
            draft={draft}
            setDraft={setDraft}
            courtListOpen={courtListOpen}
            setCourtListOpen={setCourtListOpen}
          />
        )}
        {step === 2 && <DateTime draft={draft} setDraft={setDraft} />}
        {step === 3 && <PlayerDetails draft={draft} setDraft={setDraft} />}
        {step === 4 && <AddOns draft={draft} setDraft={setDraft} />}
        {step === 5 && (
          <PaymentStep
            draft={draft}
            processing={createBooking.isPending}
            quote={quoteQuery.data}
            quoteLoading={quoteQuery.isLoading}
            error={error}
            onPay={pay}
            onEditStep={jumpToStep}
          />
        )}
      </div>

      {step < 5 && (
        <div className="flex w-full items-center justify-between">
          {showBack ? (
            <button
              type="button"
              onClick={goBack}
              className="flex items-center gap-2 rounded-full px-4 py-3 text-base text-ink shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05),0px_13px_161px_0px_rgba(15,73,106,0.1)]"
            >
              <img src={arrowRight} alt="" className="size-[22px] rotate-180" />
              Back
            </button>
          ) : (
            <span />
          )}

          <button
            type="button"
            disabled={!continueEnabled}
            onClick={goContinue}
            className="flex items-center gap-3 rounded-full py-3 pl-6 pr-4 text-base text-[#fefefe] shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05),0px_13px_161px_0px_rgba(15,73,106,0.1)] disabled:opacity-40"
            style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
          >
            Continue
            <img src={arrowRight} alt="" className="size-[22px]" />
          </button>
        </div>
      )}
    </div>
  )
}
