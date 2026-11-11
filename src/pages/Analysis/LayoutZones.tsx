import { useState, type DragEvent } from 'react'
import { Rows3 } from 'lucide-react'
import { dragHasKind, readFieldDrag } from '@/components/fields/dnd'
import { FieldChip } from '@/components/fields/FieldChip'
import { toast } from '@/stores/uiStore'
import { useAnalysisStore, type Zone } from '@/stores/analysisStore'
import type { Field, FieldKind } from '@/types/contracts'
import type { Engine } from '@/semantic/measureEngine'
import { CollapseToggle } from './CollapseToggle'
import { MeasureZone } from './MeasureZone'
import s from './Analysis.module.css'
import { tr } from '@/i18n'

/** Index to insert at, from the pointer position relative to the chips in the zone. */
function dropIndex(e: DragEvent<HTMLElement>): number | undefined {
  const chips = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-chip-index]')]
  for (const c of chips) {
    const r = c.getBoundingClientRect()
    if (e.clientY < r.top) return Number(c.dataset.chipIndex)
    if (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2) return Number(c.dataset.chipIndex)
  }
  return undefined
}

function DropZone({ zone, kind, title, hint, icon, fields }: { zone: Zone; kind: FieldKind; title: string; hint: string; icon: React.ReactNode; fields: Map<string, Field> }) {
  const list = useAnalysisStore((st) => st[zone])
  const placeField = useAnalysisStore((st) => st.placeField)
  const removeField = useAnalysisStore((st) => st.removeField)
  const [over, setOver] = useState(false)

  const onDragOver = (e: DragEvent<HTMLElement>) => {
    if (!dragHasKind(e, kind)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOver(true)
  }
  const onDrop = (e: DragEvent<HTMLElement>) => {
    setOver(false)
    const p = readFieldDrag(e)
    if (!p) return
    e.preventDefault()
    if (p.kind !== kind) {
      toast(tr('{0} adalah {1}, letakkan di area yang sesuai.', fields.get(p.fieldId)?.label ?? tr('Field'), p.kind === 'measure' ? 'measure' : 'dimensi'))
      return
    }
    placeField(p.fieldId, zone, dropIndex(e))
  }

  const placed = list.map((id) => fields.get(id)).filter((f): f is Field => !!f)
  return (
    <div
      className={`${s.zone}${over ? ` ${s.over}` : ''}`}
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={onDrop}
      role="group"
      aria-label={`${title}: ${placed.map((f) => f.label).join(', ') || 'kosong'}`}
    >
      <div className={s.zoneTitle}>
        {icon}
        {title} <small>{hint}</small>
      </div>
      <div className={s.zoneList}>
        {placed.map((f, i) => (
          <FieldChip key={f.id} field={f} zone={zone} index={i} count={placed.length} onRemove={() => removeField(f.id)} onMove={(to) => placeField(f.id, zone, to)} />
        ))}
        {!placed.length && <div className={s.ph}>{tr('Tarik')}{' '}{kind === 'measure' ? tr('measure') : tr('dimensi')}{' '}{tr('ke sini')}</div>}
      </div>
    </div>
  )
}

export function LayoutZones({ fields, engine }: { fields: Field[]; engine: Engine | null }) {
  const map = new Map(fields.map((f) => [f.id, f]))
  return (
    <section className={`card ${s.lay}`} aria-labelledby="lay-title">
      <div className={s.layHead}>
        <h2 id="lay-title" className="t-section">
          {tr('Layout')}{' '}<span>{tr('(Drag & Drop)')}</span>
        </h2>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className="t-meta">{tr('Urutan dimensi menentukan hierarki tabel · Alt+←/→ untuk mengurutkan')}</span>
          <CollapseToggle panel="layout" label={tr('Layout (Drag & Drop)')} controls="panel-layout" direction="right" />
        </span>
      </div>
      <div className={s.layGrid}>
        <DropZone zone="dimensions" kind="dimension" title={tr('Dimensi')} hint={tr('(baris)')} icon={<Rows3 size={14} aria-hidden />} fields={map} />
        <MeasureZone fields={map} engine={engine} />
      </div>
    </section>
  )
}
