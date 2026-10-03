import type { ComponentProps, ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'

/**
 * The one table look for the whole dashboard: a bordered shell tinted like the
 * page, a quiet sentence-case header band on that tint, and the rows on a white
 * panel whose top corners are rounded over the band.
 *
 * Built from primitives (`Table`, `Thead`, `Tbody`, `Tr`, `Th`, `Td`) so a screen
 * with a bespoke row — a drawer trigger, an inline select — keeps its markup and
 * only loses its styling; `DataTable` below is the shortcut for the plain case
 * of "these columns, these rows".
 *
 * The shape comes from the primitives rather than from a class on each cell, so a
 * caller never has to repeat padding or borders — and, because it is the table
 * itself that rounds the first row, a `Tr` can be dropped in or out of the body
 * without anything needing to know it is first.
 */

type SortDir = 'asc' | 'desc'

/**
 * `bare` drops the shell, for a table that already sits inside a `Card` which
 * supplies the border and the title; the header band then stays white so the card
 * does not read as two stacked headers. `inset` is `bare` for a card that pads its
 * own body: the card's padding is the gutter, so the outer cells give theirs up.
 */
export function Table({
  children,
  minWidth,
  inset = false,
  bare = inset,
  className = '',
}: {
  children: ReactNode
  /** Width below which the table scrolls sideways instead of squashing columns. */
  minWidth?: number
  bare?: boolean
  inset?: boolean
  className?: string
}) {
  return (
    <div className={`${bare ? '' : 'rounded-xl border border-border-card bg-page'} shrink-0 overflow-x-auto ${className}`}>
      <table
        data-bare={bare || undefined}
        style={minWidth ? { minWidth } : undefined}
        className={[
          'w-full border-separate border-spacing-0 text-left text-sm',
          // The row panel: a hairline on top of the first row, rounded at its
          // corners (over the band behind it), and no rule under the last row — the
          // shell's own border closes the table.
          '[&_tbody>tr:first-child>td]:border-t',
          inset ? '[&_th:first-child]:pl-0 [&_td:first-child]:pl-0 [&_th:last-child]:pr-0 [&_td:last-child]:pr-0' : '',
          bare
            ? ''
            : '[&_tbody>tr:first-child>td:first-child]:rounded-tl-xl [&_tbody>tr:first-child>td:last-child]:rounded-tr-xl',
          '[&_tbody>tr:last-child>td]:border-b-0',
        ].join(' ')}
      >
        {children}
      </table>
    </div>
  )
}

export function Thead({ children }: { children: ReactNode }) {
  return <thead>{children}</thead>
}

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>
}

/**
 * A body row. Passing `onClick` makes the whole row the target and gives it the
 * keyboard handling a real button would have had; a header row needs none of this
 * and is just `<Tr>`.
 */
export function Tr({
  children,
  onClick,
  className = '',
  ...rest
}: Omit<ComponentProps<'tr'>, 'onClick'> & { onClick?: () => void }) {
  return (
    <tr
      {...rest}
      data-hover={onClick ? '' : undefined}
      onClick={onClick}
      tabIndex={onClick ? 0 : rest.tabIndex}
      onKeyDown={
        onClick
          ? (event) => {
              rest.onKeyDown?.(event)
              if (event.defaultPrevented || event.target !== event.currentTarget) return
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onClick()
            }
          : rest.onKeyDown
      }
      className={`${onClick ? 'cursor-pointer outline-none ' : ''}${className}`}
    >
      {children}
    </tr>
  )
}

function SortIcon({ dir }: { dir: SortDir | null }) {
  const Icon = dir === 'asc' ? ArrowUp : dir === 'desc' ? ArrowDown : ChevronsUpDown
  return <Icon size={13} strokeWidth={2} className="shrink-0" aria-hidden />
}

