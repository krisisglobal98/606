import { useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Pagination } from './Pagination'

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  /** Enables sorting on this column. */
  sort?: (row: T) => string | number | null
  align?: 'right'
  width?: number | string
  className?: string
}

interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  caption: string
  onRowClick?: (row: T) => void
  selectedKey?: string | null
  /** Client-side paging; omit to render all rows. */
  pageSize?: number
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  empty?: ReactNode
  /** Scroll height of the table body (the header row stays visible). */
  maxHeight?: number | string
  /** Rows-per-page choices: shows a selector and numbered pages (`pageSize` is the first choice). */
  pageSizes?: number[]
  /** Remembers the chosen rows-per-page in this browser under this key. */
  pageSizeKey?: string
  /** Changing it goes back to page 1 (e.g. the search text). */
  resetKey?: string
}

const readSize = (key: string | undefined, sizes: number[] | undefined) => {
  if (!key || !sizes) return null
  try {
    const n = Number(localStorage.getItem(key))
    return sizes.includes(n) ? n : null
  } catch {
    return null
  }
}

/** Sortable, optionally paginated table. Clickable rows are keyboard-focusable (Enter/Space). */
export function DataTable<T>({ rows, columns, rowKey, caption, onRowClick, selectedKey, pageSize: firstSize, initialSort, empty, maxHeight, pageSizes, pageSizeKey, resetKey }: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPageState] = useState(1)
  const [size, setSize] = useState<number | undefined>(() => readSize(pageSizeKey, pageSizes) ?? firstSize)
  const pageSize = size
  const wrap = useRef<HTMLDivElement>(null)
  // A new search (or other reset) starts again on page 1.
  const [seenReset, setSeenReset] = useState(resetKey)
  if (seenReset !== resetKey) {
    setSeenReset(resetKey)
    setPageState(1)
  }
  const setPage = (p: number) => {
    setPageState(p)
    wrap.current?.scrollTo({ top: 0 })
  }
  const choose = (n: number) => {
    setSize(n)
    setPage(1)
    try {
      if (pageSizeKey) localStorage.setItem(pageSizeKey, String(n))
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
  }

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key)
    if (!col?.sort) return rows
    const dir = sort!.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = col.sort!(a)
      const y = col.sort!(b)
      if (x == null) return 1
      if (y == null) return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'id', { numeric: true })) * dir
    })
  }, [rows, columns, sort])

  const pages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1
  const cur = Math.min(page, pages)
  const visible = pageSize ? sorted.slice((cur - 1) * pageSize, cur * pageSize) : sorted

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }))
    setPage(1)
  }

  return (
    <>
      <div ref={wrap} className={`dtable-wrap${maxHeight ? ' dtable-wrap--scroll' : ''}`} style={maxHeight ? { maxHeight } : undefined}>
        <table className="dtable">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th key={c.key} scope="col" className={c.align === 'right' ? 'r' : undefined} style={c.width ? { width: c.width } : undefined} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sort ? (
                      <button type="button" onClick={() => toggleSort(c.key)}>
                        {c.header}
                        {active ? sort!.dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden /> : <ArrowUpDown size={12} aria-hidden style={{ opacity: 0.4 }} />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const k = rowKey(r)
              return (
                <tr
                  key={k}
                  className={[onRowClick && 'clickable', selectedKey === k && 'is-selected'].filter(Boolean).join(' ') || undefined}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  onKeyDown={onRowClick ? (e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), onRowClick(r)) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={[c.align === 'right' && 'r', c.className].filter(Boolean).join(' ') || undefined}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
        {!visible.length && empty}
      </div>
      {pageSize && (pageSizes ? sorted.length > Math.min(...pageSizes) : sorted.length > pageSize) && (
        <Pagination page={cur} pageSize={pageSize} total={sorted.length} onPage={setPage} pageSizes={pageSizes} onPageSize={pageSizes ? choose : undefined} />
      )}
    </>
  )
}
