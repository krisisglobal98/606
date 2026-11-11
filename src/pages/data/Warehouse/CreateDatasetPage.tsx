import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, Save, Wand2 } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { ErrorState, Skeleton } from '@/components/common/StateView'
import { CategorySelect } from '@/components/warehouse/CategorySelect'
import { rowsLabel } from '@/components/warehouse/meta'
import { useResource } from '@/hooks/useResource'
import { ApiError } from '@/services/api/apiClient'
import { datasetService as analysisCatalog } from '@/services/dataset/datasetService'
import { dataWarehouseService } from '@/services/warehouse/dataWarehouseService'
import { toast } from '@/stores/uiStore'
import type { DatasetSuggestion, SemanticModel } from '@/types/warehouse'
import { localProblems, MappingEditor } from './MappingEditor'
import s from './Warehouse.module.css'
import { tr } from '@/i18n'

/**
 * Data → Set Data → Buat dataset: pick a connection of .env (by name), a schema and 1–4 tables, then map them.
 * Only metadata is stored in DOD; no data is copied and the browser never sees the connection's credentials.
 */
export default function CreateDatasetPage() {
  const [sp, setSp] = useSearchParams()
  const navigate = useNavigate()
  const conns = useResource((signal) => dataWarehouseService.getConnections(signal), 'dataset-connections')
  const usable = (conns.data ?? []).filter((c) => c.capabilities.dataset)
  const connectionId = sp.get('connection') ?? ''
  const conn = usable.find((c) => c.id === connectionId) ?? null
  const schemas = useResource((signal) => (conn && conn.secretConfigured ? dataWarehouseService.getSchemas(conn.id, signal) : Promise.resolve(null)), `schemas|${conn?.id ?? ''}`)
  const schema = sp.get('schema') || conn?.schema || ''
  const tables = useResource((signal) => (conn && conn.secretConfigured && schema ? dataWarehouseService.getTables(conn.id, schema, signal) : Promise.resolve(null)), `${conn?.id ?? ''}|${schema}`)
  const [picked, setPicked] = useState<string[]>([])
  const choose = (p: { connection?: string; schema?: string }) => {
    const next = new URLSearchParams(sp)
    if (p.connection !== undefined) {
      next.set('connection', p.connection)
      next.delete('schema')
    }
    if (p.schema !== undefined) next.set('schema', p.schema)
    setSp(next, { replace: true })
    setPicked([])
    setModel(null)
    setSuggestion(null)
  }
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<DatasetSuggestion | null>(null)
  const [model, setModel] = useState<SemanticModel | null>(null)
  const [busy, setBusy] = useState<'suggest' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const suggest = async () => {
    setBusy('suggest')
    setError(null)
    try {
      const r = await dataWarehouseService.suggestDataset({ connectionId, schema, tables: picked })
      setSuggestion(r)
      setModel(r.semantic)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr('Saran pemetaan gagal dibuat.'))
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    if (!model) return
    setBusy('save')
    setError(null)
    try {
      const d = await dataWarehouseService.createDataset({ name: name.trim(), description: description.trim(), connectionId, schema, tables: model.sources.map((x) => x.table), semantic: model, categoryId })
      analysisCatalog.invalidate()
      toast(tr('Dataset "{0}" dibuat dan siap dipakai di Analisis.', d.name), 'success')
      navigate(`/data/dataset/${d.id}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr('Dataset gagal disimpan.'))
    } finally {
      setBusy(null)
    }
  }

  const problems = model ? localProblems(model) : []
  const nameOk = name.trim().length >= 3

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      <Card>
        <Link to="/data/dataset" className="t-meta" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <ArrowLeft size={13} aria-hidden />{' '}{tr('Kembali ke Set Data')}
        </Link>
        <h2 className="t-section" style={{ marginTop: 6 }}>{tr('Dataset baru dari sumber nyata')}</h2>
        <p className="t-meta">{tr('Dataset menyimpan referensi ke koneksi, tabel sumber, dan pemetaan semantik di database DOD. Data sumber tidak disalin dan kredensial tidak diduplikasi.')}</p>

        <div className={s.formGrid} style={{ marginTop: 14 }}>
          <label className="field">
            <span className="t-label">{tr('Koneksi')}{' '}<span style={{ color: 'var(--danger)' }}>*</span></span>
            <select className="select" value={conn?.id ?? ''} onChange={(e) => choose({ connection: e.target.value })} disabled={!conns.data}>
              <option value="">{conns.data ? tr('Pilih koneksi') : tr('Memuat…')}</option>
              {usable.map((c) => <option key={c.id} value={c.id}>{c.name}{c.secretConfigured ? '' : tr(' (password belum diisi di .env)')}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="t-label">{tr('Schema')}{' '}<span style={{ color: 'var(--danger)' }}>*</span></span>
            <select className="select" value={schema} onChange={(e) => choose({ schema: e.target.value })} disabled={!schemas.data}>
              {!schemas.data && <option value={schema}>{schema || tr('–')}</option>}
              {schemas.data?.filter((x) => x.canUse).map((x) => <option key={x.name} value={x.name}>{x.name} ({x.tableCount})</option>)}
            </select>
          </label>
        </div>
        {conns.status === 'error' && !conns.data && <ErrorState message={conns.error ?? tr('')} onRetry={conns.reload} />}
        {conns.data && !usable.length && (
          <div className="callout callout--warning" role="note" style={{ marginTop: 10 }}>
            <span>{tr('Belum ada koneksi PostgreSQL/ClickHouse. Koneksi diatur di file .env server (DOD_DW_CONNECTIONS dan DOD_DW_<PREFIX>_*), lalu DOD API di-restart.')}</span>
          </div>
        )}
        {conn && !conn.secretConfigured && (
          <div className="callout callout--warning" role="note" style={{ marginTop: 10 }}>
            <span>{tr('Password koneksi ini belum diisi di file .env server; tabelnya belum bisa dibaca.')}</span>
          </div>
        )}
        {schemas.status === 'error' && <ErrorState message={schemas.error ?? tr('')} onRetry={schemas.reload} />}

        <div className={s.formGrid} style={{ marginTop: 14 }}>
          <label className="field">
            <span className="t-label">{tr('Nama dataset')}{' '}<span style={{ color: 'var(--danger)' }}>*</span></span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('mis. Production Performance')} aria-invalid={!!name && !nameOk} />
          </label>
          <label className="field">
            <span className="t-label">{tr('Deskripsi')}</span>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={tr('Aktual vs budget produksi harian')} />
          </label>
          <div className="field">
            <label className="t-label" htmlFor="ds-category">{tr('Kategori')}</label>
            <CategorySelect id="ds-category" value={categoryId} onChange={setCategoryId} />
          </div>
        </div>

        <h3 className={s.sectionTitle}>{tr('Tabel sumber · schema')}{' '}{schema}</h3>
        <p className={s.sectionHint}>{tr('Pilih 1–4 tabel. Tabel bernama budget/target/rencana dikenali sebagai budget.')}</p>
        {!conn || !conn.secretConfigured ? (
          <p className="t-meta">{tr('Pilih koneksi terlebih dahulu.')}</p>
        ) : tables.status === 'error' && !tables.data ? (
          <ErrorState message={tables.error ?? tr('')} onRetry={tables.reload} />
        ) : !tables.data ? (
          <Skeleton h={60} />
        ) : (
          <div className={s.chipsRow}>
            {tables.data.map((t) => (
              <label key={t.name}>
                <input type="checkbox" checked={picked.includes(t.name)} disabled={!t.canSelect || (!picked.includes(t.name) && picked.length >= 4)} onChange={() => { setPicked(picked.includes(t.name) ? picked.filter((x) => x !== t.name) : [...picked, t.name]); setModel(null); setSuggestion(null) }} />
                <span className="mono">{t.name}</span> <small className="t-meta">{rowsLabel(t.estimatedRows)}</small>
              </label>
            ))}
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <Button icon={<Wand2 size={14} aria-hidden />} onClick={() => void suggest()} loading={busy === 'suggest'} disabled={!picked.length}>
            {model ? tr('Susun ulang pemetaan') : tr('Susun pemetaan dari metadata')}
          </Button>
        </div>
        {error && <div className="callout callout--danger" role="alert" style={{ marginTop: 12 }}><span>{error}</span></div>}
      </Card>

      {model && suggestion && (
        <Card>
          <h2 className="t-section">{tr('Pemetaan semantik')}</h2>
          <p className="t-meta">{tr('Disarankan dari nama kolom dan tipe data yang ditemukan di sumber. Periksa dan ubah bila perlu sebelum menyimpan.')}</p>
          {suggestion.problems.length > 0 && (
            <div className="callout callout--warning" style={{ marginTop: 10 }}>
              <span>{tr('Saran awal masih memiliki catatan:')}<ul className={s.problems}>{suggestion.problems.map((p) => <li key={p}>{p}</li>)}</ul></span>
            </div>
          )}
          <MappingEditor model={model} tables={suggestion.tables} onChange={setModel} />
          {problems.length > 0 && (
            <div className="callout callout--warning" role="status" style={{ marginTop: 14 }}>
              <span>{tr('Perlu dilengkapi:')}<ul className={s.problems}>{problems.map((p) => <li key={p}>{p}</li>)}</ul></span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
            {!nameOk && <span className="t-meta" style={{ alignSelf: 'center' }}>{tr('Isi nama dataset (min. 3 karakter).')}</span>}
            <Button variant="primary" icon={<Save size={14} aria-hidden />} onClick={() => void save()} loading={busy === 'save'} disabled={!nameOk || problems.length > 0}>
              {tr('Simpan dataset')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
