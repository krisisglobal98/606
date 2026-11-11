import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeft, BarChart3, Pencil, Save, Trash2, X } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { ErrorState, Skeleton } from '@/components/common/StateView'
import { CategorySelect } from '@/components/warehouse/CategorySelect'
import { useResource } from '@/hooks/useResource'
import { ApiError } from '@/services/api/apiClient'
import { datasetService as analysisCatalog } from '@/services/dataset/datasetService'
import { dataWarehouseService } from '@/services/warehouse/dataWarehouseService'
import { useAnalysisStore } from '@/stores/analysisStore'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/uiStore'
import type { SemanticModel, WhDataset } from '@/types/warehouse'
import { formatDateTime } from '@/utils/format'
import { DeleteDatasetModal } from '../Dataset/DeleteDatasetModal'
import { localProblems, MappingEditor, type TableColumns } from './MappingEditor'
import s from './Warehouse.module.css'
import { tr } from '@/i18n'

/** Detail of a dataset over real source tables: sources, fields, semantic mapping (editable). */
export default function WarehouseDatasetPage() {
  const { id = '' } = useParams()
  const [nonce, setNonce] = useState(0)
  const res = useResource((signal) => dataWarehouseService.getDataset(id, signal), `${id}#${nonce}`)
  const d = res.data
  if (res.status === 'error' && !d) return <Card><ErrorState message={res.error ?? tr('')} onRetry={res.reload} action={<Link className="btn btn--sm" to="/data/dataset">{tr('Semua dataset')}</Link>} /></Card>
  if (!d) return <Card><Skeleton h={200} /></Card>
  return <Detail key={d.updatedAt} d={d} onSaved={() => setNonce((n) => n + 1)} />
}

