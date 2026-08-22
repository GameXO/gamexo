/**
 * First-run setup, shown instead of the dashboard until it is finished.
 *
 * Everything is held in one local draft and posted in a single request at the end.
 * The API completes it in one transaction, so a turf is never half-configured —
 * see the API's modules/onboarding/router.py for why that matters more than
 * saving each step as you go.
 */
import { useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react'
import Stepper from '../booking/Stepper'
import { useAuth } from '../auth/AuthProvider'
import { useCompleteOnboarding } from '../api/hooks'
import { ApiError } from '../api/client'
import { DEFAULT_SERVICES } from './services'
import TurfIdentity from './steps/TurfIdentity'
import SportsPicker from './steps/SportsPicker'
import ServicesPicker from './steps/ServicesPicker'
import ReviewLaunch from './steps/ReviewLaunch'
import brandLogo from '../assets/figma/brand-logo.svg'

const STEPS = ['Your turf', 'Sports', 'Services', 'Review'] as const

export type SportPick = { slug: string; name: string; icon?: string }

export type Draft = {
  businessName: string
  logoUrl: string | null
  city: string
  phone: string
  address: string
  sports: SportPick[]
  services: Record<string, boolean>
}

const EMPTY: Draft = {
  businessName: '',
  logoUrl: null,
  city: '',
  phone: '',
  address: '',
  sports: [],
  services: DEFAULT_SERVICES,
}

export default function OnboardingWizard() {
  const { me, refresh, logout } = useAuth()
  const complete = useCompleteOnboarding()

  const [step, setStep] = useState(1)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [error, setError] = useState<string | null>(null)

  const patch = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }))

  // Only the name is required. Pushing back on an empty sports list would be a
  // wall between the owner and a working dashboard over something the Sports &
  // Courts screen exists to do anyway.
  const canContinue = step !== 1 || draft.businessName.trim().length > 1

  async function launch() {
    setError(null)
    try {
      await complete.mutateAsync({
        business_name: draft.businessName.trim(),
        logo_url: draft.logoUrl,
        phone: draft.phone.trim() || null,
        city: draft.city.trim() || null,
        address: draft.address.trim() || null,
        sports: draft.sports.map((s) => ({ slug: s.slug, name: s.name })),
        services: draft.services,
      })
      // The shell renders off `tenant.onboarding_completed`, which this just
      // flipped server-side — so /auth/me has to be re-read for the wizard to
      // hand over to the dashboard.
      await refresh()
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not save your setup. Please try again.',
      )
    }
  }

  const last = step === STEPS.length

  return (
    <div className="flex min-h-screen w-full flex-col bg-page">
      <header className="flex items-center justify-between border-b border-border-card bg-surface px-5 py-4">
        <img src={brandLogo} alt="" className="h-7" />
        <div className="flex items-center gap-3 text-sm text-slate">
          <span className="hidden sm:inline">{me?.user?.email}</span>
          <button type="button" onClick={logout} className="font-medium text-ink underline">
            Sign out
          </button>
        </div>
      </header>

      <div className="px-4 pt-6">
        <Stepper current={step} steps={STEPS} onSelect={setStep} />
      </div>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <div className="rounded-2xl bg-surface p-6 shadow-sm sm:p-8">
          {step === 1 && <TurfIdentity draft={draft} patch={patch} />}
          {step === 2 && <SportsPicker draft={draft} patch={patch} />}
          {step === 3 && <ServicesPicker draft={draft} patch={patch} />}
          {step === 4 && <ReviewLaunch draft={draft} />}

          {error && (
            <p role="alert" className="mt-6 text-sm text-negative">
              {error}
            </p>
          )}

          <div className="mt-8 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              disabled={step === 1 || complete.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-input px-4 py-2.5 text-sm font-medium text-ink disabled:invisible"
            >
              <ArrowLeft size={15} />
              Back
            </button>

            <button
              type="button"
              onClick={() => (last ? void launch() : setStep((s) => s + 1))}
              disabled={!canContinue || complete.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {complete.isPending && <Loader2 size={15} className="animate-spin" />}
              {last ? (complete.isPending ? 'Setting up…' : 'Launch my dashboard') : 'Continue'}
              {!last && <ArrowRight size={15} />}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
