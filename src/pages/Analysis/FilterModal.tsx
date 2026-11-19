import { useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Modal } from '@/components/common/Modal'
import type { DataScope, Dataset, Filter } from '@/types/contracts'
import { FilterControls } from './FilterControls'
import { tr } from '@/i18n'

type State = { filter: Filter; scope: DataScope }

/** Compares filters by meaning: an empty field filter or an empty value list equals none. */
export function normalized({ filter, scope }: State) {
  const fields = Object.fromEntries(Object.entries(filter.fields ?? {}).filter(([, v]) => !!v).sort(([a], [b]) => a.localeCompare(b)))
  const sc = Object.fromEntries(Object.entries(scope).filter(([, v]) => v?.length).map(([k, v]) => [k, [...v!].sort()] as const).sort(([a], [b]) => a.localeCompare(b)))
  return JSON.stringify([filter.dateFrom, filter.dateTo, fields, sc])
}
const same = (a: State, b: State) => normalized(a) === normalized(b)

/** Number of active value filters (single-value fields and multi-value lists; the period is always set). */
export const activeFilterCount = ({ filter, scope }: State) => Object.values(filter.fields ?? {}).filter(Boolean).length + Object.values(scope).filter((v) => v?.length).length

interface Props {
  dataset: Dataset
  /** Shown under the title (the report or dataset name). */
  subtitle: string
  filter: Filter
  scope: DataScope
  /** Saved reports: the filters the report was saved with ("Kembalikan filter laporan"). Analisis: none. */
  saved?: State
  onApply: (filter: Filter, scope: DataScope) => void
  onClose: () => void
}

/**
 * Filters in a modal (Analisis and saved reports): period, single-value filters and multi-value lists. Changes are a
 * draft until Terapkan, so many filters can be set with one query; Batal (or Escape) leaves the applied ones alone.
 */
export function FilterModal({ dataset, subtitle, filter, scope, saved, onApply, onClose }: Props) {
  const [draft, setDraft] = useState<State>({ filter, scope })
  // Remounts the date inputs when the draft is reset.
  const [resets, setResets] = useState(0)
  const dirty = !same(draft, { filter, scope })
  // Without saved filters, the reset clears every value filter and keeps the period (it is required).
  const target: State = saved ?? { filter: { ...draft.filter, fields: {} }, scope: {} }
  const canReset = saved ? !same(draft, saved) : activeFilterCount(draft) > 0
  const toggleScope = (field: string, value: string) =>
    setDraft((d) => {
      const cur = d.scope[field] ?? []
      return { ...d, scope: { ...d.scope, [field]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] } }
    })
  const reset = () => {
    setDraft(target)
    setResets((n) => n + 1)
  }
  return (
    <Modal
      size="lg"
      title={saved ? tr('Filter laporan') : tr('Filter')}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <Button icon={saved ? <RotateCcw size={14} aria-hidden /> : <X size={14} aria-hidden />} variant="ghost" onClick={reset} disabled={!canReset} style={{ marginRight: 'auto' }}>
            {saved ? tr('Kembalikan filter laporan') : tr('Hapus semua filter')}
          </Button>
          <Button onClick={onClose}>{tr('Batal')}</Button>
          <Button variant="primary" onClick={() => (onApply(draft.filter, draft.scope), onClose())} disabled={!dirty}>
            {tr('Terapkan')}
          </Button>
        </>
      }
    >
      <FilterControls
        key={resets}
        dataset={dataset}
        filter={draft.filter}
        scope={draft.scope}
        onDates={(dateFrom, dateTo) => setDraft((d) => ({ ...d, filter: { ...d.filter, dateFrom, dateTo } }))}
        onReportDate={(reportDate) => setDraft((d) => ({ ...d, filter: { ...d.filter, reportDate } }))}
        onField={(dim, value) => setDraft((d) => ({ ...d, filter: { ...d.filter, fields: { ...d.filter.fields, [dim]: value } } }))}
        onClearScope={(field) => setDraft((d) => ({ ...d, scope: { ...d.scope, [field]: [] } }))}
        scopeFields={dataset.scopeFields ?? []}
        onToggleScope={toggleScope}
      />
    </Modal>
  )
}
