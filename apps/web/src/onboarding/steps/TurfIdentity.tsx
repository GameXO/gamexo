import ImageDrop from '../../ui/ImageDrop'
import type { Draft } from '../OnboardingWizard'

const inputClass =
  'w-full rounded-lg border border-border-input bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-ink'

export default function TurfIdentity({
  draft,
  patch,
}: {
  draft: Draft
  patch: (next: Partial<Draft>) => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">What’s your turf called?</h2>
        <p className="mt-1 text-sm text-slate">
          This is the name players see on bookings, invoices and the counter screen.
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Turf name</span>
        <input
          autoFocus
          value={draft.businessName}
          onChange={(e) => patch({ businessName: e.target.value })}
          placeholder="Navigo Sports Arena"
          className={inputClass}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Logo</span>
        <ImageDrop
          value={draft.logoUrl}
          onChange={(logoUrl) => patch({ logoUrl })}
          label="Upload logo"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">City</span>
          <input
            value={draft.city}
            onChange={(e) => patch({ city: e.target.value })}
            placeholder="Hyderabad"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Contact number</span>
          <input
            value={draft.phone}
            inputMode="tel"
            onChange={(e) => patch({ phone: e.target.value })}
            placeholder="+91 98765 43210"
            className={inputClass}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Address</span>
        <textarea
          rows={2}
          value={draft.address}
          onChange={(e) => patch({ address: e.target.value })}
          placeholder="Survey 42, Kondapur"
          className={inputClass}
        />
      </label>
    </div>
  )
}
