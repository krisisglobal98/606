import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { DatabaseZap, FolderTree, RotateCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { Metric } from '@/components/common/Metric'
import { EmptyState, ErrorState, Skeleton } from '@/components/common/StateView'
import { PageHeader } from '@/components/data/PageHeader'
import { SearchInput } from '@/components/forms/SearchInput'
import { DataTable, type Column } from '@/components/tables/DataTable'
import { useResource } from '@/hooks/useResource'
import { useAuthStore } from '@/stores/authStore'
import { dataWarehouseService } from '@/services/warehouse/dataWarehouseService'
import type { WhDatasetSummary } from '@/types/warehouse'
import { formatDateTime, formatRelative } from '@/utils/format'
import { DeleteDatasetModal } from './DeleteDatasetModal'
import { tr } from '@/i18n'

const categoryOf = (d: WhDatasetSummary) => (d.category ? (d.category.parentName ? `${d.category.parentName} › ${d.category.name}` : d.category.name) : null)

/** Data → Dataset: datasets defined in DOD's database over real source tables. */
export default function DatasetPage() {
  const [nonce, setNonce] = useState(0)
  const res = useResource((signal) => dataWarehouseService.listDatasets(signal), `wh-datasets#${nonce}`)
  const navigate = useNavigate()
  const role = useAuthStore((st) => st.user?.role)
  const canEdit = role === 'admin' || role === 'analyst'
  const canCreate = canEdit
  const [q, setQ] = useState('')
  const [deleting, setDeleting] = useState<WhDatasetSummary | null>(null)
  const rows = useMemo(() => res.data ?? [], [res.data])
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? rows.filter((d) => `${d.name} ${d.description} ${d.connectionName} ${categoryOf(d) ?? ''}`.toLowerCase().includes(t)) : rows
  }, [rows, q])

  const columns: Column<WhDatasetSummary>[] = [
    { key: 'name', header: tr('Dataset'), sort: (d) => d.name, render: (d) => <span className="strong" style={{ display: 'block', maxWidth: 320 }}>{d.name}<span className="sub">{d.description || tr('–')}</span></span> },
    { key: 'cat', header: tr('Kategori'), sort: (d) => categoryOf(d) ?? '~', render: (d) => (d.category ? <span>{d.category.parentName ?? d.category.name}{d.category.parentName && <span className="sub">{d.category.name}</span>}</span> : <span className="t-meta">{tr('Tanpa kategori')}</span>) },
    { key: 'src', header: tr('Sumber'), sort: (d) => d.connectionName, render: (d) => <span>{d.connectionName}<span className="sub mono">{d.schema}.{d.sourceTables.join(', ')}</span></span> },
    { key: 'fields', header: tr('Field'), align: 'right', sort: (d) => d.dimensionCount + d.measureCount, render: (d) => <span>{d.dimensionCount + d.measureCount}<span className="sub">{d.dimensionCount}{' '}{tr('dim ·')}{' '}{d.measureCount}{' '}{tr('measure')}</span></span> },
    { key: 'status', header: tr('Status'), sort: (d) => d.status, render: (d) => <span className={`badge ${d.status === 'active' ? 'badge--success' : ''}`}>{d.status === 'active' ? tr('Aktif') : d.status === 'draft' ? tr('Draft') : tr('Diarsipkan')}</span> },
    { key: 'upd', header: tr('Diperbarui'), sort: (d) => d.updatedAt, render: (d) => <span style={{ whiteSpace: 'nowrap' }}>{formatRelative(d.updatedAt)}<span className="sub">{formatDateTime(d.updatedAt)}</span></span> },
    ...(canEdit
      ? [
          {
            key: 'act',
            header: '',
            render: (d: WhDatasetSummary) => (
              <span onClick={(e) => e.stopPropagation()}>
                <button type="button" className="icon-btn" onClick={() => setDeleting(d)} aria-label={tr('Hapus dataset {0}', d.name)} title={tr('Hapus dataset')}>
                  <Trash2 size={14} />
                </button>
              </span>
            ),
          },
        ]
      : []),
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      <PageHeader
        actions={
          <>
            <Button icon={<RotateCw size={14} className={res.status === 'loading' && res.data ? 'spin' : undefined} />} onClick={() => setNonce((n) => n + 1)}>{tr('Muat ulang')}</Button>
            <Link className="btn" to="/data/categories"><FolderTree size={14} aria-hidden />{' '}{tr('Kategori')}</Link>
            {canCreate && <Link className="btn btn--primary" to="/data/dataset/new"><DatabaseZap size={14} aria-hidden />{' '}{tr('Buat dataset')}</Link>}
          </>
        }
      />
      {res.status !== 'error' && (
        <section className="metrics" aria-label={tr('Ringkasan dataset')}>
          {res.data ? (
            <>
              <Metric label={tr('Dataset')} value={rows.length} sub={tr('{0} aktif di Analisis', rows.filter((d) => d.status === 'active').length)} />
              <Metric label={tr('Berkategori')} value={rows.filter((d) => d.category).length} sub={tr('{0} tanpa kategori', rows.filter((d) => !d.category).length)} />
              <Metric label={tr('Koneksi sumber')} value={new Set(rows.map((d) => d.connectionId)).size} sub={tr('dipakai dataset')} />
            </>
          ) : (
            Array.from({ length: 3 }, (_, i) => <div key={i} className="metric"><Skeleton w="50%" h={10} /><Skeleton w="70%" h={20} style={{ marginTop: 6 }} /></div>)
          )}
        </section>
      )}
      <Card>
        <div className="toolbar">
          <SearchInput value={q} onChange={setQ} placeholder={tr('Cari dataset, kategori, sumber…')} label={tr('Cari dataset')} />
          <span className="grow" />
          {res.data && rows.length > 0 && (
            <span className="t-meta" aria-live="polite">
              {q.trim() ? tr('{0} dari {1} dataset cocok', filtered.length, rows.length) : tr('{0} dataset', rows.length)}
            </span>
          )}
        </div>
        {res.status === 'error' && !res.data ? (
          <ErrorState title={tr('Daftar dataset tidak dapat dimuat')} message={res.error ?? tr('')} onRetry={res.reload} />
        ) : !res.data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-busy="true">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} h={40} />)}</div>
        ) : !rows.length ? (
          <EmptyState title={tr('Belum ada dataset')} message={tr('Klik Buat dataset, pilih koneksi, schema, dan tabel sumber.')} action={canCreate ? <Link className="btn btn--sm btn--primary" to="/data/dataset/new"><DatabaseZap size={13} aria-hidden />{' '}{tr('Buat dataset')}</Link> : undefined} />
        ) : (
          <DataTable
            rows={filtered}
            columns={columns}
            rowKey={(d) => d.id}
            caption={tr('Daftar dataset')}
            onRowClick={(d) => navigate(`/data/dataset/${d.id}`)}
            initialSort={{ key: 'upd', dir: 'desc' }}
            // Paged (10–100 rows per page, remembered in this browser) and scrolling inside the card with the header
            // row kept on top, so the page never runs far down.
            pageSize={25}
            pageSizes={[10, 25, 50, 100]}
            pageSizeKey="dod.datasets.pageSize"
            resetKey={q.trim()}
            maxHeight="max(360px, calc(100dvh - 400px))"
            empty={<EmptyState title={tr('Tidak ada dataset yang cocok')} message={tr('Ubah kata kunci pencarian.')} />}
          />
        )}
      </Card>
      {deleting && <DeleteDatasetModal dataset={deleting} onClose={() => setDeleting(null)} onDeleted={() => (setDeleting(null), setNonce((n) => n + 1))} />}
    </div>
  )
}
