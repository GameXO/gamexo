/**
 * Outbound integrations: Playo, Hudle and anyone else selling our courts.
 *
 * The direction is the opposite of the payment half. There, we hold someone else's
 * credential. Here, we *issue* one — and it exists in readable form for exactly one
 * render, because only its hash is stored. Everything about this screen follows
 * from that: the key is shown in a panel that will not come back, with a copy
 * button, and rotation is offered rather than "show key again".
 */
import { useState } from 'react'
import { Check, Copy, KeyRound, Plug, RotateCcw, Trash2 } from 'lucide-react'
import { ApiError, apiOrigin } from '../../api/client'
import ConfirmDialog from '../../ui/ConfirmDialog'
import {
  type DialectOut,
  type PartnerOut,
  type PartnerWithKey,
  useCreatePartner,
  useDialects,
  useDeletePartner,
  usePartners,
  useRotatePartnerKey,
  useUpdatePartner,
} from './hooks'

/** A partner row shows what it speaks, so "why is Playo getting 404s?" is one
 *  glance rather than a database query. Falls back to the raw slug if the registry
 *  has not loaded, or if a partner was onboarded onto a dialect since removed. */
const dialectLabel = (all: DialectOut[] | undefined, slug: string) =>
  all?.find((d) => d.slug === slug)?.label ?? slug

/** The one URL, whoever is asking.
 *
 *  The API reports the same `base_path` for every dialect, deliberately — the key
 *  tells the gateway which contract to route to, so there is nothing to choose and
 *  no wrong choice to make. Read from the registry rather than hardcoded so a
 *  change to the API prefix cannot leave this screen handing out a dead URL. */
const gatewayUrl = (all: DialectOut[] | undefined) =>
  `${apiOrigin}${all?.[0]?.base_path ?? '/api/v1/gateway'}`

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)

