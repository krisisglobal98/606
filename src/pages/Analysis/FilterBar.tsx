import { Filter as FilterIcon, SlidersHorizontal, X } from 'lucide-react'
import { EdgeTab } from '@/components/common/EdgeTab'
import { useAnalysisStore } from '@/stores/analysisStore'
import type { Dataset } from '@/types/contracts'
import { formatDate } from '@/utils/format'
import { FilterModal, activeFilterCount } from './FilterModal'
import s from './Analysis.module.css'
import { tr } from '@/i18n'

/**
 * The Analysis page's filters work as on saved reports: a vertical "Filter" tab in the left column (with the number
 * of active filters) opens the filter modal, where Terapkan applies everything at once.
 */
export function FilterTab({ onOpen }: { onOpen: () => void }) {
  const count = useAnalysisStore((st) => activeFilterCount({ filter: st.filter, scope: st.scope }))
  return <EdgeTab label={tr('Filter')} icon={<SlidersHorizontal size={16} aria-hidden />} onClick={onOpen} dialog badge={count} on={count > 0} />
}

/** The page's filter modal over the store: Terapkan sets period, value filters and lists in one change. */
export function AnalysisFilterModal({ dataset, onClose }: { dataset: Dataset; onClose: () => void }) {
  const filter = useAnalysisStore((st) => st.filter)
  const scope = useAnalysisStore((st) => st.scope)
  const applyFilters = useAnalysisStore((st) => st.applyFilters)
  return <FilterModal dataset={dataset} subtitle={dataset.label} filter={filter} scope={scope} onApply={applyFilters} onClose={onClose} />
}

/** One line over the results: the period and the active filters (each removable), with a link to the modal. */
export function FilterSummary({ dataset, onOpen }: { dataset: Dataset; onOpen: () => void }) {
  const filter = useAnalysisStore((st) => st.filter)
  const scope = useAnalysisStore((st) => st.scope)
  const setFieldFilter = useAnalysisStore((st) => st.setFieldFilter)
  const clearScope = useAnalysisStore((st) => st.clearScope)
  const labelOf = (k: string) => dataset.fields.find((f) => f.id === k)?.label ?? k
  const fields = Object.entries(filter.fields ?? {}).filter((e): e is [string, string] => !!e[1])
  const lists = Object.keys(scope).filter((k) => scope[k]?.length)
  return (
    <div className={s.fSum} aria-label={tr('Filter aktif')}>
      <FilterIcon size={13} aria-hidden />
      <span className={s.fSumPeriod}>{formatDate(filter.dateFrom)} – {formatDate(filter.dateTo)}</span>
      {lists.map((k) => (
        <span key={`s-${k}`} className="chip chip--live" title={scope[k]!.join(', ')}>
          <span className={s.chipText}>{labelOf(k)}: {scope[k]!.length > 2 ? tr('{0} dipilih', scope[k]!.length) : scope[k]!.join(', ')}</span>
          <button type="button" className="chip-x" onClick={() => clearScope(k)} aria-label={tr('Hapus batasan {0}', labelOf(k))}><X size={12} aria-hidden /></button>
        </span>
      ))}
      {fields.map(([k, v]) => (
        <span key={`f-${k}`} className="chip chip--live" title={v}>
          <span className={s.chipText}>{labelOf(k)}: {v}</span>
          <button type="button" className="chip-x" onClick={() => setFieldFilter(k, null)} aria-label={tr('Hapus filter {0}', labelOf(k))}><X size={12} aria-hidden /></button>
        </span>
      ))}
      <button type="button" className={s.fSumLink} onClick={onOpen}>{tr('Ubah filter')}</button>
    </div>
  )
}
