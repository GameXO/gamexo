import { useState } from 'react'
import { TopBar } from '../ui/TopBar'
import { CheckinFooter } from './Chrome'
import ChooseMethod from './steps/ChooseMethod'
import EnterBookingId from './steps/EnterBookingId'
import CheckInResult from './steps/CheckInResult'
import { useFindBookingByCode } from './useCheckIn'

type Step = 'method' | 'code' | 'result'

const TITLES: Partial<Record<Step, string>> = {
  method: 'Check In',
  code: 'Check In',
}

const STEP_INDEX: Partial<Record<Step, number>> = { code: 1, result: 2 }

export default function CheckInFlow({
  onHome,
  onBookNow,
  onStore,
}: {
  onHome: () => void
  onBookNow: () => void
  onStore: () => void
}) {
  const [step, setStep] = useState<Step>('method')
  const [code, setCode] = useState('')
  const [submittedCode, setSubmittedCode] = useState<string | null>(null)

  const bookingQuery = useFindBookingByCode(submittedCode)
  const booking = bookingQuery.data

  const goCode = () => setStep('code')

  const submitCode = () => {
    setSubmittedCode(code)
    setStep('result')
  }

  const restart = () => {
    setStep('method')
    setCode('')
    setSubmittedCode(null)
  }

  const backHandlers: Record<Step, () => void> = {
    method: onHome,
    code: () => setStep('method'),
    result: restart,
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <TopBar centerTitle={TITLES[step]} onLogoClick={onHome} />

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center-safe gap-8 overflow-y-auto px-4 py-[clamp(1.5rem,4vh,3rem)]">
        {step === 'method' && <ChooseMethod onHaveBooking={goCode} onBookNow={onBookNow} />}

        {step === 'code' && <EnterBookingId code={code} setCode={setCode} onSubmit={submitCode} />}

        {step === 'result' && (
          <CheckInResult
            status={bookingQuery.isPending ? 'loading' : booking ? 'found' : 'not-found'}
            booking={booking ?? undefined}
            onRentEquipment={onStore}
            onHome={onHome}
            onRetry={goCode}
            onBookNow={onBookNow}
          />
        )}
      </main>

      <CheckinFooter
        onBack={backHandlers[step]}
        onHome={step === 'result' ? undefined : onHome}
        step={STEP_INDEX[step]}
        totalSteps={STEP_INDEX[step] ? 2 : undefined}
      />
    </div>
  )
}
