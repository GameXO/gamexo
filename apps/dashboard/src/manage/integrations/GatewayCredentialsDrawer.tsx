/**
 * The form where an academy pastes its gateway API keys.
 *
 * Every input is rendered from `provider.fields`, which the API sends — nothing
 * here knows that Razorpay has a Key ID and PhonePe has a Salt Index. Adding a
 * gateway is a catalog entry on the server; this file does not change.
 */
import { useState } from 'react'
import { AlertTriangle, ExternalLink, Loader2 } from 'lucide-react'
import Drawer from '../../ui/Drawer'
import { credentialProblems, type ProviderOut, useSaveGateway } from './hooks'

const MODES = [
  { id: 'test' as const, label: 'Test', hint: 'Sandbox keys. No real money moves.' },
  { id: 'live' as const, label: 'Live', hint: 'Real payments from real customers.' },
]

export default function GatewayCredentialsDrawer({
  provider,
  onClose,
  onSaved,
}: {
  provider: ProviderOut
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const connected = provider.config
  const [mode, setMode] = useState<'test' | 'live'>(connected?.mode ?? 'test')

  // Public fields start from what is saved; secret fields always start empty.
  // There is nothing to prefill them with — the browser is never sent a secret —
  // and an empty one means "keep the stored value" on submit.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      provider.fields
        .filter((f) => !f.secret)
        .map((f) => [f.name, String(connected?.public_config?.[f.name] ?? '')]),
    ),
  )

  const save = useSaveGateway()
  const problems = save.isError ? credentialProblems(save.error) : []

  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }))

  // The catch is what keeps the drawer open on a rejected credential. Without it
  // the rejection escapes an async onClick as an unhandled promise and the admin
  // sees nothing happen at all — the one moment they most need to be told why.
  const submit = async () => {
    try {
      const { verification } = await save.mutateAsync({ provider: provider.id, mode, values })
      onSaved(
        verification && !verification.ok
          ? `${provider.label} saved — ${verification.message}`
          : `${provider.label} saved.`,
      )
      onClose()
    } catch {
      /* rendered from save.error below, and the drawer stays open to be corrected */
    }
  }

  // A live key is the difference between a sandbox and the academy's bank account,
  // so switching to it is called out rather than being one unlabelled tab of two.
  const switchingToLive = mode === 'live' && connected?.mode !== 'live'

  return (
    <Drawer
      title={connected ? `Edit ${provider.label}` : `Connect ${provider.label}`}
      subtitle={provider.tagline}
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-border-input bg-white py-2.5 text-sm font-semibold text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={save.isPending}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {save.isPending && <Loader2 size={14} className="animate-spin" />}
            {save.isPending ? 'Checking…' : connected ? 'Save changes' : 'Connect'}
          </button>
        </div>
      }
    >
      <a
        href={provider.credentials_url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-between gap-2 rounded-xl border border-border-card bg-white px-4 py-3 text-sm text-ink"
      >
        <span>
          Get these keys from your {provider.label} dashboard
          <span className="mt-0.5 block text-xs text-muted">
            Developer settings → API keys
          </span>
        </span>
        <ExternalLink size={15} className="shrink-0 text-slate" />
      </a>

      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-slate uppercase">Environment</p>
        <div className="grid grid-cols-2 gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                mode === m.id
                  ? 'border-ink bg-ink text-white'
                  : 'border-border-input bg-white text-ink'
              }`}
            >
              <span className="block text-sm font-semibold">{m.label}</span>
              <span
                className={`mt-0.5 block text-[11px] leading-tight ${
                  mode === m.id ? 'text-white/70' : 'text-muted'
                }`}
              >
                {m.hint}
              </span>
            </button>
          ))}
        </div>
      </div>

      {switchingToLive && (
        <p className="flex items-start gap-2 rounded-xl bg-flame/10 px-3 py-2.5 text-xs text-ink">
          <AlertTriangle size={14} className="mt-px shrink-0 text-flame" />
          Live mode charges real customers. Make sure these are the live keys from
          your {provider.label} account, not the test ones.
        </p>
      )}

      {provider.fields.map((field) => {
        const hint = connected?.secret_hints?.[field.name]
        return (
          <div key={field.name}>
            <label
              htmlFor={`gw-${field.name}`}
              className="mb-1.5 flex items-baseline justify-between gap-2"
            >
              <span className="text-sm font-medium text-ink">
                {field.label}
                {!field.required && <span className="ml-1 text-xs text-muted">Optional</span>}
              </span>
              {field.secret && hint ? (
                <span className="font-mono text-[11px] text-muted">••••{String(hint)}</span>
              ) : null}
            </label>
            <input
              id={`gw-${field.name}`}
              type={field.secret ? 'password' : 'text'}
              autoComplete="off"
              spellCheck={false}
              value={values[field.name] ?? ''}
              onChange={(e) => set(field.name, e.target.value)}
              placeholder={
                field.secret && hint ? 'Leave blank to keep the saved key' : field.placeholder
              }
              className="w-full rounded-xl border border-border-input bg-white px-3.5 py-2.5 font-mono text-sm text-ink outline-none placeholder:font-sans placeholder:text-muted focus:border-ink"
            />
            <p className="mt-1.5 text-xs text-muted">{field.help}</p>
          </div>
        )
      })}

      {problems.length > 0 && (
        <div className="rounded-xl border border-negative/30 bg-negative/5 px-3.5 py-3">
          <p className="text-xs font-semibold text-negative">
            {problems.length === 1 ? 'Check this' : 'Check these'}
          </p>
          <ul className="mt-1.5 space-y-1">
            {problems.map((p) => (
              <li key={p} className="text-xs leading-snug text-ink">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted">
        Secrets are encrypted before they are stored and are never sent back to this
        screen — only the last four characters, so you can tell which key is saved.
        {provider.supports_live_check
          ? ` Saving checks them against ${provider.label} straight away.`
          : ` ${provider.label} has no way to test credentials without starting a payment, so these are checked for format only.`}
      </p>
    </Drawer>
  )
}
