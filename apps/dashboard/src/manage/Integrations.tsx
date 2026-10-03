/**
 * Settings → Integrations.
 *
 * Two kinds of integration that look similar and are not. Payment gateways hold
 * credentials the academy owns at Razorpay or Cashfree, which we store encrypted and
 * replay on every charge. Booking platforms hold credentials *we* issue to Playo and
 * Hudle, which we store hashed and can never read back. They share a grid because
 * the question an admin arrives with — "what is this academy plugged into?" — is
 * one question; each opens its own panel because what you do next is not.
 */
import { useMemo, useState } from 'react'
import { BadgeCheck, Clock, Info, Plug, Search, ShieldAlert, ShieldOff } from '../ui/icons'
import type { ReactNode } from 'react'
import { buildCatalog, connectedFirst, type IntegrationItem, relative } from './integrations/catalog'
import GatewayCredentialsDrawer from './integrations/GatewayCredentialsDrawer'
import GatewayDrawer from './integrations/GatewayDrawer'
import IntegrationCard from './integrations/IntegrationCard'
import PlatformDrawer from './integrations/PlatformDrawer'
import { useDialects, usePartners, usePaymentProviders } from './integrations/hooks'

type Filter = 'all' | 'available' | 'connected'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'available', label: 'Available' },
  { id: 'connected', label: 'Connected' },
]

/** Which panel is open. A gateway has two: the manage view for one that is
 *  connected, and the keys form. `back` remembers whether the form was reached from
 *  the manage view, so closing it returns there instead of dropping the context. */
type Panel =
  | { type: 'gateway'; id: string; mode: 'manage' | 'edit'; back: boolean }
  | { type: 'platform'; slug: string }
  | null

function Stat({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: ReactNode
  label: string
  value: string
  hint?: string
  tone?: 'warn'
}) {
  return (
    <div className="rounded-xl border border-border-card bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate">
        <span className="text-muted">{icon}</span>
        {label}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span
          className={`font-display text-2xl font-semibold ${tone === 'warn' ? 'text-negative' : 'text-ink'}`}
        >
          {value}
        </span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
    </div>
  )
}

