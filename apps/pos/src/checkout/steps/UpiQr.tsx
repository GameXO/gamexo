import { money } from '../../lib/format'
import { useUpiQrCode } from '../useCheckout'
import { asset } from '../../lib/asset'

const arrowRight = asset('pos/checkin/arrow-right-check.svg')

const UPI_ID = import.meta.env.VITE_UPI_ID ?? ''
const PAYEE_NAME = 'XCSports'

export default function UpiQr({
  amount,
  reference,
  onVerify,
}: {
  amount: number
  reference: string
  onVerify: () => void
}) {
  const dataUrl = useUpiQrCode(UPI_ID, amount, PAYEE_NAME, reference)

  return (
    <div className="flex w-full max-w-[380px] flex-col items-center gap-[clamp(1.5rem,3vw,2.25rem)] text-center">
      <div className="flex flex-col items-center gap-1">
        <p className="font-display text-[clamp(1.15rem,1.9vw,1.5rem)] font-bold text-ink">Scan to pay</p>
        <p className="text-[clamp(0.9375rem,1.1vw,1rem)] text-muted">
          {UPI_ID || 'UPI ID not configured — ask an admin to set VITE_UPI_ID'}
        </p>
      </div>

      <div className="flex size-[clamp(12rem,30vw,16rem)] items-center justify-center rounded-2xl bg-white p-4 shadow-[0px_20px_45px_-15px_rgba(0,0,0,0.18)]">
        {dataUrl ? (
          <img src={dataUrl} alt="UPI payment QR code" className="size-full object-contain" />
        ) : (
          <div className="size-full animate-pulse rounded-xl bg-surface-muted" />
        )}
      </div>

      <p className="text-[clamp(1.5rem,2.4vw,1.875rem)] font-bold text-ink">{money(amount)}</p>

      <button
        type="button"
        onClick={onVerify}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-[clamp(0.875rem,1.6vw,1.125rem)] text-[clamp(1rem,1.2vw,1.125rem)] font-bold text-white"
      >
        Verify Payment
        <img src={arrowRight} alt="" className="size-[clamp(1.1rem,1.4vw,1.5rem)]" />
      </button>
    </div>
  )
}
