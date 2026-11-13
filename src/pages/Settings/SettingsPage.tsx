import { useState } from 'react'
import { Link } from 'react-router'
import { Info, KeyRound, Moon, Palette, Save, ScrollText, SlidersHorizontal, Sun, UserRound, Users } from 'lucide-react'
import { allowedLanding, useCanOpen } from '@/app/auth/menuAccess'
import { Logo } from '@/app/layout/Logo'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { Segmented } from '@/components/common/Segmented'
import { SelectField } from '@/components/forms/SelectField'
import { TextField } from '@/components/forms/TextField'
import { env } from '@/config/env'
import { useAnalysisStore } from '@/stores/analysisStore'
import { useAuthStore } from '@/stores/authStore'
import { toast, useUiStore } from '@/stores/uiStore'
import type { Settings } from '@/types/contracts'
import s from './SettingsPage.module.css'
import { tr } from '@/i18n'

const ROLE: Record<string, string> = { admin: tr('Administrator'), analyst: tr('Analyst'), publisher: tr('Publisher'), viewer: tr('Viewer') }

export default function SettingsPage() {
  const user = useAuthStore((st) => st.user)
  const can = useCanOpen()
  const saved = useUiStore((st) => st.settings)
  const setSettings = useUiStore((st) => st.setSettings)
  const [prefs, setPrefs] = useState({ landingPage: saved.landingPage, defaultChartType: saved.defaultChartType })
  const [saving, setSaving] = useState(false)
  const dirty = prefs.landingPage !== saved.landingPage || prefs.defaultChartType !== saved.defaultChartType

  // Preferences are kept per browser (uiStore, localStorage); there is no server copy.
  const persist = (next: Settings) => Promise.resolve(next)

  // Appearance applies and saves immediately.
  const updateAppearance = (patch: Pick<Partial<Settings>, 'theme' | 'density'>) => {
    const next = { ...saved, ...patch }
    setSettings(patch)
    void persist(next).catch(() => {})
  }

  const save = async () => {
    setSaving(true)
    try {
      const out = await persist({ ...saved, ...prefs })
      setSettings(out)
      useAnalysisStore.getState().setChartType(out.defaultChartType)
      toast(tr('Preferensi disimpan.'), 'success')
    } catch {
      /* toast already shown */
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div>
          <h1 className="t-page">{tr('Settings')}</h1>
          <p className={s.desc}>{tr('Profil, tampilan, dan preferensi aplikasi Anda.')}</p>
        </div>
        <div className={s.actions}>
          {dirty && <span className="t-meta">{tr('Preferensi belum disimpan')}</span>}
          {user?.role === 'admin' && can('settings.permissions') && (
            <Link className="btn" to="/settings/permissions">
              <KeyRound size={15} aria-hidden />{' '}{tr('Hak akses menu')}
            </Link>
          )}
          {user?.role === 'admin' && can('settings.querylog') && (
            <Link className="btn" to="/settings/query-log">
              <ScrollText size={15} aria-hidden />{' '}{tr('Log query')}
            </Link>
          )}
          {user?.role === 'admin' && can('settings.users') && (
            <Link className="btn" to="/settings/users">
              <Users size={15} aria-hidden />{' '}{tr('Kelola pengguna')}
            </Link>
          )}
          <Button variant="primary" icon={<Save size={15} aria-hidden />} onClick={save} loading={saving} disabled={!dirty}>
            {tr('Simpan Preferensi')}
          </Button>
        </div>
      </header>

      <div className={s.grid}>
        <Card title={<Title icon={<UserRound size={15} />}>{tr('Profil')}</Title>} subtitle={tr('Dikelola oleh administrator sistem.')}>
          <div className={s.profile}>
            <span className={s.avatar} aria-hidden>
              {user?.name
                .split(/\s+/)
                .slice(0, 2)
                .map((p) => p[0])
                .join('')}
            </span>
            <div>
              <b>{user?.name}</b>
              <span className="t-meta">@{user?.username}</span>
            </div>
          </div>
          <div className={s.form}>
            <TextField label={tr('Nama')} value={user?.name ?? ''} readOnly />
            <TextField label={tr('Username')} value={user?.username ?? ''} readOnly />
            <TextField label={tr('Role')} value={ROLE[user?.role ?? ''] ?? user?.role ?? ''} readOnly />
          </div>
        </Card>

        <Card title={<Title icon={<Palette size={15} />}>{tr('Tampilan')}</Title>} subtitle={tr('Berlaku dan tersimpan langsung.')}>
          <div className={s.themes} role="radiogroup" aria-label={tr('Tema')}>
            {(['light', 'dark'] as const).map((th) => (
              <button key={th} type="button" role="radio" aria-checked={saved.theme === th} className={`${s.theme}${saved.theme === th ? ` ${s.on}` : ''}`} onClick={() => updateAppearance({ theme: th })}>
                <span className={`${s.preview} ${th === 'dark' ? s.pvDark : s.pvLight}`} aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <span className={s.themeLabel}>
                  {th === 'light' ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
                  {th === 'light' ? tr('Light') : tr('Dark')}
                </span>
              </button>
            ))}
          </div>
          <div className="field" style={{ marginTop: 14 }}>
            <span className="t-label">{tr('Kepadatan')}</span>
            <Segmented
              label={tr('Kepadatan')}
              value={saved.density}
              onChange={(v) => updateAppearance({ density: v })}
              options={[
                { value: 'comfortable', label: tr('Nyaman') },
                { value: 'compact', label: tr('Ringkas') },
              ]}
            />
            <span className="t-meta">{tr('Ringkas mengecilkan jarak dan tinggi baris agar lebih banyak data terlihat.')}</span>
          </div>
        </Card>

        <Card title={<Title icon={<SlidersHorizontal size={15} />}>{tr('Preferensi Aplikasi')}</Title>} subtitle={tr('Disimpan ke akun Anda.')}>
          <div className={s.form}>
            <SelectField
              label={tr('Halaman awal setelah masuk')}
              value={prefs.landingPage}
              onChange={(v) => setPrefs({ ...prefs, landingPage: v as Settings['landingPage'] })}
              options={[
                { value: '/beranda', label: tr('Beranda') },
                { value: '/analisis', label: tr('Analisis') },
              ].filter((o) => o.value === prefs.landingPage || allowedLanding(user, o.value) === o.value)}
            />
            <SelectField
              label={tr('Jenis grafik default')}
              value={prefs.defaultChartType}
              onChange={(v) => setPrefs({ ...prefs, defaultChartType: v as Settings['defaultChartType'] })}
              options={[
                { value: 'line', label: tr('Line') },
                { value: 'bar', label: tr('Bar') },
                { value: 'area', label: tr('Area') },
              ]}
            />
            <div className="field">
              <span className="t-label">{tr('Density')}</span>
              <span className="t-meta">
                {tr('Diatur di bagian Tampilan:')}{' '}<b>{saved.density === 'compact' ? tr('Ringkas') : tr('Nyaman')}</b>.
              </span>
            </div>
          </div>
        </Card>

        <Card title={<Title icon={<Info size={15} />}>{tr('Tentang')}</Title>}>
          <div className={s.about}>
            <Logo size={44} />
            <div>
              <b>{tr('Daily Operation Discovery')}</b>
              <span className="t-meta">{tr('Aplikasi analitik data · frontend fase 1')}</span>
            </div>
          </div>
          <dl className={s.dl}>
            <dt>{tr('Versi')}</dt>
            <dd>{env.version}</dd>
            <dt>{tr('Environment')}</dt>
            <dd>
              <span className="badge badge--info">{env.appEnv}</span>
            </dd>
            <dt>{tr('API')}</dt>
            <dd>
              <code>{env.apiBaseUrl}</code> <span className="badge badge--success">{tr('live')}</span>
            </dd>
          </dl>
        </Card>
      </div>
    </div>
  )
}

function Title({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
      <span style={{ color: 'var(--primary)', display: 'inline-flex' }} aria-hidden>
        {icon}
      </span>
      {children}
    </span>
  )
}
