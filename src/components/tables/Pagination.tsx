import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { formatNumber } from '@/utils/format'
import { pageWindow } from './pageWindow'
import { tr } from '@/i18n'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  busy?: boolean
  /** Rows-per-page choices; with `onPageSize` a selector is shown. */
  pageSizes?: number[]
  onPageSize?: (n: number) => void
}

export function Pagination({ page, pageSize, total, onPage, busy, pageSizes, onPageSize }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total ? (page - 1) * pageSize + 1 : 0
  const to = Math.min(total, page * pageSize)
  return (
    <nav className="pager" aria-label={tr('Navigasi halaman')}>
      <span className="pager-info">
        <span aria-live="polite">
          {formatNumber(from)}–{formatNumber(to)}{' '}{tr('dari')}{' '}{formatNumber(total)}{' '}{tr('baris')}
        </span>
        {pageSizes && onPageSize && (
          <label className="pager-size">
            {tr('Baris per halaman')}
            <select className="select select--sm" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
              {pageSizes.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </span>
      {pages > 1 && (
        <div>
          <Button size="sm" iconOnly icon={<ChevronsLeft size={14} />} onClick={() => onPage(1)} disabled={page <= 1 || busy} aria-label={tr('Halaman pertama')} />
          <Button size="sm" iconOnly icon={<ChevronLeft size={14} />} onClick={() => onPage(page - 1)} disabled={page <= 1 || busy} aria-label={tr('Halaman sebelumnya')} />
          {onPageSize ? (
            pageWindow(page, pages).map((p, i) =>
              p == null ? (
                <span key={`gap-${i}`} className="pager-gap" aria-hidden>…</span>
              ) : (
                <Button key={p} size="sm" className="pager-num" variant={p === page ? 'primary' : 'default'} onClick={() => onPage(p)} disabled={busy} aria-label={tr('Halaman {0}', p)} aria-current={p === page ? 'page' : undefined}>
                  {formatNumber(p)}
                </Button>
              ),
            )
          ) : (
            <span className="num">
              {tr('Hal.')}{' '}{formatNumber(page)} / {formatNumber(pages)}
            </span>
          )}
          <Button size="sm" iconOnly icon={<ChevronRight size={14} />} onClick={() => onPage(page + 1)} disabled={page >= pages || busy} aria-label={tr('Halaman berikutnya')} />
          <Button size="sm" iconOnly icon={<ChevronsRight size={14} />} onClick={() => onPage(pages)} disabled={page >= pages || busy} aria-label={tr('Halaman terakhir')} />
        </div>
      )}
    </nav>
  )
}
