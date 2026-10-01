import { useState } from 'react'
import { ShoppingCart } from 'lucide-react'
import { TopBar } from '../ui/TopBar'
import { CheckinFooter } from '../checkin/Chrome'
import SelectSportCourt from './steps/SelectSportCourt'
import DateTime from './steps/DateTime'
import PlayerDetails from './steps/PlayerDetails'
import AddOns from './steps/AddOns'
import { traySelections } from './offers'
import PaymentStep from './steps/PaymentStep'
import Confirmation from './steps/Confirmation'
import { ApiError } from '../api/client'
import { useCreateBooking, useInvoiceBooking, useRecordPayment, type BookingDetail, type InvoiceOut } from '../api/hooks'
import { startsAtISO } from '../lib/format'
import { buildConfirmedInvoice } from './invoice'
import { emptyDraft, type Draft } from './types'
import { asset } from '../lib/asset'

const arrowRight = asset('pos/checkin/arrow-right-check.svg')

const STEP_TITLES = ['Select Sport & Court', 'Date & Time', 'Player Details', 'Add Ons', 'Payment']
const TOTAL_STEPS = STEP_TITLES.length

function canContinue(step: number, draft: Draft) {
  if (step === 2) return draft.startHour != null
  if (step === 3) return draft.customer.name.trim().length > 1 && /^\d{10}$/.test(draft.customer.phone)
  return true
}

function ProgressDots({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {STEP_TITLES.map((_, i) => {
        const idx = i + 1
        const active = idx === step
        return (
          <span key={idx} className={`h-2.5 rounded-full transition-all ${active ? 'w-9 bg-lime' : 'w-2.5 bg-[#d5d5d5]'}`} />
        )
      })}
    </div>
  )
}

