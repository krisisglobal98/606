import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { AlertCircle, Eye, EyeOff, KeyRound, Languages, LogIn, User } from 'lucide-react'
import { allowedLanding } from '@/app/auth/menuAccess'
import { Logo } from '@/app/layout/Logo'
import { Button } from '@/components/common/Button'
import { TextField } from '@/components/forms/TextField'
import { env } from '@/config/env'
import { ApiError } from '@/services/api/apiClient'
import { isSessionValid, useAuthStore } from '@/stores/authStore'
import { useUiStore } from '@/stores/uiStore'
import { LoginRequestSchema } from '@/types/contracts'
import s from './LoginPage.module.css'
import { LANGUAGE, setLanguage, tr, type Language } from '@/i18n'

type Errors = Partial<Record<'username' | 'password', string>>

// Each language is named in itself, so it can be found whichever one is showing.
const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'id', label: 'Bahasa Indonesia' },
  { id: 'en', label: 'English' },
]

export default function LoginPage() {
  const login = useAuthStore((st) => st.login)
  const valid = useAuthStore(isSessionValid)
  const landing = useUiStore((st) => st.settings.landingPage)
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: string } | null)?.from

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [deviceInUse, setDeviceInUse] = useState(false)

  if (valid && !loading) return <Navigate to={allowedLanding(useAuthStore.getState().user, from ?? landing)} replace />

  const submit = async (takeOver: boolean) => {
    setFormError(null)
    const parsed = LoginRequestSchema.safeParse({ username, password, ...(takeOver ? { takeOver } : {}) })
    if (!parsed.success) {
      const fe: Errors = {}
      for (const i of parsed.error.issues) fe[i.path[0] as keyof Errors] ??= i.message
      setErrors(fe)
      document.getElementById(fe.username ? 'login-username' : 'login-password')?.focus()
      return
    }
    setErrors({})
    setLoading(true)
    try {
      const user = await login(parsed.data)
      setDeviceInUse(false)
      navigate(allowedLanding(user, from ?? landing), { replace: true })
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : tr('Tidak dapat masuk. Coba lagi.'))
      setDeviceInUse(err instanceof ApiError && err.code === 'DEVICE_IN_USE')
      setLoading(false)
    }
  }
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit(false)
  }

  return (
    <div className={s.page}>
      <div className={s.wrap}>
        <div className={s.brand}>
          <Logo variant="full" size={64} alt="DOD" />
          <div>
            <b>Daily Operation Discovery</b>
            <span>{tr('Analisis data operasional harian')}</span>
          </div>
        </div>

        <div className={s.language} role="group" aria-label="Bahasa / Language">
          <Languages size={15} aria-hidden />
          {LANGUAGES.map((l) => (
            <button key={l.id} type="button" className={s.languageOption} aria-pressed={LANGUAGE === l.id} disabled={loading} onClick={() => setLanguage(l.id)}>
              {l.label}
            </button>
          ))}
        </div>

        <form className={`card ${s.card}`} onSubmit={onSubmit} noValidate aria-labelledby="login-title">
          <div className={s.head}>
            <h1 id="login-title" className="t-page">
              {tr('Masuk ke Daily Operation Discovery')}
            </h1>
            <p className="t-meta">{tr('Gunakan akun Anda untuk membuka laporan dan ruang analisis.')}</p>
          </div>

          {formError && (
            <div className={s.alert} role="alert">
              <AlertCircle size={16} aria-hidden />
              <span>{formError}</span>
            </div>
          )}
          {/* One device, one user: the other user is signed out of this device (every browser), then this one signs in. */}
          {deviceInUse && (
            <Button type="button" variant="outline" block onClick={() => void submit(true)} disabled={loading}>
              {tr('Keluarkan akun tersebut dan masuk')}
            </Button>
          )}

          <TextField
            id="login-username"
            label={tr('Username')}
            required
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => (setUsername(e.target.value), errors.username && setErrors({ ...errors, username: undefined }))}
            error={errors.username}
            icon={<User size={15} aria-hidden />}
            disabled={loading}
          />
          <TextField
            id="login-password"
            label={tr('Password')}
            required
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(e) => (setPassword(e.target.value), errors.password && setErrors({ ...errors, password: undefined }))}
            error={errors.password}
            icon={<KeyRound size={15} aria-hidden />}
            disabled={loading}
            action={
              <button type="button" className="icon-btn" onClick={() => setShow((v) => !v)} aria-label={show ? tr('Sembunyikan password') : tr('Tampilkan password')} aria-pressed={show}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
          />

          <Button type="submit" variant="primary" size="lg" block loading={loading} icon={<LogIn size={16} aria-hidden />}>
            {loading ? tr('Memeriksa…') : tr('Masuk')}
          </Button>

        </form>

        <p className={s.foot}>
          {env.appName} v{env.version} · {env.appEnv}
        </p>
      </div>
    </div>
  )
}
