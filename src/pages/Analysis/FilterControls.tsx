import { useId, useState, type ReactNode } from 'react'
import { CalendarCheck, CalendarRange, X } from 'lucide-react'
import { MultiSelect } from '@/components/forms/MultiSelect'
import { SearchableSelect } from '@/components/forms/SearchableSelect'
import type { DataScope, Dataset, Filter } from '@/types/contracts'
import { useFieldValues } from './useFieldValues'
import { activeFields, filterText, isActiveFilter, type FieldFilterValue } from './fieldFilter'
import s from './Analysis.module.css'
import { tr } from '@/i18n'

interface Props {
  dataset: Dataset
  filter: Filter
  scope: DataScope
  onDates: (from: string, to: string) => void
  /** Tanggal laporan of the H.I / S.D.H.I / YTD columns; null = automatic (end of the period, at most today). */
  onReportDate?: (date: string | null) => void
  onField: (field: string, value: FieldFilterValue) => void
  onClearScope: (field: string) => void
  /** Multi-value fields (value lists that limit the data). */
  scopeFields?: string[]
  onToggleScope?: (field: string, value: string) => void
}

/**
 * The controls of the filter modal (Analisis and saved reports; the modal has its own title and buttons): the period,
 * the value lists, the single-value filters in titled sections, and a summary of what is applied. Every list opens as
 * a searchable dropdown with a fixed, scrolling height. Invalid date ranges are flagged, not applied.
 */
