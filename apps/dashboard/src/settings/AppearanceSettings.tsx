/**
 * Settings → Appearance: the academy's brand colours.
 *
 * Real, not decorative. The three colours are saved on the academy's settings and
 * are what its invoice and receipt emails are drawn in; the dashboard also takes its
 * accent from them (see `theme/brand.ts`). Pick a ready-made palette or set each
 * colour by hand — a palette is only a shortcut to filling the three fields in.
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2 } from '../ui/icons'
import { ApiError } from '../api/client'
import { useBusinessSettings, useSaveBusinessSettings } from '../api/hooks'
import {
  BRAND_PRESETS,
  STOCK_BRAND,
  inkFor,
  normaliseHex,
  sameBrand,
  type Brand,
} from '../theme/brand'
import { SettingsPanel, SettingsRow } from './SettingsPanel'

const INPUT =
  'w-full rounded-lg border border-border-card bg-white px-3.5 py-2.5 text-sm text-ink shadow-control outline-none transition-colors placeholder:text-muted focus:border-lime-ink'

/** A miniature of the dashboard in a palette's colours — the option *is* its preview. */
function PaletteThumb({ brand }: { brand: Brand }) {
  return (
    <div
      className="flex h-[112px] flex-col overflow-hidden rounded-md border border-black/5"
      style={{ background: brand.background }}
    >
      <div className="flex h-5 items-center gap-1 px-2" style={{ background: brand.primary }}>
        <span className="size-1 rounded-full bg-white/60" />
        <span className="size-1 rounded-full bg-white/40" />
        <span className="size-1 rounded-full bg-white/25" />
      </div>
      <div className="flex flex-1 flex-col justify-between p-2.5">
        <div className="flex items-center justify-between">
          <span className="h-1.5 w-12 rounded-full" style={{ background: brand.primary, opacity: 0.75 }} />
          <span
            className="h-3.5 w-9 rounded-full"
            style={{ background: brand.accent, boxShadow: '0 1px 2px rgba(0,0,0,0.12)' }}
          />
        </div>
        <svg viewBox="0 0 100 24" className="h-7 w-full" preserveAspectRatio="none" aria-hidden>
          <path
            d="M0 18 C 12 6, 22 22, 36 12 S 62 4, 74 12 S 92 8, 100 4"
            fill="none"
            stroke={brand.accent}
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        <div className="flex gap-1.5">
          <span className="h-1.5 flex-1 rounded-full" style={{ background: brand.primary, opacity: 0.14 }} />
          <span className="h-1.5 w-8 rounded-full" style={{ background: brand.primary, opacity: 0.14 }} />
        </div>
      </div>
    </div>
  )
}

function PaletteCard({
  name,
  blurb,
  brand,
  selected,
  onSelect,
}: {
  name: string
  blurb: string
  brand: Brand
  selected: boolean
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!onSelect}
      aria-pressed={selected}
      className="group flex w-full flex-col gap-2.5 text-left disabled:cursor-default"
    >
      <div
        className={`relative rounded-lg p-1 transition-shadow ${
          selected
            ? 'shadow-[0_0_0_2px_var(--color-lime-ink)]'
            : 'shadow-[0_0_0_1px_var(--color-border-card)] group-hover:shadow-[0_0_0_1px_var(--color-border-soft)]'
        }`}
      >
        <PaletteThumb brand={brand} />
        {selected && (
          <span className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-lime-ink text-white shadow-control">
            <Check size={12} strokeWidth={3} />
          </span>
        )}
      </div>
      <div>
        <p className="text-sm font-medium text-ink">{name}</p>
        <p className="mt-0.5 text-[12px] text-muted">{blurb}</p>
      </div>
    </button>
  )
}

function ColourField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (hex: string) => void
}) {
  // The text box keeps what is being typed; the draft only ever holds a valid colour.
  const [text, setText] = useState(value.replace('#', ''))
  useEffect(() => setText(value.replace('#', '')), [value])

  const commit = (raw: string) => {
    setText(raw.replace('#', ''))
    const hex = normaliseHex(raw)
    if (hex) onChange(hex)
  }
  const invalid = text.length > 0 && normaliseHex(text) === null

  return (
    <div className="flex items-center gap-3">
      <label
        className="relative block size-10 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-black/10 shadow-control"
        style={{ background: value }}
        aria-label={`${label} colour picker`}
      >
        <input
          type="color"
          value={value.toLowerCase()}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      <div className="relative w-44">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">#</span>
        <input
          id={id}
          value={text}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setText(value.replace('#', ''))}
          maxLength={7}
          spellCheck={false}
          aria-invalid={invalid}
          className={`${INPUT} pl-7 font-mono uppercase ${invalid ? 'border-negative' : ''}`}
        />
      </div>
    </div>
  )
}

