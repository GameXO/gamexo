import { mediaUrl } from '../../api/client'
import { SERVICES } from '../services'
import type { Draft } from '../OnboardingWizard'

export default function ReviewLaunch({ draft }: { draft: Draft }) {
  const on = SERVICES.filter((s) => draft.services[s.key])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">Ready to go</h2>
        <p className="mt-1 text-sm text-slate">
          You can change any of this later — nothing here is permanent.
        </p>
      </div>

      <div className="flex items-center gap-4 rounded-xl border border-border-card bg-surface p-4">
        {draft.logoUrl ? (
          <img
            src={mediaUrl(draft.logoUrl)}
            alt=""
            className="size-14 rounded-xl object-cover"
          />
        ) : (
          <div className="flex size-14 items-center justify-center rounded-xl bg-page text-lg font-semibold text-muted">
            {draft.businessName.trim().charAt(0).toUpperCase() || '?'}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-semibold text-ink">
            {draft.businessName.trim() || 'Your turf'}
          </p>
          <p className="truncate text-sm text-slate">
            {[draft.city, draft.phone].filter(Boolean).join(' · ') || 'No location set'}
          </p>
        </div>
      </div>

      <Section title={`Sports (${draft.sports.length})`}>
        {draft.sports.length === 0 ? (
          <Empty>No sports selected — you can add them from Sports &amp; Courts.</Empty>
        ) : (
          <ChipRow items={draft.sports.map((s) => `${s.icon ?? '🏅'} ${s.name}`)} />
        )}
      </Section>

      <Section title={`Services (${on.length})`}>
        <ChipRow items={on.map((s) => s.label)} />
      </Section>

      <p className="rounded-xl bg-page p-4 text-sm text-slate">
        <span className="font-medium text-ink">Next:</span> add courts for each sport, with
        their prices, timings and photos. Your dashboard will point you there.
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">{title}</span>
      {children}
    </div>
  )
}

function ChipRow({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((label) => (
        <span
          key={label}
          className="rounded-full bg-lime/25 px-2.5 py-0.5 text-[13px] font-medium text-lime-ink"
        >
          {label}
        </span>
      ))}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>
}
