import Drawer from '../ui/Drawer'
import StatusPill, { type StatusTone } from '../ui/StatusPill'
import { ExternalLink, Phone } from '../ui/icons'
import { formatINR } from '../dashboard/insights'
import type { BookingOut } from '../api/hooks'

const STATUS_TONE: Record<string, StatusTone> = {
  held: 'warning',
  upcoming: 'warning',
  active: 'positive',
  overdue: 'negative',
  completed: 'neutral',
  cancelled: 'neutral',
}

const PAYMENT_TONE = (status: string): StatusTone =>
  status === 'paid' ? 'positive' : status === 'refunded' ? 'neutral' : 'warning'

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border-card bg-white">
      <h3 className="border-b border-dashed border-border-soft px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </h3>
      <dl className="divide-y divide-dashed divide-border-soft text-sm">{children}</dl>
    </section>
  )
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="text-slate">{label}</dt>
      <dd className={`text-right ${strong ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>{value}</dd>
    </div>
  )
}

/**
 * The side panel a booking opens in: who, what, when and what is owed, without leaving
 * the page it was clicked on. The full record — editing, settling, partner cancellation —
 * is a click away in Bookings.
 */
export default function BookingPanel({
  booking,
  sport,
  court,
  channel,
  onClose,
  onOpenBookings,
}: {
  booking: BookingOut
  sport: string
  court: string
  channel: string
  onClose: () => void
  onOpenBookings?: () => void
}) {
  const name = booking.customer_name || 'Walk-in guest'
  const status = booking.status ?? 'upcoming'
  const balance = Number(booking.balance_due)
  const equipment = Number(booking.equipment_charge)
  const discount = Number(booking.discount)

  return (
    <Drawer
      title={name}
      subtitle={`${booking.reference}${booking.customer_phone ? ` · ${booking.customer_phone}` : ''}`}
      icon={
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-lime-ink text-sm font-semibold text-lime">
          {name.trim().slice(0, 1).toUpperCase() || '?'}
        </span>
      }
      onClose={onClose}
      footer={
        <div className="flex items-center gap-3">
          {booking.customer_phone && (
            <a
              href={`tel:${booking.customer_phone}`}
              className="inline-flex items-center gap-2 rounded-lg border border-border-card bg-white px-4 py-2.5 text-sm font-medium text-ink shadow-control hover:bg-surface-muted"
            >
              <Phone size={15} />
              Call
            </a>
          )}
          {onOpenBookings && (
            <button
              type="button"
              onClick={onOpenBookings}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-control hover:bg-ink/90"
            >
              Open in Bookings
              <ExternalLink size={15} />
            </button>
          )}
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill label={status} tone={STATUS_TONE[status] ?? 'neutral'} />
        <StatusPill label={booking.payment_status} tone={PAYMENT_TONE(booking.payment_status)} />
      </div>

      <Section title="Booking">
        <Row label="Sport" value={sport} />
        <Row label="Court" value={court} />
        <Row label="Date" value={dateOf(booking.starts_at)} />
        <Row label="Time" value={`${timeOf(booking.starts_at)} – ${timeOf(booking.ends_at)}`} />
        <Row label="Duration" value={`${booking.duration_min / 60} hr`} />
        <Row label="Source" value={channel} />
      </Section>

      <Section title="Payment">
        <Row label="Court" value={formatINR(Number(booking.court_charge))} />
        {equipment > 0 && <Row label="Add-ons" value={formatINR(equipment)} />}
        {discount > 0 && <Row label="Discount" value={`− ${formatINR(discount)}`} />}
        <Row label="Taxes" value={formatINR(Number(booking.taxes))} />
        <Row label="Total" value={formatINR(Number(booking.total))} strong />
        <Row label="Paid" value={formatINR(Number(booking.amount_paid))} />
        <Row
          label="Balance due"
          strong
          value={<span className={balance > 0 ? 'text-amber-700' : 'text-lime-ink'}>{formatINR(balance)}</span>}
        />
      </Section>

      {booking.notes && (
        <Section title="Notes">
          <p className="px-4 py-3 text-sm leading-relaxed text-slate">{booking.notes}</p>
        </Section>
      )}
    </Drawer>
  )
}
