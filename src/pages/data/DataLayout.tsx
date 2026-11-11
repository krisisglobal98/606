import { Suspense } from 'react'
import { Outlet } from 'react-router'
import { LoadingState } from '@/components/common/StateView'
import { tr } from '@/i18n'

/** Data: datasets and their categories. Source connections are set in the server's .env, not here. */
export default function DataLayout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', padding: '2px 2px 0' }}>
        <h1 className="t-page">{tr('Data')}</h1>
        <p style={{ color: 'var(--muted)' }}>{tr('Dataset dari koneksi sumber yang diatur di server, siap dipakai Analisis dan Report.')}</p>
      </div>
      <Suspense fallback={<LoadingState label={tr('Memuat halaman…')} height={360} />}>
        <Outlet />
      </Suspense>
    </div>
  )
}
