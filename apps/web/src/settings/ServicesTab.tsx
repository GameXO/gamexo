import { useState } from 'react'
import { useSettings, useUpdateSettings } from '../api/hooks'
import { ApiError } from '../api/client'
import Toggle from '../manage/Toggle'
import { SERVICES } from '../onboarding/services'
import { Card } from './SettingsPage'

export default function ServicesTab() {
  const { data: settings, isPending } = useSettings()
  const save = useUpdateSettings()
  const [error, setError] = useState<string | null>(null)

  const enabled = (settings?.enabled_services ?? {}) as Record<string, boolean>

  // Saved on the toggle rather than behind a Save button. A switch that has to be
  // confirmed reads as broken, and the server merges partial maps, so one key at a
  // time is exactly what the endpoint wants.
  async function toggle(key: string) {
    setError(null)
    try {
      await save.mutateAsync({ enabled_services: { [key]: !enabled[key] } })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that change.')
    }
  }

  if (isPending) return <p className="text-sm text-slate">Loading services…</p>

  return (
    <Card
      title="Services"
      subtitle="Turning a service off hides it from staff. Nothing is deleted, and switching it back on brings everything with it."
    >
      {error && (
        <p role="alert" className="mb-4 text-sm text-negative">
          {error}
        </p>
      )}

      <ul className="flex flex-col divide-y divide-border-soft">
        {SERVICES.map((service) => (
          <li key={service.key} className="flex items-start gap-4 py-3.5 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">
                {service.label}
                {service.locked && (
                  <span className="ml-2 text-xs font-normal text-muted">Always on</span>
                )}
              </p>
              <p className="mt-0.5 text-[13px] leading-snug text-slate">{service.blurb}</p>
            </div>
            <Toggle
              checked={service.locked ? true : !!enabled[service.key]}
              disabled={service.locked || save.isPending}
              onChange={() => void toggle(service.key)}
            />
          </li>
        ))}
      </ul>
    </Card>
  )
}
