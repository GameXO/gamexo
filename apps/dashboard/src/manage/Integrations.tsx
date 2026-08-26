/**
 * Manage → Integrations.
 *
 * Two halves that look similar and are not. Payment gateways hold credentials the
 * academy owns at Razorpay or Cashfree, which we store encrypted and replay on
 * every charge. Booking platforms hold credentials *we* issue to Playo and Hudle,
 * which we store hashed and can never read back. They share a screen because the
 * question an admin arrives with — "what is this academy plugged into?" — is one
 * question.
 */
import { useState } from 'react'
import { Info, ShieldOff } from 'lucide-react'
import BookingPlatforms from './integrations/BookingPlatforms'
import GatewayCredentialsDrawer from './integrations/GatewayCredentialsDrawer'
import PaymentGatewayCard from './integrations/PaymentGatewayCard'
import { type ProviderOut, usePaymentProviders } from './integrations/hooks'

export default function Integrations() {
  const gateways = usePaymentProviders()
  const [editing, setEditing] = useState<ProviderOut | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const notify = (message: string) => {
    setToast(message)
    setTimeout(() => setToast(null), 3500)
  }

  const providers = gateways.data?.providers ?? []
  const secretsAvailable = gateways.data?.secrets_available ?? true

  const collecting = (surface: 'web' | 'pos') =>
    providers.find((p) =>
      surface === 'web' ? p.config?.collect_on_web : p.config?.collect_on_pos,
    )?.label

  const web = collecting('web')
  const pos = collecting('pos')

  return (
    <div className="flex flex-1 flex-col gap-8 overflow-y-auto px-4 py-5 sm:px-6">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Payment gateways</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate">
              Connect the academy's own gateway account, then choose which one collects
              on the dashboard and which on the counter tablet. Only one gateway can
              collect per surface, so there is never a question of which one charged a
              booking.
            </p>
          </div>
        </div>

        {/* The answer to "where is the money going?" belongs above the cards, not
            reconstructed by reading eight toggles. */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              ['Dashboard', web],
              ['POS counter', pos],
            ] as const
          ).map(([label, using]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border-card bg-white px-4 py-3"
            >
              <span className="text-sm text-slate">{label} collects via</span>
              <span
                className={`text-sm font-semibold ${using ? 'text-ink' : 'text-muted'}`}
              >
                {using ?? 'Cash / UPI only'}
              </span>
            </div>
          ))}
        </div>

        {!secretsAvailable && (
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-negative/30 bg-negative/5 px-3.5 py-3 text-xs leading-relaxed text-ink">
            <ShieldOff size={14} className="mt-px shrink-0 text-negative" />
            <span>
              This deployment has no encryption key configured, so payment credentials
              cannot be stored safely and connecting a gateway is disabled. Set{' '}
              <span className="font-mono">SECRETS_ENCRYPTION_KEY</span> on the API and
              restart it.
            </span>
          </p>
        )}

        {gateways.isLoading && <p className="mt-4 text-sm text-slate">Loading gateways…</p>}
        {gateways.isError && (
          <p className="mt-4 text-sm text-negative">Could not load payment gateways.</p>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {providers.map((provider) => (
            <PaymentGatewayCard
              key={provider.id}
              provider={provider}
              disabled={!secretsAvailable}
              onEdit={() => setEditing(provider)}
              onNotify={notify}
            />
          ))}
        </div>

        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted">
          <Info size={13} className="mt-px shrink-0" />
          Key secrets are encrypted before they are written and never sent back to the
          browser — this screen only ever shows the last four characters. Turning both
          toggles off leaves that surface taking cash and UPI at the counter, exactly
          as it does today.
        </p>
      </section>

      <div className="h-px bg-border-card" />

      <BookingPlatforms onNotify={notify} />

      {editing && (
        <GatewayCredentialsDrawer
          provider={editing}
          onClose={() => setEditing(null)}
          onSaved={notify}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] max-w-[90vw] -translate-x-1/2 rounded-xl bg-ink px-4 py-2.5 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