export default function Integrations() {
  const gateways = usePaymentProviders()
  const dialects = useDialects()
  const partners = usePartners()

  const [panel, setPanel] = useState<Panel>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [toast, setToast] = useState<string | null>(null)

  const notify = (message: string) => {
    setToast(message)
    setTimeout(() => setToast(null), 3500)
  }

  const providers = useMemo(() => gateways.data?.providers ?? [], [gateways.data])
  const secretsAvailable = gateways.data?.secrets_available ?? true

  const catalog = useMemo(
    () => buildCatalog(providers, dialects.data ?? [], partners.data ?? []),
    [providers, dialects.data, partners.data],
  )

  const all: IntegrationItem[] = [...catalog.gateways, ...catalog.platforms]
  const connected = all.filter((i) => i.connected)
  const attention = catalog.gateways.filter((g) => g.provider.config?.last_verification_error)
  const lastCall = (partners.data ?? [])
    .map((p) => p.last_used_at)
    .filter((t): t is string => Boolean(t))
    .sort()
    .at(-1)

  const collecting = (surface: 'web' | 'pos') =>
    providers.find((p) =>
      surface === 'web' ? p.config?.collect_on_web : p.config?.collect_on_pos,
    )?.label

  const matches = (item: IntegrationItem) => {
    const q = query.trim().toLowerCase()
    if (q && !`${item.name} ${item.summary}`.toLowerCase().includes(q)) return false
    if (filter === 'connected') return item.connected
    if (filter === 'available') return !item.connected
    return true
  }

  const sections = [
    {
      id: 'gateways',
      title: 'Payment gateways',
      blurb: "The academy's own gateway account. One collects per surface.",
      items: connectedFirst(catalog.gateways).filter(matches),
    },
    {
      id: 'platforms',
      title: 'Booking platforms',
      blurb: 'Outside sites that read availability and book your courts.',
      items: connectedFirst(catalog.platforms).filter(matches),
    },
  ].filter((s) => s.items.length > 0)

  const open = (item: IntegrationItem) => {
    if (item.kind === 'platform') {
      setPanel({ type: 'platform', slug: item.dialect.slug })
    } else {
      setPanel({
        type: 'gateway',
        id: item.provider.id,
        mode: item.connected ? 'manage' : 'edit',
        back: false,
      })
    }
  }

  // Resolved from the live queries on every render, never copied into state, so a
  // toggle or a rotated key shows in the open panel as soon as the refetch lands.
  const gatewayPanel =
    panel?.type === 'gateway' ? providers.find((p) => p.id === panel.id) : undefined
  const platformPanel =
    panel?.type === 'platform'
      ? catalog.platforms.find((p) => p.dialect.slug === panel.slug)
      : undefined

  const web = collecting('web')
  const pos = collecting('pos')
  const loading = gateways.isLoading || dialects.isLoading || partners.isLoading
  const failed = gateways.isError || dialects.isError || partners.isError

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<Plug size={14} />} label="Total available" value={String(all.length)} />
        <Stat
          icon={<BadgeCheck size={14} />}
          label="Connected"
          value={String(connected.length).padStart(2, '0')}
          hint={`of ${all.length}`}
        />
        <Stat
          icon={<ShieldAlert size={14} />}
          label="Needs attention"
          value={String(attention.length).padStart(2, '0')}
          tone={attention.length ? 'warn' : undefined}
        />
        <Stat
          icon={<Clock size={14} />}
          label="Last API call"
          value={lastCall ? relative(lastCall) : '—'}
          hint={lastCall ? undefined : 'No calls yet'}
        />
      </div>

      {/* The answer to "where is the money going?" belongs above the cards, not
          reconstructed by reading a toggle on each one. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(
          [
            ['Dashboard', web],
            ['POS counter', pos],
          ] as const
        ).map(([label, using]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 rounded-xl border border-border-card bg-white px-4 py-3"
          >
            <span className="text-sm text-slate">{label} collects via</span>
            <span className={`text-sm font-semibold ${using ? 'text-ink' : 'text-muted'}`}>
              {using ?? 'Cash / UPI only'}
            </span>
          </div>
        ))}
      </div>

      {!secretsAvailable && (
        <p className="flex items-start gap-2 rounded-xl border border-negative/30 bg-negative/5 px-3.5 py-3 text-xs leading-relaxed text-ink">
          <ShieldOff size={14} className="mt-px shrink-0 text-negative" />
          <span>
            This deployment has no encryption key configured, so payment credentials cannot
            be stored safely and connecting a gateway is disabled. Set{' '}
            <span className="font-mono">SECRETS_ENCRYPTION_KEY</span> on the API and restart
            it.
          </span>
        </p>
      )}

      <div className="rounded-2xl border border-border-card bg-surface-muted/40 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-ink">All integrations</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search integrations…"
                aria-label="Search integrations"
                className="w-56 rounded-xl border border-border-input bg-white py-2 pr-3 pl-9 text-sm text-ink outline-none placeholder:text-muted focus:border-ink"
              />
            </div>
            <div className="flex rounded-xl border border-border-input bg-white p-0.5" role="tablist">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={`rounded-[10px] px-3 py-1.5 text-sm transition-colors ${
                    filter === f.id
                      ? 'bg-surface-muted font-semibold text-ink'
                      : 'text-slate hover:text-ink'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && <p className="mt-5 text-sm text-slate">Loading integrations…</p>}
        {failed && !loading && (
          <p className="mt-5 text-sm text-negative">Could not load every integration. Try refreshing.</p>
        )}

        {!loading && sections.length === 0 && !failed && (
          <div className="mt-5 flex flex-col items-center rounded-xl border border-dashed border-border-soft bg-white/60 px-6 py-10 text-center">
            <Plug size={20} className="text-muted" />
            <p className="mt-3 text-sm font-semibold text-ink">
              {query ? `No integration matches “${query.trim()}”` : 'Nothing here yet'}
            </p>
            <p className="mt-1 max-w-sm text-xs text-slate">
              {filter === 'connected'
                ? 'Connect a payment gateway or a booking platform and it will show up here.'
                : 'Try a different search or filter.'}
            </p>
          </div>
        )}

        {sections.map((section) => (
          <section key={section.id} className="mt-5">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3">
              <h3 className="text-sm font-semibold text-ink">
                {section.title}
                <span className="ml-1.5 font-normal text-muted">{section.items.length}</span>
              </h3>
              <p className="text-xs text-muted">{section.blurb}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {section.items.map((item) => (
                <IntegrationCard
                  key={item.key}
                  item={item}
                  disabled={item.kind === 'gateway' && !secretsAvailable}
                  onOpen={() => open(item)}
                />
              ))}
            </div>
          </section>
        ))}

        <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted">
          <Info size={13} className="mt-px shrink-0" />
          Gateway secrets are encrypted before they are written and never sent back to the
          browser — only the last four characters are shown. Turning both collection toggles
          off leaves a surface taking cash and UPI at the counter, exactly as it does today.
        </p>
      </div>

      {gatewayPanel && panel?.type === 'gateway' && panel.mode === 'manage' && (
        <GatewayDrawer
          provider={gatewayPanel}
          disabled={!secretsAvailable}
          onEdit={() => setPanel({ ...panel, mode: 'edit', back: true })}
          onClose={() => setPanel(null)}
          onNotify={notify}
        />
      )}

      {gatewayPanel && panel?.type === 'gateway' && panel.mode === 'edit' && (
        <GatewayCredentialsDrawer
          provider={gatewayPanel}
          onClose={() => setPanel(panel.back ? { ...panel, mode: 'manage' } : null)}
          onSaved={notify}
        />
      )}

      {platformPanel && (
        <PlatformDrawer item={platformPanel} onClose={() => setPanel(null)} onNotify={notify} />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] max-w-[90vw] -translate-x-1/2 rounded-xl bg-ink px-4 py-2.5 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
