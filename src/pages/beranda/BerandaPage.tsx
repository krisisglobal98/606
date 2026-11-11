import { useAuthStore } from '@/stores/authStore'
import { tr } from '@/i18n'

/** Beranda: the plain start page of DOD Minimal (title and greeting; no map, no contact buttons). */
export default function BerandaPage() {
  const name = useAuthStore((s) => s.user?.name)
  return (
    <div style={{ padding: '2px 2px 0' }}>
      <h1 className="t-page">{tr('Beranda')}</h1>
      {name && <p style={{ color: 'var(--muted)' }}>{tr('Selamat datang, {0}.', name)}</p>}
    </div>
  )
}
