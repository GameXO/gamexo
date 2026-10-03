/**
 * Outbound integrations: Playo, Hudle and anyone else selling our courts.
 *
 * The direction is the opposite of the payment half. There, we hold someone else's
 * credential. Here, we *issue* one — and it exists in readable form for exactly one
 * render, because only its hash is stored. Everything about this panel follows
 * from that: the key is shown in a view that will not come back, with a copy
 * button, and rotation is offered rather than "show key again".
 *
 * One panel per contract (`dialect`), holding every key issued against it. A venue
 * can hand its own website one key and a staging site another; Playo normally has
 * one.
 */
import { useState } from 'react'
import { ApiError, apiOrigin } from '../../api/client'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from '../../ui/icons'
import ConfirmDialog from '../../ui/ConfirmDialog'
import SidePanel from '../../ui/PanelDock'
import type { PlatformItem } from './catalog'
import CopyField from './CopyField'
import IntegrationLogo from './IntegrationLogo'
import { useCopy } from './useCopy'
import {
  type DialectOut,
  type PartnerOut,
  type PartnerWithKey,
  useCreatePartner,
  useDeletePartner,
  useRotatePartnerKey,
  useUpdatePartner,
} from './hooks'

/** The one URL, whoever is asking.
 *
 *  The API reports the same `base_path` for every dialect, deliberately — the key
 *  tells the gateway which contract to route to, so there is nothing to choose and
 *  no wrong choice to make. Read from the registry rather than hardcoded so a
 *  change to the API prefix cannot leave this screen handing out a dead URL. */
const gatewayUrl = (d: DialectOut) => `${apiOrigin}${d.base_path || '/api/v1/gateway'}`

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)

/** What a key lets its holder do, as the plain list the connect screen shows. The
 *  browser-key list ends in what it *cannot* do, because that boundary is the
 *  reason someone would pick it. */
function abilities(own: boolean, publishable: boolean) {
  if (publishable) {
    return [
      { ok: true, text: 'Check live court availability' },
      { ok: true, text: 'Take a booking for an open slot' },
      { ok: false, text: 'List bookings, read customer details or cancel' },
    ]
  }
  return own
    ? [
        { ok: true, text: 'Read live availability for every court' },
        { ok: true, text: 'Create bookings' },
        { ok: true, text: 'Read, cancel and reconcile bookings' },
      ]
    : [
        { ok: true, text: 'Read live availability for every court' },
        { ok: true, text: 'Book courts — walk-ins already show as taken, so nothing sells twice' },
      ]
}

function Abilities({ own, publishable }: { own: boolean; publishable: boolean }) {
  return (
    <ul className="space-y-2.5">
      {abilities(own, publishable).map((a) => (
        <li key={a.text} className="flex items-start gap-2.5 text-sm text-ink">
          <span
            className={`mt-px flex size-5 shrink-0 items-center justify-center rounded-full ${
              a.ok ? 'bg-positive/15 text-positive' : 'bg-negative/10 text-negative'
            }`}
          >
            {a.ok ? <Check size={12} /> : <X size={12} />}
          </span>
          <span className={a.ok ? '' : 'text-slate'}>{a.text}</span>
        </li>
      ))}
    </ul>
  )
}

