import { useState, type ReactNode } from 'react'
import type { Draft } from '../../data/booking'

const inputClass =
  'w-full rounded-lg border border-border-input bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="flex flex-col items-start gap-1.5">
      <span className="flex w-full items-center justify-between text-sm font-medium text-slate">
        {label}
        {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

export default function PlayerDetails({ draft, setDraft }: { draft: Draft; setDraft: (patch: Partial<Draft>) => void }) {
  const [touched, setTouched] = useState(false)
  const { name, phone, email, players, notes } = draft.customer
  const phoneOk = /^\d{10}$/.test(phone)

  const set = (patch: Partial<Draft['customer']>) => setDraft({ customer: { ...draft.customer, ...patch } })

  return (
    <div className="flex w-full flex-col gap-5">
      <p className="text-xl text-ink">Who&apos;s playing?</p>

      <div className="flex w-full flex-col gap-4 rounded-xl bg-white p-5 sm:max-w-[520px]">
        <Field label="Phone number">
          <div className="relative w-full">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">+91</span>
            <input
              className={`${inputClass} pl-11`}
              inputMode="numeric"
              autoComplete="tel"
              maxLength={10}
              placeholder="90000 00000"
              value={phone}
              onChange={(e) => set({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              onBlur={() => setTouched(true)}
            />
          </div>
          {touched && phone && !phoneOk && <p className="text-xs text-negative">Enter all 10 digits.</p>}
        </Field>

        <Field label="Name">
          <input
            className={inputClass}
            autoComplete="name"
            placeholder="Player's name"
            value={name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Players">
            <input
              className={inputClass}
              inputMode="numeric"
              placeholder="How many"
              value={players}
              onChange={(e) => set({ players: e.target.value.replace(/\D/g, '').slice(0, 3) })}
            />
          </Field>
          <Field label="Email" hint="Optional">
            <input
              className={inputClass}
              type="email"
              autoComplete="email"
              placeholder="For the invoice"
              value={email}
              onChange={(e) => set({ email: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Anything we should know" hint="Optional">
          <textarea
            className={`${inputClass} min-h-[76px] resize-none`}
            placeholder="Bringing a coach, need extra lights…"
            value={notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </Field>
      </div>
    </div>
  )
}
