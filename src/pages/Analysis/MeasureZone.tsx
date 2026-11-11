import { useState, type DragEvent } from 'react'
import { ArrowDown, ArrowUp, Columns3, FolderPlus, GripVertical, MoreVertical, RotateCcw, Trash2 } from 'lucide-react'
import { Dropdown } from '@/components/common/Dropdown'
import { dragHasKind, readFieldDrag } from '@/components/fields/dnd'
import { FieldChip } from '@/components/fields/FieldChip'
import { DISPLAY_CALC, type DisplayCalc, type Engine } from '@/semantic/measureEngine'
import { useAnalysisStore } from '@/stores/analysisStore'
import { toast } from '@/stores/uiStore'
import type { Field } from '@/types/contracts'
import s from './Analysis.module.css'
import { tr } from '@/i18n'

const MIME_GROUP = 'application/x-dod-mgroup'

/** Insert position from the pointer, among the direct items of a container marked with `attr`. */
function indexAt(e: DragEvent<HTMLElement>, attr: string): number | undefined {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(`:scope > [${attr}]`)]
  for (const c of items) {
    const r = c.getBoundingClientRect()
    if (e.clientY < r.top) return Number(c.getAttribute(attr))
    if (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2) return Number(c.getAttribute(attr))
  }
  return undefined
}

/**
 * Measures area of the Layout. Measures can stand alone or sit in user-defined Measure Groups; each
 * measure can show one or more display calculations. This is the single source of the table's
 * column structure; with no groups and no settings the table shows the raw dataset values.
 */
export function MeasureZone({ fields, engine }: { fields: Map<string, Field>; engine: Engine | null }) {
  const layout = useAnalysisStore((st) => st.measureLayout)
  const settings = useAnalysisStore((st) => st.measureSettings)
  const moveMeasure = useAnalysisStore((st) => st.moveMeasure)
  const moveMeasureBlock = useAnalysisStore((st) => st.moveMeasureBlock)
  const addMeasureGroup = useAnalysisStore((st) => st.addMeasureGroup)
  const resetMeasureConfig = useAnalysisStore((st) => st.resetMeasureConfig)
  const removeField = useAnalysisStore((st) => st.removeField)
  const [over, setOver] = useState<string | null>(null)
  const configured = layout.some((b) => b.kind === 'group') || Object.keys(settings).length > 0

  /** Drop on a container: a measure from the Field List or the Layout, or (top level) a group. */
  const drop = (group: string | null) => (e: DragEvent<HTMLElement>) => {
    const isGroup = e.dataTransfer.types.includes(MIME_GROUP)
    if (isGroup && group != null) return
    e.stopPropagation()
    setOver(null)
    if (isGroup) {
      e.preventDefault()
      const id = e.dataTransfer.getData(MIME_GROUP)
      moveMeasureBlock(id, indexAt(e, 'data-block') ?? layout.length)
      return
    }
    const p = readFieldDrag(e)
    if (!p) return
    e.preventDefault()
    if (p.kind !== 'measure') {
      toast(tr('{0} adalah dimensi, letakkan di area Dimensi.', fields.get(p.fieldId)?.label ?? tr('Field')))
      return
    }
    moveMeasure(p.fieldId, group, indexAt(e, group ? 'data-chip-index' : 'data-block'))
  }
  const dragOver = (key: string, group: string | null) => (e: DragEvent<HTMLElement>) => {
    const ok = dragHasKind(e, 'measure') || (group == null && e.dataTransfer.types.includes(MIME_GROUP))
    if (!ok) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setOver(key)
  }

  const chip = (id: string, group: string | null, index: number, count: number, attr: Record<string, number>) => {
    const f = fields.get(id)
    if (!f) return null
    const set = settings[id]
    const shown = engine?.displays(id, set) ?? ['value']
    const note = set?.display && !(shown.length === 1 && shown[0] === 'value') ? shown.map((c) => DISPLAY_CALC.get(c)?.label).join(' · ') : undefined
    return (
      <div key={id} {...Object.fromEntries(Object.entries(attr).map(([k, v]) => [k, String(v)]))} className={s.mzItem}>
        <FieldChip
          field={f}
          zone="measures"
          index={index}
          count={count}
          label={set?.alias || undefined}
          note={note}
          onRemove={() => removeField(id)}
          onMove={(to) => moveMeasure(id, group, to)}
          menu={engine && <MeasureMenu id={id} field={f} engine={engine} />}
        />
      </div>
    )
  }

  return (
    <div
      className={`${s.zone}${over === 'root' ? ` ${s.over}` : ''}`}
      onDragOver={dragOver('root', null)}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
      onDrop={drop(null)}
      role="group"
      aria-label={tr('Measure')}
    >
      <div className={s.zoneTitle}>
        <Columns3 size={14} aria-hidden />
        {tr('Measure')}{' '}<small>{tr('(nilai)')}</small>
        <span className={s.mzActions}>
          <button type="button" className={s.mzBtn} onClick={() => addMeasureGroup(tr('Group {0}', layout.filter((b) => b.kind === 'group').length + 1))} title={tr('Kelompokkan measure di bawah satu header')}>
            <FolderPlus size={13} aria-hidden />{' '}{tr('Measure Group')}
          </button>
          {configured && (
            <button type="button" className={s.mzBtn} onClick={resetMeasureConfig} title={tr('Hapus semua group dan pengaturan kolom: kembali ke tampilan data mentah')}>
              <RotateCcw size={12} aria-hidden />{' '}{tr('Data mentah')}
            </button>
          )}
        </span>
      </div>
      <div className={s.mzList}>
        {layout.map((b, i) =>
          b.kind === 'measure' ? (
            chip(b.id, null, i, layout.length, { 'data-block': i })
          ) : (
            <div
              key={b.id}
              data-block={i}
              className={`${s.mGroup}${over === b.id ? ` ${s.over}` : ''}`}
              onDragOver={dragOver(b.id, b.id)}
              onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
              onDrop={drop(b.id)}
              role="group"
              aria-label={tr('Measure Group {0}', b.name)}
            >
              <GroupHead id={b.id} name={b.name} index={i} count={layout.length} />
              <div className={s.mGroupList}>
                {b.measures.map((m, j) => chip(m, b.id, j, b.measures.length, { 'data-chip-index': j }))}
                {!b.measures.length && <div className={s.ph}>{tr('Tarik measure ke group ini')}</div>}
              </div>
            </div>
          ),
        )}
        {!layout.length && <div className={s.ph}>{tr('Tarik measure ke sini')}</div>}
      </div>
    </div>
  )
}