export default function PlatformDrawer({
  item,
  onClose,
  onNotify,
}: {
  item: PlatformItem
  onClose: () => void
  onNotify: (message: string) => void
}) {
  const { dialect, partners } = item
  const own = dialect.is_default
  const label = item.name

  const create = useCreatePartner()
  const update = useUpdatePartner()
  const rotate = useRotatePartnerKey()
  const remove = useDeletePartner()

  const [view, setView] = useState<'keys' | 'new'>(partners.length ? 'keys' : 'new')
  // The one render in which a key exists in readable form. Cleared by "Done",
  // never re-derivable — only sha256(key) is stored, so there is no second chance
  // and the view says so.
  const [issued, setIssued] = useState<PartnerWithKey | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<PartnerOut | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState(partners.length || own ? '' : dialect.label)
  // Where the key will live. Only asked for an own-website integration: a
  // third-party platform calls from its servers, so the question has one answer.
  const [inBrowser, setInBrowser] = useState(false)
  const [origins, setOrigins] = useState('')

  // One per line, blanks dropped. A trailing newline while someone is still typing
  // must not become an empty origin that matches nothing.
  const originList = origins
    .split('\n')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean)
  const wantsBrowserKey = inBrowser && own
  const slug = slugify(name)
  // A publishable key with no origin is a key the browser can never use: every
  // response it gets is discarded before the page sees it.
  const canCreate = Boolean(slug) && !create.isPending && (!wantsBrowserKey || originList.length > 0)

  const fail = (fallback: string) => (err: unknown) =>
    setError(err instanceof ApiError ? err.message : fallback)

  const submit = async () => {
    if (!canCreate) return
    try {
      setError(null)
      setIssued(
        await create.mutateAsync({
          name: name.trim(),
          slug,
          dialect: dialect.slug,
          // Sent explicitly rather than left to the server default, so what the
          // form showed is what gets issued.
          key_kind: wantsBrowserKey ? 'publishable' : 'secret',
          allowed_origins: wantsBrowserKey ? originList : [],
        }),
      )
      setName('')
      setInBrowser(false)
      setOrigins('')
      setView('keys')
    } catch (err) {
      fail('Could not generate that key.')(err)
    }
  }

  const doRotate = async (partner: PartnerOut) => {
    try {
      setError(null)
      setIssued(await rotate.mutateAsync(partner.id))
    } catch (err) {
      fail('Could not rotate that key.')(err)
    }
  }

  const toggleActive = async (partner: PartnerOut) => {
    try {
      setError(null)
      await update.mutateAsync({ id: partner.id, is_active: !partner.is_active })
      onNotify(partner.is_active ? `${partner.name} revoked.` : `${partner.name} re-enabled.`)
    } catch (err) {
      fail('Could not update that key.')(err)
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
      fail('Could not remove that key.')(err)
    }
  }

  // --- A key was just issued: the one-time view ------------------------------------
  if (issued) {
    const publishable = issued.key_kind === 'publishable'
    return (
      <SidePanel
        title={`Connect ${label}`}
        subtitle="Copy the key now — it is shown once"
        onClose={() => setIssued(null)}
        footer={
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="w-full rounded-xl bg-ink py-2.5 text-sm font-semibold text-white"
          >
            Done
          </button>
        }
      >
        <div className="flex items-center justify-center gap-3 pt-2">
          <IntegrationLogo id={dialect.slug} name={label} size={56} />
          <span className="flex items-center text-muted">
            <ArrowLeft size={14} />
            <ArrowRight size={14} className="-ml-1" />
          </span>
          <IntegrationLogo id="turfleo" name="Turfleo" size={56} />
        </div>
        <div className="text-center">
          <p className="text-lg font-semibold text-ink">
            Connect {label} to your courts
          </p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-slate">
            Send {issued.name}'s key as the <span className="font-mono">X-API-Key</span> header
            to the address below.
          </p>
        </div>

        <CopyField label="Base URL" value={gatewayUrl(dialect)} />
        <CopyField label="API key" value={issued.api_key} wrap />
        <p className="-mt-2 rounded-xl border border-lime bg-lime/10 px-3.5 py-2.5 text-xs leading-relaxed text-lime-ink">
          This is the only time it can be read. We store a hash, so it cannot be looked up
          later — a lost key needs a rotation.
        </p>

        <div className="border-t border-border-card pt-5">
          <p className="mb-3 text-sm font-semibold text-ink">{issued.name} will be able to</p>
          <Abilities own={own} publishable={publishable} />
        </div>
      </SidePanel>
    )
  }

  // --- Generate a key --------------------------------------------------------------
  const form = (
    <div className="flex flex-col gap-5">
      <div>
        <label htmlFor="platform-name" className="mb-1.5 block text-sm font-medium text-ink">
          {own ? 'Name this website or app' : 'Key name'}
        </label>
        <input
          id="platform-name"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder={own ? 'Acme Turf Site' : dialect.label}
          className="w-full rounded-xl border border-border-input bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus:border-ink"
        />
        {name && (
          <p className="mt-1.5 text-xs text-muted">
            Bookings from this key will be tagged{' '}
            <span className="font-mono text-slate">{slug || '—'}</span>.
          </p>
        )}
      </div>

      {/* Only for an own-website integration. A third-party platform calls from its
          own servers by definition, so asking would be a question with one answer —
          and offering a browser key for Playo's contract would offer something that
          cannot exist. */}
      {own && (
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate uppercase">
            Where will the key live?
          </p>
          <div className="space-y-2">
            {(
              [
                [
                  false,
                  'On their server',
                  'The key is never sent to a browser. Full access to the contract — read bookings, cancel, reconcile.',
                ],
                [
                  true,
                  "In their website's JavaScript",
                  'For a site with no backend. Anyone who opens devtools can read the key, so it can only check availability and take a booking.',
                ],
              ] as const
            ).map(([browser, title, hint]) => (
              <label
                key={title}
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3.5 ${
                  inBrowser === browser ? 'border-ink bg-white' : 'border-border-input bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="key-kind"
                  checked={inBrowser === browser}
                  onChange={() => setInBrowser(browser)}
                  className="mt-0.5 accent-ink"
                />
                <span>
                  <span className="block text-sm font-medium text-ink">{title}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </div>

          {inBrowser && (
            <div className="mt-3">
              <label
                htmlFor="allowed-origins"
                className="text-xs font-semibold tracking-wide text-slate uppercase"
              >
                Their website address
              </label>
              <textarea
                id="allowed-origins"
                value={origins}
                onChange={(e) => setOrigins(e.target.value)}
                rows={2}
                placeholder="https://xcs.base44.app"
                className="mt-1.5 w-full rounded-xl border border-border-input bg-white px-3.5 py-2.5 font-mono text-xs text-ink outline-none focus:border-ink"
              />
              <p className="mt-1.5 text-xs leading-snug text-muted">
                One per line, scheme included. Without a match the browser throws our reply
                away, so this is what makes the integration work — it is not a security
                control, since anything that is not a browser sets its own headers.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-border-card pt-5">
        <p className="mb-3 text-sm font-semibold text-ink">This key will be able to</p>
        <Abilities own={own} publishable={wantsBrowserKey} />
      </div>
    </div>
  )

  // --- Keys already issued ---------------------------------------------------------
  const list = (
    <div className="space-y-3">
      {partners.map((partner) => (
        <KeyRow
          key={partner.id}
          partner={partner}
          busy={rotate.isPending || update.isPending}
          onRotate={() => void doRotate(partner)}
          onToggle={() => void toggleActive(partner)}
          onDelete={() => setConfirmDelete(partner)}
        />
      ))}
      <p className="text-xs leading-relaxed text-muted">
        Every key uses the same address — <span className="font-mono">{gatewayUrl(dialect)}</span>.
        The key is what tells us which API to speak.
      </p>
    </div>
  )

  return (
    <>
      <SidePanel
        title={label}
        subtitle={`Booking platform · ${partners.length} key${partners.length === 1 ? '' : 's'}`}
        icon={<IntegrationLogo id={dialect.slug} name={label} size={40} />}
        onClose={onClose}
        footer={
          view === 'new' ? (
            <div className="flex items-center gap-3">
              {partners.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setView('keys')
                    setError(null)
                  }}
                  className="flex-1 rounded-xl border border-border-input bg-white py-2.5 text-sm font-semibold text-ink"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!canCreate}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {create.isPending && <Loader2 size={14} className="animate-spin" />}
                Generate key
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setView('new')
                setError(null)
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink py-2.5 text-sm font-semibold text-white"
            >
              <Plus size={14} />
              Add another key
            </button>
          )
        }
      >
        {error && (
          <p className="rounded-xl border border-negative/30 bg-negative/5 px-3.5 py-2.5 text-xs text-ink">
            {error}
          </p>
        )}
        {view === 'new' ? form : list}
      </SidePanel>

      {confirmDelete && (
        <ConfirmDialog
          title={`Remove ${confirmDelete.name}?`}
          message="Its key stops working immediately. If it has made bookings this will be refused — revoke instead, so those bookings keep showing where they came from."
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void doDelete(confirmDelete)}
        />
      )}
    </>
  )
}

function KeyRow({
  partner,
  busy,
  onRotate,
  onToggle,
  onDelete,
}: {
  partner: PartnerOut
  busy: boolean
  onRotate: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-xl border border-border-card bg-white p-3.5">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted">
          <KeyRound size={14} className="text-ink" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-ink">{partner.name}</p>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${
                partner.is_active ? 'bg-positive/15 text-positive' : 'bg-surface-muted text-slate'
              }`}
            >
              {partner.is_active ? 'Active' : 'Revoked'}
            </span>
            {partner.key_kind === 'publishable' && (
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-slate">
                Browser key
              </span>
            )}
          </div>
          <p className="text-xs text-muted">
            {partner.last_used_at
              ? `Last call ${new Date(partner.last_used_at).toLocaleString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  hour: 'numeric',
                  minute: '2-digit',
                })}`
              : 'Never used'}
          </p>
        </div>
      </div>

      <KeyPrefix prefix={partner.key_prefix} name={partner.name} />

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onRotate}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-border-input bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-hover disabled:opacity-50"
        >
          <RotateCcw size={12} />
          Rotate
        </button>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          className="rounded-lg border border-border-input bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-hover disabled:opacity-50"
        >
          {partner.is_active ? 'Revoke' : 'Re-enable'}
        </button>
        <button
          type="button"
          aria-label={`Remove ${partner.name}`}
          onClick={onDelete}
          className="ml-auto rounded-lg p-1.5 text-negative hover:bg-negative/10"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

/**
 * The identifying half of a partner's key, hidden until asked for.
 *
 * WHAT THIS DOES NOT DO, because the UI used to imply otherwise: it does not
 * reveal the key. The secret half is never stored — only a SHA-256 of the whole
 * string is (see `gateway/models.py::generate_api_key`), and the list endpoint
 * returns `key_prefix` and nothing else. The full key exists in a readable form
 * exactly once, in the view shown at creation and rotation.
 *
 * So the trailing dots are not a mask over something retrievable, and an eye that
 * "unmasked" them would be promising a reveal that can never arrive. What toggles
 * here is the prefix, and the label says which.
 *
 * Hidden by default all the same. The prefix is not a secret — it is designed to be
 * quotable in a support ticket — but it looks exactly like one on a shared screen.
 */
function KeyPrefix({ prefix, name }: { prefix: string; name: string }) {
  const [shown, setShown] = useState(false)
  const { copied, copy } = useCopy(prefix)

  return (
    <div className="mt-3 flex items-center gap-1 rounded-lg bg-surface-muted px-3 py-2">
      <p className="min-w-0 flex-1 truncate font-mono text-xs text-slate" aria-live="polite">
        {shown ? (
          <>
            {prefix}
            <span title="The secret half is never stored and cannot be shown">.••••••••</span>
          </>
        ) : (
          '•'.repeat(prefix.length + 9)
        )}
      </p>
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        // Named, not "toggle key": several rows carry one of these, and a screen
        // reader announcing "show key identifier" four times says nothing about
        // which key is being revealed.
        aria-label={`${shown ? 'Hide' : 'Show'} the key identifier for ${name}`}
        title={shown ? 'Hide key identifier' : 'Show key identifier'}
        className="rounded-md p-1 text-muted hover:bg-white hover:text-ink"
      >
        {shown ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
      {/* Copies the prefix — the only part that exists to copy. Enabled while hidden
          too: someone quoting it into a support ticket wants the string, not the
          sight of it. */}
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy the key identifier for ${name}`}
        title={copied ? 'Copied' : 'Copy key identifier'}
        className="rounded-md p-1 text-muted hover:bg-white hover:text-ink"
      >
        {copied ? <Check size={13} className="text-positive" /> : <Copy size={13} />}
      </button>
    </div>
  )
}
