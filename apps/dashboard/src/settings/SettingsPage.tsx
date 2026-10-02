/**
 * Settings — a grouped nav on the left (a scrolling pill row on small screens),
 * one section open at a time on the right. Everything that configures the
 * academy lives here and only here: team, membership plans, payments,
 * notifications and integrations used to be duplicated under Manage, which is
 * now just the day-to-day records. Sections without a screen yet (General,
 * Booking Rules, Billing, Security & Sessions) render as a "coming soon" card
 * rather than being left out of the nav.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { identityFrom } from '../auth/identity'
import Integrations from '../manage/Integrations'
import NotificationSettings from '../manage/NotificationSettings'
import PaymentModes from '../manage/PaymentModes'
import StaffManagement from '../manage/StaffManagement'
import { AppearanceSettings } from './AppearanceSettings'
import { AcademyPrograms } from './AcademyPrograms'
import { ChangePassword } from './ChangePassword'
import { GeneralSettings } from './GeneralSettings'
import { ServicesPicker } from './ServicesPicker'
import { SettingsPageHeader, SettingsPanel } from './SettingsPanel'
import { SETTINGS_NAV, type SettingsSectionId } from './settingsNav'

function ComingSoon() {
  return (
    <SettingsPanel>
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <p className="text-sm font-medium text-ink">We're building this experience now.</p>
        <p className="mt-1 text-sm text-muted">Check back soon.</p>
      </div>
    </SettingsPanel>
  )
}

function AccountDetails() {
  const { me } = useAuth()
  const identity = useMemo(() => identityFrom(me), [me])
  const rows = [
    { label: 'Name', value: identity.name },
    { label: 'Signs in as', value: identity.username || '—' },
    { label: 'Role', value: identity.roleLabel || '—' },
    { label: 'Venue', value: identity.business },
  ]

  return (
    <SettingsPanel flush>
      <dl className="divide-y divide-dashed divide-border-soft">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-1 gap-1 py-4 text-sm sm:grid-cols-[220px_1fr] sm:gap-6">
            <dt className="text-slate">{row.label}</dt>
            <dd className="font-medium text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </SettingsPanel>
  )
}

const SECTION_COPY: Record<SettingsSectionId, { title: string; description: string }> = {
  general: {
    title: 'General',
    description: 'Your business details and the branches it trades from.',
  },
  account: {
    title: 'Account',
    description: 'Your own sign-in details, as the server has them.',
  },
  appearance: {
    title: 'Appearance',
    description: 'Your brand colours: how your emails look to customers and the accent colour on this dashboard.',
  },
  counterServices: {
    title: 'Counter Services',
    description:
      'What your front desk can do on the POS tablet. Switching one off removes its tile from the counter — it does not delete anything, and turning it back on restores it.',
  },
  academyPrograms: {
    title: 'Academy Programmes',
    description: "Courses this academy runs, who they're for, and what a term costs.",
  },
  password: {
    title: 'Password',
    description:
      "If you're still using the password from your welcome email, change it here. Everyone signed in to this account on other devices will be signed out.",
  },
  team: {
    title: 'Team & Roles',
    description: 'Everyone with a login for this academy, and what each person can access.',
  },
  bookingRules: {
    title: 'Booking Rules',
    description: 'Cancellation windows, advance-booking limits and slot buffers.',
  },
  notifications: {
    title: 'Notifications',
    description: 'Which events email, WhatsApp or text your customers.',
  },
  billing: {
    title: 'Billing & Plan',
    description: "This academy's plan, usage and invoices from gamexo.",
  },
  payments: {
    title: 'Payments',
    description: 'Choose which payment methods staff can accept at the counter and in the booking flow.',
  },
  security: {
    title: 'Security & Sessions',
    description: 'Active sign-ins for this account and where they were made from.',
  },
  integrations: {
    title: 'Integrations',
    description: 'Payment gateways and the booking platforms connected to this academy.',
  },
}

function findNavItem(id: SettingsSectionId) {
  for (const group of SETTINGS_NAV) {
    const item = group.items.find((entry) => entry.id === id)
    if (item) return item
  }
  return undefined
}

export default function SettingsPage({
  section,
  onSectionChange,
}: {
  section: SettingsSectionId
  onSectionChange: (next: SettingsSectionId) => void
}) {
  const { me } = useAuth()
  const isAdmin = me?.user?.role === 'admin'
  const scrollRef = useRef<HTMLDivElement>(null)

  // A long section scrolled to the bottom should not hand over the next one
  // already scrolled halfway down.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [section])

  if (!isAdmin) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:px-10">
        <div className="w-full">
          {/* Not an error, and not styled like one. A receptionist opening Settings
              has done nothing wrong; there is simply nothing here for them yet. */}
          <div className="rounded-xl border border-border-card bg-white p-6">
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
    const copy = SECTION_COPY[section]
    const item = findNavItem(section)
    if (!copy || !item) return null

    const screen =
      section === 'general' ? <GeneralSettings />
      : section === 'counterServices' ? <ServicesPicker />
      : section === 'academyPrograms' ? <AcademyPrograms />
      : section === 'password' ? <ChangePassword />
      : section === 'account' ? <AccountDetails />
      : section === 'appearance' ? <AppearanceSettings />
      : section === 'team' ? <StaffManagement />
      : section === 'notifications' ? <NotificationSettings />
      : section === 'payments' ? <PaymentModes />
      : section === 'integrations' ? <Integrations />
      : <ComingSoon />

    return (
      <>
        <SettingsPageHeader title={copy.title} description={copy.description} />
        {screen}
      </>
    )
  }

  // On desktop the sections are the sidebar's Settings group, so this page no longer
  // carries a second navigation column of its own. Below `lg` the sidebar is a
  // drawer, which is why the strip of section chips further down stays.
  return (
    <div className="flex flex-1 overflow-hidden bg-white">
      <div ref={scrollRef} className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-white">
        {/* Below `lg` the left nav is hidden, so without this a phone or tablet
            could only ever reach whichever section happened to be open. */}
        <nav
          aria-label="Settings sections"
          className="sticky top-0 z-10 flex shrink-0 gap-1.5 overflow-x-auto border-b border-border-soft bg-white px-4 py-2.5 lg:hidden"
        >
          {SETTINGS_NAV.flatMap((group) => group.items).map((item) => {
            const active = item.id === section
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSectionChange(item.id)}
                aria-current={active ? 'true' : undefined}
                className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                  active ? 'bg-lime/30 font-medium text-lime-ink' : 'text-slate hover:bg-surface-muted'
                }`}
              >
                {item.label}
              </button>
            )
          })}
        </nav>

        {/* `key` restarts the entrance animation on every section change, which
            is the whole of the "smoother": content eases in instead of snapping. */}
        <div key={section} className="animate-section-in w-full px-4 py-6 motion-reduce:animate-none sm:px-8 lg:px-12 lg:py-10">
          {renderSection()}
        </div>
      </div>
    </div>
  )
}
