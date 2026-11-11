import { Suspense } from 'react'
import { Outlet } from 'react-router'
import { LoadingState } from '@/components/common/StateView'
import { tr } from '@/i18n'

/** Report: Laporan Operasional (layouts saved from Analisis). Laporan PDF was removed from DOD Minimal. */
export default function ReportLayout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', padding: '2px 2px 0' }}>
        <h1 className="t-page">{tr('Report')}</h1>
        <p style={{ color: 'var(--muted)' }}>{tr('Laporan operasional yang disimpan dari halaman Analisis.')}</p>
      </div>
      <Suspense fallback={<LoadingState label={tr('Memuat halaman…')} height={300} />}>
        <Outlet />
      </Suspense>
    </div>
  )
}
