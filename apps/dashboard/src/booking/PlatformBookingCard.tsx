import { useState } from 'react'
import { AlertTriangle, Clock, Loader2, Store } from '../ui/icons'
import { useRequestPartnerCancel } from '../api/hooks'
import { platformName, type Booking } from '../data/booking'

const requestedAt = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

/**
 * A booking sold on Playo, Hudle or District.
 *
 * The customer paid the platform, so only the platform can cancel and refund it —
 * and none of their contracts lets us tell them we did. Cancelling here would put
 * the court back on sale under a customer holding a valid ticket. So this card
 * records the *request* instead: the court stays blocked, staff cancel it on the
 * platform, and the platform's own cancel call closes the booking here.
 *
 * Also shows every id their support desk will ask for, because that call is the
 * step that actually gets the customer refunded.
 */
export default function PlatformBookingCard({
  booking,
  locked,
}: {
  booking: Booking
  /** The slot has started — nothing left to cancel, only ids to quote. */
  locked: boolean
}) {
  const request = useRequestPartnerCancel()
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (!booking.platform) return null
  const name = platformName(booking.platform.slug)
  const pending = booking.platform.cancelRequestedAt

  const submit = async () => {
    setError(null)
    try {
      await request.mutateAsync({ bookingId: booking.id, reason: reason.trim() || undefined })
      setAsking(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the request.')
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-card bg-surface-muted/50 p-4">
      <div className="flex items-center gap-2">
        <Store size={18} className="text-ink" />
        <p className="text-sm font-semibold text-ink">Sold on {name}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate">{name} order</dt>
        <dd className="font-semibold text-ink">{booking.platform.orderRef ?? '—'}</dd>
        <dt className="text-slate">{name} booking</dt>
        <dd className="font-semibold text-ink">{booking.platform.bookingRef ?? 'Not mapped yet'}</dd>
        <dt className="text-slate">Our ref</dt>
        <dd className="font-semibold text-ink">{booking.reference}</dd>
      </dl>

      {pending ? (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <Clock size={16} className="mt-0.5 shrink-0" />
          <span>
            Cancellation requested {requestedAt(pending)}. The court stays blocked until {name}{' '}
            cancels it — cancel it in your {name} partner app or with {name} support, quoting
            the ids above. It will then cancel here on its own.
          </span>
        </div>
      ) : locked ? null : asking ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Reason, e.g. court flooded"
            className="w-full rounded-lg border border-border-input bg-white px-3 py-2 text-sm text-ink"
          />
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="h-10 flex-1 rounded-full border border-border-input bg-white text-sm font-medium text-ink"
            >
              Back
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={request.isPending}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-ink text-sm font-medium text-bone disabled:opacity-40"
            >
              {request.isPending && <Loader2 size={15} className="animate-spin" />}
              Mark as requested
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="rounded-lg bg-surface px-3 py-2 text-xs text-slate">
            The customer paid {name}, so only {name} can cancel and refund this booking.
            Need a different slot instead? Edit the booking — {name} sees the move straight
            away and the price they paid is kept.
          </p>
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="flex h-10 items-center justify-center rounded-full border border-border-input bg-white px-4 text-sm font-medium text-ink"
          >
            Request cancellation on {name}
          </button>
        </>
      )}
    </div>
  )
}
