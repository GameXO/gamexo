/**
 * Manage one connected payment gateway: what is saved, where it collects, and the
 * three things you can do to it (edit keys, test, disconnect).
 *
 * The two routing toggles are the answer to "which gateway takes the money?" — one
 * for the dashboard, one for the counter tablet. They are independent, so an
 * academy can move online payments to a new gateway while the POS stays put.
 */
import { useState } from 'react'
import { BadgeCheck, Loader2, ShieldAlert, TriangleAlert } from '../../ui/icons'
import ConfirmDialog from '../../ui/ConfirmDialog'
import SidePanel from '../../ui/PanelDock'
import Toggle from '../Toggle'
import { relative } from './catalog'
import IntegrationLogo from './IntegrationLogo'
import {
  type ProviderOut,
  type Surface,
  useDisconnectGateway,
  useSetRouting,
  useVerifyGateway,
} from './hooks'

export default function GatewayDrawer({
  provider,
  disabled,
  onEdit,
  onClose,
  onNotify,
}: {
  provider: ProviderOut
  disabled: boolean
  onEdit: () => void
  onClose: () => void
  onNotify: (message: string) => void
}) {
  const config = provider.config
  const routing = useSetRouting()
  const verifying = useVerifyGateway()
  const disconnect = useDisconnectGateway()
  const [confirming, setConfirming] = useState(false)

  // Every action reports its own outcome through `onNotify`, success or failure. A
  // silently-ignored rejection on a routing toggle is the worst case on this
  // screen: the switch springs back on the next refetch and the academy is left
  // believing it changed where payments go.
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
    setConfirming(false)
    try {
      await disconnect.mutateAsync(provider.id)
      onNotify(`${provider.label} disconnected.`)
      onClose()
    } catch (err) {
      report(`Could not disconnect ${provider.label}.`)(err)
    }
  }

  if (!config) return null

  return (
    <>
      <SidePanel
        title={provider.label}
        subtitle={`Payment gateway · ${config.mode === 'live' ? 'Live' : 'Test'} mode`}
        icon={<IntegrationLogo id={provider.id} name={provider.label} size={40} />}
        onClose={onClose}
        footer={
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={disabled || disconnect.isPending}
              className="rounded-xl px-3 py-2.5 text-sm font-semibold text-negative disabled:opacity-50"
            >
              Disconnect
            </button>
            <button
              type="button"
              onClick={onEdit}
              disabled={disabled}
              className="ml-auto flex-1 rounded-xl bg-ink py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Edit keys
            </button>
          </div>
        }
      >
        {/* Three distinct states, deliberately. "Not checked" is not a failure —
            PhonePe and PayU can only be proven by a real payment — and showing it
            as one would train people to ignore the warning that matters. */}
        <div className="rounded-xl border border-border-card bg-white p-4">
          {config.last_verification_error ? (
            <p className="flex items-start gap-2 text-sm leading-snug text-negative">
              <ShieldAlert size={16} className="mt-px shrink-0" />
              {config.last_verification_error}
            </p>
          ) : config.last_verified_at ? (
            <p className="flex items-center gap-2 text-sm font-medium text-positive">
              <BadgeCheck size={16} className="shrink-0" />
              Verified {relative(config.last_verified_at)}
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sm leading-snug text-slate">
              <TriangleAlert size={16} className="mt-px shrink-0 text-muted" />
              {provider.supports_live_check
                ? 'Not checked yet.'
                : 'Cannot be checked without a live payment.'}
            </p>
          )}
          {provider.supports_live_check && (
            <button
              type="button"
              onClick={() => void runVerify()}
              disabled={disabled || verifying.isPending}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-border-input bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-hover disabled:opacity-50"
            >
              {verifying.isPending && <Loader2 size={12} className="animate-spin" />}
              Test connection
            </button>
          )}
        </div>

        <section>
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate uppercase">
            Collect payments from
          </p>
          <div className="divide-y divide-border-card rounded-xl border border-border-card bg-white">
            {(
              [
                ['web', 'Dashboard', 'Online and staff-made bookings', config.collect_on_web],
                ['pos', 'POS counter', 'The counter tablet', config.collect_on_pos],
              ] as const
            ).map(([surface, label, hint, on]) => (
              <div key={surface} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink">{label}</p>
                  <p className="text-xs text-muted">{hint}</p>
                </div>
                <Toggle
                  checked={on}
                  disabled={disabled || routing.isPending}
                  onChange={() => void setSurface(surface, !on)}
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Only one gateway collects per surface. Turning one on here takes it from
            whichever gateway had it.
          </p>
        </section>

        <section>
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate uppercase">
            Saved credentials
          </p>
          <dl className="space-y-2 rounded-xl border border-border-card bg-white px-4 py-3">
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
          {config.updated_by_email && (
            <p className="mt-2 text-[11px] text-muted">
              Last updated by {config.updated_by_email} · {relative(config.updated_at)}
            </p>
          )}
        </section>
      </SidePanel>

      {confirming && (
        <ConfirmDialog
          title={`Disconnect ${provider.label}?`}
          message="Its saved keys are deleted and any surface it collects on goes back to cash and UPI at the counter. You can reconnect later by pasting the keys again."
          confirmLabel="Disconnect"
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={() => void remove()}
        />
      )}
    </>
  )
}
