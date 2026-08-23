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
import { ApiError } from '../../api/client'
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

/** A partner row shows what it speaks, so "why is Playo getting 401s?" is one
 *  glance rather than a database query. Falls back to the raw slug if the registry
 *  has not loaded, or if a partner was onboarded onto a dialect since removed. */
const dialectLabel = (all: DialectOut[] | undefined, slug: string) =>
  all?.find((d) => d.slug === slug)?.label ?? slug

const dialectPath = (all: DialectOut[] | undefined, slug: string) =>
  all?.find((d) => d.slug === slug)?.base_path ?? `/api/v1/gateway/${slug}`

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
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [dialect, setDialect] = useState('native')
  const [freshKey, setFreshKey] = useState<PartnerWithKey | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<PartnerOut | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const slug = slugify(name)
    if (!slug) return
    try {
      setError(null)
      setFreshKey(await create.mutateAsync({ name: name.trim(), slug, dialect }))
      setName('')
      setDialect('native')
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
            Give Playo, Hudle or your own website an API key to read live availability
            and book courts. They see every booking's slot as taken — including
            walk-ins — so the same court is never sold twice.
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

      {freshKey && <FreshKeyPanel partner={freshKey} onDone={() => setFreshKey(null)} />}

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
              disabled={!slugify(name) || create.isPending}
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

          {/* Which contract they speak. Nearly always ours — a dialect exists only
              for a platform big enough to dictate its own spec, and each one is a
              file someone had to write. */}
          <p className="mt-4 text-xs font-semibold tracking-wide text-slate uppercase">
            Which API will they use?
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(dialects.data ?? []).map((d) => (
              <button
                key={d.slug}
                type="button"
                onClick={() => setDialect(d.slug)}
                className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${
                  dialect === d.slug
                    ? 'border-ink bg-ink text-white'
                    : 'border-border-input bg-white text-ink'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {d.label}
                  {d.is_default && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        dialect === d.slug ? 'bg-white/20' : 'bg-surface-muted text-slate'
                      }`}
                    >
                      Default
                    </span>
                  )}
                </span>
                <span
                  className={`mt-1 block text-[11px] leading-snug ${
                    dialect === d.slug ? 'text-white/70' : 'text-muted'
                  }`}
                >
                  {d.summary}
                </span>
                <span
                  className={`mt-1.5 block font-mono text-[11px] ${
                    dialect === d.slug ? 'text-white/60' : 'text-slate'
                  }`}
                >
                  {d.base_path}
                </span>
              </button>
            ))}
          </div>
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
              <p className="mt-0.5 text-[11px] text-slate">
                Speaks{' '}
                <span className="font-medium text-ink">
                  {dialectLabel(dialects.data, partner.dialect)}
                </span>{' '}
                · <span className="font-mono">{dialectPath(dialects.data, partner.dialect)}</span>
              </p>
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

/**
 * The one render in which the key exists.
 *
 * Not a toast: it must survive until it has been copied somewhere safe, so it is
 * dismissed by hand and says plainly that it will not be shown again.
 */
function FreshKeyPanel({ partner, onDone }: { partner: PartnerWithKey; onDone: () => void }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(partner.api_key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

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
        <span className="font-mono">/api/v1/gateway/availability</span> and{' '}
        <span className="font-mono">/api/v1/gateway/bookings</span>.
      </p>
    </div>
  )
}
