/**
 * Settings — a grouped nav on the left, one section open at a time on the
 * right. Two sections have a real screen behind them (Counter Services,
 * Password); the rest render as a "coming soon" card rather than being left
 * out of the nav, the same way Sales/Events/Help Center are already full nav
 * items elsewhere in the app before their screens exist — the nav describes
 * where Settings is headed, not just what's already built.
 */
import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { identityFrom } from '../auth/identity'
import { ChangePassword } from './ChangePassword'
import { ServicesPicker } from './ServicesPicker'
import { SETTINGS_NAV, type SettingsSectionId } from './settingsNav'

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border-card bg-surface p-6">
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lime/20 text-lime-ink">
          <Icon size={20} />
        </div>
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate">{description}</p>
        </div>
      </div>
      {children && <div className="mt-5">{children}</div>}
    </section>
  )
}

function ComingSoonCard({ icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <SectionCard icon={icon} title={title} description={description}>
      <p className="text-sm text-muted">We're building this experience now. Check back soon.</p>
    </SectionCard>
  )
}

function AccountCard() {
  const { me } = useAuth()
  const identity = useMemo(() => identityFrom(me), [me])
  const rows = [
    { label: 'Name', value: identity.name },
    { label: 'Signs in as', value: identity.username || '—' },
    { label: 'Role', value: identity.roleLabel || '—' },
    { label: 'Venue', value: identity.business },
  ]
  const User = SETTINGS_NAV[0].items[1].icon

  return (
    <SectionCard icon={User} title="Account" description="Your own sign-in details, as the server has them.">
      <div className="divide-y divide-border-card border-y border-border-card">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between py-3.5 text-sm">
            <span className="text-slate">{row.label}</span>
            <span className="font-medium text-ink">{row.value}</span>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

const SECTION_COPY: Partial<Record<SettingsSectionId, { title: string; description: string }>> = {
  general: {
    title: 'General',
    description: 'Business name, address and the details that appear on invoices.',
  },
  team: {
    title: 'Team & Roles',
    description: 'Who has access to this academy and what each role can do — managed today from Manage → Users and Manage Staff.',
  },
  bookingRules: {
    title: 'Booking Rules',
    description: 'Cancellation windows, advance-booking limits and slot buffers.',
  },
  notifications: {
    title: 'Notifications',
    description: 'Which events email or SMS your team and your customers — managed today from Manage → Notifications.',
  },
  billing: {
    title: 'Billing & Plan',
    description: "This academy's plan, usage and invoices from gamexo.",
  },
  payments: {
    title: 'Payments',
    description: 'Payment gateways and modes accepted at the counter — managed today from Manage → Payment Modes.',
  },
  security: {
    title: 'Security & Sessions',
    description: 'Active sign-ins for this account and where they were made from.',
  },
  integrations: {
    title: 'Integrations',
    description: 'Booking platforms and third-party tools connected to this academy — managed today from Manage → Integrations.',
  },
}

function findNavItem(id: SettingsSectionId) {
  for (const group of SETTINGS_NAV) {
    const item = group.items.find((entry) => entry.id === id)
    if (item) return item
  }
  return undefined
}

export default function SettingsPage() {
  const { me } = useAuth()
  const isAdmin = me?.user?.role === 'admin'
  const [section, setSection] = useState<SettingsSectionId>('counterServices')

  if (!isAdmin) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-2xl">
          {/* Not an error, and not styled like one. A receptionist opening Settings
              has done nothing wrong; there is simply nothing here for them yet. */}
          <div className="rounded-2xl border border-border-card bg-surface p-6">
            <h2 className="font-display text-lg font-semibold text-ink">Settings</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate">
              There's nothing here for your account yet. Ask an admin if you need
              your password changed.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const renderSection = () => {
    if (section === 'counterServices') return <ServicesPicker />
    if (section === 'password') return <ChangePassword />
    if (section === 'account') return <AccountCard />

    const copy = SECTION_COPY[section]
    const item = findNavItem(section)
    if (!copy || !item) return null
    return <ComingSoonCard icon={item.icon} title={copy.title} description={copy.description} />
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="hidden w-[248px] shrink-0 flex-col overflow-y-auto border-r border-border-soft px-4 py-6 lg:flex">
        <p className="px-2 text-lg font-semibold text-ink">Settings</p>
        <p className="mt-1 px-2 text-[13px] leading-relaxed text-slate">
          Manage your preferences and account settings.
        </p>

        <nav className="mt-6 flex flex-col gap-5">
          {SETTINGS_NAV.map((group) => (
            <div key={group.label}>
              <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {group.label}
              </p>
              <div className="mt-1.5 flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon
                  const active = item.id === section
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSection(item.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                        active
                          ? 'bg-lime/20 font-medium text-lime-ink'
                          : 'text-slate hover:bg-surface-muted hover:text-ink'
                      }`}
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-2xl">{renderSection()}</div>
      </div>
    </div>
  )
}