export function FilterControls({ dataset, filter, scope, onDates, onReportDate, onField, onClearScope, scopeFields = [], onToggleScope }: Props) {
  const dateId = useId()
  const reportId = useId()
  const [draft, setDraft] = useState({ from: filter.dateFrom, to: filter.dateTo })
  const invalid = !draft.from || !draft.to || draft.from > draft.to
  const labelOf = (k: string) => dataset.fields.find((f) => f.id === k)?.label ?? k

  const setDate = (k: 'from' | 'to', v: string) => {
    const next = { ...draft, [k]: v }
    setDraft(next)
    if (next.from && next.to && next.from <= next.to) onDates(next.from, next.to)
  }
  const activeScope = Object.keys(scope).filter((k) => scope[k]?.length)
  const active = activeFields(filter.fields)
  const count = activeScope.length + active.length

  const lists = scopeFields.map((f) => (
    <ScopeSelect key={f} dataset={dataset} field={f} label={labelOf(f)} value={scope[f] ?? []} onToggle={(v) => onToggleScope?.(f, v)} onClear={() => onClearScope(f)} />
  ))
  // A field offered both ways is shown once, as the list (it also covers one value); a single value already set on it
  // (e.g. saved in a report) keeps its control so it can still be seen and changed.
  const singles = (dataset.filterFields ?? []).filter((f) => !scopeFields.includes(f) || isActiveFilter(filter.fields?.[f])).map((f) => (
    <FieldFilter key={f} dataset={dataset} field={f} label={labelOf(f)} value={filter.fields?.[f] ?? null} onChange={(v) => onField(f, v)} />
  ))
  // Titled sections, so a field that is offered both ways is not confusing.
  const section = (title: string, hint: string, children: ReactNode) => (
    <fieldset className={s.fbSection}>
      <legend>
        {title} <small>{hint}</small>
      </legend>
      <div className={s.fbGrid}>{children}</div>
    </fieldset>
  )

  return (
    <section className={s.fb} aria-label={tr('Filter')}>
      <div className={s.fbGrid}>
        <div className={`field ${s.dates}`} role="group" aria-labelledby={dateId}>
          <span id={dateId} className="t-label">
            <CalendarRange size={13} aria-hidden /> {tr('Periode')}
          </span>
          <div className={s.dateRow}>
            <input type="date" className="input" value={draft.from} min={dataset.coverage?.from} max={dataset.coverage?.to} onChange={(e) => setDate('from', e.target.value)} aria-label={tr('Tanggal mulai')} aria-invalid={invalid} />
            <span aria-hidden className={s.dateSep}>–</span>
            <input type="date" className="input" value={draft.to} min={dataset.coverage?.from} max={dataset.coverage?.to} onChange={(e) => setDate('to', e.target.value)} aria-label={tr('Tanggal akhir')} aria-invalid={invalid} />
          </div>
        </div>
        {onReportDate && (
          <div className={`field ${s.dates}`} role="group" aria-labelledby={reportId}>
            <span id={reportId} className="t-label">
              <CalendarCheck size={13} aria-hidden /> {tr('Tanggal laporan')}
            </span>
            <div className={s.dateRow}>
              <input type="date" className="input" value={filter.reportDate ?? ''} min={dataset.coverage?.from} max={dataset.coverage?.to} onChange={(e) => onReportDate(e.target.value || null)} aria-label={tr('Tanggal laporan')} aria-describedby={`${reportId}-hint`} />
              {filter.reportDate && (
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => onReportDate(null)}>
                  {tr('Otomatis')}
                </button>
              )}
            </div>
            <small id={`${reportId}-hint`} className="t-meta">
              {filter.reportDate ? tr('Kolom H.I = tanggal ini, S.D.H.I = tanggal 1 bulan itu s.d. tanggal ini.') : tr('Otomatis: tanggal akhir periode, paling lambat hari ini. Dipakai kolom H.I dan S.D.H.I.')}
            </small>
          </div>
        )}
      </div>
      {lists.length > 0 && section(tr('Batasan data'), tr('boleh pilih beberapa nilai'), lists)}
      {singles.length > 0 && section(tr('Filter nilai'), tr('satu nilai per field'), singles)}

      {invalid && (
        <span className="field-error" role="alert">
          {tr('Tanggal mulai harus sebelum tanggal akhir. Filter tanggal sebelumnya masih dipakai.')}
        </span>
      )}

      <div className={s.chips}>
        <span>{tr('Data aktif:')}</span>
        <span className="chip">{tr('Dataset:')}{' '}{dataset.label}</span>
        {activeScope.map((k) => (
          <span key={`s-${k}`} className="chip chip--live" title={scope[k]!.join(', ')}>
            <span className={s.chipText}>{labelOf(k)}: {scope[k]!.join(', ')}</span>
            <button type="button" className="chip-x" onClick={() => onClearScope(k)} aria-label={tr('Hapus batasan {0}', labelOf(k))}>
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        {active.map(([k, v]) => (
          <span key={`f-${k}`} className="chip chip--live" title={filterText(v)}>
            <span className={s.chipText}>{labelOf(k)}: {filterText(v)}</span>
            <button type="button" className="chip-x" onClick={() => onField(k, null)} aria-label={tr('Hapus filter {0}', labelOf(k))}>
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        {!count && <span>{tr('seluruh data sumber')}</span>}
      </div>
    </section>
  )
}

/**
 * Value filter: a searchable dropdown (one value; the first entry means every value) or, instead, "contains" text
 * (e.g. every unit code with "DT-0"). A list kept from a saved report shows as its values.
 */
function FieldFilter({ dataset, field, label, value, onChange }: { dataset: Dataset; field: string; label: string; value: FieldFilterValue; onChange: (v: FieldFilterValue) => void }) {
  const vals = useFieldValues(dataset.id, field)
  const list = vals.data?.values ?? []
  const all = tr('Semua {0}', label.toLowerCase())
  const like = value && typeof value === 'object' && !Array.isArray(value) ? value.like : ''
  const one = typeof value === 'string' ? value : Array.isArray(value) && value.length === 1 ? value[0]! : ''
  return (
    <div className={s.fbCtl}>
    <SearchableSelect
      label={label}
      value={one}
      active={!!one || (Array.isArray(value) && value.length > 1)}
      disabled={!vals.data}
      onChange={(v) => onChange(v || null)}
      placeholder={vals.status === 'error' ? tr('Nilai tidak dapat dimuat') : vals.data ? all : tr('Memuat…')}
      searchPlaceholder={tr('Cari {0}…', label.toLowerCase())}
      options={[{ value: '', label: Array.isArray(value) && value.length > 1 ? filterText(value) : all }, ...list.map((v) => ({ value: v, label: v }))]}
    />
    <input
      type="search"
      className="input"
      style={{ marginTop: 4, height: 30 }}
      value={like}
      maxLength={100}
      placeholder={tr('atau berisi teks…')}
      aria-label={tr('{0} berisi teks', label)}
      onChange={(e) => onChange(e.target.value.trim() ? { like: e.target.value } : null)}
    />
    </div>
  )
}

/** Multi-value filter: a dropdown checklist; nothing checked means every value. */
function ScopeSelect({ dataset, field, label, value, onToggle, onClear }: { dataset: Dataset; field: string; label: string; value: string[]; onToggle: (v: string) => void; onClear: () => void }) {
  const vals = useFieldValues(dataset.id, field)
  return (
    <MultiSelect
      className={s.fbCtl}
      label={label}
      options={vals.data?.values ?? null}
      selected={value}
      onToggle={onToggle}
      onClear={onClear}
      allLabel={tr('Semua {0}', label.toLowerCase())}
      error={vals.status === 'error' && !vals.data ? tr('Nilai tidak dapat dimuat.') : null}
      onRetry={vals.reload}
      note={vals.data?.truncated ? tr('Hanya {0} nilai pertama yang ditampilkan.', vals.data.values.length) : null}
    />
  )
}
