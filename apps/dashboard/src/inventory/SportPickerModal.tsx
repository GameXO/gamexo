import { Check, X } from 'lucide-react'
import { useSports } from '../api/hooks'

export default function SportPickerModal({
  selectedId,
  onPick,
  onClose,
}: {
  selectedId: string | null
  onPick: (sportId: string | null) => void
  onClose: () => void
}) {
  const sportsQuery = useSports()

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <p className="text-base font-semibold text-ink">Link a sport</p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <p className="mt-1 text-sm text-slate">General kit with no sport of its own can stay unlinked.</p>

        <div className="mt-4 flex flex-col gap-1">
          <button
            type="button"
            onClick={() => {
              onPick(null)
              onClose()
            }}
            className="flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm hover:bg-surface-muted"
          >
            <span className="text-ink">General (no sport)</span>
            {selectedId === null && <Check size={16} className="text-ink" />}
          </button>

          {sportsQuery.isPending && <p className="px-3 py-2 text-sm text-muted">Loading sports…</p>}
          {sportsQuery.error && (
            <p role="alert" className="px-3 py-2 text-sm text-negative">
              Could not load sports.
            </p>
          )}
          {sportsQuery.data?.map((sport) => (
            <button
              key={sport.id}
              type="button"
              onClick={() => {
                onPick(sport.id)
                onClose()
              }}
              className="flex items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm hover:bg-surface-muted"
            >
              <span className="text-ink">{sport.name}</span>
              {selectedId === sport.id && <Check size={16} className="text-ink" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
