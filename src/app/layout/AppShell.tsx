import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { BarChart3, ChevronDown, Database, FileText, House, KeyRound, LogOut, Settings as SettingsIcon } from 'lucide-react'
import { Dropdown } from '@/components/common/Dropdown'
import { LoadingState } from '@/components/common/StateView'
import { allowedLanding, canOpen } from '@/app/auth/menuAccess'
import { useAuthStore } from '@/stores/authStore'
import { toast, useUiStore } from '@/stores/uiStore'
import { ChangePasswordModal } from './ChangePasswordModal'
import { Logo } from './Logo'
import s from './AppShell.module.css'
import { tr } from '@/i18n'

// Beranda is the plain start page.
// Each item is a menu of Settings → Hak Akses Menu (`menu`); the server sends the allowed ones with the user.
const NAV: { to: string; menu: string; label: string; Icon: typeof House; roles?: string[] }[] = [
  { to: '/beranda', menu: 'beranda', label: tr('Beranda'), Icon: House },
  { to: '/analisis', menu: 'analisis', label: tr('Analisis'), Icon: BarChart3 },
  { to: '/report', menu: 'report', label: tr('Report'), Icon: FileText },
  { to: '/data', menu: 'data', label: tr('Data'), Icon: Database },
  { to: '/settings', menu: 'settings', label: tr('Settings'), Icon: SettingsIcon },
]

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

export function AppShell() {
  const user = useAuthStore((st) => st.user)
  const logout = useAuthStore((st) => st.logout)
  const [pwOpen, setPwOpen] = useState(false)
  const landing = useUiStore((st) => st.settings.landingPage)
  const navigate = useNavigate()
  const refresh = useAuthStore((st) => st.refresh)

  // Menu permissions may change while a session lasts: reload the user on start and when the tab is shown again.
  useEffect(() => {
    let last = 0
    const run = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 60_000) return
      last = Date.now()
      void refresh().catch(() => undefined)
    }
    run()
    document.addEventListener('visibilitychange', run)
    return () => document.removeEventListener('visibilitychange', run)
  }, [refresh])

  const onLogout = async () => {
    await logout()
    toast(tr('Anda telah keluar.'))
    navigate('/login', { replace: true })
  }

  return (
    <div className={s.shell}>
      <header className={s.top}>
        <div className={s.brandNav}>
          <NavLink to={allowedLanding(user, landing)} className={s.brand} aria-label={tr('Daily Operation Discovery – ke halaman awal')}>
            <Logo size={32} />
            <span className={s.brandName}>
              {tr('Daily Operation')}
              <br />
              {tr('Discovery')}
            </span>
          </NavLink>
          <nav className="seg" aria-label={tr('Menu utama')}>
            {NAV.filter((n) => canOpen(user, n.menu) && (!n.roles || (user && n.roles.includes(user.role)))).map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'is-on' : '')}>
                <Icon size={15} aria-hidden />
                <span className={s.navLabel}>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
        <Dropdown
          trigger={({ open, toggle, id }) => (
            <button className={s.user} onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={id}>
              <span className={s.avatar} aria-hidden>
                {initials(user?.name ?? '?')}
              </span>
              <span className={s.userText}>
                <b>{user?.name}</b>
                <small>{user?.role === 'admin' ? tr('Administrator') : user?.role === 'publisher' ? tr('Publisher') : user?.role}</small>
              </span>
              <ChevronDown size={14} aria-hidden />
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="menu-head">{tr('Masuk sebagai @')}{user?.username}</div>
              <button role="menuitem" onClick={() => (close(), navigate('/settings'))}>
                <SettingsIcon size={15} />{' '}{tr('Settings')}
              </button>
              <button role="menuitem" onClick={() => (close(), setPwOpen(true))}>
                <KeyRound size={15} />{' '}{tr('Ubah password')}
              </button>
              <hr />
              <button role="menuitem" onClick={() => (close(), void onLogout())}>
                <LogOut size={15} />{' '}{tr('Keluar')}
              </button>
            </>
          )}
        </Dropdown>
      </header>
      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
      <main className={s.main} id="main">
        <Suspense fallback={<LoadingState label={tr('Memuat halaman…')} height={400} />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
