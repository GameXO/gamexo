import { useState } from 'react'
import { CircleDot, Circle, CalendarCheck2, IndianRupee } from 'lucide-react'
import { balanceOf, courtById, equipmentForSport, money } from '../data/booking'
import chevronDown from '../assets/figma/chevron-down.svg'
import {
  useAllCourts,
  useExtendBooking,
  useInventory,
  useIssueKit,
  useOutstandingInvoices,
  useRecordPayment,
  useSetBookingStatus,
  useSports,
  useTodaysBookings,
} from '../api/hooks'
import { ApiError } from '../api/client'
import { courtOccupancy, canExtend, effectiveState, todayISO } from './derive'
import { useNow } from './useNow'
import Tile from './Tile'
import CourtCard from './CourtCard'
import CourtPanel from './CourtPanel'

type ViewMode = 'courts' | 'customers'
type Filter = 'all' | 'live' | 'upcoming' | 'free'

export default function ActiveGames({ onStartBooking }: { onStartBooking: (courtId: string) => void }) {
  const now = useNow(15000)
  const [viewMode, setViewMode] = useState<ViewMode>('courts')
  const [filter, setFilter] = useState<Filter>('all')
  const [sportFilter, setSportFilter] = useState<string | null>(null)
  const [sportMenuOpen, setSportMenuOpen] = useState(false)
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const bookingsQuery = useTodaysBookings()
  const tabsQuery = useOutstandingInvoices()
  const courtsQuery = useAllCourts()
  const inventoryQuery = useInventory()
  const sportsQuery = useSports()

  const setStatus = useSetBookingStatus()
  const extend = useExtendBooking()
  const issueKit = useIssueKit()
  const recordPayment = useRecordPayment()

  const bookings = bookingsQuery.data ?? []
  const tabs = tabsQuery.data ?? []
  const courts = courtsQuery.data ?? []
  const sports = sportsQuery.data ?? []

  // Availability comes from the movement ledger, which is the only thing that
  // knows what is physically on the shelf right now.
  const remainingStock = Object.fromEntries(
    (inventoryQuery.data ?? []).map((item) => [item.id, item.qtyAvailable]),
  )

  const occ = courtOccupancy(courts, bookings, now)
  const filteredCourts = occ
    .filter((c) => filter === 'all' || c.state === filter)
    .filter((c) => !sportFilter || c.court.sportId === sportFilter)
  const sportFilterLabel = sportFilter ? sports.find((s) => s.id === sportFilter)?.name : 'All Sports'

  const courtsInPlay = occ.filter((c) => c.state === 'live').length
  const freeCourts = occ.filter((c) => c.state === 'free').length

  const todaysBookings = bookings
    .filter((b) => b.date === todayISO())
    .sort((a, b) => a.startHour - b.startHour)
  // Unpaid court hire plus unpaid counter tabs — the two ways money is owed.
  const owed =
    bookings.reduce((s, b) => s + balanceOf(b), 0) + tabs.reduce((s, t) => s + t.balance, 0)

  const selectedBooking = bookings.find((b) => b.id === selectedBookingId) ?? null
  const selectedCourt = selectedBooking ? courtById(selectedBooking.courtId) || null : null
  const selectedTab = tabs.find((t) => t.id === selectedTabId) ?? null

  const run = (p: Promise<unknown>) => {
    setError(null)
    p.catch((err) =>
      setError(
        err instanceof ApiError ? err.message : 'Could not reach the server. Nothing was changed.',
      ),
    )
  }

  const issueKitTo = (itemId: string, bookingId?: string) => {
    if ((remainingStock[itemId] ?? 0) <= 0) return
    run(issueKit.mutateAsync({ equipmentId: itemId, bookingId }))
  }

  return (
    <div className="flex flex-1 flex-col items-start gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <p className="w-full text-lg text-ink">Active Courts</p>

      {error && (
        <p
          role="alert"
          className="w-full rounded-xl border border-negative/30 bg-negative/5 px-4 py-3 text-sm text-negative"
        >
          {error}
        </p>
      )}

      <div className="grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Courts In Play" value={String(courtsInPlay)} icon={CircleDot} />
        <Tile label="Free Courts" value={String(freeCourts)} icon={Circle} />
        <Tile label="Bookings Today" value={String(todaysBookings.length)} icon={CalendarCheck2} />
        <Tile label="Amount Owed" value={money(owed)} icon={IndianRupee} alert={owed > 0} />
      </div>

      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-full border border-border-input bg-surface p-1">
          {(['courts', 'customers'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setViewMode(v)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                viewMode === v ? 'bg-ink text-white' : 'text-slate'
              }`}
            >
              {v === 'courts' ? 'By court' : 'By customer'}
            </button>
          ))}
        </div>

        {viewMode === 'courts' && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['all', 'All'],
                  ['live', 'In play'],
                  ['free', 'Free'],
                  ['upcoming', 'Next up'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                    filter === key ? 'border-ink bg-ink text-white' : 'border-border-input bg-surface text-slate'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setSportMenuOpen((v) => !v)}
                className="flex items-center gap-3 rounded-full border border-border-input bg-surface px-4 py-2 shadow-[0px_1px_2px_0px_rgba(82,88,102,0.09)]"
              >
                <span className="text-sm font-medium text-ink">{sportFilterLabel}</span>
                <img src={chevronDown} alt="" className="h-2.5 w-auto shrink-0" />
              </button>

              {sportMenuOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Close filter"
                    onClick={() => setSportMenuOpen(false)}
                    className="fixed inset-0 z-10"
                  />
                  <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-lg border border-border-card bg-white py-1 shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setSportFilter(null)
                        setSportMenuOpen(false)
                      }}
                      className={`flex w-full items-center px-3.5 py-2 text-left text-sm ${
                        sportFilter === null ? 'font-semibold text-ink' : 'text-slate hover:bg-surface-muted'
                      }`}
                    >
                      All Sports
                    </button>
                    {sports.map((sport) => (
                      <button
                        key={sport.id}
                        type="button"
                        onClick={() => {
                          setSportFilter(sport.id)
                          setSportMenuOpen(false)
                        }}
                        className={`flex w-full items-center px-3.5 py-2 text-left text-sm ${
                          sportFilter === sport.id ? 'font-semibold text-ink' : 'text-slate hover:bg-surface-muted'
                        }`}
                      >
                        {sport.name}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {viewMode === 'courts' ? (
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredCourts.map(({ court, state, booking }) => (
            <CourtCard
              key={court.id}
              court={court}
              state={state}
              booking={booking}
              now={now}
              onClick={() => (booking ? setSelectedBookingId(booking.id) : onStartBooking(court.id))}
            />
          ))}
        </div>
      ) : (
        <div className="flex w-full flex-col gap-5">
          <div className="w-full overflow-hidden rounded-xl border border-border-card bg-surface">
            {todaysBookings.map((b) => {
              const st = effectiveState(b, now)
              const court = courtById(b.courtId)!
              const balance = balanceOf(b)
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedBookingId(b.id)}
                  className="flex w-full items-center gap-4 border-b border-border-card px-4 py-3 text-left last:border-b-0 hover:bg-surface-muted"
                >
                  <span className="w-16 shrink-0 text-xs font-medium text-slate">
                    {formatClockHour(b.startHour)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                    {b.customer.name}
                  </span>
                  <span className="hidden w-28 shrink-0 text-xs text-slate sm:block">{court.name}</span>
                  <span
                    className={`w-16 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${
                      st === 'live'
                        ? 'bg-lime text-lime-ink'
                        : st === 'upcoming'
                          ? 'bg-surface-muted text-slate'
                          : 'bg-border-card text-muted'
                    }`}
                  >
                    {st === 'live' ? 'Live' : st === 'upcoming' ? 'Next' : 'Done'}
                  </span>
                  <span className={`w-20 shrink-0 text-right text-xs font-semibold ${balance > 0 ? 'text-negative' : 'text-positive'}`}>
                    {balance > 0 ? money(balance) : 'Paid'}
                  </span>
                </button>
              )
            })}
            {todaysBookings.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted">No bookings today yet.</p>
            )}
          </div>

          {tabs.length > 0 && (
            <div className="flex w-full flex-col gap-3">
              <p className="text-sm font-semibold text-ink">Counter tabs</p>
              <div className="w-full overflow-hidden rounded-xl border border-border-card bg-surface">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTabId(t.id)}
                    className="flex w-full items-center gap-4 border-b border-border-card px-4 py-3 text-left last:border-b-0 hover:bg-surface-muted"
                  >
                    <span className="flex-1 text-sm font-medium text-ink">{t.customerName}</span>
                    <span className="text-xs text-slate">{t.invoiceNo}</span>
                    <span className="text-xs text-negative font-semibold">{money(t.balance)} due</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedBooking && selectedCourt && (
        <CourtPanel
          subject={{ kind: 'booking', booking: selectedBooking }}
          onClose={() => setSelectedBookingId(null)}
          onIssueKit={(itemId) => issueKitTo(itemId, selectedBooking.id)}
          onSettle={(method) =>
            run(
              recordPayment.mutateAsync({
                bookingId: selectedBooking.id,
                // Settle the outstanding balance, not the total: part-payments may
                // already have been taken against this booking.
                amount: balanceOf(selectedBooking),
                method: method as 'cash' | 'upi' | 'card',
              }),
            )
          }
          onCheckIn={() => run(setStatus.mutateAsync({ bookingId: selectedBooking.id, status: 'checked-in' }))}
          onFinish={() => run(setStatus.mutateAsync({ bookingId: selectedBooking.id, status: 'completed' }))}
          // The client check keeps the button honest; the server's exclusion
          // constraint is what actually decides, and its 409 surfaces above.
          onExtend={() => run(extend.mutateAsync({ bookingId: selectedBooking.id, minutes: 60 }))}
          canExtend={canExtend(selectedBooking, bookings)}
          kitOptions={equipmentForSport(selectedCourt.sportId)}
          remainingStock={remainingStock}
        />
      )}

      {selectedTab && (
        <CourtPanel
          subject={{ kind: 'tab', tab: selectedTab }}
          onClose={() => setSelectedTabId(null)}
          // A tab has no booking to attach a movement to, so kit sold at the
          // counter is billed on the invoice rather than issued against a court.
          onIssueKit={(itemId) => issueKitTo(itemId)}
          onSettle={(method) =>
            run(
              recordPayment.mutateAsync({
                invoiceId: selectedTab.id,
                amount: selectedTab.balance,
                method: method as 'cash' | 'upi' | 'card',
              }),
            )
          }
          onCheckIn={() => {}}
          onFinish={() => {}}
          onExtend={() => {}}
          canExtend={false}
          kitOptions={[]}
          remainingStock={remainingStock}
        />
      )}
    </div>
  )
}

function formatClockHour(startHour: number) {
  const h = Math.floor(startHour)
  const m = Math.round((startHour - h) * 60)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
}
