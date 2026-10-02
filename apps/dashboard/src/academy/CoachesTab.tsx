/**
 * Coaches, with the load each one is carrying — and, for a manager, what they cost.
 *
 * The question a manager brings here is "who has room, and who is stretched?", so the
 * batches and students counts lead and the table sorts busiest-first. A row opens that
 * coach's page; the Payroll switch answers the other monthly question, "who do I owe?".
 * Reception sees the same roster without the money: pay figures arrive zeroed from the
 * server for them, and this screen hides the column and the Payroll switch rather than
 * showing a column of zeros.
 */
import { useMemo, useState } from 'react'
import { ChevronRight, Plus, Search, Star } from 'lucide-react'
import { useCoaches, useSports } from '../api/hooks'
import Avatar from './Avatar'
import CoachDrawer from './CoachDrawer'
import { payTerms } from './coachFormat'
import { STATUS_CHIP } from './format'
import { useIsManager } from './permissions'
import PayrollView from './PayrollView'

type View = 'coaches' | 'payroll'

export default function CoachesTab({ onOpen }: { onOpen: (coachId: string) => void }) {
  const isManager = useIsManager()
  const { data, isLoading, isError } = useCoaches()
  const { data: sports } = useSports(true)

  const [view, setView] = useState<View>('coaches')
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [adding, setAdding] = useState(false)

  const sportName = useMemo(() => {
    const byId = new Map((sports ?? []).map((s) => [s.id, s.name]))
    return (id: string) => byId.get(id) ?? 'Sport'
  }, [sports])

  const all = useMemo(() => data?.items ?? [], [data])
  const inactiveCount = all.filter((c) => c.status === 'inactive').length

  const coaches = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all
      .filter((c) => showInactive || c.status !== 'inactive')
      .filter(
        (c) =>
          !q ||
          c.name.toLowerCase().includes(q) ||
          c.coach_no.toLowerCase().includes(q) ||
          (c.specialization ?? '').toLowerCase().includes(q),
      )
      .sort((a, b) => (b.total_students ?? 0) - (a.total_students ?? 0) || a.name.localeCompare(b.name))
  }, [all, search, showInactive])

  const columns = isManager ? 9 : 8

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {isManager && (
            <div className="flex overflow-hidden rounded-lg border border-border-card bg-white text-sm" role="tablist">
              {(['coaches', 'payroll'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`px-4 py-2 font-medium capitalize ${view === v ? 'bg-ink text-white' : 'text-slate hover:text-ink'}`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}

          {view === 'coaches' && (
            <>
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search coaches"
                  aria-label="Search coaches"
                  className="h-10 w-56 rounded-lg border border-border-card bg-white pl-9 pr-3 text-sm text-ink outline-none focus:border-lime"
                />
              </div>
              {inactiveCount > 0 && (
                <label className="flex items-center gap-2 text-sm text-slate">
                  <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                  Show inactive ({inactiveCount})
                </label>
              )}
            </>
          )}
        </div>

        {isManager && view === 'coaches' && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white"
          >
            <Plus size={16} /> Add coach
          </button>
        )}
      </div>

      {view === 'payroll' && isManager ? (
        <PayrollView onOpen={onOpen} />
      ) : (
        <div className="shrink-0 overflow-x-auto rounded-xl border border-border-card bg-white">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-border-card text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Coach</th>
                <th className="px-4 py-3 font-medium">Sports</th>
                <th className="px-4 py-3 font-medium">Batches</th>
                <th className="px-4 py-3 font-medium">Students</th>
                <th className="px-4 py-3 font-medium">Rating</th>
                {isManager && <th className="px-4 py-3 font-medium">Pay</th>}
                <th className="px-4 py-3 font-medium">Available</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {coaches.map((coach) => (
                <tr
                  key={coach.id}
                  onClick={() => onOpen(coach.id)}
                  className="cursor-pointer border-b border-border-card last:border-0 hover:bg-surface/60"
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpen(coach.id)
                      }}
                      className="flex items-center gap-3 text-left"
                    >
                      <Avatar name={coach.name} initials={coach.avatar_initials} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{coach.name}</span>
                        <span className="block truncate text-xs text-muted">
                          {coach.coach_no}
                          {coach.specialization && ` · ${coach.specialization}`}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate">
                    {(coach.sport_ids ?? []).length ? (
                      (coach.sport_ids ?? []).map(sportName).join(', ')
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-ink">{coach.active_batches ?? 0}</td>
                  <td className="px-4 py-3 font-medium text-ink">{coach.total_students ?? 0}</td>
                  <td className="px-4 py-3">
                    {Number(coach.rating) > 0 ? (
                      <span className="inline-flex items-center gap-1 text-ink">
                        <Star size={13} className="fill-amber-400 text-amber-400" />
                        {Number(coach.rating).toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  {isManager && <td className="px-4 py-3 text-xs text-slate">{payTerms(coach)}</td>}
                  <td className="px-4 py-3 text-xs text-slate">
                    {[coach.morning_available !== false && 'Mornings', coach.evening_available !== false && 'Evenings']
                      .filter(Boolean)
                      .join(' · ') || 'Not available'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_CHIP[coach.status ?? 'active'] ?? 'bg-surface-muted text-slate'}`}
                    >
                      {coach.status ?? 'active'}
                    </span>
                    {coach.type === 'guest' && (
                      <span className="ml-1.5 rounded-full bg-surface-muted px-2 py-1 text-xs text-slate">Guest</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-muted">
                    <ChevronRight size={16} />
                  </td>
                </tr>
              ))}

              {isLoading && (
                <tr>
                  <td colSpan={columns} className="px-4 py-10 text-center text-sm text-muted">
                    Loading coaches…
                  </td>
                </tr>
              )}
              {isError && (
                <tr>
                  <td colSpan={columns} className="px-4 py-10 text-center text-sm text-negative">
                    Could not load coaches.
                  </td>
                </tr>
              )}
              {!isLoading && !isError && coaches.length === 0 && (
                <tr>
                  <td colSpan={columns} className="px-4 py-10 text-center text-sm text-muted">
                    {all.length === 0 ? (
                      <>
                        No coaches on staff yet.
                        {isManager && (
                          <>
                            {' '}
                            <button type="button" onClick={() => setAdding(true)} className="text-lime-ink underline">
                              Add the first one
                            </button>
                            .
                          </>
                        )}
                      </>
                    ) : (
                      'No coach matches that search.'
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {adding && <CoachDrawer onClose={() => setAdding(false)} onSaved={(c) => onOpen(c.id)} />}
    </div>
  )
}
