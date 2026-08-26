/**
 * Paid, provisioned, and on the way to the dashboard.
 *
 * The redirect is automatic but not instant: a few seconds so the owner reads that
 * their password has been emailed, because that sentence is the one they will need
 * to remember tomorrow when the session has expired. A button too, since an
 * automatic redirect that a popup blocker or a back-navigation eats leaves nobody
 * anywhere.
 */
import { useEffect, useState } from 'react'
import { rupees, type Verified } from '../api/client'
import { clearSignupToken } from '../lib/session'
import { Button, ChevronRight } from '../ui/primitives'
import { WizardShell } from './WizardShell'

const REDIRECT_SECONDS = 6

export function Success({ result }: { result: Verified }) {
  const { signup, handoff_token, dashboard_url } = result

  // `?handoff=` is exchanged by the dashboard for a real token pair — see
  // apps/dashboard/src/auth/handoff.ts. Without one (a handoff already redeemed,
  // or a signup confirmed by webhook while this tab was closed) they land on the
  // login screen and sign in with the credentials they were emailed.
  const target = handoff_token
    ? `${dashboard_url}/?handoff=${encodeURIComponent(handoff_token)}`
    : dashboard_url

  const [left, setLeft] = useState(REDIRECT_SECONDS)

  useEffect(() => {
    // Spent the moment it has worked. The intent token is a bearer capability, and
    // leaving it in localStorage after the academy exists is a stale key in a
    // drawer — it can no longer mint a session, but it still names a real signup.
    clearSignupToken()
  }, [])

  useEffect(() => {
    if (left <= 0) {
      window.location.replace(target)
      return
    }
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(timer)
  }, [left, target])

  return (
    <WizardShell
      title={`${signup.business_name ?? 'Your venue'} is ready`}
      subtitle="Payment received. Your dashboard is set up and waiting."
      footer={
        <div className="space-y-3">
          <Button className="w-full" onClick={() => window.location.replace(target)}>
            Open my dashboard <ChevronRight />
          </Button>
          <p className="text-center text-[13px] text-muted">
            Taking you there in {left}s…
          </p>
        </div>
      }
    >
      <div className="space-y-6">
        {signup.credentials_emailed ? (
          <div className="rounded-2xl border border-border-soft bg-surface-muted p-5">
            <p className="text-[15px] text-ink">
              We've emailed your admin login to{' '}
              <strong className="font-semibold">{signup.email}</strong>.
            </p>
            <p className="mt-2 text-[14px] text-slate">
              It contains a temporary password — change it under Settings → Security
              after you sign in. Check your spam folder if it hasn't arrived in a
              couple of minutes.
            </p>
          </div>
        ) : (
          // Said plainly rather than hidden. Provisioning survives a mail failure on
          // purpose, but an owner who believes an email is coming will close this
          // tab, and the handoff below is the only session they will ever get.
          <div
            role="alert"
            className="rounded-2xl border border-negative/25 bg-negative/5 p-5"
          >
            <p className="text-[15px] font-medium text-ink">
              Your venue is set up, but we couldn't send your login email.
            </p>
            <p className="mt-2 text-[14px] text-slate">
              Your payment went through and{' '}
              <strong className="font-semibold">{signup.email}</strong> is your admin
              account — but the message carrying its password did not leave our
              server. Use the button below to go straight in{' '}
              <strong className="font-semibold">now</strong>, then set a password
              under Settings → Security before you close the tab.
            </p>
          </div>
        )}

        <dl className="space-y-2.5 text-[14px]">
          <Row label="Venue" value={signup.business_name ?? '—'} />
          <Row label="Your address" value={`${signup.tenant_slug ?? '—'}.gamexo.app`} />
          <Row
            label="Plan"
            value={
              signup.plan_code
                ? `${signup.plan_code} · ${signup.billing_period ?? 'monthly'}`
                : '—'
            }
          />
          <Row
            label="Paid"
            value={signup.amount_paise != null ? rupees(signup.amount_paise, { decimals: true }) : '—'}
          />
        </dl>

        <p className="text-[13px] text-muted">
          Your venue has no courts yet — adding them is the first thing the dashboard
          will ask for.
        </p>
      </div>
    </WizardShell>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border-soft pb-2.5 last:border-0">
      <dt className="text-slate">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  )
}
