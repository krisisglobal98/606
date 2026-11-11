import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { ChevronRight, Home, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { Metric } from '@/components/common/Metric'
import { EmptyState, ErrorState, Skeleton } from '@/components/common/StateView'
import { ICON } from '@/components/data/status'
import { StatusBadge } from '@/components/data/StatusBadge'
import { SearchInput } from '@/components/forms/SearchInput'
import { SelectField } from '@/components/forms/SelectField'
import { DataTable, type Column } from '@/components/tables/DataTable'
import { useResource } from '@/hooks/useResource'
import { ApiError } from '@/services/api/apiClient'
import { userService } from '@/services/users/userService'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/uiStore'
import type { ManagedUser } from '@/types/users'
import { formatDateTime, formatNumber, formatRelative } from '@/utils/format'
import { accessSummary, ROLE_LABEL, ROLES } from './userMeta'
import s from './Users.module.css'
import { tr } from '@/i18n'

export function Crumbs({ current }: { current?: string }) {
  return (
    <nav className={s.crumbs} aria-label={tr('Lokasi halaman')}>
      <Home size={13} aria-hidden />
      <Link to="/settings">{tr('Settings')}</Link>
      <ChevronRight size={12} aria-hidden />
      {current ? <Link to="/settings/users">{tr('Pengguna')}</Link> : <span aria-current="page">{tr('Pengguna')}</span>}
      {current && (
        <>
          <ChevronRight size={12} aria-hidden />
          <span aria-current="page">{current}</span>
        </>
      )}
    </nav>
  )
}

export function AdminOnly() {
  return (
    <Card>
      <EmptyState title={tr('Khusus administrator')} message={tr('Hanya administrator yang dapat mengelola pengguna DOD.')} action={<Link className="btn btn--sm" to="/settings">{tr('Kembali ke Settings')}</Link>} />
    </Card>
  )
}

/** Settings → Pengguna: DOD users (dor_user) and the organization master they are scoped to. */
export default function UsersPage() {
  const isAdmin = useAuthStore((st) => st.user?.role === 'admin')
  if (!isAdmin) return <AdminOnly />
  return <Users />
}

function Users() {
  const navigate = useNavigate()
  const [nonce, setNonce] = useState(0)
  const list = useResource((signal) => userService.list(signal), `users${nonce}`)
  const org = useResource((signal) => userService.orgStatus(signal), `org${nonce}`)
  const [q, setQ] = useState('')
  const [role, setRole] = useState('all')
  const [status, setStatus] = useState('all')
  const [reloading, setReloading] = useState(false)
  const rows = useMemo(() => list.data ?? [], [list.data])

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return rows.filter(
      (u) =>
        (role === 'all' || u.role === role) &&
        (status === 'all' || (status === 'active') === u.active) &&
        (!term || `${u.name} ${u.username} ${u.externalSubject ?? ''}`.toLowerCase().includes(term)),
    )
  }, [rows, q, role, status])

  /** Drops the server's organization snapshot (read again from PIMS at the next request; nothing is copied). */
  const reloadMaster = async () => {
    setReloading(true)
    try {
      const r = await userService.orgReload()
      toast(r.available ? tr('Master organisasi dibaca ulang dari PIMS.') : tr('Master organisasi tidak dapat dihubungi.'), r.available ? 'success' : 'error')
      setNonce((n) => n + 1)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : tr('Master organisasi gagal dibaca ulang.'), 'error')
    } finally {
      setReloading(false)
    }
  }

  const columns: Column<ManagedUser>[] = [
    {
      key: 'name',
      header: tr('Pengguna'),
      sort: (u) => u.name.toLowerCase(),
      render: (u) => (
        <span className="strong">
          {u.name}
          <span className="sub mono">@{u.username}</span>
        </span>
      ),
    },
    { key: 'role', header: tr('Peran'), sort: (u) => u.role, render: (u) => ROLE_LABEL[u.role] },
    { key: 'access', header: tr('Akses data'), sort: (u) => u.assignments, render: (u) => <span className={u.assignments ? undefined : 't-meta'}>{accessSummary(u)}</span> },
    { key: 'sso', header: 'SSO', sort: (u) => (u.identityIssuer ? 1 : 0), render: (u) => (u.identityIssuer ? <span className="badge badge--info" title={`${u.identityIssuer} · ${u.externalSubject}`}>{tr('SSO')}</span> : <span className="t-meta">{tr('Login lokal')}</span>) },
    { key: 'status', header: tr('Status'), sort: (u) => (u.active ? 1 : 0), render: (u) => <StatusBadge meta={u.active ? { label: tr('Aktif'), tone: 'success', icon: ICON.check } : { label: tr('Nonaktif'), tone: 'neutral', icon: ICON.off }} /> },
    { key: 'updated', header: tr('Diperbarui'), sort: (u) => u.updatedAt, render: (u) => <span style={{ whiteSpace: 'nowrap' }}>{formatRelative(u.updatedAt)}<span className="sub">{u.updatedBy ? tr('oleh {0}', u.updatedBy.name) : formatDateTime(u.updatedAt)}</span></span> },
  ]

  const o = org.data

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div>
          <h1 className="t-page">{tr('Pengguna')}</h1>
          <p className={s.desc}>{tr('Kelola identitas, peran aplikasi, dan akses data pengguna DOD.')}</p>
        </div>
        <div className={s.actions}>
          {o?.configured && (
            <Button icon={<RefreshCw size={14} aria-hidden />} loading={reloading} onClick={() => void reloadMaster()} title={o.loadedAt ? tr('Dibaca {0}', formatDateTime(o.loadedAt)) : undefined}>
              {tr('Muat ulang master')}
            </Button>
          )}
          <Link className="btn btn--primary" to="/settings/users/new">
            <Plus size={14} aria-hidden />{' '}{tr('Tambah pengguna')}
          </Link>
        </div>
      </header>
      <Crumbs />

      {list.status !== 'error' && (
        <section className="metrics" aria-label={tr('Ringkasan pengguna')}>
          {list.data ? (
            <>
              <Metric label={tr('Pengguna')} value={formatNumber(rows.length)} sub={tr('{0} aktif', rows.filter((u) => u.active).length)} />
              <Metric label={tr('Administrator')} value={rows.filter((u) => u.role === 'admin' && u.active).length} sub={tr('aktif')} />
              <Metric label={tr('Identitas SSO')} value={rows.filter((u) => u.identityIssuer).length} sub={tr('issuer + external subject')} />
              <Metric label={tr('Tanpa akses data')} value={rows.filter((u) => u.active && !u.assignments).length} sub={tr('pengguna aktif tanpa assignment')} />
              <Metric
                label={tr('Master organisasi PIMS')}
                value={o ? (o.available ? tr('Tersedia') : tr('Tidak tersedia')) : '–'}
                sub={o?.loadedAt ? tr('dibaca {0} · berlaku {1} detik', formatRelative(o.loadedAt), o.cacheSeconds) : o?.configured ? tr('belum dibaca') : tr('akun read-only belum dikonfigurasi')}
              />
            </>
          ) : (
            Array.from({ length: 4 }, (_, i) => <div key={i} className="metric"><Skeleton w="50%" h={10} /><Skeleton w="70%" h={20} style={{ marginTop: 6 }} /></div>)
          )}
        </section>
      )}

      {o && (!o.configured || !o.available) && (
        <div className="callout callout--warning" role="note">
          <span>
            {o.configured ? tr('Master organisasi PIMS tidak dapat dihubungi ({0}).', o.error ?? '') : tr('Akun read-only master organisasi (DOD_ORG_DB_*) belum dikonfigurasi di server.')}{tr(' ')}
            {tr('Pengguna tanpa hak unrestricted_data tidak mendapat data laporan sampai master tersedia.')}
          </span>
        </div>
      )}

      <Card>
        {list.status === 'error' ? (
          <ErrorState title={tr('Daftar pengguna tidak dapat dimuat')} message={list.error ?? tr('')} onRetry={list.reload} />
        ) : !list.data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-busy="true">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} h={44} />)}</div>
        ) : (
          <>
            <div className={s.toolbar}>
              <SearchInput value={q} onChange={setQ} placeholder={tr('Cari nama atau username')} label={tr('Cari pengguna')} />
              <SelectField label={tr('Peran')} hideLabel size="sm" value={role} onChange={setRole} options={[{ value: 'all', label: tr('Semua peran') }, ...ROLES.map((r) => ({ value: r.value, label: r.label }))]} />
              <SelectField label={tr('Status')} hideLabel size="sm" value={status} onChange={setStatus} options={[{ value: 'all', label: tr('Semua status') }, { value: 'active', label: tr('Aktif') }, { value: 'inactive', label: tr('Nonaktif') }]} />
            </div>
            <DataTable
              rows={shown}
              columns={columns}
              rowKey={(u) => u.id}
              caption={tr('Pengguna DOD')}
              onRowClick={(u) => navigate(`/settings/users/${u.id}`)}
              initialSort={{ key: 'name', dir: 'asc' }}
              pageSize={25}
              empty={<EmptyState title={tr('Tidak ada pengguna yang cocok')} message={tr('Ubah kata kunci atau filter.')} />}
            />
          </>
        )}
      </Card>
      <p className="t-meta" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <ShieldCheck size={14} aria-hidden />{' '}{tr('Password disimpan sebagai hash di server dan tidak pernah ditampilkan. Pengguna tidak dihapus; nonaktifkan untuk mencabut akses.')}
      </p>
    </div>
  )
}
