import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { Card } from './SettingsPage'

/**
 * Where the counter app lives.
 *
 * In production both apps ship from one Cloudflare Worker — the dashboard at `/`
 * and the POS at `/pos/` — so the URL is simply this page's own origin plus that
 * path. In development they are separate Vite servers on different ports, which is
 * what VITE_POS_URL is for.
 */
function posUrl(): string {
  const configured = import.meta.env.VITE_POS_URL as string | undefined
  if (configured) return configured.replace(/\/$/, '') + '/'
  return `${window.location.origin}/pos/`
}

export default function PosTab() {
  const url = posUrl()
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    QRCode.toDataURL(url, {
      margin: 1,
      width: 320,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    }).then((data) => {
      if (!cancelled) setQr(data)
    })
    return () => {
      cancelled = true
    }
  }, [url])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access is denied over plain HTTP and in some embedded browsers.
      // The URL is on screen and selectable, so this is a convenience failing, not
      // the feature failing — say nothing rather than raise an alarm.
    }
  }

  return (
    <>
      <Card
        title="Open the counter on a tablet"
        subtitle="Point the tablet's browser at this address and sign in with your counter account."
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex gap-2">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full min-w-0 rounded-lg border border-border-input bg-page px-3 py-2.5 font-mono text-sm text-ink outline-none"
              />
              <button
                type="button"
                onClick={() => void copy()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-input px-3 text-sm font-medium text-ink hover:border-ink"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-ink underline"
            >
              Open it here
              <ExternalLink size={13} />
            </a>

            <p className="text-sm text-slate">
              Or scan the code with the tablet’s camera — it goes to the same place.
            </p>
          </div>

          {qr && (
            <img
              src={qr}
              alt={`QR code for ${url}`}
              className="size-40 shrink-0 self-center rounded-xl border border-border-card bg-white p-2 sm:self-start"
            />
          )}
        </div>
      </Card>

      <Card title="Signing in at the counter">
        <ul className="flex flex-col gap-3 text-sm text-slate">
          <li>
            <span className="font-medium text-ink">Use the counter account, not yours.</span> It
            is a separate login that can take bookings, check players in and sell from the shop —
            and can reach nothing else. Your own account opens reports, staff and settings, and
            should never be the one left signed in on a tablet at a public counter.
          </li>
          <li>
            Create or reset it under{' '}
            <span className="font-medium text-ink">Manage → Manage Staff</span>, with the role{' '}
            <span className="font-medium text-ink">kiosk</span>.
          </li>
          <li>
            <span className="font-medium text-ink">To sign out on the tablet,</span> double-click
            the logo in the top bar. It is deliberately awkward so a player cannot do it by
            accident.
          </li>
        </ul>
      </Card>
    </>
  )
}
