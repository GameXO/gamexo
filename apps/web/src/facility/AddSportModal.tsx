/**
 * Add sports from the catalogue, after onboarding.
 *
 * Deliberately the same chip grid the onboarding wizard uses, because it is the
 * same decision — a turf that adds pickleball in March should meet the interface
 * it already used in January.
 */
import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { useCreateSport, useSportCatalogue } from '../api/hooks'
import { ApiError } from '../api/client'
import type { components } from '../api/schema'

type SportOut = components['schemas']['SportOut']

export default function AddSportModal({
  existing,
  onClose,
}: {
  existing: SportOut[]
  onClose: () => void
}) {
  const { data: catalogue, isPending } = useSportCatalogue()
  const create = useCreateSport()

  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [custom, setCustom] = useState('')
  const [error, setError] = useState<string | null>(null)

  const alreadyHave = new Set(existing.map((s) => s.slug))
  const available = (catalogue ?? []).filter((s) => !alreadyHave.has(s.slug))

  const toggle = (slug: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })

  async function add() {
    setError(null)
    const chosen = available.filter((s) => picked.has(s.slug))
    const customName = custom.trim()

    try {
      // Sequential, so a failure part-way leaves the ones before it created rather
      // than an indeterminate subset — and the error names the sport that failed.
      for (const sport of chosen) {
        await create.mutateAsync({
          name: sport.name,
          slug: sport.slug,
          icon: sport.icon,
          color: sport.color,
          bg_color: sport.bg_color,
          default_duration_min: sport.default_duration_min,
          price_base: String(sport.price_base),
          price_peak: String(sport.price_peak),
          price_weekend: String(sport.price_weekend),
        })
      }

      if (customName) {
        await create.mutateAsync({
          name: customName,
          icon: '🏅',
          // Zero, not a guess: an invented rate here gets charged to a real
          // customer before anyone notices it was never set.
          price_base: '0',
          price_peak: '0',
          price_weekend: '0',
        })
      }

      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add those sports.')
    }
  }

  const nothingPicked = picked.size === 0 && !custom.trim()

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white p-5 shadow-2xl"
      >
        <p className="text-base font-semibold text-ink">Add a sport</p>
        <p className="mt-1 text-sm text-slate">
          Each one starts with a suggested price you can change on its courts.
        </p>

        <div className="my-4 flex-1 overflow-y-auto">
          {isPending ? (
            <p className="text-sm text-slate">Loading…</p>
          ) : available.length === 0 ? (
            <p className="text-sm text-slate">
              You already offer everything in the list. Add your own below.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {available.map((sport) => {
                const on = picked.has(sport.slug)
                return (
                  <button
                    key={sport.slug}
                    type="button"
                    onClick={() => toggle(sport.slug)}
                    aria-pressed={on}
                    className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition-colors ${
                      on
                        ? 'border-lime-ink bg-lime/25 font-medium text-lime-ink'
                        : 'border-border-input text-slate hover:border-ink hover:text-ink'
                    }`}
                  >
                    <span aria-hidden>{sport.icon}</span>
                    {sport.name}
                    {on && <Check size={13} />}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Something else?</span>
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Sepak Takraw"
            className="w-full rounded-lg border border-border-input bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-ink"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-sm text-negative">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border-input px-4 py-2 text-sm text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void add()}
            disabled={nothingPicked || create.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {create.isPending && <Loader2 size={14} className="animate-spin" />}
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
