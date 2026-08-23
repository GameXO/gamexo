/**
 * The turf's own configuration: who it is, what it runs, and how to open its
 * counter. Replaces the <ComingSoon/> stub the Settings view used to render.
 */
import { useState } from 'react'
import Tabs from '../ui/Tabs'
import BusinessTab from './BusinessTab'
import ServicesTab from './ServicesTab'
import PosTab from './PosTab'

const TABS = ['Business', 'Services', 'Counter (POS)'] as const
type Tab = (typeof TABS)[number]

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('Business')

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <Tabs tabs={TABS} active={tab} onChange={setTab} />

        {tab === 'Business' && <BusinessTab />}
        {tab === 'Services' && <ServicesTab />}
        {tab === 'Counter (POS)' && <PosTab />}
      </div>
    </div>
  )
}

/** Shared card chrome, so the three tabs do not each invent their own. */
export function Card({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border-card bg-surface p-5 sm:p-6">
      <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-slate">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

export const inputClass =
  'w-full rounded-lg border border-border-input bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-ink'

export function Field({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}

/**
 * A save button plus its own status line.
 *
 * Every screen in this app re-implements a toast as local state and a setTimeout.
 * Inside a settings form that is the wrong shape anyway — the confirmation belongs
 * next to the button that caused it, not floating over the page.
 */
export function SaveBar({
  onSave,
  saving,
  dirty,
  saved,
  error,
}: {
  onSave: () => void
  saving: boolean
  dirty: boolean
  saved: boolean
  error: string | null
}) {
  return (
    <div className="mt-6 flex items-center gap-3">
      <button
        type="button"
        onClick={onSave}
        disabled={saving || !dirty}
        className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
      {error ? (
        <span role="alert" className="text-sm text-negative">
          {error}
        </span>
      ) : saved && !dirty ? (
        <span className="text-sm text-positive">Saved</span>
      ) : null}
    </div>
  )
}
