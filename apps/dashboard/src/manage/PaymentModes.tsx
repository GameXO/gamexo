import { Banknote, CreditCard, Smartphone, Wallet } from '../ui/icons'
import { PAYMENT_METHODS } from '../data/booking'
import * as db from '../lib/db'
import { SettingsPanel } from '../settings/SettingsPanel'
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
    <SettingsPanel flush>
      {PAYMENT_METHODS.map((m) => {
        const Icon = ICONS[m.id] ?? Wallet
        const enabled = modes[m.id] ?? true
        return (
          <div
            key={m.id}
            className="flex items-center justify-between gap-4 border-b border-dashed border-border-soft py-5 last:border-b-0"
          >
            <div className={`flex items-center gap-4 transition-opacity ${enabled ? '' : 'opacity-60'}`}>
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-ink">
                <Icon size={18} />
              </div>
              <div>
                <p className="text-sm font-medium text-ink">{m.name}</p>
                <p className="mt-0.5 text-[12px] text-muted">{m.hint}</p>
              </div>
            </div>
            <Toggle checked={enabled} onChange={() => db.togglePaymentMode(m.id)} />
          </div>
        )
      })}
    </SettingsPanel>
  )
}
