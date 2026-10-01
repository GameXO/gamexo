import { useEffect } from 'react'
import Keypad from '../checkin/Keypad'
import { asset } from '../lib/asset'

const arrowRight = asset('pos/checkin/arrow-right-check.svg')
const reloadIcon = asset('pos/checkin/reload.svg')

/** The boxed-digit + keypad pattern from the check-in OTP screen, generalized so the
 *  checkout flow's admin-authorization step can reuse it verbatim instead of forking it. */
export default function OtpEntry({
  helperText,
  otp,
  setOtp,
  length = 5,
  demoCode,
  demoLabel = 'Test mode — the OTP is',
  error,
  verifying,
  verifyingLabel = 'Verifying…',
  verifyLabel = 'Verify',
  resendCooldown,
  onVerify,
  onResend,
}: {
  helperText: string
  otp: string
  setOtp: (v: string) => void
  length?: number
  demoCode: string
  demoLabel?: string
  error: string | null
  verifying: boolean
  verifyingLabel?: string
  verifyLabel?: string
  resendCooldown: number
  onVerify: () => void
  onResend: () => void
}) {
  const ready = otp.length === length

  const addDigit = (d: string) => setOtp(otp.length < length ? otp + d : otp)
  const backspace = () => setOtp(otp.slice(0, -1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) addDigit(e.key)
      else if (e.key === 'Backspace') backspace()
      else if (e.key === 'Enter' && ready && !verifying) onVerify()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex w-full max-w-[360px] flex-col items-center gap-[clamp(1.75rem,4.5vw,4.1875rem)]">
      <div className="flex w-full flex-col items-start gap-3">
        <p className="text-[clamp(0.9375rem,1.1vw,1rem)] font-medium text-ink">{helperText}</p>
        <div className="flex w-full items-center gap-2.5">
          {Array.from({ length }).map((_, i) => {
            const active = i === Math.min(otp.length, length - 1)
            return (
              <div
                key={i}
                className={`flex aspect-square flex-1 items-center justify-center rounded-xl border-2 bg-border-input text-[clamp(1.1rem,1.5vw,1.25rem)] font-semibold text-ink shadow-[0px_12px_17px_-9px_rgba(0,0,0,0.12)] ${
                  active ? 'border-ink' : 'border-white'
                }`}
              >
                {otp[i] ?? ''}
              </div>
            )
          })}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-negative">
            {error}
          </p>
        ) : (
          <p className="text-xs text-muted">
            {demoLabel} {demoCode}
          </p>
        )}
      </div>

      <div className="flex w-full flex-col items-center gap-[clamp(1.25rem,2.6vw,2.1875rem)]">
        <Keypad onDigit={addDigit} onBackspace={backspace} />

        <div className="flex w-full flex-col gap-3">
          <button
            type="button"
            disabled={!ready || verifying}
            onClick={onVerify}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-[clamp(0.875rem,1.6vw,1.125rem)] text-[clamp(1rem,1.2vw,1.125rem)] font-bold text-white transition-opacity disabled:opacity-40"
          >
            {verifying ? verifyingLabel : verifyLabel}
            {!verifying && <img src={arrowRight} alt="" className="size-[clamp(1.1rem,1.4vw,1.5rem)]" />}
          </button>

          <button
            type="button"
            disabled={resendCooldown > 0}
            onClick={onResend}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-surface-muted py-[clamp(0.875rem,1.6vw,1.125rem)] text-[clamp(1rem,1.2vw,1.125rem)] font-bold text-ink disabled:opacity-50"
          >
            <img src={reloadIcon} alt="" className="size-[clamp(1rem,1.3vw,1.125rem)]" />
            {resendCooldown > 0 ? `Resend OTP (${resendCooldown}s)` : 'Resend OTP'}
          </button>
        </div>
      </div>
    </div>
  )
}