export default function BookingPlatforms({ onNotify }: { onNotify: (message: string) => void }) {
  const partners = usePartners()
  const create = useCreatePartner()
  const update = useUpdatePartner()
  const rotate = useRotatePartnerKey()
  const remove = useDeletePartner()

  const dialects = useDialects()

  /** The named third-party platforms, in the order the API lists them: the ones with
   *  an adapter first. `native` is excluded — it is our own contract, and "who is this
   *  integration for?" has no answer that is us. */
  const platforms = (dialects.data ?? []).filter((d) => d.is_platform)

  /** Selected by default, so the common case is one field and a button. Derived from
   *  the registry rather than hardcoded to `playo`: the day Hudle's adapter lands,
   *  this must not still be pinning the form to a platform that happens to be first
   *  in a list someone reordered. */
  const firstReady = platforms.find((d) => d.is_ready)?.slug ?? ''

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  // Empty until touched, so the default follows the registry once it loads rather
  // than being frozen at whatever the first render guessed.
  const [dialect, setDialect] = useState('')
  const selected = dialect || firstReady
  const [freshKey, setFreshKey] = useState<PartnerWithKey | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<PartnerOut | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const slug = slugify(name)
    const chosen = dialect || firstReady
    if (!slug || !chosen) return
    try {
      setError(null)
      setFreshKey(await create.mutateAsync({ name: name.trim(), slug, dialect: chosen }))
      setName('')
      setDialect('')
      setAdding(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add that platform.')
    }
  }

  const doRotate = async (partner: PartnerOut) => {
    try {
      setError(null)
      setFreshKey(await rotate.mutateAsync(partner.id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not rotate that key.')
    }
  }

  const toggleActive = async (partner: PartnerOut) => {
    try {
      setError(null)
      await update.mutateAsync({ id: partner.id, is_active: !partner.is_active })
      onNotify(partner.is_active ? `${partner.name} revoked.` : `${partner.name} re-enabled.`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that platform.')
    }
  }

  /** Re-point a live integration at another contract, keeping its key.
   *
   *  The repair for having picked the wrong one at setup. Deleting and re-adding is
   *  not an alternative — the booking FK is RESTRICT, so a platform that has booked
   *  anything cannot be deleted at all. */
  const repoint = async (partner: PartnerOut, slug: string) => {
    if (slug === partner.dialect) return
    try {
      setError(null)
      await update.mutateAsync({ id: partner.id, dialect: slug })
      onNotify(`${partner.name} now speaks ${dialectLabel(dialects.data, slug)}.`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change that platform’s API.')
    }
  }

  const doDelete = async (partner: PartnerOut) => {
    setConfirmDelete(null)
    try {
      await remove.mutateAsync(partner.id)
      onNotify(`${partner.name} removed.`)
    } catch (err) {
      // 409 while bookings still reference it — the FK is RESTRICT, so a booking
      // can always still answer "where did this come from?".
      setError(err instanceof ApiError ? err.message : 'Could not remove that platform.')
    }
  }

  const rows = partners.data ?? []

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Booking platforms</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate">
            Give Playo, Hudle or District an API key to read live availability and book
            courts. They see every booking's slot as taken — including walk-ins — so
            the same court is never sold twice.
          </p>
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white"
          >
            Add platform
          </button>
        )}
      </div>

      {rows.length > 0 && <GatewayUrl url={gatewayUrl(dialects.data)} />}

      {freshKey && (
        <FreshKeyPanel
          partner={freshKey}
          url={gatewayUrl(dialects.data)}
          onDone={() => setFreshKey(null)}
        />
      )}

      {adding && (
        <div className="mt-4 rounded-2xl border border-border-card bg-white p-4">
          <label htmlFor="platform-name" className="text-sm font-medium text-ink">
            Platform name
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id="platform-name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
              placeholder="Playo"
              className="min-w-[200px] flex-1 rounded-xl border border-border-input px-3.5 py-2.5 text-sm text-ink outline-none focus:border-ink"
            />
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!slugify(name) || !selected || create.isPending}
              className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Generate key
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false)
                setName('')
                setError(null)
              }}
              className="rounded-xl border border-border-input px-4 py-2.5 text-sm font-semibold text-ink"
            >
              Cancel
            </button>
          </div>
          {name && (
            <p className="mt-2 text-xs text-muted">
              Bookings from this platform will be tagged{' '}
              <span className="font-mono text-slate">{slugify(name)}</span>.
            </p>
          )}

          {/* Which platform this is — NOT which URL they get. There is one URL, and
              this is what the key routes to.

              The two without an adapter are shown rather than hidden: they are real
              platforms we intend to support, and a picker that silently omitted them
              would invite someone to ask why. Disabled, not merely styled — and the
              API refuses them too, since a greyed button is presentation, not a rule. */}
          <p className="mt-4 text-xs font-semibold tracking-wide text-slate uppercase">
            Which platform is this?
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {platforms.map((d) => (
              <button
                key={d.slug}
                type="button"
                onClick={() => setDialect(d.slug)}
                disabled={!d.is_ready}
                aria-disabled={!d.is_ready}
                title={d.is_ready ? undefined : `${d.label} has not sent their API spec yet.`}
                className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${
                  !d.is_ready
                    ? 'cursor-not-allowed border-border-soft bg-surface-muted/60 text-muted'
                    : selected === d.slug
                      ? 'border-ink bg-ink text-white'
                      : 'border-border-input bg-white text-ink'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {d.label}
                  {!d.is_ready && (
                    <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-slate uppercase">
                      Soon
                    </span>
                  )}
                </span>
                <span
                  className={`mt-1 block text-[11px] leading-snug ${
                    !d.is_ready ? 'text-muted' : selected === d.slug ? 'text-white/70' : 'text-muted'
                  }`}
                >
                  {d.summary}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">
            All of them get the same URL — the key is what tells us which API to speak.
          </p>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-xl border border-negative/30 bg-negative/5 px-3.5 py-2.5 text-xs text-ink">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {rows.length === 0 && !adding && (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-border-soft bg-white/60 px-6 py-10 text-center">
            <Plug size={20} className="text-muted" />
            <p className="mt-3 text-sm font-semibold text-ink">No platforms connected</p>
            <p className="mt-1 max-w-sm text-xs text-slate">
              Add one to let an outside site sell your courts without risking a double
              booking.
            </p>
          </div>
        )}

        {rows.map((partner) => (
          <div
            key={partner.id}
            className="flex flex-wrap items-center gap-3 rounded-2xl border border-border-card bg-white p-4"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted">
              <KeyRound size={15} className="text-ink" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-ink">{partner.name}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                    partner.is_active ? 'bg-positive/15 text-positive' : 'bg-surface-muted text-slate'
                  }`}
                >
                  {partner.is_active ? 'Active' : 'Revoked'}
                </span>
              </div>
              <p className="mt-0.5 font-mono text-xs text-muted">
                {partner.key_prefix}.••••••••
              </p>
              <label className="mt-1 flex items-center gap-1.5 text-[11px] text-slate">
                Speaks
                <select
                  value={partner.dialect}
                  onChange={(e) => void repoint(partner, e.target.value)}
                  disabled={update.isPending}
                  aria-label={`API ${partner.name} speaks`}
                  className="rounded-lg border border-border-input bg-white px-1.5 py-0.5 text-[11px] font-medium text-ink outline-none focus:border-ink disabled:opacity-50"
                >
                  {platforms.map((d) => (
                    <option key={d.slug} value={d.slug} disabled={!d.is_ready}>
                      {d.is_ready ? d.label : `${d.label} — not built yet`}
                    </option>
                  ))}
                  {/* Whatever this partner is on today, if it is not one of the three
                      offered — gamexo API, or a dialect since retired. Present so the
                      row states the truth rather than silently displaying the first
                      option, and selectable so re-pointing back to it stays possible
                      without a curl. */}
                  {!platforms.some((d) => d.slug === partner.dialect) && (
                    <option value={partner.dialect}>
                      {dialectLabel(dialects.data, partner.dialect)}
                    </option>
                  )}
                </select>
              </label>
            </div>

            <p className="text-xs text-slate">
              {partner.last_used_at
                ? `Last call ${new Date(partner.last_used_at).toLocaleString('en-IN', {
                    day: 'numeric',
                    month: 'short',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}`
                : 'Never used'}
            </p>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void doRotate(partner)}
                disabled={rotate.isPending}
                className="flex items-center gap-1.5 rounded-lg border border-border-input px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
              >
                <RotateCcw size={12} />
                Rotate
              </button>
              <button
                type="button"
                onClick={() => void toggleActive(partner)}
                className="rounded-lg border border-border-input px-3 py-1.5 text-xs font-semibold text-ink"
              >
                {partner.is_active ? 'Revoke' : 'Re-enable'}
              </button>
              <button
                type="button"
                aria-label={`Remove ${partner.name}`}
                onClick={() => setConfirmDelete(partner)}
                className="rounded-lg p-1.5 text-negative"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Remove ${confirmDelete.name}?`}
          message="Their key stops working immediately. If they have made bookings this will be refused — revoke instead, so those bookings keep showing where they came from."
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void doDelete(confirmDelete)}
        />
      )}
    </section>
  )
}

/** Copy-to-clipboard with a two-second acknowledgement. Two panels here hand out a
 *  string someone must paste elsewhere, and a copy button with no feedback leaves
 *  people clicking it twice to be sure. */
function useCopy(value: string) {
  const [copied, setCopied] = useState(false)
  return {
    copied,
    copy: async () => {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    },
  }
}

/**
 * The URL every platform is given.
 *
 * One line, once, above the list — not repeated per row, because it is the same for
 * all of them and repeating it would imply otherwise. Which contract a request
 * reaches is decided by its API key, so this is genuinely the whole address.
 */
function GatewayUrl({ url }: { url: string }) {
  const { copied, copy } = useCopy(url)

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border-card bg-surface-muted/50 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold tracking-wide text-slate uppercase">
          Base URL — give this to every platform
        </p>
        <code className="mt-1 block truncate font-mono text-xs text-ink">{url}</code>
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        className="flex items-center gap-1.5 rounded-lg border border-border-input bg-white px-3 py-2 text-xs font-semibold text-ink"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/**
 * The one render in which the key exists.
 *
 * Not a toast: it must survive until it has been copied somewhere safe, so it is
 * dismissed by hand and says plainly that it will not be shown again.
 */
function FreshKeyPanel({
  partner,
  url,
  onDone,
}: {
  partner: PartnerWithKey
  url: string
  onDone: () => void
}) {
  const { copied, copy } = useCopy(partner.api_key)

  return (
    <div className="mt-4 rounded-2xl border border-lime bg-lime/10 p-4">
      <p className="text-sm font-semibold text-lime-ink">
        {partner.name}'s API key — copy it now
      </p>
      <p className="mt-1 text-xs text-lime-ink/80">
        This is the only time it can be read. We store a hash, so it cannot be looked
        up later — a lost key needs a rotation.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-lime/60 bg-white px-3 py-2 font-mono text-xs text-ink">
          {partner.api_key}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-lime/60 bg-white px-3 py-2 text-xs font-semibold text-ink"
        >
          Done
        </button>
      </div>
      <p className="mt-3 text-[11px] text-lime-ink/70">
        They send it as the <span className="font-mono">X-API-Key</span> header to{' '}
        <span className="font-mono">{url}</span>. The key is what tells us which API
        they speak, so that one address is everything they need.
      </p>
    </div>
  )
}
