import { useMemo, useState, type DragEvent } from 'react'
import { ChevronDown, ChevronRight, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { dragFromZone, readFieldDrag } from '@/components/fields/dnd'
import { FieldItem } from '@/components/fields/FieldItem'
import { useAnalysisStore, zoneFor } from '@/stores/analysisStore'
import type { Category } from '@/semantic/measureEngine'
import type { Field } from '@/types/contracts'
import { CollapseToggle } from './CollapseToggle'
import s from './Analysis.module.css'
import { tr } from '@/i18n'

/** Searchable, always-visible list of dimensions and measures. Dropping a placed chip here removes it. */
interface Props {
  fields: Field[]
  /** Measure category from the semantic engine: raw, derived (built-in) or calculated (custom formula). */
  category?: (id: string) => Category
  onAddCalc?: () => void
  onEditCalc?: (id: string) => void
  onRemoveCalc?: (id: string) => void
}

const CATEGORY_TITLE: Record<Category, string> = { raw: tr('Raw'), derived: tr('Derived'), calculated: tr('Calculated') }

export function FieldList({ fields, category, onAddCalc, onEditCalc, onRemoveCalc }: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState({ dimension: true, measure: true })
  const [over, setOver] = useState(false)
  const dims = useAnalysisStore((st) => st.dimensions)
  const meas = useAnalysisStore((st) => st.measures)
  const placeField = useAnalysisStore((st) => st.placeField)
  const removeField = useAnalysisStore((st) => st.removeField)

  const used = (f: Field) => dims.includes(f.id) || meas.includes(f.id)
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? fields.filter((f) => f.label.toLowerCase().includes(t) || f.id.toLowerCase().includes(t)) : fields
  }, [fields, q])

  const onDragOver = (e: DragEvent) => {
    if (!dragFromZone(e)) return
    e.preventDefault()
    setOver(true)
  }
  const onDrop = (e: DragEvent) => {
    setOver(false)
    const p = readFieldDrag(e)
    if (p && p.from !== 'list') {
      e.preventDefault()
      removeField(p.fieldId)
    }
  }

  const group = (kind: Field['kind'], title: string) => {
    const list = filtered.filter((f) => f.kind === kind)
    return (
      <div>
        <button type="button" className={s.grp} onClick={() => setOpen((o) => ({ ...o, [kind]: !o[kind] }))} aria-expanded={open[kind]}>
          {open[kind] ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          <span>{title}</span>
          <small>{list.length}</small>
        </button>
        {open[kind] && kind === 'measure' && category ? (
          // Measures in three categories: warehouse values, built-in semantic measures, custom formulas.
          (['raw', 'derived', 'calculated'] as Category[]).map((c) => {
            const items = list.filter((f) => category(f.id) === c)
            return (
              <div key={c} className={s.flCat}>
                <span className={s.flCatHead}>
                  {CATEGORY_TITLE[c]}
                  {c === 'calculated' && onAddCalc && (
                    <button type="button" className={s.flAdd} onClick={onAddCalc}>
                      <Plus size={12} aria-hidden />{' '}{tr('Tambah')}
                    </button>
                  )}
                </span>
                <div className={s.flList}>
                  {items.map((f) =>
                    c === 'calculated' ? (
                      <div key={f.id} className={s.flCalc}>
                        <FieldItem field={f} used={used(f)} onToggle={() => (used(f) ? removeField(f.id) : placeField(f.id, 'measures'))} />
                        <button type="button" className="icon-btn" onClick={() => onEditCalc?.(f.id)} aria-label={tr('Ubah {0}', f.label)}>
                          <Pencil size={12} />
                        </button>
                        <button type="button" className="icon-btn" onClick={() => onRemoveCalc?.(f.id)} aria-label={tr('Hapus {0}', f.label)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ) : (
                      <FieldItem key={f.id} field={f} used={used(f)} onToggle={() => (used(f) ? removeField(f.id) : placeField(f.id, zoneFor(f.kind)))} />
                    ),
                  )}
                  {!items.length && <span className={s.ph}>{c === 'calculated' ? tr('Belum ada. Buat formula sendiri bila perlu.') : tr('Tidak ada yang cocok.')}</span>}
                </div>
              </div>
            )
          })
        ) : open[kind] ? (
          <div className={s.flList}>
            {list.map((f) => (
              <FieldItem key={f.id} field={f} used={used(f)} onToggle={() => (used(f) ? removeField(f.id) : placeField(f.id, zoneFor(f.kind)))} />
            ))}
            {!list.length && <span className={s.ph}>{tr('Tidak ada yang cocok.')}</span>}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <section
      className={`card ${s.fl} ${s.sideCard}${over ? ` ${s.flDrop}` : ''}`}
      aria-labelledby="fl-title"
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={onDrop}
    >
      <div className={s.flHead}>
        <b id="fl-title">{tr('Field List')}</b>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span className="t-meta">{fields.length}{' '}{tr('field')}</span>
          <CollapseToggle panel="fields" label={tr('Field List')} controls="panel-fields" direction="right" />
        </span>
      </div>
      <div className={`input-wrap ${s.search}`}>
        <Search size={14} aria-hidden />
        <input className="input" type="search" placeholder={tr('Cari field…')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr('Cari field')} />
        {q && (
          <span className="input-action">
            <button type="button" className="icon-btn" onClick={() => setQ('')} aria-label={tr('Hapus pencarian')}>
              <X size={13} />
            </button>
          </span>
        )}
      </div>
      {/* Title and search stay in place; the lists scroll inside the card. */}
      <div className={s.sideBody}>
        {group('dimension', tr('Dimensi'))}
        {group('measure', tr('Measure'))}
      </div>
      <p className={s.flHint}>{tr('Tarik field ke area Dimensi atau Measure, atau klik untuk menambah/menghapus. Tarik chip ke sini untuk melepasnya.')}</p>
    </section>
  )
}
