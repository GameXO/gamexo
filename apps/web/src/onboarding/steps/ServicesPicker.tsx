import { Check } from 'lucide-react'
import { SERVICES } from '../services'
import type { Draft } from '../OnboardingWizard'

export default function ServicesPicker({
  draft,
  patch,
}: {
  draft: Draft
  patch: (next: Partial<Draft>) => void
}) {
  const toggle = (key: string, locked?: boolean) => {
    if (locked) return
    patch({ services: { ...draft.services, [key]: !draft.services[key] } })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">
          What do you want to run here?
        </h2>
        <p className="mt-1 text-sm text-slate">
          Turning something off just hides it — you can switch any of these on later in
          Settings, and nothing is deleted.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {SERVICES.map((service) => {
          const on = !!draft.services[service.key]
          return (
            <button
              key={service.key}
              type="button"
              onClick={() => toggle(service.key, service.locked)}
              aria-pressed={on}
              disabled={service.locked}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                on ? 'border-lime-ink bg-lime/15' : 'border-border-card bg-surface hover:border-ink'
              } ${service.locked ? 'cursor-default' : ''}`}
            >
              <span
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border ${
                  on ? 'border-lime-ink bg-lime-ink text-white' : 'border-border-input'
                }`}
              >
                {on && <Check size={13} />}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-ink">
                  {service.label}
                  {service.locked && (
                    <span className="ml-2 text-xs font-normal text-muted">Always on</span>
                  )}
                </span>
                <span className="text-[13px] leading-snug text-slate">{service.blurb}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
