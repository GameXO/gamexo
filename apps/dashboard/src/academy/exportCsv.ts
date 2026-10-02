/**
 * Export the students table as CSV — every row matching the current filters, not
 * just the page on screen.
 *
 * Built in the browser from the same `/academy/roster` endpoint the table reads, so
 * the file always agrees with what the screen showed and respects the same
 * permissions; there is no second export path to keep in step.
 */
import { api, type RosterQuery } from '../api/client'
import type { StudentRow } from '../api/hooks'
import { LEVEL_TITLE } from './format'

const PAGE = 200

/** Every page, in order. Capped so a runaway filter cannot loop forever. */
async function fetchAll(query: RosterQuery): Promise<StudentRow[]> {
  const rows: StudentRow[] = []
  for (let page = 1; page <= 50; page++) {
    const res = await api.roster({ ...query, page, size: PAGE })
    rows.push(...res.items)
    if (page >= res.pages) break
  }
  return rows
}

/**
 * Quote a cell, and defuse spreadsheet formulas.
 *
 * A name or note that begins with `=`, `@`, or a `+`/`-` that is not a plain number
 * would be *executed* when the file is opened in Excel. Prefixing an apostrophe makes
 * it text. Phone numbers (`+91 98765 43210`) are left alone — they look like numbers,
 * and mangling every one of them would make the column useless.
 */
export function cell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=@]|^[+-](?![\d\s()-]+$)/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Save a CSV: a header row and already-quoted lines. Shared by every export on the
 * Academy screens so they all get the same BOM and the same formula protection (apply
 * `cell` to each value).
 */
export function downloadCsv(filename: string, header: string[], lines: string[]): void {
  // The BOM makes Excel read the file as UTF-8, so ₹ and non-Latin names survive.
  const blob = new Blob(['\uFEFF', [header.map(cell).join(','), ...lines].join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function exportRosterCsv(
  query: RosterQuery,
  sportName: (id: string | null | undefined) => string,
): Promise<number> {
  // The page and size belong to the table; the export wants everything.
  const { page: _page, size: _size, ...filters } = query
  void _page
  void _size
  const rows = await fetchAll(filters)

  const header = [
    'Student ID',
    'Name',
    'Age',
    'Gender',
    'Parent',
    'Phone',
    'Status',
    'Sport',
    'Programme',
    'Batch',
    'Coach',
    'Level',
    'Attendance % (30 days)',
    'Attendance % (overall)',
    'Rating',
    'Fees',
    'Pending fee',
    'Term ends',
    'Needs attention',
  ]

  const lines = rows.map((r) => {
    const level = r.levels.find((l) => l.sport_id === r.sport_id) ?? r.levels[0]
    return [
      r.student_no,
      r.name,
      r.age,
      r.gender,
      r.parent_name,
      r.phone,
      r.status,
      sportName(r.sport_id),
      r.program_name,
      r.batch_name,
      r.coach_name,
      level ? LEVEL_TITLE[level.level] : '',
      r.attendance_pct,
      r.attendance_overall_pct,
      Number(r.rating).toFixed(1),
      r.fee_status === 'none' ? 'No plan' : r.fee_status === 'paid' ? 'Paid' : 'Due',
      Number(r.pending_fee),
      r.renewal_date,
      r.flags.join('; '),
    ]
      .map(cell)
      .join(',')
  })

  downloadCsv(`students-${new Date().toISOString().slice(0, 10)}.csv`, header, lines)
  return rows.length
}
