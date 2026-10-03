/**
 * One tile in the integrations grid: a payment gateway or a booking platform.
 *
 * The two kinds share a card because the question an admin arrives with is one
 * question — "what is this academy plugged into?" — but each says its own thing in
 * the footer: a gateway says which surfaces it collects on, a platform how many
 * keys it holds and when one was last used.
 */
import { Plus, Settings2, ShieldAlert } from '../../ui/icons'
import { type IntegrationItem, relative } from './catalog'
import IntegrationLogo from './IntegrationLogo'

function Status({ item }: { item: IntegrationItem }) {
  if (!item.ready) {
    return <span className="text-xs text-muted">Waiting on their API spec</span>
  }
  if (!item.connected) return <span className="text-xs text-muted">Not connected</span>

  if (item.kind === 'gateway') {
    const config = item.provider.config
    if (config?.last_verification_error) {
      return (
        <span className="flex items-center gap-1.5 text-xs font-medium text-negative">
          <ShieldAlert size={13} /> Needs attention
        </span>
      )
    }
    const surfaces = [config?.collect_on_web && 'Dashboard', config?.collect_on_pos && 'POS'].filter(
      Boolean,
    )
    return (
      <span className="flex items-center gap-1.5 text-xs text-slate">
        <span className="size-1.5 rounded-full bg-positive" />
        {surfaces.length ? `Collecting on ${surfaces.join(' + ')}` : 'Connected · not collecting'}
      </span>
    )
  }

  const active = item.partners.filter((p) => p.is_active).length
  const lastUsed = item.partners
    .map((p) => p.last_used_at)
    .filter((t): t is string => Boolean(t))
    .sort()
    .at(-1)
  return (
    <span className="flex items-center gap-1.5 text-xs text-slate">
      <span className={`size-1.5 rounded-full ${active ? 'bg-positive' : 'bg-muted'}`} />
      {active ? `${active} active key${active === 1 ? '' : 's'}` : 'All keys revoked'}
      {lastUsed && <span className="text-muted">· {relative(lastUsed)}</span>}
    </span>
  )
}

export default function IntegrationCard({
  item,
  disabled,
  onOpen,
}: {
  item: IntegrationItem
  /** Blocks connecting (not managing) — e.g. a deployment with no encryption key. */
  disabled?: boolean
  onOpen: () => void
}) {
  const id = item.kind === 'gateway' ? item.provider.id : item.dialect.slug
  const blocked = !item.ready || (disabled && !item.connected)

  return (
    <div
      className={`flex flex-col rounded-xl border border-border-card bg-white transition-colors ${
        item.ready ? 'hover:border-border-input' : 'opacity-70'
      }`}
    >
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <IntegrationLogo id={id} name={item.name} />
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-slate">
            {!item.ready ? 'Soon' : item.kind === 'gateway' ? 'Payments' : 'Booking'}
          </span>
        </div>
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-ink">
          {item.name}
          {item.kind === 'gateway' && item.provider.config && (
            <span
              className={`rounded-full px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase ${
                item.provider.config.mode === 'live'
                  ? 'bg-positive/15 text-positive'
                  : 'bg-surface-muted text-slate'
              }`}
            >
              {item.provider.config.mode}
            </span>
          )}
        </p>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate">{item.summary}</p>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border-card px-4 py-3">
        <Status item={item} />
        {item.connected ? (
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-1.5 rounded-lg border border-border-input bg-white px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-hover"
          >
            <Settings2 size={13} />
            Manage
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            disabled={blocked}
            className="flex items-center gap-1.5 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            <Plus size={13} />
            Connect
          </button>
        )}
      </div>
    </div>
  )
}