/**
 * A column heading. Give it `onSort` and it becomes a button with the up/down
 * affordance; `sort` says which way it is currently sorted (`null`/omitted for
 * "not by this column"), and an active column reads in ink like the screenshot's
 * "Name ↑".
 */
export function Th({
  children,
  align = 'left',
  sort = null,
  onSort,
  className = '',
}: {
  children?: ReactNode
  align?: 'left' | 'right' | 'center'
  sort?: SortDir | null
  onSort?: () => void
  className?: string
}) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
  return (
    <th
      scope="col"
      aria-sort={onSort ? (sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none') : undefined}
      aria-hidden={children ? undefined : true}
      className={`whitespace-nowrap bg-page px-4 py-3.5 text-xs font-medium first:pl-5 last:pr-5 [table[data-bare]_&]:bg-surface ${alignClass} ${
        sort ? 'text-ink' : 'text-muted'
      } ${className}`}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          className={`inline-flex items-center gap-1.5 hover:text-ink ${align === 'right' ? 'flex-row-reverse' : ''}`}
        >
          {children}
          <SortIcon dir={sort} />
        </button>
      ) : (
        children
      )}
    </th>
  )
}

export function Td({
  children,
  align = 'left',
  className = '',
  ...rest
}: ComponentProps<'td'> & { align?: 'left' | 'right' | 'center' }) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''
  return (
    <td
      {...rest}
      className={`border-b border-border-card bg-surface px-4 py-3.5 first:pl-5 last:pr-5 [tr[data-hover]:hover_&]:bg-surface-muted/60 [tr[data-hover]:focus-visible_&]:bg-surface-muted/60 ${alignClass} ${className}`}
    >
      {children}
    </td>
  )
}

/** A single full-width row for loading, error and empty states. */
export function TableMessage({
  colSpan,
  tone = 'muted',
  children,
}: {
  colSpan: number
  tone?: 'muted' | 'negative'
  children: ReactNode
}) {
  return (
    <tr>
      <Td
        colSpan={colSpan}
        align="center"
        className={`py-12 ${tone === 'negative' ? 'text-negative' : 'text-muted'}`}
        role={tone === 'negative' ? 'alert' : undefined}
      >
        {children}
      </Td>
    </tr>
  )
}

export type Column<T> = {
  key: string
  header?: ReactNode
  cell: (row: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  /** Shows the sort affordance; the screen owns the actual ordering. */
  sortable?: boolean
  className?: string
}

/**
 * Columns and rows in, the standard table out. Sorting is controlled — the screen
 * keeps `sort` and reorders its own rows — so it works the same over a client-side
 * list and a server-paged one.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  sort,
  onSort,
  loading = false,
  error,
  empty = 'Nothing to show.',
  minWidth,
  bare,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  sort?: { key: string; dir: SortDir }
  onSort?: (key: string) => void
  loading?: boolean
  error?: ReactNode
  empty?: ReactNode
  minWidth?: number
  bare?: boolean
}) {
  return (
    <Table minWidth={minWidth} bare={bare}>
      <Thead>
        <Tr>
          {columns.map((col) => (
            <Th
              key={col.key}
              align={col.align}
              sort={sort?.key === col.key ? sort.dir : null}
              onSort={col.sortable && onSort ? () => onSort(col.key) : undefined}
            >
              {col.header}
            </Th>
          ))}
        </Tr>
      </Thead>
      <Tbody>
        {loading ? (
          <TableMessage colSpan={columns.length}>Loading…</TableMessage>
        ) : error ? (
          <TableMessage colSpan={columns.length} tone="negative">
            {error}
          </TableMessage>
        ) : rows.length === 0 ? (
          <TableMessage colSpan={columns.length}>{empty}</TableMessage>
        ) : (
          rows.map((row) => (
            <Tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}>
              {columns.map((col) => (
                <Td key={col.key} align={col.align} className={col.className}>
                  {col.cell(row)}
                </Td>
              ))}
            </Tr>
          ))
        )}
      </Tbody>
    </Table>
  )
}
