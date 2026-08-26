/**
 * Step 0 — who is signing up, before the three steps the mockups show.
 *
 * This is what creates the intent, so it has to come first: every later screen
 * addresses the signup by the token this call returns. It asks for as little as
 * possible, because the answer to "how much do you want before you show me the
 * product" is "less".
 *
 * No password field, and that is the design. The password is generated at
 * provisioning and emailed — see `app/modules/billing/service.py::fulfil` — so
 * there is nothing to choose here and nothing to confirm.
 */
import { useState } from 'react'
import { ApiError, DASHBOARD_URL_FALLBACK, api, type Signup } from '../api/client'
import { Alert, Button, ChevronRight, Field, Input } from '../ui/primitives'
import { WizardShell } from './WizardShell'

export function AccountStep({
  onStarted,
}: {
  onStarted: (token: string, signup: Signup) => void
}) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null)
  // Held separately from `fieldError` because it is not a correction to make and
  // resubmit — it is a different destination. See the branch below.
  const [alreadyRegistered, setAlreadyRegistered] = useState<string | null>(null)

  const errorFor = (field: string) =>
    fieldError?.field === field ? fieldError.message : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setFieldError(null)
    setError(null)
    setAlreadyRegistered(null)

    if (!fullName.trim()) {
      setFieldError({ field: 'full_name', message: 'Please tell us your name.' })
      return
    }
    if (!email.trim()) {
      setFieldError({ field: 'email', message: 'We need an email to send your login to.' })
      return
    }

    setSaving(true)
    try {
      const { token, signup } = await api.startSignup({
        email: email.trim(),
        full_name: fullName.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      })
      onStarted(token, signup)
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) {
        // Not a validation error, so not shown as one. Everything else on this form
        // is "fix this and press the button again"; this is the one outcome where
        // pressing the button again can never work, because the thing they are
        // trying to create already exists. Sending it to `fieldError` put a red
        // line under the email box and left them re-typing an address that was
        // never wrong.
        setAlreadyRegistered(email.trim())
      } else if (err instanceof ApiError && err.status === 422) {
        setFieldError({ field: 'email', message: 'That email address does not look right.' })
      } else {
        setError(
          err instanceof ApiError ? err.message : 'Could not start your signup. Please try again.',
        )
      }
    } finally {
      setSaving(false)
    }
  }

  if (alreadyRegistered) {
    return (
      <WizardShell
        title="You already have a venue with us"
        subtitle={`${alreadyRegistered} is already set up — there's nothing to buy again.`}
      >
        <div className="space-y-6">
          <p className="text-[15px] leading-relaxed text-slate">
            Sign in with the username from your welcome email — it looks like{' '}
            <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[13px] text-ink">
              admin@your-venue
            </code>
            {/* No whitespace before the comma: JSX keeps the newline as a space. */}
            {', not your email address.'}
          </p>

          <a
            href={DASHBOARD_URL_FALLBACK}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-ink px-5 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-ink/90"
          >
            Go to sign in <ChevronRight />
          </a>

          <p className="text-[14px] leading-relaxed text-muted">
            Lost the email, or never got it? Contact support and we'll reissue your
            login. {/* Deliberately not a self-serve reset: there is no reset flow
                       yet, and a button that goes nowhere is worse than a sentence
                       that tells the truth. */}
          </p>

          <button
            type="button"
            onClick={() => setAlreadyRegistered(null)}
            className="text-[14px] font-medium text-ink underline underline-offset-4 hover:no-underline"
          >
            Use a different email instead
          </button>
        </div>
      </WizardShell>
    )
  }

  return (
    <WizardShell
      title="Create your XCSports account"
      subtitle="Three short steps, then you're managing your venue."
    >
      <form onSubmit={submit} className="space-y-6">
        <Field label="Your name" required error={errorFor('full_name')}>
          <Input
            value={fullName}
            invalid={Boolean(errorFor('full_name'))}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Vasu Pal"
            autoComplete="name"
            autoFocus
            maxLength={200}
          />
        </Field>

        <Field
          label="Work email"
          required
          error={errorFor('email')}
          hint="Your admin login and password are emailed here once you're set up."
        >
          <Input
            type="email"
            value={email}
            invalid={Boolean(errorFor('email'))}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourturf.com"
            autoComplete="email"
            maxLength={320}
          />
        </Field>

        <Field label="Phone" hint="Optional — used for payment receipts and support.">
          <Input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 90000 11111"
            autoComplete="tel"
            maxLength={32}
          />
        </Field>

        {error && <Alert>{error}</Alert>}

        <Button type="submit" className="w-full" loading={saving} disabled={saving}>
          Get started <ChevronRight />
        </Button>
      </form>
    </WizardShell>
  )
}
