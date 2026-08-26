/**
 * Step 3 — which product surfaces the venue switches on.
 *
 * These keys are the contract with `SERVICE_KEYS` in `app/models/tenant.py`, and
 * they gate what appears in the dashboard's sidebar. Nothing here is irreversible:
 * the same switches live in Settings → Services afterwards, which is what the copy
 * at the bottom says, because a first-run screen that feels permanent gets abandoned.
 *
 * `booking` is deliberately absent — a venue that does not take bookings is not a
 * customer, and offering it as a choice invites someone to turn the product off.
 */
import { useState } from 'react'
import { ApiError, api, type Signup } from '../api/client'
import { Alert, Button, ChevronRight } from '../ui/primitives'
import { WizardShell } from './WizardShell'

const SERVICES = [
  { key: 'checkin', label: 'Check-in', hint: 'Counter tablet, booking-ID lookup' },
  { key: 'walkin', label: 'walkin Booking', hint: 'Take a booking at the desk' },
  { key: 'academy', label: 'Student Attendance', hint: 'Batches, coaches, attendance' },
  { key: 'membership', label: 'Membership', hint: 'Passes, packages, renewals' },
  { key: 'shop', label: 'Rental shop', hint: 'Kit rental and counter sales' },
] as const

/**
 * `walkin` is not a `SERVICE_KEY`. The mockup lists it as its own tile, but taking a
 * booking at the desk is what `booking` already is — always on, and not offered
 * above as something to disable. The tile stays because the owner recognises it;
 * ticking it just means "yes, that too", and it is dropped before the PATCH rather
 * than sent as a key the API would silently discard.
 */
const NOT_A_SERVICE_KEY = new Set<string>(['walkin'])

export function ServicesStep({
  token,
  signup,
  onSaved,
  onBack,
}: {
  token: string
  signup: Signup
  onSaved: (next: Signup) => void
  onBack: () => void
}) {
  const [chosen, setChosen] = useState<Record<string, boolean>>(() => ({
    ...signup.services,
    // Reflects the always-on reality rather than starting unticked and implying
    // the desk cannot take a booking until they ask for it.
    walkin: true,
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (key: string) => setChosen((c) => ({ ...c, [key]: !c[key] }))

  async function next() {
    setSaving(true)
    setError(null)
    try {
      const services = Object.fromEntries(
        Object.entries(chosen).filter(([key]) => !NOT_A_SERVICE_KEY.has(key)),
      )
      onSaved(await api.saveSignup(token, { services }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <WizardShell
      step={3}
      total={3}
      title="Choose the services you want to use in your POS systems"
      subtitle="Finish this and start managing immediately."
      footer={
        <div className="space-y-3">
          <Button className="w-full" onClick={next} loading={saving} disabled={saving}>
            Next <ChevronRight />
          </Button>
          <button
            type="button"
            onClick={onBack}
            className="w-full text-[14px] font-medium text-slate hover:text-ink"
          >
            Back
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          {SERVICES.map((service) => {
            const on = Boolean(chosen[service.key])
            return (
              <button
                key={service.key}
                type="button"
                onClick={() => toggle(service.key)}
                aria-pressed={on}
                className={`rounded-xl border px-5 py-5 text-center transition ${
                  on
                    ? 'border-ink bg-ink text-white'
                    : 'border-border-soft bg-white text-ink hover:border-ink'
                }`}
              >
                <span className="block text-[15px] font-medium">{service.label}</span>
                <span
                  className={`mt-1 block text-[12px] ${on ? 'text-white/65' : 'text-muted'}`}
                >
                  {service.hint}
                </span>
              </button>
            )
          })}
        </div>

        <p className="text-[13px] text-muted">
          Court bookings and reports are always on. Everything here can be switched
          later in Settings → Services.
        </p>

        {error && <Alert>{error}</Alert>}
      </div>
    </WizardShell>
  )
}
