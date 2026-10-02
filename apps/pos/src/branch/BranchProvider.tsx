/**
 * Which branch this counter tablet is sitting in.
 *
 * An academy may run several turfs, and a tablet is bolted to one of them. The choice
 * is made once per device and remembered: it decides which courts the counter offers,
 * and which address and GSTIN print on the receipts it hands out.
 *
 *   - One branch  → used automatically, no question asked. A single-site academy never
 *                   sees a picker.
 *   - Several     → the tablet asks once, and keeps the answer in localStorage.
 *   - Fetch fails → the counter carries on with no branch filter rather than locking
 *                   staff out mid-shift; the server still stamps the right branch on
 *                   every booking, because it derives it from the court.
 *
 * Not React Query for the *selection* — it is device state, not server state — but the
 * branch list itself is a query, so it refreshes when an admin adds or closes a site.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { api } from '../api/client'
import { addressOf } from './issuer'
import { BranchContext, readStored, writeStored, type Branch, type BranchState } from './useBranch'

export function BranchProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.listBranches(),
    staleTime: 60_000,
  })
  const [storedId, setStoredId] = useState<string | null>(readStored)
  const [choosing, setChoosing] = useState(false)

  const branches = useMemo(() => query.data ?? [], [query.data])
  const multi = branches.length > 1

  // A remembered id for a branch that has since closed or been removed is no choice at
  // all: it falls through to "ask again" instead of pinning the tablet to a dead site.
  const branch = useMemo(
    () => (multi ? (branches.find((b) => b.id === storedId) ?? null) : (branches[0] ?? null)),
    [multi, branches, storedId],
  )

  const choose = useCallback((id: string) => {
    writeStored(id)
    setStoredId(id)
    setChoosing(false)
  }, [])

  const value = useMemo<BranchState>(
    () => ({ branch, branches, multi, switchBranch: () => setChoosing(true) }),
    [branch, branches, multi],
  )

  if (query.isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-page text-sm text-slate">Loading…</div>
    )
  }

  if (multi && (choosing || !branch)) {
    return (
      <BranchPicker
        branches={branches}
        currentId={branch?.id}
        onPick={choose}
        onCancel={branch ? () => setChoosing(false) : undefined}
      />
    )
  }

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
}

function BranchPicker({
  branches,
  currentId,
  onPick,
  onCancel,
}: {
  branches: Branch[]
  currentId?: string
  onPick: (id: string) => void
  onCancel?: () => void
}) {
  return (
    <div className="flex h-full w-full flex-col items-center overflow-y-auto bg-page px-[clamp(1.25rem,3vw,3rem)] py-[clamp(1.5rem,5dvh,3.5rem)]">
      <div className="flex w-full max-w-[640px] flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <p className="font-display text-[clamp(1.5rem,2.6vw,2rem)] font-bold text-ink">Which branch is this counter?</p>
          <p className="text-[clamp(0.9375rem,1.2vw,1.0625rem)] text-muted">
            Bookings and receipts from this tablet will be for the branch you pick. You can switch later by tapping the
            branch name at the top of any screen.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {branches.map((b) => {
            const line = addressOf(b)
            const current = b.id === currentId
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => onPick(b.id)}
                className={`flex items-start gap-4 rounded-2xl border-[3px] bg-surface p-5 text-left transition-colors ${
                  current ? 'border-lime' : 'border-surface hover:border-ink/20'
                }`}
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-lime/30 text-ink">
                  <MapPin size={20} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-display text-[clamp(1.1rem,1.6vw,1.25rem)] font-bold text-ink">{b.name}</span>
                  {line && <span className="text-[clamp(0.875rem,1.1vw,0.9375rem)] text-muted">{line}</span>}
                  {b.is_default && <span className="mt-1 text-xs font-medium text-muted">Main branch</span>}
                </span>
              </button>
            )
          })}
        </div>

        {onCancel && (
          <button type="button" onClick={onCancel} className="self-start rounded-xl px-4 py-3 text-sm font-medium text-muted">
            Keep the current branch
          </button>
        )}
      </div>
    </div>
  )
}
