/**
 * Step 2 — which sports the venue offers.
 *
 * The chips come from `GET /signup/sports` rather than a list in this file, so a
 * slug sent from here always matches one the API stocks and arrives priced from the
 * catalogue. A sport typed into "Add another" is sent as a custom slug, which the
 * API accepts and creates at zero price for the owner to set — deliberately, since
 * a made-up rate would otherwise be charged to a real customer.
 */
import { useEffect, useState } from 'react'
import { ApiError, api, type Signup, type SportPick } from '../api/client'
import { Alert, Button, ChevronRight, Input } from '../ui/primitives'
import { WizardShell } from './WizardShell'

type CatalogueSport = { slug: string; name: string; icon: string }

export function SportsStep({
  token,
  signup,
  onSaved,
  onBack,
}: {
  token: string
  signup: Signup
  onSaved: (next: Signup) => void
  onBack: () => void
}) {
  const [catalogue, setCatalogue] = useState<CatalogueSport[]>([])
  const [picked, setPicked] = useState<SportPick[]>(signup.sports ?? [])
  const [custom, setCustom] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .sports()
      .then(setCatalogue)
      .catch(() => setError('Could not load the sports list. Please reload the page.'))
  }, [])

  const isPicked = (slug: string) => picked.some((p) => p.slug === slug)

  const toggle = (slug: string, name?: string) =>
    setPicked((current) =>
      current.some((p) => p.slug === slug)
        ? current.filter((p) => p.slug !== slug)
        : [...current, { slug, name: name ?? null }],
    )

  function addCustom() {
    const label = custom.trim()
    if (!label) return
    // Same slugify the API applies, so the chip we draw is the sport that lands.
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    if (!slug || isPicked(slug)) {
      setCustom('')
      return
    }
    setPicked((current) => [...current, { slug, name: label }])
    setCustom('')
  }

  /** Anything picked that the catalogue does not stock — rendered as its own chip. */
  const extras = picked.filter((p) => !catalogue.some((c) => c.slug === p.slug))

  async function next() {
    if (picked.length === 0) {
      setError('Pick at least one sport — you can add more later.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      onSaved(await api.saveSignup(token, { sports: picked }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <WizardShell
      step={2}
      total={3}
      title="Choose the sports you offer in the playground"
      subtitle="Finish this and start managing immediately."
      footer={
        <div className="space-y-3">
          <Button className="w-full" onClick={next} loading={saving} disabled={saving}>
            Next <ChevronRight />
          </Button>
          <button
            type="button"
            onClick={onBack}
            className="w-full text-[14px] font-medium text-slate hover:text-ink"
          >
            Back
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2.5">
          {catalogue.map((sport) => (
            <Chip
              key={sport.slug}
              selected={isPicked(sport.slug)}
              onClick={() => toggle(sport.slug)}
            >
              {sport.name}
            </Chip>
          ))}
          {extras.map((sport) => (
            <Chip key={sport.slug} selected onClick={() => toggle(sport.slug)}>
              {sport.name ?? sport.slug}
            </Chip>
          ))}
        </div>

        <div className="flex gap-2.5">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCustom()
              }
            }}
            placeholder="Something else? Add it here"
            maxLength={100}
            className="flex-1"
          />
          <Button variant="ghost" onClick={addCustom} disabled={!custom.trim()}>
            Add
          </Button>
        </div>

        <p className="text-[13px] text-muted">
          {picked.length === 0
            ? 'Nothing picked yet.'
            : `${picked.length} selected. A sport we don't already price starts at ₹0 — you set the rate in the dashboard.`}
        </p>

        {error && <Alert>{error}</Alert>}
      </div>
    </WizardShell>
  )
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // aria-pressed rather than a checkbox role: these read as toggle buttons, and
      // a screen reader announcing "pressed" is what a sighted user sees as filled.
      aria-pressed={selected}
      className={`rounded-[10px] border px-4 py-2.5 text-[14px] transition ${
        selected
          ? 'border-ink bg-ink font-medium text-white'
          : 'border-border-soft bg-white text-ink hover:border-ink'
      }`}
    >
      {children}
    </button>
  )
}
