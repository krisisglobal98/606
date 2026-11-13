/**
 * Settings › Log Query (administrators): every query DOD sent to a source database — who, which dataset, when, how
 * long, how many rows, and whether it failed. SQL text and parameter values are never stored, so none is shown.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeft, ChevronRight, Download, Home, RefreshCw } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { Metric } from '@/components/common/Metric'
import { EmptyState, ErrorState, Skeleton } from '@/components/common/StateView'
import { SelectField } from '@/components/forms/SelectField'
import { DataTable, type Column } from '@/components/tables/DataTable'
import { useResource } from '@/hooks/useResource'
import { queryLogService, type QueryLogEntry, type QueryLogQuery } from '@/services/queryLog/queryLogService'
import { userService } from '@/services/users/userService'
import { dataWarehouseService } from '@/services/warehouse/dataWarehouseService'
import { toast } from '@/stores/uiStore'
import { csvCell } from '@/utils/csv'
import { formatDateTime, formatNumber } from '@/utils/format'
import { kindLabel, errorLabel, periodRange, type PeriodPreset } from './queryLogMeta'
import s from '../users/Users.module.css'
import { tr } from '@/i18n'

const PAGE = 100

export default function QueryLogPage() {
  const [preset, setPreset] = useState<PeriodPreset>('7')
  const [custom, setCustom] = useState(() => periodRange('7'))
  const [status, setStatus] = useState('')
  const [kind, setKind] = useState('')
  const [userId, setUserId] = useState('')
  const [datasetId, setDatasetId] = useState('')
  const [minMs, setMinMs] = useState('')
  const [offset, setOffset] = useState(0)
  const [nonce, setNonce] = useState(0)

  const range = preset === 'custom' ? custom : periodRange(preset)
  const query: QueryLogQuery = { ...range, limit: PAGE, offset, ...(status ? { status: status as QueryLogQuery['status'] } : {}), ...(kind ? { kind } : {}), ...(userId ? { userId } : {}), ...(datasetId ? { datasetId } : {}), ...(Number(minMs) > 0 ? { minDurationMs: Math.round(Number(minMs)) } : {}) }
  const key = JSON.stringify(query)
  const log = useResource((signal) => queryLogService.search(query, signal), `${key}#${nonce}`)
  const users = useResource((signal) => userService.list(signal), 'qlog-users')
  const datasets = useResource((signal) => dataWarehouseService.listDatasets(signal), 'qlog-datasets')
  const reset = <T,>(set: (v: T) => void) => (v: T) => (set(v), setOffset(0))
  const badRange = preset === 'custom' && custom.from > custom.to

  const columns: Column<QueryLogEntry>[] = useMemo(
    () => [
      { key: 'at', header: tr('Waktu'), width: 150, render: (r) => <span className="mono">{formatDateTime(r.startedAt)}</span> },
      { key: 'user', header: tr('Pengguna'), render: (r) => (r.userId ? <span className="strong">{r.userName ?? tr('(pengguna dihapus)')}<span className="sub mono">@{r.username ?? r.userId}</span></span> : <span className="t-meta">{tr('sistem')}</span>) },
      { key: 'dataset', header: tr('Dataset'), render: (r) => (r.datasetId ? r.datasetName ?? <span className="t-meta">{tr('(dataset dihapus)')}</span> : <span className="t-meta">{r.connectionName}</span>) },
      { key: 'kind', header: tr('Jenis'), render: (r) => <span title={r.kind}>{kindLabel(r.kind)}</span> },
      { key: 'ms', header: tr('Durasi'), align: 'right', render: (r) => `${formatNumber(r.durationMs)} ms` },
      { key: 'rows', header: tr('Baris'), align: 'right', render: (r) => (r.rows == null ? '–' : formatNumber(r.rows)) },
      {
        key: 'status',
        header: tr('Status'),
        render: (r) =>
          r.status === 'ok' ? (
            <span className="badge badge--success">{tr('Berhasil')}</span>
          ) : r.status === 'cancelled' ? (
            <span className="badge badge--warning">{tr('Dibatalkan')}</span>
          ) : (
            <span className="badge badge--danger" title={r.errorCode ?? ''}>{tr('Gagal')}{r.errorCode ? `: ${errorLabel(r.errorCode)}` : ''}</span>
          ),
      },
    ],
    [],
  )

  const exportCsv = () => {
    const items = log.data?.items ?? []
    const head = [tr('Waktu'), tr('Username'), tr('Pengguna'), tr('Dataset'), tr('Koneksi'), tr('Jenis'), tr('Durasi (ms)'), tr('Baris'), tr('Status'), tr('Kode error')]
    const lines = [head.map(csvCell).join(','), ...items.map((r) => [csvCell(r.startedAt), csvCell(r.username ?? ''), csvCell(r.userName ?? ''), csvCell(r.datasetName ?? r.datasetId ?? ''), csvCell(r.connectionName), csvCell(kindLabel(r.kind)), String(r.durationMs), r.rows == null ? '' : String(r.rows), csvCell(r.status), csvCell(r.errorCode ?? '')].join(','))]
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = `dod-log-query-${range.from}_${range.to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast(tr('File CSV diunduh (baris yang sedang tampil).'), 'success')
  }

  const d = log.data
  const sm = d?.summary
  return (
    <div className={s.page}>
      <header className={s.head}>
        <div>
          <h1 className="t-page">{tr('Log Query')}</h1>
          <p className="t-meta">{tr('Setiap query DOD ke database sumber: siapa, dataset apa, kapan, berapa lama, dan berhasil atau gagal. Teks SQL dan nilai parameter tidak disimpan.')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<Download size={14} aria-hidden />} onClick={exportCsv} disabled={!d?.items.length}>{tr('Ekspor CSV')}</Button>
          <Button icon={<RefreshCw size={14} aria-hidden />} onClick={() => setNonce((n) => n + 1)}>{tr('Muat ulang')}</Button>
        </div>
      </header>
      <nav className={s.crumbs} aria-label={tr('Lokasi halaman')}>
        <Home size={13} aria-hidden />
        <Link to="/settings">{tr('Settings')}</Link>
        <ChevronRight size={12} aria-hidden />
        <span aria-current="page">{tr('Log Query')}</span>
      </nav>

      <Card>
        <div className={s.toolbar} style={{ flexWrap: 'wrap' }}>
          <SelectField label={tr('Periode')} size="sm" value={preset} onChange={reset((v: string) => setPreset(v as PeriodPreset))} options={[{ value: 'today', label: tr('Hari ini') }, { value: '7', label: tr('7 hari terakhir') }, { value: '30', label: tr('30 hari terakhir') }, { value: 'custom', label: tr('Rentang sendiri') }]} />
          {preset === 'custom' && (
            <>
              <label className="field"><span className="t-label">{tr('Dari')}</span><input className="input" type="date" value={custom.from} max={custom.to} onChange={(e) => (setCustom({ ...custom, from: e.target.value }), setOffset(0))} /></label>
              <label className="field"><span className="t-label">{tr('Sampai')}</span><input className="input" type="date" value={custom.to} min={custom.from} onChange={(e) => (setCustom({ ...custom, to: e.target.value }), setOffset(0))} /></label>
            </>
          )}
          <SelectField label={tr('Status')} size="sm" value={status} onChange={reset(setStatus)} options={[{ value: '', label: tr('Semua status') }, { value: 'ok', label: tr('Berhasil') }, { value: 'error', label: tr('Gagal') }, { value: 'cancelled', label: tr('Dibatalkan') }]} />
          <SelectField label={tr('Jenis')} size="sm" value={kind} onChange={reset(setKind)} options={[{ value: '', label: tr('Semua jenis') }, ...(d?.kinds ?? (kind ? [kind] : [])).map((k) => ({ value: k, label: kindLabel(k) }))]} />
          <SelectField label={tr('Pengguna')} size="sm" value={userId} onChange={reset(setUserId)} options={[{ value: '', label: tr('Semua pengguna') }, ...(users.data ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.username})` }))]} />
          <SelectField label={tr('Dataset')} size="sm" value={datasetId} onChange={reset(setDatasetId)} options={[{ value: '', label: tr('Semua dataset') }, ...(datasets.data ?? []).map((x) => ({ value: x.id, label: x.name }))]} />
          <label className="field"><span className="t-label">{tr('Durasi minimal (ms)')}</span><input className="input" type="number" min={0} step={100} value={minMs} placeholder="0" onChange={(e) => (setMinMs(e.target.value), setOffset(0))} style={{ width: 120 }} /></label>
        </div>
      </Card>

      {badRange ? (
        <Card><EmptyState title={tr('Rentang tanggal tidak valid')} message={tr('Tanggal mulai harus sebelum tanggal akhir.')} /></Card>
      ) : log.status === 'error' && !d ? (
        <Card><ErrorState title={tr('Log query tidak dapat dimuat')} message={log.error ?? tr('')} onRetry={log.reload} /></Card>
      ) : (
        <>
          <section className="metrics" aria-label={tr('Ringkasan log query')}>
            {sm ? (
              <>
                <Metric label={tr('Query')} value={formatNumber(sm.count)} sub={tr('{0} s.d. {1}', range.from, range.to)} />
                <Metric label={tr('Gagal')} value={formatNumber(sm.errors)} sub={sm.count ? tr('{0}% dari semua query', formatNumber((sm.errors / sm.count) * 100, 1)) : tr('–')} />
                <Metric label={tr('Dibatalkan')} value={formatNumber(sm.cancelled)} sub={tr('pengguna pindah halaman / menutup')} />
                <Metric label={tr('Durasi p50 / p95')} value={sm.p50Ms == null ? '–' : `${formatNumber(sm.p50Ms)} / ${formatNumber(sm.p95Ms ?? 0)}`} unit="ms" sub={tr('separuh / 95% query selesai dalam waktu ini')} />
                <Metric label={tr('Terlama')} value={sm.maxMs == null ? '–' : formatNumber(sm.maxMs)} unit="ms" />
              </>
            ) : (
              Array.from({ length: 5 }, (_, i) => <div key={i} className="metric"><Skeleton w="50%" h={10} /><Skeleton w="70%" h={20} style={{ marginTop: 6 }} /></div>)
            )}
          </section>
          <Card>
            {!d ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-busy="true">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={36} />)}</div>
            ) : (
              <>
                <DataTable rows={d.items} columns={columns} rowKey={(r) => r.id} caption={tr('Log query')} pageSize={PAGE} empty={<EmptyState title={tr('Tidak ada query pada periode dan filter ini')} message={tr('Ubah periode atau filter.')} />} />
                {d.total > PAGE && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
                    <span className="t-meta">{tr('{0}–{1} dari {2}', formatNumber(offset + 1), formatNumber(Math.min(offset + PAGE, d.total)), formatNumber(d.total))}</span>
                    <Button size="sm" icon={<ChevronLeft size={14} aria-hidden />} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{tr('Sebelumnya')}</Button>
                    <Button size="sm" icon={<ChevronRight size={14} aria-hidden />} disabled={offset + PAGE >= d.total} onClick={() => setOffset(offset + PAGE)}>{tr('Berikutnya')}</Button>
                  </div>
                )}
              </>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
