/**
 * The students table — the screen staff actually arrive at.
 *
 * Every question they come with is a filter: "who is in tennis?", "whose fees are
 * due?", "who is ready to move up?". The sport chips sit above everything else because
 * sport is the first cut an academy makes; the rest are dropdowns. Each row carries the
 * three numbers that say whether a student is okay — attendance, rating, fees — so most
 * questions are answered without opening anyone.
 *
 * Filtering, sorting and paging all happen on the server, and the table keeps showing
 * the previous result while the next loads, so changing a filter never blanks the page.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Loader2, Search, X } from 'lucide-react'
import type { RosterQuery } from '../api/client'
import {
  SKILL_LEVELS,
  useBatches,
  useCoaches,
  useRoster,
  useSports,
  type StudentRow,
} from '../api/hooks'
import Avatar from './Avatar'
import { exportRosterCsv } from './exportCsv'
import { FLAG_META, LEVEL_TITLE, STATUS_CHIP, attendanceTone, formatDate, renewalText, rupees } from './format'

const PAGE_SIZE = 25

export type RosterFilters = Omit<RosterQuery, 'size'>

const SORTABLE: { key: NonNullable<RosterQuery['sort']>; label: string }[] = [
  { key: 'name', label: 'Student' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'rating', label: 'Rating' },
  { key: 'renewal', label: 'Fees & term' },
]

const selectClass =
  'rounded-lg border border-border-card bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lime'

function FilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T | undefined
  onChange: (v: T | undefined) => void
  options: { value: T; label: string }[]
}) {
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
      className={selectClass}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export default function StudentsTab({
  filters,
  onFiltersChange,
  onOpen,
  onEnrol,
}: {
  filters: RosterFilters
  onFiltersChange: (next: RosterFilters) => void
  onOpen: (studentId: string) => void
  onEnrol: () => void
}) {
  const { data: sports } = useSports(true)
  const { data: batches } = useBatches()
  const { data: coaches } = useCoaches()
  const [search, setSearch] = useState(filters.search ?? '')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const query: RosterQuery = { ...filters, size: PAGE_SIZE, page: filters.page ?? 1 }
  const { data, isLoading, isError, isFetching } = useRoster(query)

  // A change to anything but the page goes back to page one: page 4 of the old
  // result set is meaningless in the new one, and often does not exist.
  const update = (patch: Partial<RosterFilters>) =>
    onFiltersChange({ ...filters, page: 1, ...patch })

  // What this box last pushed up. Lets the effect below tell "the filter changed
  // because I typed" from "something else replaced the filters" — only the second
  // should overwrite what is in the box.
  const lastPushed = useRef<string | undefined>(filters.search)

  useEffect(() => {
    if (filters.search !== lastPushed.current) {
      lastPushed.current = filters.search
      setSearch(filters.search ?? '')
    }
  }, [filters.search])

  // Debounced, so typing a name does not fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      const next = search.trim() || undefined
      if (next !== (filters.search || undefined)) {
        lastPushed.current = next
        onFiltersChange({ ...filters, page: 1, search: next })
      }
    }, 300)
    return () => clearTimeout(id)
    // `filters` is read inside but deliberately not a dependency: re-arming on every
    // filter change would re-send a search that has not changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const sportName = useMemo(() => {
    const byId = new Map((sports ?? []).map((s) => [s.id, s.name]))
    return (id: string | null | undefined) => (id ? (byId.get(id) ?? 'Sport') : '—')
  }, [sports])

  const batchOptions = (batches ?? [])
    .filter((b) => !filters.sport_id || b.sport_id === filters.sport_id)
    .map((b) => ({ value: b.id, label: b.name }))

  const activeFilterCount = [
    filters.search,
    filters.status,
    filters.sport_id,
    filters.batch_id,
    filters.coach_id,
    filters.level,
    filters.fee_status,
    filters.attention,
  ].filter(Boolean).length

  const clear = () => {
    setSearch('')
    onFiltersChange({ page: 1, sort: filters.sort, desc: filters.desc })
  }

  const sortBy = (key: NonNullable<RosterQuery['sort']>) => {
    const sameColumn = (filters.sort ?? 'name') === key
    // Ascending first for every column: for attendance and rating that is worst-first,
    // which is why anyone sorts by them — to find who is struggling. Soonest-first for
    // the term end is the same idea. A second click reverses it.
    update({ sort: key, desc: sameColumn ? !filters.desc : false })
  }

  async function onExport() {
    setExporting(true)
    setExportError(null)
    try {
      const { page: _page, ...rest } = query
      void _page
      await exportRosterCsv(rest, sportName)
    } catch {
      setExportError('Could not export the students. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  const rows = data?.items ?? []
  const page = data?.page ?? 1
  const pages = data?.pages ?? 1

  return (
    <div className="flex flex-col gap-4">
      {/* Sport first: it is the cut an academy makes before any other. */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by sport">
        {[{ id: undefined as string | undefined, name: 'All sports' }, ...(sports ?? [])].map((s) => {
          const on = filters.sport_id === s.id
          return (
            <button
              key={s.id ?? 'all'}
              type="button"
              aria-pressed={on}
              // A batch from another sport would match nothing, so changing sport drops it.
              onClick={() => update({ sport_id: s.id, batch_id: undefined })}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                on ? 'bg-ink text-white' : 'border border-border-card bg-white text-slate hover:text-ink'
              }`}
            >
              {s.name}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, ID, parent or phone"
            aria-label="Search students"
            className="w-full rounded-lg border border-border-card bg-white py-2 pl-9 pr-3 text-sm text-ink outline-none focus:border-lime"
          />
        </div>

        <FilterSelect
          label="All batches"
          value={filters.batch_id}
          onChange={(v) => update({ batch_id: v })}
          options={batchOptions}
        />
        <FilterSelect
          label="All coaches"
          value={filters.coach_id}
          onChange={(v) => update({ coach_id: v })}
          options={(coaches?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <FilterSelect
          label="Any level"
          value={filters.level}
          onChange={(v) => update({ level: v })}
          options={SKILL_LEVELS.map((l) => ({ value: l, label: LEVEL_TITLE[l] }))}
        />
        <FilterSelect
          label="Any fee status"
          value={filters.fee_status}
          onChange={(v) => update({ fee_status: v })}
          options={[
            { value: 'paid', label: 'Paid' },
            { value: 'due', label: 'Fees due' },
            { value: 'none', label: 'No plan' },
          ]}
        />
        <FilterSelect
          label="Any status"
          value={filters.status}
          onChange={(v) => update({ status: v })}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'paused', label: 'Paused' },
            { value: 'completed', label: 'Completed' },
            { value: 'inactive', label: 'Inactive' },
          ]}
        />
        <FilterSelect
          label="Needs attention"
          value={filters.attention}
          onChange={(v) => update({ attention: v })}
          options={(Object.keys(FLAG_META) as (keyof typeof FLAG_META)[]).map((k) => ({
            value: k,
            label: FLAG_META[k].label,
          }))}
        />

        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm text-slate hover:text-ink"
          >
            <X size={14} />
            Clear ({activeFilterCount})
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-slate" aria-live="polite">
          {data ? `${data.total} ${data.total === 1 ? 'student' : 'students'}` : 'Loading…'}
          {isFetching && data && <Loader2 size={13} className="animate-spin text-muted" />}
        </p>
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={exporting || !data || data.total === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-border-card bg-white px-3 py-2 text-sm font-medium text-ink disabled:opacity-40"
        >
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Export CSV
        </button>
      </div>

      {exportError && (
        <p role="alert" className="rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
          {exportError}
        </p>
      )}

      {/* `shrink-0` is load-bearing: this is a child of a scrolling flex column and
          `overflow-hidden` would otherwise let it collapse to its border. */}
      <div className="shrink-0 overflow-x-auto rounded-xl border border-border-card bg-white">
        <table className="w-full min-w-[920px] text-left text-sm">
          <thead>
            <tr className="border-b border-border-card text-xs uppercase tracking-wide text-muted">
              {SORTABLE.slice(0, 1).map((c) => (
                <SortHeader key={c.key} col={c} filters={filters} onSort={sortBy} />
              ))}
              <th className="px-4 py-3 font-medium">Sport & level</th>
              <th className="px-4 py-3 font-medium">Batch & coach</th>
              {SORTABLE.slice(1).map((c) => (
                <SortHeader key={c.key} col={c} filters={filters} onSort={sortBy} />
              ))}
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <StudentTableRow key={row.id} row={row} sportName={sportName} onOpen={onOpen} />
            ))}

            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted">
                  Loading students…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-negative">
                  Could not load students.
                </td>
              </tr>
            )}
            {!isLoading && !isError && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  {activeFilterCount > 0 ? (
                    <>
                      <p className="text-sm font-medium text-ink">No students match these filters</p>
                      <button type="button" onClick={clear} className="mt-2 text-sm text-slate underline">
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-ink">No students enrolled yet</p>
                      <p className="mt-1 text-sm text-slate">Enrol your first student to see them here.</p>
                      <button
                        type="button"
                        onClick={onEnrol}
                        className="mt-3 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white"
                      >
                        Enrol student
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate">
          <span>
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onFiltersChange({ ...filters, page: page - 1 })}
              className="inline-flex items-center gap-1 rounded-lg border border-border-card bg-white px-3 py-1.5 disabled:opacity-40"
            >
              <ChevronLeft size={14} /> Previous
            </button>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => onFiltersChange({ ...filters, page: page + 1 })}
              className="inline-flex items-center gap-1 rounded-lg border border-border-card bg-white px-3 py-1.5 disabled:opacity-40"
            >
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SortHeader({
  col,
  filters,
  onSort,
}: {
  col: { key: NonNullable<RosterQuery['sort']>; label: string }
  filters: RosterFilters
  onSort: (key: NonNullable<RosterQuery['sort']>) => void
}) {
  const active = (filters.sort ?? 'name') === col.key
  const Arrow = filters.desc ? ArrowDown : ArrowUp
  return (
    <th
      className="px-4 py-3 font-medium"
      aria-sort={active ? (filters.desc ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(col.key)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide ${active ? 'text-ink' : 'hover:text-ink'}`}
      >
        {col.label}
        {active && <Arrow size={12} />}
      </button>
    </th>
  )
}