export default function BookingFlow({ onDone, initialCourtId }: { onDone: () => void; initialCourtId?: string }) {
  const [step, setStep] = useState(initialCourtId ? 2 : 1)
  const [courtListOpen, setCourtListOpen] = useState(!!initialCourtId)
  const [draft, setDraftState] = useState<Draft>(() =>
    initialCourtId ? { ...emptyDraft(), courtId: initialCourtId } : emptyDraft(),
  )
  const [result, setResult] = useState<{ booking: BookingDetail; invoice?: InvoiceOut } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const createBooking = useCreateBooking()
  const recordPayment = useRecordPayment()
  const invoiceBooking = useInvoiceBooking()
  const processing = createBooking.isPending || recordPayment.isPending

  const setDraft = (patch: Partial<Draft>) => setDraftState((d) => ({ ...d, ...patch }))

  const goBack = () => {
    if (step === 1 && courtListOpen) return setCourtListOpen(false)
    if (step === 2) {
      setCourtListOpen(true)
      return setStep(1)
    }
    setStep((s) => Math.max(1, s - 1))
  }

  const goContinue = () => setStep((s) => Math.min(TOTAL_STEPS, s + 1))

  const selectCourt = (courtId: string) => {
    setDraft({ courtId })
    setStep(2)
  }

  const jumpToStep = (s: number) => {
    setStep(s)
    setCourtListOpen(s >= 2 ? false : courtListOpen)
  }

  const pay = async () => {
    if (!draft.courtId || !draft.date || draft.startHour == null) return
    setError(null)
    try {
      const equipment = traySelections(draft.equipment)
      const booking = await createBooking.mutateAsync({
        courtId: draft.courtId,
        startsAt: startsAtISO(draft.date, draft.startHour),
        durationMin: draft.hours * 60,
        customerName: draft.customer.name.trim(),
        customerPhone: draft.customer.phone,
        notes: draft.customer.notes || undefined,
        equipment,
      })

      if (draft.payNow) {
        await recordPayment.mutateAsync({
          bookingId: booking.id,
          amount: Number(booking.total),
          method: draft.paymentMethod,
        })
      }

      // A formal invoice number is a nice-to-have on the ticket — the booking itself is
      // already confirmed at this point, so a failure here shouldn't block check-in.
      let invoice: InvoiceOut | undefined
      try {
        invoice = await invoiceBooking.mutateAsync(booking.id)
      } catch {
        invoice = undefined
      }

      setResult({ booking, invoice })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the booking. Check your connection and try again.')
    }
  }

  const reset = () => {
    setDraftState(emptyDraft())
    setStep(1)
    setCourtListOpen(false)
    setResult(null)
    onDone()
  }

  const bookAnother = () => {
    setDraftState(emptyDraft())
    setStep(1)
    setCourtListOpen(false)
    setResult(null)
  }

  if (result) {
    const invoice = buildConfirmedInvoice(result.booking, draft, result.invoice)
    return (
      <div className="flex h-full w-full flex-col overflow-hidden">
        <TopBar onLogoClick={reset} />
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center-safe gap-8 overflow-y-auto px-4 py-[clamp(1.5rem,4vh,3rem)]">
          <Confirmation invoice={invoice} onDone={reset} onBookAnother={bookAnother} />
        </main>
        <CheckinFooter onBack={reset} />
      </div>
    )
  }

  const showBack = step > 1 || courtListOpen
  const continueEnabled = canContinue(step, draft)
  const trayCount = Object.values(draft.equipment).reduce((a, b) => a + b, 0)

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <TopBar centerTitle={STEP_TITLES[step - 1]} onLogoClick={onDone} />

      <main className="flex min-h-0 flex-1 flex-col gap-[clamp(0.5rem,1.5dvh,1.25rem)] overflow-y-auto px-[clamp(1.25rem,3vw,3rem)] py-[clamp(0.5rem,1.6dvh,1.5rem)]">
        {error && (
          <p role="alert" className="w-full rounded-xl bg-negative/10 px-4 py-3 text-sm text-negative">
            {error}
          </p>
        )}

        {step === 1 && (
          <SelectSportCourt
            draft={draft}
            setDraft={setDraft}
            courtListOpen={courtListOpen}
            setCourtListOpen={setCourtListOpen}
            onPickCourt={selectCourt}
          />
        )}
        {step === 2 && <DateTime draft={draft} setDraft={setDraft} />}
        {step === 3 && <PlayerDetails draft={draft} setDraft={setDraft} />}
        {step === 4 && <AddOns draft={draft} setDraft={setDraft} />}
        {step === 5 && (
          <PaymentStep draft={draft} setDraft={setDraft} processing={processing} onPay={pay} onEditStep={jumpToStep} />
        )}
      </main>

      <CheckinFooter
        onBack={showBack ? goBack : onDone}
        onHome={onDone}
        rightExtra={
          step > 1 && step < TOTAL_STEPS ? (
            <div className="flex items-center gap-[clamp(1rem,2vw,1.5rem)]">
              <ProgressDots step={step} />
              <button
                type="button"
                disabled={!continueEnabled}
                onClick={goContinue}
                className="flex items-center gap-2 rounded-xl bg-ink py-[clamp(0.75rem,1.4vw,0.875rem)] pl-[clamp(1.25rem,2vw,1.5rem)] pr-[clamp(1rem,1.6vw,1.125rem)] text-[clamp(0.9375rem,1vw,1rem)] font-bold text-white transition-opacity disabled:opacity-40"
              >
                {step === 4 && trayCount > 0 && (
                  <span className="flex items-center gap-1.5 rounded-lg bg-lime px-2 py-1.5 text-ink">
                    <ShoppingCart size={18} strokeWidth={2} />
                    {trayCount}
                  </span>
                )}
                Continue
                <img src={arrowRight} alt="" className="size-[clamp(1.1rem,1.4vw,1.5rem)]" />
              </button>
            </div>
          ) : (
            <ProgressDots step={step} />
          )
        }
      />
    </div>
  )
}
