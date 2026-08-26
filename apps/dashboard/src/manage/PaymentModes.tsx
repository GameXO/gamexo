import { Banknote, CreditCard, Smartphone, Wallet } from 'lucide-react'
import { PAYMENT_METHODS } from '../data/booking'
import * as db from '../lib/db'
import Toggle from './Toggle'

const ICONS: Record<string, typeof Smartphone> = {
  upi: Smartphone,
  card: CreditCard,
  cash: Banknote,
  wallet: Wallet,
}

export default function PaymentModes() {
  db.useDbVersion()
  const modes = db.getPaymentModes()

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <p className="text-lg text-ink">Payment Modes</p>
      <p className="-mt-3 text-sm text-slate">
        Choose which payment methods staff can accept at the counter and in the booking flow.
      </p>

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
        {PAYMENT_METHODS.map((m) => {
          const Icon = ICONS[m.id] ?? Wallet
          const enabled = modes[m.id] ?? true
          return (
            <div
              key={m.id}
              className={`flex items-center justify-between gap-3 rounded-xl border bg-white p-4 transition-colors ${
                enabled ? 'border-border-card' : 'border-border-card opacity-60'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink">
                  <Icon size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">{m.name}</p>
                  <p className="text-xs text-muted">{m.hint}</p>
                </div>
              </div>
              <Toggle checked={enabled} onChange={() => db.togglePaymentMode(m.id)} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
