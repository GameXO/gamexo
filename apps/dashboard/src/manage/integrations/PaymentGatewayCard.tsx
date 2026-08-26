/**
 * One payment gateway, connected or not.
 *
 * The two routing toggles are the answer to "which gateway takes the money?" —
 * one for the dashboard, one for the counter tablet. They are independent, so an
 * academy can move online payments to a new gateway while the POS stays put.
 */
import { BadgeCheck, Loader2, ShieldAlert, TriangleAlert } from 'lucide-react'
import Toggle from '../Toggle'
import {
  type ProviderOut,
  type Surface,
  useDisconnectGateway,
  useSetRouting,
  useVerifyGateway,
} from './hooks'

const LOGO_TINT: Record<string, string> = {
  razorpay: 'bg-[#0b3cc1]',
  cashfree: 'bg-[#5a2ac0]',
  phonepe: 'bg-[#5f259f]',
  payu: 'bg-[#0b8f3a]',
  stripe: 'bg-[#5b53f0]',
}

const relative = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function PaymentGatewayCard({
  provider,
  disabled,
  onEdit,
  onNotify,
}: {
  provider: ProviderOut
  disabled: boolean
  onEdit: () => void
  onNotify: (message: string) => void
}) {
  const config = provider.config
  const routing = useSetRouting()
  const verifying = useVerifyGateway()
  const disconnect = useDisconnectGateway()

  // Every one of these reports its own outcome through `onNotify`, success or
  // failure. A silently-ignored rejection on a routing toggle is the worst case on
  // this screen: the switch springs back on the next refetch and the academy is
  // left believing it changed where payments go.
  const report = (message: string) => (err: unknown) =>
    onNotify(err instanceof Error ? err.message : message)

  const setSurface = async (surface: Surface, on: boolean) => {
    const where = surface === 'web' ? 'Dashboard' : 'POS'
    try {
      await routing.mutateAsync({ provider: provider.id, surface, on })
      onNotify(
        on ? `${where} now collects via ${provider.label}.` : `${where} collection turned off.`,
      )
    } catch (err) {
      report(`Could not change ${where} collection.`)(err)
    }
  }

  const runVerify = async () => {
    try {
      onNotify((await verifying.mutateAsync(provider.id)).message)
    } catch (err) {
      report(`Could not reach ${provider.label}.`)(err)
    }
  }

  const remove = async () => {
    try {
      await disconnect.mutateAsync(provider.id)
      onNotify(`${provider.label} disconnected.`)
    } catch (err) {
      report(`Could not disconnect ${provider.label}.`)(err)
    }
  }

  return (
    <div className="flex flex-col rounded-2xl border border-border-card bg-white p-5">
      <div className="flex items-start gap-3">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white ${
            LOGO_TINT[provider.id] ?? 'bg-ink'
          }`}
        >
          {provider.label.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-ink">{provider.label}</p>
            {config && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                  config.mode === 'live'
                    ? 'bg-positive/15 text-positive'
                    : 'bg-surface-muted text-slate'
                }`}
              >
                {config.mode}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs leading-snug text-muted">{provider.tagline}</p>
        </div>
      </div>

      {config ? (
        <>
          <dl className="mt-4 space-y-1.5 rounded-xl bg-surface-muted px-3.5 py-3">
            {provider.fields
              .filter((f) => !f.secret)
              .map((f) => (
                <div key={f.name} className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-xs text-slate">{f.label}</dt>
                  <dd className="truncate font-mono text-xs text-ink">
                    {String(config.public_config?.[f.name] ?? '—')}
                  </dd>
                </div>
              ))}
            {provider.fields
              .filter((f) => f.secret && config.secret_hints?.[f.name])
              .map((f) => (
                <div key={f.name} className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-xs text-slate">{f.label}</dt>
                  <dd className="font-mono text-xs text-ink">
                    ••••{String(config.secret_hints[f.name])}
                  </dd>
                </div>
              ))}
          </dl>

          {/* Three distinct states, deliberately. "Not checked" is not a failure —
              PhonePe and PayU can only be proven by a real payment — and showing it
              as one would train people to ignore the warning that matters. */}
          {config.last_verification_error ? (
            <p className="mt-3 flex items-start gap-1.5 text-xs leading-snug text-negative">
              <ShieldAlert size={13} className="mt-px shrink-0" />
              {config.last_verification_error}
            </p>
          ) : config.last_verified_at ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-positive">
              <BadgeCheck size={13} className="shrink-0" />
              Verified {relative(config.last_verified_at)}
            </p>
          ) : (
            <p className="mt-3 flex items-start gap-1.5 text-xs leading-snug text-slate">
              <TriangleAlert size={13} className="mt-px shrink-0 text-muted" />
              {provider.supports_live_check
                ? 'Not checked yet.'
                : 'Cannot be checked without a live payment.'}
            </p>
          )}

          <div className="mt-4 space-y-2 border-t border-border-card pt-4">
            <p className="text-xs font-semibold tracking-wide text-slate uppercase">
              Collect payments from
            </p>
            {(
              [
                ['web', 'Dashboard', config.collect_on_web],
                ['pos', 'POS counter', config.collect_on_pos],
              ] as const
            ).map(([surface, label, on]) => (
              <div key={surface} className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink">{label}</span>
                <Toggle
                  checked={on}
                  disabled={disabled || routing.isPending}
                  onChange={() => void setSurface(surface, !on)}
                />
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              disabled={disabled}
              className="rounded-lg border border-border-input bg-white px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
            >
              Edit keys
            </button>
            {provider.supports_live_check && (
              <button
                type="button"
                onClick={() => void runVerify()}
                disabled={disabled || verifying.isPending}
                className="flex items-center gap-1.5 rounded-lg border border-border-input bg-white px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
              >
                {verifying.isPending && <Loader2 size={12} className="animate-spin" />}
                Test connection
              </button>
            )}
            <button
              type="button"
              onClick={() => void remove()}
              disabled={disabled || disconnect.isPending}
              className="ml-auto rounded-lg px-2 py-1.5 text-xs font-semibold text-negative disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>

          {config.updated_by_email && (
            <p className="mt-3 text-[11px] text-muted">
              Last updated by {config.updated_by_email} · {relative(config.updated_at)}
            </p>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          disabled={disabled}
          className="mt-5 w-full rounded-xl border border-dashed border-border-soft py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
        >
          Connect {provider.label}
        </button>
      )}
    </div>
  )
}
