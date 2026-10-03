/**
 * Payroll for a month: what every coach is owed, and who has been paid.
 *
 * The page answers the question a manager actually has on the 1st — "what do I have to
 * pay, and to whom?" — with the total up top and a Pay button on each unpaid row. Paid
 * rows show what was paid rather than what the month would come to now, because a payout
 * is a snapshot: a refund later does not rewrite what was handed over.
 *
 * Starts on the academy's *own* current month, as the server reports it, rather than the
 * browser's clock — the two disagree for a few hours either side of midnight.
 */
import { useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Loader2 } from '../ui/icons'
import { usePayroll } from '../api/hooks'
import Avatar from './Avatar'
import { PAY_MODEL_LABEL, PAYOUT_STATUS_CHIP, addMonths, longMonth } from './coachFormat'
import { cell, downloadCsv } from './exportCsv'
import { rupees } from './format'
import PayoutDrawer from './PayoutDrawer'
import { Table, TableMessage, Tbody, Td, Th, Thead, Tr } from '../ui/Table'
import StatTile from '../ui/StatTile'

export default function PayrollView({ onOpen }: { onOpen: (coachId: string) => void }) {
  // `undefined` is "the academy's current month"; once the person navigates it is explicit.
  const [month, setMonth] = useState<string | undefined>(undefined)
  const { data, isLoading, isError, isFetching } = usePayroll(month)
  const [paying, setPaying] = useState<{ id: string; name: string } | null>(null)

  const shown = data ? data.period.slice(0, 7) : month
  const rows = data?.rows ?? []
  const unpaid = rows.filter((r) => r.status === 'due').length

  // A month that has not begun cannot be paid, so navigation stops at the academy's
  // current one — as the server reports it, not the browser's clock.
  const atCurrent = data ? data.period >= data.current_period : true

  function exportCsv() {
    if (!data || !shown) return
    downloadCsv(
      `coach-payroll-${shown}.csv`,
      [
        'Coach ID',
        'Coach',
        'Pay model',
        'Sessions',
        'Hours',
        'Fees collected',
        'Base pay',
        'Commission',
        'Earned',
        'Status',
        'Paid',
      ],
      data.rows.map((r) =>
        [
          r.coach_no,
          r.name,
          PAY_MODEL_LABEL[r.pay_model],
          r.sessions,
          Number(r.hours),
          Number(r.fees_collected),
          Number(r.base_amount),
          Number(r.commission_amount),
          Number(r.gross),
          r.status === 'paid' ? 'Paid' : r.status === 'due' ? 'Due' : 'Nothing earned',
          r.paid_total != null ? Number(r.paid_total) : '',
        ]
          .map(cell)
          .join(','),
      ),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shown && setMonth(addMonths(shown, -1))}
            aria-label="Previous month"
            className="flex size-9 items-center justify-center rounded-lg border border-border-card bg-white text-slate hover:text-ink"
          >
            <ChevronLeft size={16} />
          </button>
          <p className="min-w-[150px] text-center font-display text-base font-semibold text-ink">
            {shown ? longMonth(shown) : '…'}
          </p>
          <button
            type="button"
            onClick={() => shown && setMonth(addMonths(shown, 1))}
            disabled={atCurrent}
            aria-label="Next month"
            className="flex size-9 items-center justify-center rounded-lg border border-border-card bg-white text-slate hover:text-ink disabled:opacity-40"
          >
            <ChevronRight size={16} />
          </button>
          {isFetching && <Loader2 size={15} className="animate-spin text-muted" />}
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!data || rows.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-card bg-white px-3.5 py-2 text-sm font-medium text-ink disabled:opacity-40"
        >
          <Download size={15} /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Payroll" value={data ? rupees(data.total_gross) : '—'} sub={`${rows.length} coaches`} />
        <StatTile label="Paid" value={data ? rupees(data.total_paid) : '—'} tone="text-positive" />
        <StatTile
          label="Still to pay"
          value={data ? rupees(data.total_due) : '—'}
          tone={data && Number(data.total_due) > 0 ? 'text-amber-700' : undefined}
          sub={unpaid ? `${unpaid} ${unpaid === 1 ? 'coach' : 'coaches'}` : data ? 'All paid up' : undefined}
        />
      </div>

      <Table minWidth={900}>
        <Thead>
          <Tr>
            <Th>Coach</Th>
            <Th>Pay</Th>
            <Th>Taught</Th>
            <Th>Fees collected</Th>
            <Th align="right">Earned</Th>
            <Th>Status</Th>
            <Th />
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((r) => (
            <Tr key={r.coach_id}>
              <Td>
                <button type="button" onClick={() => onOpen(r.coach_id)} className="flex items-center gap-3 text-left">
                  <Avatar name={r.name} initials={r.avatar_initials} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink hover:underline">{r.name}</span>
                    <span className="block text-xs text-muted">{r.coach_no}</span>
                  </span>
                </button>
              </Td>
              <Td className="text-slate">{PAY_MODEL_LABEL[r.pay_model]}</Td>
              <Td className="text-slate">
                {r.sessions} {r.sessions === 1 ? 'session' : 'sessions'}
                <span className="block text-xs text-muted">{Number(r.hours)} h</span>
              </Td>
              <Td className="text-slate">
                {r.pay_model === 'commission' || r.pay_model === 'hybrid' ? rupees(r.fees_collected) : '—'}
              </Td>
              <Td align="right" className="font-medium text-ink">
                {rupees(r.paid_total ?? r.gross)}
                {r.paid_total != null && Number(r.paid_total) !== Number(r.gross) && (
                  <span className="block text-xs font-normal text-muted">would be {rupees(r.gross)} now</span>
                )}
              </Td>
              <Td>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${PAYOUT_STATUS_CHIP[r.status] ?? ''}`}
                >
                  {r.status === 'paid' ? 'Paid' : r.status === 'due' ? 'Due' : 'Nothing earned'}
                </span>
              </Td>
              <Td align="right">
                {r.status === 'due' && (
                  <button
                    type="button"
                    onClick={() => setPaying({ id: r.coach_id, name: r.name })}
                    className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Record payout
                  </button>
                )}
                {r.status === 'paid' && (
                  <button
                    type="button"
                    onClick={() => onOpen(r.coach_id)}
                    className="rounded-lg border border-border-card px-2.5 py-1.5 text-xs text-slate hover:text-ink"
                  >
                    Details
                  </button>
                )}
              </Td>
            </Tr>
          ))}

          {isLoading && (
            <TableMessage colSpan={7}>
                Loading payroll…
              </TableMessage>
          )}
          {isError && (
            <TableMessage colSpan={7} tone="negative">
                Could not load payroll.
              </TableMessage>
          )}
          {!isLoading && !isError && rows.length === 0 && (
            <TableMessage colSpan={7}>
                No coaches to pay for {shown ? longMonth(shown) : 'this month'}.
              </TableMessage>
          )}
        </Tbody>
      </Table>

      <p className="text-xs text-muted">
        Commission is a share of fees <em>received</em> in the month, not fees invoiced. Hours count sessions whose
        register was taken. A paid month shows what was actually paid.
      </p>

      {paying && shown && (
        <PayoutDrawer
          coach={paying}
          month={shown}
          inProgress={atCurrent}
          onClose={() => setPaying(null)}
        />
      )}
    </div>
  )
}
