import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { SearchInput } from '@/components/forms/SearchInput'
import { ErrorState, Skeleton } from '@/components/common/StateView'
import type { LoadStatus } from '@/components/charts/ChartContainer'
import s from '../Analysis.module.css'
import { LOCALE, tr } from '@/i18n'

export interface PickerItem {
  id: string
  title: string
  meta: ReactNode
  /** Shown next to the title (status, plate number). */
  tag?: ReactNode
}

/** Left column of a profile report: search and the records of the chosen unit. */
export function ProfilePicker({
  label,
  q,
  onQ,
  placeholder,
  items,
  more,
  status,
  error,
  onRetry,
  selected,
  onSelect,
}: {
  label: string
  q: string
  onQ: (v: string) => void
  placeholder: string
  items: PickerItem[] | null
  more: boolean
  status: LoadStatus
  error: string | null
  onRetry: () => void
  selected: string
  onSelect: (id: string) => void
}) {
  return (
    <div className={s.picker}>
      <SearchInput value={q} onChange={onQ} placeholder={placeholder} label={tr('Cari {0}', label.toLowerCase())} />
      {items && <p className={s.pickCount}>{items.length.toLocaleString(LOCALE)} {label.toLowerCase()}</p>}
      <div className={s.pickList} role="listbox" aria-label={tr('Daftar {0}', label.toLowerCase())} aria-busy={status === 'loading'}>
        {status === 'error' && !items ? (
          <ErrorState message={error ?? tr('')} onRetry={onRetry} />
        ) : !items ? (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={38} />)
        ) : items.length === 0 ? (
          <p className={s.pickNone}>{tr('Tidak ada')}{' '}{label.toLowerCase()}{' '}{tr('yang cocok di kebun ini. Ubah kata kunci.')}</p>
        ) : (
          items.map((it) => (
            <button key={it.id} type="button" role="option" aria-selected={it.id === selected} className={s.pickItem} onClick={() => onSelect(it.id)}>
              <span>
                <span className={s.pickTitle}>
                  <b>{it.title}</b>
                  {it.tag}
                </span>
                <small>{it.meta}</small>
              </span>
              <ChevronRight size={14} aria-hidden />
            </button>
          ))
        )}
      </div>
      {items && more && <p className="t-meta">{tr('Daftar dipotong. Persempit dengan kata kunci.')}</p>}
    </div>
  )
}
