/**
 * The signup flow, as a state machine over one saved intent.
 *
 * No router. There are six screens, and the thing they navigate over is not a URL —
 * it is how far a *server-side* signup has got. The wizard's real state lives in
 * `signup_intent`, and the screen is derived from it: reopening the tab reloads the
 * intent and lands on the step it had reached, which a URL-driven router would
 * fight rather than help.
 *
 * The one route that does exist is `#/signup`, so the landing page's CTA is
 * linkable and the browser Back button leaves the wizard instead of the site.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, type Signup, type Verified } from './api/client'
import { Landing } from './landing/Landing'
import { clearSignupToken, getSignupToken, setSignupToken } from './lib/session'
import { AccountStep } from './signup/AccountStep'
import { BusinessStep } from './signup/BusinessStep'
import { PlanStep } from './signup/PlanStep'
import { ServicesStep } from './signup/ServicesStep'
import { SportsStep } from './signup/SportsStep'
import { Success } from './signup/Success'

/** Which of the wizard's screens is showing. `plan` is the payment step. */
type Step = 'account' | 'business' | 'sports' | 'services' | 'plan'

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash)
  const [token, setToken] = useState<string | null>(getSignupToken)
  const [signup, setSignup] = useState<Signup | null>(null)
  const [step, setStep] = useState<Step>('account')
  const [paid, setPaid] = useState<Verified | null>(null)
  const [restoring, setRestoring] = useState(Boolean(getSignupToken()))

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  /**
   * Reopen a signup left in another tab or another day.
   *
   * The step is derived from what the intent already has rather than remembered
   * separately, so it stays right even if the two ever disagree — the server's copy
   * is the one that decides.
   */
  useEffect(() => {
    if (!token) return
    let cancelled = false

    api
      .readSignup(token)
      .then((restored) => {
        if (cancelled) return
        setSignup(restored)
        if (restored.status === 'completed') {
          // Paid in another tab, or confirmed by webhook while this one was closed.
          // There is no handoff token to offer here — this tab never held one — so
          // the success screen sends them to the login with their emailed password.
          setPaid({
            signup: restored,
            handoff_token: null,
            dashboard_url: import.meta.env.VITE_DASHBOARD_URL ?? 'http://localhost:5173',
          })
        } else if (!restored.business_name) {
          setStep('business')
        } else if (restored.sports.length === 0) {
          setStep('sports')
        } else {
          setStep('plan')
        }
      })
      .catch((err) => {
        // Expired or unknown. Drop it and start clean rather than stranding the
        // visitor on a wizard whose every call will 404.
        if (err instanceof ApiError && err.isGone) {
          clearSignupToken()
          setToken(null)
        }
      })
      .finally(() => {
        if (!cancelled) setRestoring(false)
      })

    return () => {
      cancelled = true
    }
  }, [token])

  const start = useCallback(() => {
    window.location.hash = '#/signup'
  }, [])

  if (paid) return <Success result={paid} />

  const inSignup = route.startsWith('#/signup')
  if (!inSignup) return <Landing onStart={start} />

  if (restoring) {
    return (
      <div className="grid min-h-screen place-items-center bg-page text-[15px] text-slate">
        Picking up where you left off…
      </div>
    )
  }

  if (!token || !signup) {
    return (
      <AccountStep
        onStarted={(newToken, created) => {
          setSignupToken(newToken)
          setToken(newToken)
          setSignup(created)
          setStep('business')
          setRestoring(false)
        }}
      />
    )
  }

  switch (step) {
    case 'business':
      return (
        <BusinessStep
          token={token}
          signup={signup}
          onSaved={(next) => {
            setSignup(next)
            setStep('sports')
          }}
        />
      )
    case 'sports':
      return (
        <SportsStep
          token={token}
          signup={signup}
          onBack={() => setStep('business')}
          onSaved={(next) => {
            setSignup(next)
            setStep('services')
          }}
        />
      )
    case 'services':
      return (
        <ServicesStep
          token={token}
          signup={signup}
          onBack={() => setStep('sports')}
          onSaved={(next) => {
            setSignup(next)
            setStep('plan')
          }}
        />
      )
    case 'plan':
      return (
        <PlanStep
          token={token}
          signup={signup}
          onBack={() => setStep('services')}
          onPaid={setPaid}
        />
      )
    // `account` is handled above, where there is no token yet to render a step for.
    default:
      return <AccountStep onStarted={() => setStep('business')} />
  }
}