function GroupHead({ id, name, index, count }: { id: string; name: string; index: number; count: number }) {
  const rename = useAnalysisStore((st) => st.renameMeasureGroup)
  const remove = useAnalysisStore((st) => st.removeMeasureGroup)
  const move = useAnalysisStore((st) => st.moveMeasureBlock)
  return (
    <div className={s.mGroupHead}>
      <span
        className={s.mGroupGrip}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(MIME_GROUP, id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        title={tr('Tarik untuk memindah group')}
      >
        <GripVertical size={13} aria-hidden />
      </span>
      <input className={s.mGroupName} value={name} onChange={(e) => rename(id, e.target.value)} aria-label={tr('Nama Measure Group')} placeholder={tr('Nama group')} />
      <button type="button" className="icon-btn" disabled={index === 0} onClick={() => move(id, index - 1)} aria-label={tr('Naikkan {0}', name)}>
        <ArrowUp size={12} />
      </button>
      <button type="button" className="icon-btn" disabled={index === count - 1} onClick={() => move(id, index + 2)} aria-label={tr('Turunkan {0}', name)}>
        <ArrowDown size={12} />
      </button>
      <button type="button" className="icon-btn" onClick={() => remove(id)} aria-label={tr('Hapus group {0} (measure tetap di Layout)', name)} title={tr('Hapus group (measure di dalamnya tetap ada)')}>
        <Trash2 size={12} />
      </button>
    </div>
  )
}

/** ⋮ on a measure: alias, display calculations (from the registry) and their order, number format. */
function MeasureMenu({ id, field, engine }: { id: string; field: Field; engine: Engine }) {
  const setting = useAnalysisStore((st) => st.measureSettings[id])
  const setMeasureSetting = useAnalysisStore((st) => st.setMeasureSetting)
  const options = engine.calcsFor(id)
  const shown = engine.displays(id, setting)
  const def = engine.defs.get(id)
  const setDisplay = (next: DisplayCalc[]) => setMeasureSetting(id, { display: next })
  const move = (c: DisplayCalc, d: -1 | 1) => {
    const i = shown.indexOf(c)
    const j = i + d
    if (j < 0 || j >= shown.length) return
    const next = [...shown]
    next[i] = next[j]!
    next[j] = c
    setDisplay(next)
  }
  return (
    <Dropdown
      align="right"
      trigger={({ open, toggle, id: menuId }) => (
        <button type="button" className={`icon-btn ${s.chipMenu}`} onClick={toggle} aria-haspopup="true" aria-expanded={open} aria-controls={menuId} aria-label={tr('Atur {0}', field.label)} title={tr('Atur kolom, alias, dan format')}>
          <MoreVertical size={13} />
        </button>
      )}
    >
      {() => (
        <div className={s.mMenu} onDragStart={(e) => e.stopPropagation()}>
          <div className="menu-head">{tr('Atur measure ·')}{' '}{field.label}</div>
          <label className={s.mMenuRow}>
            <span>{tr('Nama tampilan')}</span>
            <input className="input" value={setting?.alias ?? ''} placeholder={field.label} onChange={(e) => setMeasureSetting(id, { alias: e.target.value || undefined })} />
          </label>
          <div className={s.mMenuSub}>{tr('Kolom yang ditampilkan')}</div>
          {options.map((c) => {
            const on = shown.includes(c.id)
            return (
              <div key={c.id} className={`${s.mMenuCalc}${c.unavailable ? ` ${s.mMenuOff}` : ''}`} title={c.unavailable ?? c.description}>
                <label>
                  <input type="checkbox" checked={on} disabled={!!c.unavailable || (on && shown.length === 1)} onChange={() => setDisplay(on ? shown.filter((x) => x !== c.id) : [...shown, c.id])} />
                  {c.label}
                </label>
                {c.unavailable ? (
                  <small>{tr('belum tersedia')}</small>
                ) : on && shown.length > 1 ? (
                  <span>
                    <button type="button" className="icon-btn" onClick={() => move(c.id, -1)} disabled={shown.indexOf(c.id) === 0} aria-label={tr('Geser {0} ke kiri', c.label)}>
                      <ArrowUp size={11} />
                    </button>
                    <button type="button" className="icon-btn" onClick={() => move(c.id, 1)} disabled={shown.indexOf(c.id) === shown.length - 1} aria-label={tr('Geser {0} ke kanan', c.label)}>
                      <ArrowDown size={11} />
                    </button>
                  </span>
                ) : null}
              </div>
            )
          })}
          <div className={s.mMenuSub}>{tr('Format')}</div>
          <div className={s.mMenuFmt}>
            <label className={s.mMenuRow}>
              <span>{tr('Desimal')}</span>
              <select className="select select--sm" value={setting?.decimals ?? ''} onChange={(e) => setMeasureSetting(id, { decimals: e.target.value === '' ? undefined : Number(e.target.value) })}>
                <option value="">{tr('Bawaan (')}{def?.decimals ?? 1})</option>
                {[0, 1, 2, 3].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className={s.mMenuRow}>
              <span>{tr('Satuan')}</span>
              <input className="input" value={setting?.unit ?? ''} placeholder={def?.unit || tr('tanpa satuan')} onChange={(e) => setMeasureSetting(id, { unit: e.target.value || undefined })} />
            </label>
          </div>
          {setting && (
            <button type="button" className={s.mMenuReset} onClick={() => setMeasureSetting(id, null)}>
              <RotateCcw size={12} aria-hidden />{' '}{tr('Tampilkan apa adanya (Value saja)')}
            </button>
          )}
        </div>
      )}
    </Dropdown>
  )
}
