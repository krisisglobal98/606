import { useState } from 'react'
import { ArrowLeft, ArrowRight, GripVertical, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/common/Button'
import type { MeasureWhere, SemanticMeasure, SemanticModel, TypeCategory } from '@/types/warehouse'
import s from './Warehouse.module.css'
import { tr } from '@/i18n'

export interface TableColumns {
  name: string
  columns: { name: string; dataType: string; typeCategory: TypeCategory }[]
}

const TIME_DIMS = [
  { id: 'tanggal', label: tr('Tanggal (bulan)') },
  { id: 'tahun', label: tr('Tahun') },
  { id: 'bulan', label: tr('Bulan') },
  { id: 'hari', label: tr('Hari') },
]

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+/, '').replace(/_+$/, '').slice(0, 60) || 'field'

/** Quick client-side checks; the server validates the full model against live metadata on save. */
export function localProblems(m: SemanticModel): string[] {
  const out: string[] = []
  const ids = [...m.dimensions.map((d) => d.id), ...m.measures.map((x) => x.id)]
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i || TIME_DIMS.some((t) => t.id === id))
  if (dup.length) out.push(tr('Id ganda: {0}.', [...new Set(dup)].join(', ')))
  for (const d of m.dimensions) if (!Object.values(d.columns).some(Boolean)) out.push(tr('Dimensi {0} belum dipetakan ke kolom.', d.label))
  for (const x of m.measures) {
    if (x.type === 'ratio' && (!m.measures.some((y) => y.id === x.numerator && y.type !== 'ratio') || !m.measures.some((y) => y.id === x.denominator && y.type !== 'ratio'))) out.push(tr('Rasio {0}: pembilang/penyebut harus measure dasar.', x.label))
    if ((x.type === 'sum' || x.type === 'snapshot' || x.type === 'distinct') && !x.column) out.push(tr('Measure {0}: kolom belum dipilih.', x.label))
    if ((x.type === 'sum' || x.type === 'snapshot' || x.type === 'distinct') && x.where && (!x.where.dim || !x.where.values.length)) out.push(tr('Measure {0}: syarat belum lengkap (pilih dimensi dan isi nilainya).', x.label))
    if (x.type === 'prorate' && (!m.measures.some((y) => y.id === x.budget && y.type === 'sum') || !m.measures.some((y) => y.id === x.workdays && y.type === 'sum'))) out.push(tr('Anggaran prorata {0}: anggaran dan hari kerja harus measure SUM.', x.label))
    if (x.type === 'snapshot' && !m.entity.length) out.push(tr('Measure {0} (snapshot) memerlukan kunci entitas.', x.label))
  }
  if (!m.measures.some((x) => x.id === m.kpi.actual)) out.push(tr('Pilih measure KPI aktual.'))
  if (!m.defaultLayout.measures.length) out.push(tr('Pilih minimal satu measure untuk layout awal.'))
  return out
}

/**
 * Semantic mapping: business concept ↔ source columns. Stored as DOD metadata only; the source schema
 * is never changed. Dimensions are compared as text, so e.g. tahuntanam int8 and text line up.
 */
