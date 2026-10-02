/**
 * Bookings — a list, and a page per booking.
 *
 * The list is only the table: filters above it, nothing beside it. Opening a row
 * replaces the list with that booking's own full-width page (customer, the booking,
 * what was charged, the membership) and a way back. It used to be a table squeezed
 * next to a side panel, which left both too narrow to read and the panel permanently
 * showing whichever row happened to be first.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  ChevronRight,
  Clock,
  Pencil,
  ReceiptText,
  UserRound,
} from 'lucide-react'
import {
  balanceOf,
  courtById,
  equipmentLines,
  money,
  platformName,
  rangeLabel,
  sourceLabel,
  sportById,
  toISO,
  type Booking,
} from '../data/booking'
import { useBookings, useBookingsAwaitingPartnerCancel, useBranches, useRecordPayment } from '../api/hooks'
import * as db from '../lib/db'
import EditBookingDrawer from '../booking/EditBookingDrawer'
import PlatformBookingCard from '../booking/PlatformBookingCard'
import StatusPill from '../ui/StatusPill'

const paymentLabel = (booking: Booking) => {
  if (booking.payment?.status === 'paid') return 'Paid'
  if (balanceOf(booking) > 0) return 'Due'
  return 'Settled'
}

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

/**
 * Whether the slot has already started. `startHour` is local wall-clock, so the
 * date is composed from local parts — parsing `${date}T${hour}` as a string would
 * read the same digits as UTC and misjudge every evening booking by the offset.
 */
const hasStarted = (booking: Booking) => {
  const [y, mo, d] = booking.date.split('-').map(Number)
  return new Date(y, mo - 1, d, booking.startHour).getTime() < Date.now()
}

function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'lg' }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-lime-ink font-semibold text-lime ${
        size === 'lg' ? 'size-14 text-lg' : 'size-9 text-xs'
      }`}
    >
      {initials(name)}
    </div>
  )
}

function Panel({
  icon: Icon,
  title,
  children,
  className = '',
}: {
  icon: typeof UserRound
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-border-card bg-white ${className}`}>
      <header className="flex items-center gap-2.5 border-b border-border-card px-5 py-4">
        <Icon size={18} className="text-slate" />
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </header>
      {children}
    </section>
  )
}

