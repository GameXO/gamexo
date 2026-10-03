import { useMemo, useState } from 'react'
import { Loader2, X } from '../ui/icons'
import { ApiError } from '../api/client'
import { useSaveSport, useSportCatalogue, type SportRecord } from '../api/hooks'
import { ImageUploader } from './ImageFields'

const OTHER = '__other__'

const INPUT =
  'w-full rounded-lg border border-border-card bg-white px-3.5 py-2.5 text-sm text-ink shadow-control outline-none transition-colors placeholder:text-muted focus:border-lime-ink'

/**
 * Add a sport: pick one from the stock list, or choose Other and describe your own.
 *
 * A stock sport arrives priced, with its colours and icon, so it can be sold straight
 * away. A custom one has only a name and a picture, so its prices start at zero and
 * are set afterwards on the sport's own page — asking for them here would turn a
 * two-field dialog into a form.
 */
export default function AddSportDialog({
  existing,
  onClose,
  onAdded,
}: {
  existing: SportRecord[]
  onClose: () => void
  onAdded: (name: string) => void
}) {
  const { data: catalogue, isLoading, isError } = useSportCatalogue()
  const save = useSaveSport()

  const [choice, setChoice] = useState('')
  const [customName, setCustomName] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A sport the academy already has is not offered again — the API would refuse the
  // duplicate name, and a menu that lists it only to fail is worse than not listing it.
  const available = useMemo(() => {
    const have = new Set(existing.flatMap((s) => [s.slug, s.name.toLowerCase()]))
    return (catalogue ?? []).filter((c) => !have.has(c.slug) && !have.has(c.name.toLowerCase()))
  }, [catalogue, existing])

  const isOther = choice === OTHER
  const picked = available.find((c) => c.slug === choice)
  const name = isOther ? customName.trim() : (picked?.name ?? '')
  const canSave = !save.isPending && (isOther ? name.length > 0 : picked !== undefined)

  async function onSave() {
    setError(null)
    try {
      if (isOther) {
        await save.mutateAsync({
          body: {
            name,
            price_base: 0,
            price_peak: 0,
            price_weekend: 0,
            image_url: image,
          },
        })
      } else if (picked) {
        await save.mutateAsync({
          body: {
            name: picked.name,
            slug: picked.slug,
            icon: picked.icon,
            color: picked.color,
            bg_color: picked.bg_color,
            default_duration_min: picked.default_duration_min,
            price_base: picked.price_base,
            price_peak: picked.price_peak,
            price_weekend: picked.price_weekend,
          },
        })
      }
      onAdded(name)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this sport. Please try again.')
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-sport-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-dashed border-border-soft px-6 py-5">
          <div>
            <h2 id="add-sport-title" className="text-base font-semibold text-ink">
              Add a sport
            </h2>
            <p className="mt-1 text-sm text-slate">Pick from the list, or add one of your own.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate hover:bg-surface-muted"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex flex-col gap-5 px-6 py-6">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Sport</span>
            <select
              value={choice}
              onChange={(e) => {
                setChoice(e.target.value)
                setError(null)
              }}
              disabled={isLoading}
              className={INPUT}
            >
              <option value="">{isLoading ? 'Loading sports…' : 'Select a sport'}</option>
              {available.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.icon ? `${c.icon}  ` : ''}
                  {c.name}
                </option>
              ))}
              <option value={OTHER}>Other…</option>
            </select>
            {isError && (
              <span role="alert" className="text-[12px] text-negative">
                Could not load the sports list. You can still add your own with “Other”.
              </span>
            )}
          </label>

          {isOther && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink">Sport name</span>
                <input
                  autoFocus
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  maxLength={100}
                  placeholder="e.g. Squash"
                  className={INPUT}
                />
              </label>

              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-ink">Image</span>
                <ImageUploader value={image} onChange={setImage} label="Upload an image for this sport" />
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
              {error}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-3 border-t border-dashed border-border-soft px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-card bg-white px-4 py-2 text-sm font-medium text-ink shadow-control hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={!canSave}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white shadow-control disabled:opacity-40"
          >
            {save.isPending && <Loader2 size={14} className="animate-spin" />}
            Save
          </button>
        </footer>
      </div>
    </div>
  )
}
