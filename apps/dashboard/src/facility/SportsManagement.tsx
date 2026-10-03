/**
 * Sports & Courts: the sports this academy offers, and a page for each.
 *
 * The list is only the table — one row per sport — with Add sport above it. Opening a
 * row replaces the list with that sport's own page, where its courts, hours, photos
 * and pricing are managed. Everything here is the API's data: adding a sport creates a
 * real row, and the booking flow reads the same sports and courts.
 */
import { useMemo, useState } from 'react'
import { ChevronRight, Plus } from '../ui/icons'
import Card from '../ui/Card'
import StatusPill from '../ui/StatusPill'
import { Table, Tbody, Td, Th, Thead, Tr } from '../ui/Table'
import { useToast } from '../ui/useToast'
import { useManagedCourts, useManagedSports } from '../api/hooks'
import AddSportDialog from './AddSportDialog'
import SportDetail from './SportDetail'
import SportThumb from './SportThumb'

const rupees = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

export default function SportsManagement() {
  const sportsQuery = useManagedSports()
  const courtsQuery = useManagedCourts()
  const { toast, notify } = useToast()
  const [adding, setAdding] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const sports = useMemo(() => sportsQuery.data ?? [], [sportsQuery.data])

  const counts = useMemo(() => {
    const total = new Map<string, number>()
    const open = new Map<string, number>()
    for (const c of courtsQuery.data ?? []) {
      total.set(c.sport_id, (total.get(c.sport_id) ?? 0) + 1)
      if (c.is_bookable) open.set(c.sport_id, (open.get(c.sport_id) ?? 0) + 1)
    }
    return { total, open }
  }, [courtsQuery.data])

  // Looked up from the live list, so the page reflects every save without being handed
  // a stale copy — and falls back to the list if the sport is removed from under it.
  const opened = openId ? (sports.find((s) => s.id === openId) ?? null) : null

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto bg-page px-4 py-6 sm:px-6 lg:px-8">
      {opened ? (
        <SportDetail sport={opened} onBack={() => setOpenId(null)} onNotify={notify} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-slate">Open a sport to manage its courts, hours, photos and pricing.</p>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-control"
            >
              <Plus size={15} />
              Add sport
            </button>
          </div>

          {sportsQuery.isPending ? (
            <Card>
              <p className="py-8 text-center text-sm text-muted">Loading sports…</p>
            </Card>
          ) : sportsQuery.error ? (
            <Card>
              <p role="alert" className="py-8 text-center text-sm text-negative">
                Could not load sports:{' '}
                {sportsQuery.error instanceof Error ? sportsQuery.error.message : 'unknown error'}
              </p>
            </Card>
          ) : sports.length === 0 ? (
            <Card>
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-ink">No sports yet</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-slate">
                  Add the first sport you offer, then add its courts.
                </p>
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-control"
                >
                  <Plus size={15} />
                  Add sport
                </button>
              </div>
            </Card>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Sport</Th>
                  <Th>Courts</Th>
                  <Th>Starting at</Th>
                  <Th>Status</Th>
                  <Th className="w-10" />
                </Tr>
              </Thead>
              <Tbody>
                {sports.map((sport) => {
                  const total = counts.total.get(sport.id) ?? 0
                  const open = counts.open.get(sport.id) ?? 0
                  return (
                    <Tr key={sport.id} onClick={() => setOpenId(sport.id)} className="group">
                      <Td>
                        <div className="flex items-center gap-3.5">
                          <SportThumb sport={sport} />
                          <span className={`font-semibold ${sport.is_active ? 'text-ink' : 'text-muted'}`}>
                            {sport.name}
                          </span>
                        </div>
                      </Td>
                      <Td>
                        <p className="font-medium text-ink">
                          {total} {total === 1 ? 'court' : 'courts'}
                        </p>
                        {total > 0 && open !== total && (
                          <p className="text-xs text-muted">{open} open for booking</p>
                        )}
                      </Td>
                      <Td className="font-medium text-ink">
                        {Number(sport.price_base) > 0 ? `${rupees(sport.price_base)}/hr` : (
                          <span className="font-normal text-muted">Not priced</span>
                        )}
                      </Td>
                      <Td>
                        <StatusPill
                          label={sport.is_active ? 'Active' : 'Disabled'}
                          tone={sport.is_active ? 'positive' : 'neutral'}
                        />
                      </Td>
                      <Td className="text-muted">
                        <ChevronRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                      </Td>
                    </Tr>
                  )
                })}
              </Tbody>
            </Table>
          )}
        </>
      )}

      {adding && (
        <AddSportDialog
          existing={sports}
          onClose={() => setAdding(false)}
          onAdded={(name) => {
            setAdding(false)
            notify(`${name} added successfully`)
          }}
        />
      )}

      {toast}
    </div>
  )
}
