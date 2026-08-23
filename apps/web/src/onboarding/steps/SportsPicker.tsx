import { useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { useSportCatalogue } from '../../api/hooks'
import type { Draft, SportPick } from '../OnboardingWizard'

export default function SportsPicker({
  draft,
  patch,
}: {
  draft: Draft
  patch: (next: Partial<Draft>) => void
}) {
  const { data: catalogue, isPending } = useSportCatalogue()
  const [custom, setCustom] = useState('')

  const picked = new Set(draft.sports.map((s) => s.slug))

  const toggle = (pick: SportPick) =>
    patch({
      sports: picked.has(pick.slug)
        ? draft.sports.filter((s) => s.slug !== pick.slug)
        : [...draft.sports, pick],
    })

  const addCustom = () => {
    const name = custom.trim()
    if (!name) return
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!slug || picked.has(slug)) {
      setCustom('')
      return
    }
    patch({ sports: [...draft.sports, { slug, name, icon: '🏅' }] })
    setCustom('')
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">
          Which sports do you offer?
        </h2>
        <p className="mt-1 text-sm text-slate">
          Pick as many as you like. Each one starts with a suggested price you can change,
          and you’ll add its courts next.
        </p>
      </div>

      {isPending ? (
        <p className="text-sm text-slate">Loading sports…</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {(catalogue ?? []).map((sport) => {
            const on = picked.has(sport.slug)
            return (
              <button
                key={sport.slug}
                type="button"
                onClick={() => toggle({ slug: sport.slug, name: sport.name, icon: sport.icon ?? '🏅' })}
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

      {/* Anything the catalogue does not stock. Created with no price, because a
          made-up rate here would be charged to a real customer. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Something else?</span>
        <div className="flex gap-2">
          <input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCustom()
              }
            }}
            placeholder="Sepak Takraw"
            className="flex-1 rounded-lg border border-border-input bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-ink"
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={!custom.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-input px-3.5 text-sm font-medium text-ink hover:border-ink disabled:opacity-40"
          >
            <Plus size={14} />
            Add
          </button>
        </div>
        <span className="text-xs text-muted">
          You’ll set its price when you add courts.
        </span>
      </div>

      {draft.sports.length > 0 && (
        <p className="text-sm text-slate">
          <span className="font-medium text-ink">{draft.sports.length}</span> selected
        </p>
      )}
    </div>
  )
}
