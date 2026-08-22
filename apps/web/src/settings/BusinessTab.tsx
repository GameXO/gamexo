import { useEffect, useState } from 'react'
import { useSettings, useUpdateSettings } from '../api/hooks'
import { ApiError } from '../api/client'
import ImageDrop from '../ui/ImageDrop'
import { Card, Field, SaveBar, inputClass } from './SettingsPage'

/** The columns this tab owns. Anything else on the settings row is left alone. */
const FIELDS = [
  'business_name',
  'phone',
  'email',
  'address',
  'city',
  'gst_number',
  'currency',
  'timezone',
  'invoice_prefix',
  'logo_url',
] as const

type Form = Record<(typeof FIELDS)[number], string>

const EMPTY = Object.fromEntries(FIELDS.map((f) => [f, ''])) as Form

export default function BusinessTab() {
  const { data: settings, isPending } = useSettings()
  const save = useUpdateSettings()

  const [form, setForm] = useState<Form>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seeded once. Re-syncing on every render of `settings` would discard whatever
  // the user is mid-way through typing the moment the query refetches.
  useEffect(() => {
    if (!settings || loaded) return
    setForm(
      Object.fromEntries(
        FIELDS.map((f) => [f, (settings as Record<string, unknown>)[f] ?? '']),
      ) as Form,
    )
    setLoaded(true)
  }, [settings, loaded])

  const set = (key: keyof Form, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const dirty =
    loaded &&
    FIELDS.some((f) => form[f] !== (((settings as Record<string, unknown>)?.[f] ?? '') as string))

  async function onSave() {
    setError(null)
    try {
      await save.mutateAsync({
        ...Object.fromEntries(
          // Blank means "cleared" for optional text, but the API rejects an empty
          // business_name, currency or prefix — so those are simply not sent when
          // empty rather than being sent as invalid.
          FIELDS.map((f) => [
            f,
            form[f].trim() === '' && ['business_name', 'currency', 'invoice_prefix'].includes(f)
              ? undefined
              : form[f].trim() || null,
          ]).filter(([, v]) => v !== undefined),
        ),
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.')
    }
  }

  if (isPending) return <p className="text-sm text-slate">Loading settings…</p>

  return (
    <>
      <Card title="Business" subtitle="What players see on bookings, receipts and the counter.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Logo</span>
            <ImageDrop
              value={form.logo_url || null}
              onChange={(url) => set('logo_url', url ?? '')}
              label="Upload logo"
            />
          </div>

          <Field label="Turf name">
            <input
              value={form.business_name}
              onChange={(e) => set('business_name', e.target.value)}
              className={inputClass}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone">
              <input
                value={form.phone}
                inputMode="tel"
                onChange={(e) => set('phone', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Address">
            <textarea
              rows={2}
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="City">
            <input
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </Card>

      <Card title="Billing" subtitle="Used on every invoice this turf issues.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="GSTIN">
            <input
              value={form.gst_number}
              onChange={(e) => set('gst_number', e.target.value.toUpperCase())}
              className={inputClass}
            />
          </Field>
          <Field label="Invoice prefix" hint="Leads every invoice number, e.g. NSA-2026-0001.">
            <input
              value={form.invoice_prefix}
              maxLength={8}
              onChange={(e) => set('invoice_prefix', e.target.value.toUpperCase())}
              className={inputClass}
            />
          </Field>
          <Field label="Currency">
            <input
              value={form.currency}
              maxLength={3}
              onChange={(e) => set('currency', e.target.value.toUpperCase())}
              className={inputClass}
            />
          </Field>
          <Field
            label="Timezone"
            hint="Reports bucket peak hours in this zone — in UTC an evening peak lands mid-afternoon."
          >
            <input
              value={form.timezone}
              onChange={(e) => set('timezone', e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <SaveBar
          onSave={() => void onSave()}
          saving={save.isPending}
          dirty={dirty}
          saved={save.isSuccess}
          error={error}
        />
      </Card>
    </>
  )
}