function Detail({ d, onSaved }: { d: WhDataset; onSaved: () => void }) {
  const navigate = useNavigate()
  const setDataset = useAnalysisStore((st) => st.setDataset)
  const role = useAuthStore((st) => st.user?.role)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [model, setModel] = useState<SemanticModel>(d.semantic)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const meta = useResource(
    async (signal) => Promise.all(d.sourceTables.map((t) => dataWarehouseService.getTableColumns(d.connectionId, d.schema, t, signal).then((columns): TableColumns => ({ name: t, columns })))),
    editing ? `${d.id}|cols` : 'off',
  )

  const open = async () => {
    try {
      const cat = await analysisCatalog.getCatalog()
      const ds = cat.datasets.find((x) => x.id === d.id)
      if (!ds) throw new Error(tr('missing'))
      setDataset(ds)
      navigate('/analisis')
    } catch {
      toast(tr('Dataset belum tersedia di katalog Analisis. Coba muat ulang.'), 'error')
    }
  }
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await dataWarehouseService.updateDataset(d.id, { semantic: model })
      analysisCatalog.invalidate()
      toast(tr('Pemetaan disimpan.'), 'success')
      setEditing(false)
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr('Pemetaan gagal disimpan.'))
    } finally {
      setBusy(false)
    }
  }
  const setCategory = async (categoryId: string | null) => {
    try {
      await dataWarehouseService.updateDataset(d.id, { categoryId })
      analysisCatalog.invalidate()
      toast(tr('Kategori dataset diperbarui.'), 'success')
      onSaved()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : tr('Kategori gagal disimpan.'), 'error')
    }
  }
  const problems = editing ? localProblems(model) : []
  const dims = d.fields.filter((f) => f.kind === 'dimension')
  const measures = d.fields.filter((f) => f.kind === 'measure')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      <Card>
        <div className={s.head}>
          <div className={s.headMain}>
            <Link to="/data/dataset" className="t-meta" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><ArrowLeft size={13} aria-hidden />{' '}{tr('Semua dataset')}</Link>
            <h2>{d.name} <span className="badge badge--success">{tr('Data nyata')}</span>{d.status !== 'active' && <span className="badge">{d.status}</span>}</h2>
            <span className="t-meta">{d.description || tr('Tanpa deskripsi')}</span>
          </div>
          <div className={s.headActs}>
            {(role === 'admin' || role === 'analyst') && <Button icon={<Trash2 size={14} aria-hidden />} onClick={() => setDeleting(true)}>{tr('Hapus')}</Button>}
            <Button variant="primary" icon={<BarChart3 size={14} aria-hidden />} onClick={() => void open()}>{tr('Buka di Analisis')}</Button>
          </div>
        </div>
        <dl className={s.connKv}>
          <div><dt>{tr('Koneksi')}</dt><dd>{d.connectionName} · {d.environment}</dd></div>
          <div><dt>{tr('Schema')}</dt><dd className="mono">{d.schema}</dd></div>
          <div><dt>{tr('Tabel sumber')}</dt><dd className="mono">{d.sourceTables.map((t) => <span key={t} style={{ display: 'block' }}>{t}</span>)}</dd></div>
          <div><dt>{tr('Field')}</dt><dd>{dims.length}{' '}{tr('dimensi ·')}{' '}{measures.length}{' '}{tr('measure')}</dd></div>
          <div>
            <dt>{tr('Kategori')}</dt>
            <dd>
              {role === 'admin' || role === 'analyst' ? (
                <CategorySelect value={d.category?.id ?? null} onChange={(v) => void setCategory(v)} />
              ) : d.category ? (
                d.category.parentName ? `${d.category.parentName} › ${d.category.name}` : d.category.name
              ) : (
                tr('Tanpa kategori')
              )}
            </dd>
          </div>
          <div><dt>{tr('Dibuat')}</dt><dd>{formatDateTime(d.createdAt)}</dd></div>
          <div><dt>{tr('Diperbarui')}</dt><dd>{formatDateTime(d.updatedAt)}</dd></div>
        </dl>
        {deleting && <DeleteDatasetModal dataset={d} onClose={() => setDeleting(false)} onDeleted={() => navigate('/data/dataset')} />}
        <p className="t-meta" style={{ marginTop: 10 }}>{tr('Metadata disimpan di database DOD. Query analitik dijalankan langsung ke sumber (read-only) dan hanya hasil agregasi yang dikirim ke browser.')}</p>
      </Card>

      <Card
        title={tr('Pemetaan semantik')}
        subtitle={tr('Konsep bisnis ↔ kolom sumber. Disimpan sebagai metadata DOD; schema sumber tidak diubah.')}
        actions={
          (role === 'admin' || role === 'analyst') &&
          (editing ? (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <Button size="sm" icon={<X size={13} aria-hidden />} onClick={() => (setEditing(false), setModel(d.semantic), setError(null))}>{tr('Batal')}</Button>
              <Button size="sm" variant="primary" icon={<Save size={13} aria-hidden />} loading={busy} disabled={problems.length > 0} onClick={() => void save()}>{tr('Simpan')}</Button>
            </span>
          ) : (
            <Button size="sm" icon={<Pencil size={13} aria-hidden />} onClick={() => setEditing(true)}>{tr('Ubah pemetaan')}</Button>
          ))
        }
      >
        {error && <div className="callout callout--danger" role="alert" style={{ marginBottom: 10 }}><span>{error}</span></div>}
        {editing && !meta.data ? (
          meta.status === 'error' ? <ErrorState message={meta.error ?? tr('')} onRetry={meta.reload} /> : <Skeleton h={200} />
        ) : (
          <MappingEditor model={editing ? model : d.semantic} tables={meta.data ?? d.semantic.sources.map((x) => ({ name: x.table, columns: columnsFromModel(d.semantic, x.alias) }))} onChange={setModel} readOnly={!editing} />
        )}
        {problems.length > 0 && <div className="callout callout--warning" style={{ marginTop: 12 }}><span>{tr('Perlu dilengkapi:')}<ul className={s.problems}>{problems.map((p) => <li key={p}>{p}</li>)}</ul></span></div>}
      </Card>
    </div>
  )
}

/** Read-only view: the mapped columns are enough to render the selects without fetching metadata. */
function columnsFromModel(m: SemanticModel, alias: string) {
  const names = new Set<string>()
  const src = m.sources.find((x) => x.alias === alias)
  if (src) names.add(src.dateColumn)
  m.dimensions.forEach((d) => d.columns[alias] && names.add(d.columns[alias]!))
  m.measures.forEach((x) => x.type !== 'ratio' && x.source === alias && names.add(x.column))
  return [...names].map((n) => ({ name: n, dataType: '', typeCategory: n === src?.dateColumn ? ('date' as const) : m.measures.some((x) => x.type !== 'ratio' && x.column === n) ? ('number' as const) : ('string' as const) }))
}