function Facts({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-5 p-5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs uppercase tracking-wide text-muted">{item.label}</dt>
          <dd className="mt-1 text-sm font-medium text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function BookingDetail({ booking, onBack }: { booking: Booking; onBack: () => void }) {
  const recordPayment = useRecordPayment()
  const { data: branches } = useBranches(true)
  const [editing, setEditing] = useState(false)

  const court = courtById(booking.courtId)
  const sport = sportById(booking.sportId)
  const branch = (branches ?? []).find((b) => b.id === booking.branchId)
  const outstanding = balanceOf(booking)
  const label = paymentLabel(booking)
  // Read at render rather than on a timer: a slot that starts while this sits
  // open locks on the next render, which any refetch brings.
  const isPast = hasStarted(booking)
  const addOns = equipmentLines(booking.equipment, booking.hours)

  // Customer profiles are not migrated yet, so the membership tier below still
  // comes from the local visit counter.
  const profile = db.findCustomer(booking.customer.phone)
  const visits = profile?.visits ?? 1
  const tier = visits >= 8 ? 'Platinum' : visits >= 4 ? 'Gold' : visits >= 2 ? 'Silver' : 'Basic'
  const perks =
    tier === 'Platinum'
      ? 'Priority access, free locker usage, and loyalty perks.'
      : tier === 'Gold'
        ? 'Priority booking slots and member-only offers.'
        : tier === 'Silver'
          ? 'Early access to weekend slots.'
          : 'Standard access with pay-as-you-go pricing.'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !editing) onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, onBack])

  const settleDue = () => {
    if (outstanding <= 0) return
    const method = booking.payment?.method
    recordPayment.mutate({
      bookingId: booking.id,
      amount: outstanding,
      // The UI's free-text methods include values the API does not accept
      // (e.g. "wallet"); anything unrecognised settles as cash at the counter.
      method: (['cash', 'upi', 'card', 'bank', 'cheque'] as const).find((m) => m === method) ?? 'cash',
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-card bg-white px-3 py-1.5 font-medium text-ink hover:bg-surface-muted"
        >
          <ArrowLeft size={15} />
          Bookings
        </button>
        <ChevronRight size={14} className="text-muted" />
        <span className="font-medium text-ink">{booking.reference}</span>
      </nav>

      {/* Who and how much, before anything else. */}
      <section className="flex flex-col gap-5 rounded-xl border border-border-card bg-white p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={booking.customer.name} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
                {booking.customer.name}
              </h1>
              <StatusPill label={label} tone={label === 'Due' ? 'warning' : 'positive'} />
            </div>
            <p className="mt-1 text-sm text-slate">
              {booking.customer.phone} · {booking.customer.email || 'No email on file'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={isPast}
            title={isPast ? 'This booking has already started and can no longer be edited' : 'Edit booking'}
            className="inline-flex items-center gap-2 rounded-lg border border-border-input bg-white px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface-muted disabled:cursor-not-allowed disabled:border-border-card disabled:bg-surface-muted disabled:text-muted"
          >
            <Pencil size={15} />
            Edit booking
          </button>
          {outstanding > 0 && (
            <button
              type="button"
              onClick={settleDue}
              disabled={recordPayment.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-bone disabled:opacity-60"
            >
              Settle {money(outstanding)}
            </button>
          )}
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel icon={CalendarDays} title="Booking">
            <Facts
              items={[
                { label: 'Reference', value: booking.reference },
                { label: 'Game', value: sport?.name || booking.sportId },
                { label: 'Court', value: court?.name || booking.courtId },
                { label: 'Date', value: formatDate(booking.date) },
                {
                  label: 'Time',
                  value: `${rangeLabel(booking.startHour, booking.hours)} · ${booking.hours}h`,
                },
                {
                  label: 'Source',
                  value: sourceLabel(booking.bookedVia, booking.platform?.slug) ?? '—',
                },
                ...(branch ? [{ label: 'Branch', value: branch.name }] : []),
                { label: 'Players', value: booking.customer.players || '1' },
                { label: 'Notes', value: booking.customer.notes || 'No notes' },
              ]}
            />
          </Panel>

          <Panel icon={ReceiptText} title="Payment">
            <div className="divide-y divide-border-card text-sm">
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-slate">Court</span>
                <span className="font-medium text-ink">{money(booking.slotTotal)}</span>
              </div>
              {addOns.map((line) => (
                <div key={line.id} className="flex items-center justify-between px-5 py-3">
                  <span className="text-slate">
                    {line.name} × {line.qty}
                  </span>
                  <span className="font-medium text-ink">{money(line.amount)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-slate">GST</span>
                <span className="font-medium text-ink">{money(booking.gst)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3.5">
                <span className="font-semibold text-ink">Total</span>
                <span className="font-semibold text-ink">{money(booking.total)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-slate">
                  Paid{booking.payment?.method ? ` · ${booking.payment.method}` : ''}
                </span>
                <span className="font-medium text-ink">{money(booking.paidTotal)}</span>
              </div>
              <div className="flex items-center justify-between bg-surface-muted px-5 py-3.5">
                <span className="font-semibold text-ink">Balance due</span>
                <span className={`font-semibold ${outstanding > 0 ? 'text-amber-700' : 'text-lime-ink'}`}>
                  {money(outstanding)}
                </span>
              </div>
            </div>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {booking.platform && (
            <PlatformBookingCard booking={booking} locked={isPast} />
          )}

          <Panel icon={BadgeCheck} title="Membership">
            <div className="flex flex-col gap-3 p-5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate">Status</span>
                <span className="font-semibold text-ink">{tier}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate">Visits</span>
                <span className="font-semibold text-ink">{visits}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate">Member since</span>
                <span className="font-semibold text-ink">{formatDate(booking.date)}</span>
              </div>
              <p className="rounded-lg bg-surface-muted px-3 py-2.5 text-slate">{perks}</p>
            </div>
          </Panel>
        </div>
      </div>

      {editing && <EditBookingDrawer booking={booking} onClose={() => setEditing(false)} />}
    </div>
  )
}

export default function BookingsPage() {
  const bookingsQuery = useBookings()
  const awaitingQuery = useBookingsAwaitingPartnerCancel()
  const { data: branches } = useBranches(true)
  // Id -> name, for the Source column. The branch is only named when there is more
  // than one to tell apart.
  const branchNames = useMemo(() => new Map((branches ?? []).map((b) => [b.id, b.name])), [branches])
  const today = toISO(new Date())
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [openId, setOpenId] = useState<string | null>(null)
  // The follow-up list replaces the date range rather than narrowing it: a request
  // Playo has sat on for a week is exactly the one outside today's range.
  const [waitingOnly, setWaitingOnly] = useState(false)
  const awaiting = useMemo(() => awaitingQuery.data ?? [], [awaitingQuery.data])
  const scrollRef = useRef<HTMLDivElement>(null)

  const bookings = useMemo(() => {
    const items = bookingsQuery.data?.items ?? []
    return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [bookingsQuery.data])

  const visibleBookings = useMemo(() => {
    if (waitingOnly) return awaiting
    const start = startDate || today
    const end = endDate || today
    const lower = start <= end ? start : end
    const upper = start <= end ? end : start
    return bookings.filter((booking) => booking.date >= lower && booking.date <= upper)
  }, [awaiting, bookings, endDate, startDate, today, waitingOnly])

  // Looked up in everything loaded, not just the visible range, so changing a
  // filter elsewhere cannot yank the page out from under someone reading it. If the
  // booking is gone from the data altogether, fall back to the list.
  const opened = openId
    ? (bookings.find((b) => b.id === openId) ?? awaiting.find((b) => b.id === openId) ?? null)
    : null

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [openId])

  const open = (id: string) => setOpenId(id)

  return (
    <div ref={scrollRef} className="flex flex-1 flex-col gap-5 overflow-y-auto bg-page px-4 py-5 sm:px-6 lg:px-8">
      {opened ? (
        <BookingDetail booking={opened} onBack={() => setOpenId(null)} />
      ) : (
        <>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            {/* The page title and its one-line description are in the header; this only
                says something when the list is not the usual one. */}
            <p className="text-sm text-slate">
              {waitingOnly
                ? 'Cancellation requested here, not yet cancelled on the platform — chase these.'
                : 'Open a booking for the full customer and payment details.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {(awaiting.length > 0 || waitingOnly) && (
                <button
                  type="button"
                  onClick={() => setWaitingOnly((on) => !on)}
                  aria-pressed={waitingOnly}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                    waitingOnly
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-border-card bg-white text-slate'
                  }`}
                >
                  <Clock size={16} />
                  Waiting on platform · {awaiting.length}
                </button>
              )}
              <label
                className={`flex items-center gap-2 rounded-lg border border-border-card bg-white px-3 py-2 text-sm text-slate ${
                  waitingOnly ? 'opacity-50' : ''
                }`}
              >
                <CalendarDays size={16} />
                <span>From</span>
                <input
                  type="date"
                  value={startDate}
                  disabled={waitingOnly}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-md border-none bg-transparent text-sm text-ink"
                />
              </label>
              <label
                className={`flex items-center gap-2 rounded-lg border border-border-card bg-white px-3 py-2 text-sm text-slate ${
                  waitingOnly ? 'opacity-50' : ''
                }`}
              >
                <CalendarDays size={16} />
                <span>To</span>
                <input
                  type="date"
                  value={endDate}
                  disabled={waitingOnly}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-md border-none bg-transparent text-sm text-ink"
                />
              </label>
            </div>
          </div>

          <section className="overflow-hidden rounded-xl border border-border-card bg-white">
            <header className="flex items-center justify-between gap-3 border-b border-border-card px-5 py-4">
              <div className="flex items-center gap-2.5">
                <CalendarDays size={18} className="text-slate" />
                <h2 className="text-sm font-semibold text-ink">
                  {waitingOnly ? 'Waiting on the platform' : 'Bookings'}
                </h2>
              </div>
              <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-slate">
                {visibleBookings.length} {visibleBookings.length === 1 ? 'result' : 'results'}
              </span>
            </header>

            {bookingsQuery.isPending ? (
              <p className="px-5 py-14 text-center text-sm text-muted">Loading bookings…</p>
            ) : bookingsQuery.error ? (
              <p role="alert" className="px-5 py-14 text-center text-sm text-negative">
                Could not load bookings:{' '}
                {bookingsQuery.error instanceof Error ? bookingsQuery.error.message : 'unknown error'}
              </p>
            ) : visibleBookings.length === 0 ? (
              <p className="px-5 py-14 text-center text-sm text-muted">
                {waitingOnly ? 'Nothing is waiting on a platform.' : 'No bookings match the selected dates.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-border-card text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-5 py-3 font-medium">Booking</th>
                      <th className="px-3 py-3 font-medium">Customer</th>
                      <th className="px-3 py-3 font-medium">Game &amp; Court</th>
                      <th className="px-3 py-3 font-medium">When</th>
                      <th className="px-3 py-3 font-medium">Source</th>
                      <th className="px-3 py-3 font-medium">Amount</th>
                      <th className="px-3 py-3 font-medium">Payment</th>
                      <th className="w-10 px-3 py-3" aria-hidden />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBookings.map((booking) => {
                      const court = courtById(booking.courtId)
                      return (
                        <tr
                          key={booking.id}
                          onClick={() => open(booking.id)}
                          // The row is the target, so it also has to answer the
                          // keyboard — it replaced a real button, which came with
                          // focus and Enter for free.
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return
                            event.preventDefault()
                            open(booking.id)
                          }}
                          className="group cursor-pointer border-b border-border-card/70 transition-colors last:border-none hover:bg-surface-muted/70 focus-visible:bg-surface-muted/70 focus-visible:outline-none"
                        >
                          <td className="px-5 py-3.5">
                            <div className="flex flex-col items-start gap-1">
                              <span className="font-semibold text-ink">{booking.reference}</span>
                              {booking.platform && (
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                    booking.platform.cancelRequestedAt
                                      ? 'bg-amber-50 text-amber-800'
                                      : 'bg-surface-muted text-slate'
                                  }`}
                                >
                                  {platformName(booking.platform.slug)}
                                  {booking.platform.cancelRequestedAt ? ' · cancel requested' : ''}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3.5">
                            <div className="flex items-center gap-3">
                              <Avatar name={booking.customer.name} />
                              <div className="flex min-w-0 flex-col">
                                <span className="truncate font-semibold text-ink">{booking.customer.name}</span>
                                <span className="text-xs text-muted">{booking.customer.phone}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3.5">
                            <div className="flex flex-col">
                              <span className="font-semibold text-ink">
                                {sportById(booking.sportId)?.name || booking.sportId}
                              </span>
                              <span className="text-xs text-muted">{court?.name || booking.courtId}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3.5">
                            <div className="flex flex-col">
                              <span className="font-semibold text-ink">{formatDate(booking.date)}</span>
                              <span className="text-xs text-muted">
                                {rangeLabel(booking.startHour, booking.hours)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3.5">
                            <div className="flex flex-col">
                              <span className="font-semibold text-ink">
                                {sourceLabel(booking.bookedVia, booking.platform?.slug) ?? '—'}
                              </span>
                              {branchNames.size > 1 && booking.branchId && (
                                <span className="text-xs text-muted">{branchNames.get(booking.branchId)}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3.5 font-semibold text-ink">{money(booking.total)}</td>
                          <td className="px-3 py-3.5">
                            <StatusPill label={paymentLabel(booking)} tone={paymentLabel(booking) === 'Due' ? 'warning' : 'positive'} />
                          </td>
                          <td className="px-3 py-3.5 text-muted">
                            <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