export function AppearanceSettings() {
  const { data: settings, isLoading, isError } = useBusinessSettings()
  const save = useSaveBusinessSettings()
  const [draft, setDraft] = useState<Brand | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const server = useMemo<Brand | null>(
    () =>
      settings
        ? { primary: settings.brand_primary, accent: settings.brand_accent, background: settings.brand_background }
        : null,
    [settings],
  )

  // Seeded once from the server, then owned by the form, so a background refetch
  // cannot overwrite a colour somebody is halfway through choosing.
  useEffect(() => {
    if (server && draft === null) setDraft(server)
  }, [server, draft])

  const dirty = !!(server && draft && !sameBrand(server, draft))
  const matched = draft ? BRAND_PRESETS.find((p) => sameBrand(p.brand, draft)) : undefined

  const set = (patch: Partial<Brand>) => {
    setSaved(false)
    setDraft((d) => (d ? { ...d, ...patch } : d))
  }

  async function onSave() {
    if (!draft) return
    setError(null)
    try {
      await save.mutateAsync({
        brand_primary: draft.primary,
        brand_accent: draft.accent,
        brand_background: draft.background,
      })
      setSaved(true)
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.isForbidden
            ? 'Only an admin can change this.'
            : err.message
          : 'Could not save your colours. Please try again.',
      )
    }
  }

  const onCancel = () => {
    setSaved(false)
    setError(null)
    setDraft(server)
  }

  return (
    <SettingsPanel
      title="Brand colours"
      description="Used on your invoice and receipt emails, and as the accent colour across this dashboard."
      flush
    >
      {isError && (
        <p role="alert" className="mb-4 rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
          Could not load your colours.
        </p>
      )}

      {isLoading || !draft ? (
        <div className="flex flex-col gap-5 py-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-muted" />
          ))}
        </div>
      ) : (
        <>
          <SettingsRow label="Colour theme" description="Start from a palette, then fine-tune below.">
            <div className="grid grid-cols-2 gap-x-5 gap-y-6 md:grid-cols-3 2xl:grid-cols-5">
              {BRAND_PRESETS.map((preset) => (
                <PaletteCard
                  key={preset.id}
                  name={preset.name}
                  blurb={preset.blurb}
                  brand={preset.brand}
                  selected={matched?.id === preset.id}
                  onSelect={() => set({ ...preset.brand })}
                />
              ))}
              {!matched && (
                <PaletteCard name="Custom" blurb="Your own colours." brand={draft} selected />
              )}
            </div>
          </SettingsRow>

          <SettingsRow
            label="Primary colour"
            description="Email headers and buttons. Also the text colour on the accent."
            htmlFor="brand-primary"
          >
            <ColourField id="brand-primary" label="Primary" value={draft.primary} onChange={(primary) => set({ primary })} />
          </SettingsRow>

          <SettingsRow
            label="Accent colour"
            description="Highlights, the active menu item and buttons across the dashboard."
            htmlFor="brand-accent"
          >
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <ColourField id="brand-accent" label="Accent" value={draft.accent} onChange={(accent) => set({ accent })} />
              <span
                className="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
                style={{ background: draft.accent, color: inkFor(draft) }}
              >
                Preview
              </span>
            </div>
          </SettingsRow>

          <SettingsRow
            label="Email background"
            description="The backdrop behind your invoice and receipt emails."
            htmlFor="brand-background"
          >
            <ColourField
              id="brand-background"
              label="Background"
              value={draft.background}
              onChange={(background) => set({ background })}
            />
          </SettingsRow>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-border-soft py-4">
            <button
              type="button"
              onClick={() => set({ ...STOCK_BRAND })}
              className="text-sm text-slate underline-offset-2 hover:text-ink hover:underline"
            >
              Reset to default colours
            </button>
            <div className="flex items-center gap-3">
              {error && (
                <p role="alert" className="text-sm text-negative">
                  {error}
                </p>
              )}
              {saved && !dirty && <span className="text-sm text-lime-ink">Saved</span>}
              <button
                type="button"
                onClick={onCancel}
                disabled={!dirty}
                className="rounded-lg border border-border-card bg-white px-4 py-2 text-sm font-medium text-ink shadow-control disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void onSave()}
                disabled={!dirty || save.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white shadow-control disabled:opacity-40"
              >
                {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                Save changes
              </button>
            </div>
          </div>
        </>
      )}
    </SettingsPanel>
  )
}