export function MappingEditor({ model, tables, onChange, readOnly }: { model: SemanticModel; tables: TableColumns[]; onChange: (m: SemanticModel) => void; readOnly?: boolean }) {
  const m = model
  const cols = (alias: string) => tables.find((t) => t.name === m.sources.find((x) => x.alias === alias)?.table)?.columns ?? []
  const set = (p: Partial<SemanticModel>) => onChange({ ...m, ...p })
  const dims = [...TIME_DIMS, ...m.dimensions.map((d) => ({ id: d.id, label: d.label }))]
  const baseMeasures = m.measures.filter((x) => x.type !== 'ratio' && x.type !== 'prorate')
  // Parts of a ratio or a pro-rata budget: SUM / snapshot measures (a distinct count is not divisible that way).
  const sums = baseMeasures.filter((x) => x.type !== 'distinct')
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const setMeasure = (i: number, x: SemanticMeasure) => set({ measures: m.measures.map((y, j) => (j === i ? x : y)) })
  const dis = readOnly

  return (
    <fieldset disabled={dis} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <h3 className={s.sectionTitle}>{tr('Sumber')}</h3>
      <p className={s.sectionHint}>{tr('Setiap tabel diagregasi sendiri lalu digabung pada dimensi yang sama (FULL JOIN), sehingga aktual dan budget sejajar meski nama dan tipe kolomnya berbeda.')}</p>
      <div className="dtable-wrap">
        <table className={`dtable ${s.mapTable}`}>
          <thead><tr><th scope="col">{tr('Tabel')}</th><th scope="col">{tr('Alias')}</th><th scope="col">{tr('Label')}</th><th scope="col">{tr('Peran')}</th><th scope="col">{tr('Kolom tanggal')}</th></tr></thead>
          <tbody>
            {m.sources.map((src, i) => (
              <tr key={src.alias}>
                <td className="mono strong">{src.table}</td>
                <td className={s.idCell}>{src.alias}</td>
                <td><input className="input" style={{ height: 30 }} value={src.label} onChange={(e) => set({ sources: m.sources.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} aria-label={tr('Label {0}', src.table)} /></td>
                <td>
                  <select className="select select--sm" value={src.role} onChange={(e) => set({ sources: m.sources.map((x, j) => (j === i ? { ...x, role: e.target.value as typeof x.role } : x)) })} aria-label={tr('Peran {0}', src.table)}>
                    <option value="actual">{tr('Aktual')}</option><option value="budget">{tr('Budget')}</option><option value="other">{tr('Lainnya')}</option>
                  </select>
                </td>
                <td>
                  <select className="select select--sm" value={src.dateColumn} onChange={(e) => set({ sources: m.sources.map((x, j) => (j === i ? { ...x, dateColumn: e.target.value } : x)) })} aria-label={tr('Kolom tanggal {0}', src.table)}>
                    {cols(src.alias).filter((c) => c.typeCategory === 'date').map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className={s.sectionTitle}>{tr('Dimensi')}</h3>
      <p className={s.sectionHint}>{tr('Konsep bisnis dan kolomnya di setiap tabel. Tanggal, Tahun, dan Bulan otomatis dari kolom tanggal. Nilai dibandingkan sebagai teks (normalisasi tipe).')}</p>
      <div className="dtable-wrap">
        <table className={`dtable ${s.mapTable}`}>
          <thead>
            <tr>
              <th scope="col">{tr('Konsep')}</th>
              <th scope="col">{tr('Id')}</th>
              {m.sources.map((x) => <th key={x.alias} scope="col">{x.label} <span className="sub mono">{x.table}</span></th>)}
              <th scope="col" title={tr('Urutan baris yang terpisah dari label: kolom angka (mis. urutan); kosong = urut menurut nilai')}>{tr('Kunci urut')}</th>
              <th scope="col"><span className="sr-only">{tr('Aksi')}</span></th>
            </tr>
          </thead>
          <tbody>
            {m.dimensions.map((d, i) => (
              <tr key={i}>
                <td><input className="input" style={{ height: 30 }} value={d.label} onChange={(e) => set({ dimensions: m.dimensions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} aria-label={tr('Label dimensi')} /></td>
                <td><input className={`input ${s.idCell}`} style={{ height: 30, width: 130, minWidth: 0 }} value={d.id} onChange={(e) => set({ dimensions: m.dimensions.map((x, j) => (j === i ? { ...x, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') } : x)) })} onBlur={() => set({ dimensions: m.dimensions.map((x, j) => (j === i ? { ...x, id: slug(x.id) } : x)) })} aria-label={tr('Id dimensi {0}', d.label)} /></td>
                {m.sources.map((src) => (
                  <td key={src.alias}>
                    <select className="select select--sm" value={d.columns[src.alias] ?? ''} onChange={(e) => set({ dimensions: m.dimensions.map((x, j) => (j === i ? { ...x, columns: { ...x.columns, [src.alias]: e.target.value || null } } : x)) })} aria-label={tr('Kolom {0} di {1}', d.label, src.table)}>
                      <option value="">{tr('— tidak ada —')}</option>
                      {cols(src.alias).map((c) => <option key={c.name} value={c.name}>{c.name} ({c.dataType})</option>)}
                    </select>
                  </td>
                ))}
                <td>
                  {(() => {
                    // The sort key is read from the first source where the dimension is mapped.
                    const alias = m.sources.find((src) => d.columns[src.alias])?.alias
                    if (!alias) return null
                    return (
                      <select className="select select--sm" value={d.sortColumns?.[alias] ?? ''} onChange={(e) => set({ dimensions: m.dimensions.map((x, j) => (j === i ? { ...x, sortColumns: e.target.value ? { [alias]: e.target.value } : undefined } : x)) })} aria-label={tr('Kunci urut {0}', d.label)}>
                        <option value="">{tr('— urut menurut nilai —')}</option>
                        {cols(alias).filter((c) => c.typeCategory === 'number').map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                    )
                  })()}
                </td>
                <td>
                  <button type="button" className="icon-btn" aria-label={tr('Hapus dimensi {0}', d.label)} onClick={() => set({ dimensions: m.dimensions.filter((_, j) => j !== i), entity: m.entity.filter((x) => x !== d.id), scopeFields: m.scopeFields.filter((x) => x !== d.id), filterFields: m.filterFields.filter((x) => x !== d.id), defaultLayout: { ...m.defaultLayout, dimensions: m.defaultLayout.dimensions.filter((x) => x !== d.id) } })}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!dis && (
        <Button size="sm" variant="ghost" icon={<Plus size={13} aria-hidden />} style={{ marginTop: 6 }} onClick={() => {
          let id = 'dimensi_baru'
          for (let k = 2; m.dimensions.some((d) => d.id === id); k++) id = `dimensi_baru_${k}`
          set({ dimensions: [...m.dimensions, { id, label: tr('Dimensi baru'), columns: Object.fromEntries(m.sources.map((x) => [x.alias, null])) }] })
        }}>
          {tr('Tambah dimensi')}
        </Button>
      )}

      <h3 className={s.sectionTitle}>{tr('Measure')}</h3>
      <p className={s.sectionHint}><b>{tr('SUM')}</b>{' '}{tr('untuk nilai harian (produksi, janjang).')}{' '}<b>{tr('Snapshot')}</b>{' '}{tr('untuk nilai yang berulang di setiap baris harian (luas, jumlah pokok): diambil sekali per entitas, lalu dijumlah.')}{' '}{tr('Pilih "nilai tanggal terakhir" untuk status harian (unit standby/rusak): yang dihitung nilai pada tanggal terakhir periode, termasuk 0.')}{' '}<b>{tr('Rasio')}</b>{' '}{tr('dihitung setelah agregasi.')}</p>
      <div className="dtable-wrap">
        <table className={`dtable ${s.mapTable}`}>
          <thead><tr><th scope="col">{tr('Label')}</th><th scope="col">{tr('Id')}</th><th scope="col">{tr('Jenis')}</th><th scope="col">{tr('Sumber & kolom / rumus')}</th><th scope="col">{tr('Satuan')}</th><th scope="col">{tr('Desimal')}</th><th scope="col"><span className="sr-only">{tr('Aksi')}</span></th></tr></thead>
          <tbody>
            {m.measures.map((x, i) => (
              <tr key={i}>
                <td><input className="input" style={{ height: 30 }} value={x.label} onChange={(e) => setMeasure(i, { ...x, label: e.target.value })} aria-label={tr('Label measure')} /></td>
                <td><input className={`input ${s.idCell}`} style={{ height: 30, width: 130, minWidth: 0 }} value={x.id} onChange={(e) => setMeasure(i, { ...x, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} onBlur={() => setMeasure(i, { ...x, id: slug(x.id) })} aria-label={tr('Id measure {0}', x.label)} /></td>
                <td>
                  <select className="select select--sm" value={x.type} onChange={(e) => {
                    const t = e.target.value as SemanticMeasure['type']
                    const head = { id: x.id, label: x.label, unit: x.unit, decimals: x.decimals }
                    const src = 'source' in x ? x.source : m.sources[0]!.alias
                    const column = 'column' in x ? x.column : ''
                    if (t === 'ratio') setMeasure(i, { ...head, type: 'ratio', numerator: sums[0]?.id ?? '', denominator: sums[1]?.id ?? sums[0]?.id ?? '', scale: 1 })
                    else if (t === 'prorate') setMeasure(i, { ...head, type: 'prorate', budget: sums[0]?.id ?? '', workdays: sums[1]?.id ?? sums[0]?.id ?? '' })
                    else if (t === 'snapshot') setMeasure(i, { ...head, type: 'snapshot', source: src, column })
                    else setMeasure(i, { ...head, type: t, source: src, column })
                  }} aria-label={tr('Jenis {0}', x.label)}>
                    <option value="sum">{tr('SUM')}</option><option value="snapshot">{tr('Snapshot')}</option><option value="distinct">{tr('Hitung unik')}</option><option value="ratio">{tr('Rasio')}</option><option value="prorate">{tr('Anggaran prorata')}</option>
                  </select>
                </td>
                <td>
                  {x.type === 'prorate' ? (
                    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      <select className="select select--sm" value={x.budget} onChange={(e) => setMeasure(i, { ...x, budget: e.target.value })} aria-label={tr('Anggaran sebulan')}>{sums.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
                      {tr('× hari kerja s.d. tanggal laporan ÷ sebulan, dari')}
                      <select className="select select--sm" value={x.workdays} onChange={(e) => setMeasure(i, { ...x, workdays: e.target.value })} aria-label={tr('Hari kerja (kalender kerja)')}>{sums.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
                    </span>
                  ) : x.type === 'ratio' ? (
                    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      <select className="select select--sm" value={x.numerator} onChange={(e) => setMeasure(i, { ...x, numerator: e.target.value })} aria-label={tr('Pembilang')}>{baseMeasures.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
                      ÷
                      <select className="select select--sm" value={x.denominator} onChange={(e) => setMeasure(i, { ...x, denominator: e.target.value })} aria-label={tr('Penyebut')}>{baseMeasures.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
                      ×
                      <input className="input" type="number" style={{ height: 30, width: 70, minWidth: 0 }} value={x.scale} onChange={(e) => setMeasure(i, { ...x, scale: Number(e.target.value) || 1 })} aria-label={tr('Skala')} />
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                      <select className="select select--sm" value={x.source} onChange={(e) => setMeasure(i, { ...x, source: e.target.value, column: '' })} aria-label={tr('Sumber measure')}>{m.sources.map((src) => <option key={src.alias} value={src.alias}>{src.label}</option>)}</select>
                      <select className="select select--sm" value={x.column} onChange={(e) => setMeasure(i, { ...x, column: e.target.value })} aria-label={tr('Kolom measure')}>
                        <option value="">{tr('— pilih kolom —')}</option>
                        {cols(x.source).filter((c) => x.type === 'distinct' || c.typeCategory === 'number').map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                      <WhereEditor where={x.where} dims={m.dimensions.filter((d) => d.columns[x.source])} label={x.label} onChange={(where) => setMeasure(i, { ...x, where })} />
                      {x.type === 'snapshot' && (
                        <select className="select select--sm" value={x.pick ?? 'max'} onChange={(e) => setMeasure(i, { ...x, pick: e.target.value === 'last' ? 'last' : undefined })} aria-label={tr('Cara ambil snapshot {0}', x.label)} title={tr('Nilai terbesar: luas, jumlah pokok. Nilai tanggal terakhir: status harian (unit standby/rusak pada tanggal laporan), termasuk nilai 0.')}>
                          <option value="max">{tr('nilai terbesar')}</option>
                          <option value="last">{tr('nilai tanggal terakhir')}</option>
                        </select>
                      )}
                    </span>
                  )}
                </td>
                <td><input className="input" style={{ height: 30, width: 90, minWidth: 0 }} value={x.unit} onChange={(e) => setMeasure(i, { ...x, unit: e.target.value })} aria-label={tr('Satuan {0}', x.label)} /></td>
                <td><input className="input" type="number" min={0} max={6} style={{ height: 30, width: 64, minWidth: 0 }} value={x.decimals} onChange={(e) => setMeasure(i, { ...x, decimals: Math.max(0, Math.min(6, Number(e.target.value) || 0)) })} aria-label={tr('Desimal {0}', x.label)} /></td>
                <td>
                  <button type="button" className="icon-btn" aria-label={tr('Hapus measure {0}', x.label)} onClick={() => set({ measures: m.measures.filter((_, j) => j !== i), defaultLayout: { ...m.defaultLayout, measures: m.defaultLayout.measures.filter((y) => y !== x.id) } })}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!dis && (
        <Button size="sm" variant="ghost" icon={<Plus size={13} aria-hidden />} style={{ marginTop: 6 }} onClick={() => {
          const label = tr('Measure baru')
          let id = slug(label)
          for (let k = 2; m.measures.some((x) => x.id === id) || m.dimensions.some((d) => d.id === id); k++) id = `${slug(label)}_${k}`
          set({ measures: [...m.measures, { id, label, unit: '', decimals: 0, type: 'sum', source: m.sources[0]!.alias, column: '' }] })
        }}>
          {tr('Tambah measure')}
        </Button>
      )}

      <h3 className={s.sectionTitle}>{tr('KPI & kunci entitas')}</h3>
      <div className={s.formGrid}>
        <label className="field">
          <span className="t-label">{tr('KPI aktual')}</span>
          <select className="select" value={m.kpi.actual} onChange={(e) => set({ kpi: { ...m.kpi, actual: e.target.value } })}>{baseMeasures.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
        </label>
        <label className="field">
          <span className="t-label">{tr('KPI target (budget)')}</span>
          <select className="select" value={m.kpi.target ?? ''} onChange={(e) => set({ kpi: { ...m.kpi, target: e.target.value || null } })}>
            <option value="">{tr('— tanpa target —')}</option>
            {baseMeasures.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
      </div>
      <p className={s.sectionHint} style={{ marginTop: 10 }}>{tr('Kunci entitas (untuk measure snapshot dan deteksi anomali per blok):')}</p>
      <div className={s.chipsRow}>
        {m.dimensions.map((d) => (
          <label key={d.id}><input type="checkbox" checked={m.entity.includes(d.id)} onChange={() => set({ entity: toggle(m.entity, d.id) })} /> {d.label}</label>
        ))}
      </div>

      <h3 className={s.sectionTitle}>{tr('Tampilan di Analisis')}</h3>
      <p className={s.sectionHint}>{tr('Urutan di sini menjadi urutan di halaman Analisis. Geser dengan tombol ←/→ atau tarik.')}</p>
      <OrderedPicker disabled={dis} label={tr('Pengaturan Data (dimensi untuk membatasi cakupan data)')} options={m.dimensions} value={m.scopeFields} onChange={(scopeFields) => set({ scopeFields })} />
      <OrderedPicker disabled={dis} label={tr('Filter bar (dimensi yang bisa difilter)')} options={m.dimensions} value={m.filterFields} onChange={(filterFields) => set({ filterFields })} />
      <OrderedPicker disabled={dis} label={tr('Layout awal: dimensi baris (urutan = hierarki)')} options={dims} value={m.defaultLayout.dimensions} onChange={(dimensions) => set({ defaultLayout: { ...m.defaultLayout, dimensions } })} />
      <OrderedPicker disabled={dis} label={tr('Layout awal: measure (urutan kolom)')} options={m.measures} value={m.defaultLayout.measures} onChange={(measures) => set({ defaultLayout: { ...m.defaultLayout, measures } })} />
    </fieldset>
  )
}

/**
 * Chosen items in their order (move with ←/→ or drag) plus the remaining options to add. Inside a
 * disabled fieldset (read-only view) every control is disabled by the browser.
 */
function OrderedPicker({ label, options, value, onChange, disabled }: { label: string; options: { id: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const [drag, setDrag] = useState<number | null>(null)
  const name = (id: string) => options.find((o) => o.id === id)?.label ?? id
  const chosen = [...new Set(value)].filter((id) => options.some((o) => o.id === id))
  const rest = options.filter((o) => !chosen.includes(o.id))
  const move = (from: number, to: number) => {
    if (to < 0 || to >= chosen.length || from === to) return
    const next = [...chosen]
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x!)
    onChange(next)
  }
  return (
    <div className={s.ordered} role="group" aria-label={label}>
      <p className={s.sectionHint} style={{ marginTop: 10 }}>{label}</p>
      <ol className={s.orderList}>
        {chosen.map((id, i) => (
          <li
            key={id}
            className={`${s.orderChip}${drag === i ? ` ${s.dragging}` : ''}`}
            draggable={!disabled}
            onDragStart={(e) => (setDrag(i), e.dataTransfer.setData('text/plain', id), (e.dataTransfer.effectAllowed = 'move'))}
            onDragOver={(e) => drag != null && e.preventDefault()}
            onDrop={(e) => (e.preventDefault(), drag != null && move(drag, i), setDrag(null))}
            onDragEnd={() => setDrag(null)}
          >
            <GripVertical size={12} aria-hidden className={s.grip} />
            <span className={s.orderNo}>{i + 1}</span>
            {name(id)}
            <button type="button" className="icon-btn" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={tr('Geser {0} ke kiri', name(id))}><ArrowLeft size={12} /></button>
            <button type="button" className="icon-btn" onClick={() => move(i, i + 1)} disabled={i === chosen.length - 1} aria-label={tr('Geser {0} ke kanan', name(id))}><ArrowRight size={12} /></button>
            <button type="button" className="icon-btn" onClick={() => onChange(chosen.filter((x) => x !== id))} aria-label={tr('Hapus {0}', name(id))}><X size={12} /></button>
          </li>
        ))}
        {!chosen.length && <li className={s.orderEmpty}>{tr('Belum ada yang dipilih')}</li>}
      </ol>
      {rest.length > 0 && (
        <div className={s.orderAdd}>
          {rest.map((o) => (
            <button key={o.id} type="button" className={s.addChip} onClick={() => onChange([...chosen, o.id])}>
              <Plus size={11} aria-hidden /> {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Optional condition of a measure: only rows whose dimension value is in the list count (e.g. Status = B), so the
 * warehouse needs no derived column per case. Values are typed separated by commas.
 */
function WhereEditor({ where, dims, label, onChange }: { where: MeasureWhere | undefined; dims: { id: string; label: string }[]; label: string; onChange: (w: MeasureWhere | undefined) => void }) {
  if (!where)
    return (
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => onChange({ dim: dims[0]?.id ?? '', values: [] })} disabled={!dims.length} title={tr('Hanya baris dengan nilai dimensi tertentu yang dihitung (mis. Status = B)')}>
        {tr('+ syarat')}
      </button>
    )
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      {tr('hanya jika')}
      <select className="select select--sm" value={where.dim} onChange={(e) => onChange({ ...where, dim: e.target.value })} aria-label={tr('Dimensi syarat {0}', label)}>
        {dims.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>
      =
      <input
        className="input"
        style={{ height: 30, width: 140, minWidth: 0 }}
        defaultValue={where.values.join(', ')}
        placeholder={tr('nilai, pisahkan koma')}
        onBlur={(e) => onChange({ ...where, values: [...new Set(e.target.value.split(',').map((v) => v.trim()).filter(Boolean))] })}
        aria-label={tr('Nilai syarat {0}', label)}
      />
      <button type="button" className="icon-btn" onClick={() => onChange(undefined)} aria-label={tr('Hapus syarat {0}', label)}>
        <Trash2 size={13} />
      </button>
    </span>
  )
}
