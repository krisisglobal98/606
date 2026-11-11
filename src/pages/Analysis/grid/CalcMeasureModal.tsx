import { useState } from 'react'
import { Button } from '@/components/common/Button'
import { Modal } from '@/components/common/Modal'
import { CALC_PREFIX, parseFormula, type CalcMeasure, type Engine } from '@/semantic/measureEngine'
import g from './PivotGrid.module.css'
import { tr } from '@/i18n'

const FORMATS = [
  { id: '0', label: tr('#,##0'), decimals: 0, percent: false },
  { id: '1', label: tr('#,##0.0'), decimals: 1, percent: false },
  { id: '2', label: tr('#,##0.00'), decimals: 2, percent: false },
  { id: 'p', label: tr('0.0 %  (nilai × 100)'), decimals: 1, percent: true },
]

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'kpi'

/**
 * Advanced: a user-defined measure from a formula over existing measures, e.g. "Produksi / Luas".
 * Common analytics (Growth, Achievement, Variance, Contribution) are built in and need no formula.
 * The formula is evaluated per row on aggregated values, so it stays correct at every level.
 */
export function CalcMeasureModal({ engine, existing, initial, onSave, onClose }: { engine: Engine; existing: CalcMeasure[]; initial: CalcMeasure | null; onSave: (m: CalcMeasure) => void; onClose: () => void }) {
  const [label, setLabel] = useState(initial?.label ?? '')
  const [formula, setFormula] = useState(initial?.formula ?? '')
  const [format, setFormat] = useState(initial ? (initial.percent ? 'p' : String(initial.decimals)) : '2')
  const [unit, setUnit] = useState(initial?.unit ?? '')
  const names = engine.list.filter((d) => d.category !== 'calculated' && !d.id.startsWith('dx:')).map((d) => ({ id: d.id, label: d.label }))
  const parsed = formula.trim() ? parseFormula(formula, names) : null
  const id = initial?.id ?? `${CALC_PREFIX}${slug(label)}`
  const clash = !initial && (existing.some((x) => x.id === id) || engine.defs.has(id))
  const nameOk = label.trim().length >= 2 && !clash
  const fmt = FORMATS.find((f) => f.id === format) ?? FORMATS[2]!
  const insert = (name: string) => setFormula((f) => `${f}${f && !/[\s(]$/.test(f) ? ' ' : ''}${/[^\p{L}\p{N}_ ]/u.test(name) ? `[${name}]` : name}`)

  return (
    <Modal
      title={initial ? tr('Ubah Calculated Measure') : tr('Tambah Calculated Measure')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{tr('Batal')}</Button>
          <Button variant="primary" disabled={!nameOk || !parsed?.ok} onClick={() => onSave({ id, label: label.trim(), formula: formula.trim(), decimals: fmt.decimals, percent: fmt.percent, unit: fmt.percent ? '%' : unit.trim() })}>
            {tr('Simpan')}
          </Button>
        </>
      }
    >
      <div className={g.calcForm}>
        <label className="field">
          <span className="t-label">{tr('Nama')}</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={tr('Produktivitas')} aria-invalid={!!label && !nameOk} />
          {clash && <span className="field-error">{tr('Nama ini sudah dipakai.')}</span>}
        </label>
        <label className="field">
          <span className="t-label">{tr('Formula')}</span>
          <input className="input" value={formula} onChange={(e) => setFormula(e.target.value)} placeholder={tr('Produksi / Luas')} aria-invalid={parsed?.ok === false} spellCheck={false} />
          {parsed?.ok === false && <span className="field-error">{parsed.error}</span>}
          {parsed?.ok && <span className="t-meta">{tr('Dihitung per baris dari nilai yang sudah diagregasi (bukan rata-rata rasio).')}</span>}
        </label>
        <div>
          <span className="t-label">{tr('Measure yang bisa dipakai')}</span>
          <div className={g.nameChips}>
            {names.map((n) => (
              <button key={n.id} type="button" className="chip" onClick={() => insert(n.label)}>
                {n.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: '1 1 160px' }}>
            <span className="t-label">{tr('Format')}</span>
            <select className="select" value={format} onChange={(e) => setFormat(e.target.value)}>
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {!fmt.percent && (
            <label className="field" style={{ flex: '1 1 120px' }}>
              <span className="t-label">{tr('Satuan (opsional)')}</span>
              <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={tr('Ton/Ha')} />
            </label>
          )}
        </div>
      </div>
    </Modal>
  )
}