function StudentTableRow({
  row,
  sportName,
  onOpen,
}: {
  row: StudentRow
  sportName: (id: string | null | undefined) => string
  onOpen: (id: string) => void
}) {
  const level = row.levels.find((l) => l.sport_id === row.sport_id) ?? row.levels[0]
  const tone = attendanceTone(row.attendance_pct)
  const shownFlags = row.flags.slice(0, 2)
  const hiddenFlags = row.flags.length - shownFlags.length

  return (
    <tr
      onClick={() => onOpen(row.id)}
      // The row is the target, so it also has to answer the keyboard.
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onOpen(row.id)
      }}
      className="cursor-pointer border-b border-border-card last:border-0 transition-colors hover:bg-surface-muted/70 focus:bg-surface-muted/70 focus:outline-none"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar name={row.name} initials={row.avatar_initials} photoUrl={row.photo_url} />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{row.name}</p>
            <p className="text-xs text-muted">
              {row.student_no}
              {row.age != null && ` · ${row.age} yrs`}
            </p>
            {row.flags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {shownFlags.map((f) => (
                  <span key={f} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${FLAG_META[f].chip}`}>
                    {FLAG_META[f].label}
                  </span>
                ))}
                {hiddenFlags > 0 && (
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-slate">
                    +{hiddenFlags}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </td>

      <td className="px-4 py-3">
        {row.sport_id ? (
          <>
            <p className="text-ink">{sportName(row.sport_id)}</p>
            {level && <p className="text-xs text-muted">{LEVEL_TITLE[level.level]}</p>}
          </>
        ) : (
          <span className="text-xs text-muted">Not enrolled</span>
        )}
      </td>

      <td className="px-4 py-3">
        <p className="text-ink">{row.batch_name ?? '—'}</p>
        {row.coach_name && <p className="text-xs text-muted">{row.coach_name}</p>}
      </td>

      <td className="px-4 py-3">
        {row.attendance_pct === null ? (
          <span className="text-xs text-muted">No sessions yet</span>
        ) : (
          <div className="w-28">
            <p className={`text-sm font-medium ${tone.text}`}>{Math.round(row.attendance_pct)}%</p>
            <div className="mt-1 h-1.5 rounded-full bg-surface-muted">
              <div className={`h-1.5 rounded-full ${tone.bar}`} style={{ width: `${row.attendance_pct}%` }} />
            </div>
            <p className="mt-0.5 text-[11px] text-muted">last 30 days</p>
          </div>
        )}
      </td>

      <td className="px-4 py-3">
        {Number(row.rating) > 0 ? (
          <span className="font-medium text-ink">
            {Number(row.rating).toFixed(1)}
            <span className="text-xs font-normal text-muted"> / 10</span>
          </span>
        ) : (
          <span className="text-xs text-muted">Not rated</span>
        )}
      </td>

      <td className="px-4 py-3">
        {row.fee_status === 'none' ? (
          <span className="text-xs text-muted">No plan</span>
        ) : (
          <>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                row.fee_status === 'paid' ? 'bg-positive/15 text-positive' : 'bg-amber-50 text-amber-800'
              }`}
            >
              {row.fee_status === 'paid' ? 'Paid' : `Due ${rupees(row.pending_fee)}`}
            </span>
            <p
              className={`mt-1 text-[11px] ${
                row.renewal_state === 'lapsed' ? 'text-negative' : row.renewal_state === 'due_soon' ? 'text-amber-700' : 'text-muted'
              }`}
              title={row.renewal_date ? `Term ends ${formatDate(row.renewal_date)}` : undefined}
            >
              {row.renewal_state === 'ok' ? `Renews ${formatDate(row.renewal_date)}` : renewalText(row.days_to_renewal)}
            </p>
          </>
        )}
      </td>

      <td className="px-4 py-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_CHIP[row.status] ?? ''}`}>
          {row.status}
        </span>
      </td>
    </tr>
  )
}
