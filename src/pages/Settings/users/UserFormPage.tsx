import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { AlertCircle, ArrowLeft, Info, KeyRound, Link2, Network, Save, Settings2, ShieldCheck, UserRound } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { ErrorState, Skeleton } from '@/components/common/StateView'
import { Switch } from '@/components/common/Switch'
import { useResource } from '@/hooks/useResource'
import { ApiError } from '@/services/api/apiClient'
import { userService } from '@/services/users/userService'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/uiStore'
import type { FieldProblem, ManagedUser, UserInput } from '@/types/users'
import { formatDateTime } from '@/utils/format'
import { AccessSection } from './AccessSection'
import { AdminOnly, Crumbs } from './UsersPage'
import { fromUser, missing, NEW_USER, ROLES } from './userMeta'
import s from './Users.module.css'
import { tr } from '@/i18n'

/** Settings → Pengguna → Tambah / Ubah pengguna (administrator): identity and role; data access separately. */
export default function UserFormPage() {
  const { id } = useParams()
  const isAdmin = useAuthStore((st) => st.user?.role === 'admin')
  const existing = useResource((signal) => (id ? userService.get(id, signal) : Promise.resolve(null)), id ?? 'new')
  if (!isAdmin) return <AdminOnly />
  const title = id ? tr('Ubah pengguna') : tr('Tambah pengguna')
  const body =
    id && existing.status === 'error' && !existing.data ? (
      <Card><ErrorState message={existing.error ?? tr('')} onRetry={existing.reload} /></Card>
    ) : id && !existing.data ? (
      <Card><Skeleton h={520} /></Card>
    ) : (
      <Form key={existing.data?.id ?? 'new'} existing={existing.data} />
    )
  return (
    <div className={s.page}>
      <header className={s.head}>
        <div>
          <h1 className="t-page">{tr('Pengguna')}</h1>
          <p className={s.desc}>{tr('Kelola identitas, peran aplikasi, dan akses data pengguna DOD.')}</p>
        </div>
      </header>
      <Crumbs current={title} />
      {body}
    </div>
  )
}

export function Section({ icon, title, optional, sub, children }: { icon: ReactNode; title: string; optional?: boolean; sub: string; children: ReactNode }) {
  return (
    <section className={s.section} aria-label={title}>
      <div className={s.sectionHead}>
        {icon}
        <b>
          {title}
          {optional && <small>{tr('(opsional)')}</small>}
        </b>
        <span>{sub}</span>
      </div>
      {children}
    </section>
  )
}

function Err({ msg }: { msg?: string }) {
  return msg ? (
    <span className="field-error">
      <AlertCircle size={13} aria-hidden />
      {msg}
    </span>
  ) : null
}

function Form({ existing }: { existing: ManagedUser | null }) {
  const navigate = useNavigate()
  const me = useAuthStore((st) => st.user)
  const [v, setV] = useState<UserInput>(() => (existing ? fromUser(existing) : NEW_USER))
  const [problems, setProblems] = useState<FieldProblem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const self = existing?.id === me?.id
  const problem = (f: string) => problems.find((p) => p.field === f)?.message
  const todo = missing(v, !existing)

  const set = (p: Partial<UserInput>) => {
    setV((x) => ({ ...x, ...p }))
    setProblems((ps) => ps.filter((q) => !(q.field in p)))
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    setProblems([])
    const body: UserInput = { ...v, password: v.password || undefined }
    try {
      const u = existing ? await userService.update(existing.id, body) : await userService.create(body)
      toast(existing ? tr('Pengguna "{0}" diperbarui.', u.name) : tr('Pengguna "{0}" ditambahkan. Tetapkan akses datanya di halaman pengguna.', u.name), 'success')
      navigate(existing ? '/settings/users' : `/settings/users/${u.id}`)
    } catch (e) {
      const ps = e instanceof ApiError ? ((e.details as { problems?: FieldProblem[] } | undefined)?.problems ?? []) : []
      setProblems(ps)
      setError(e instanceof ApiError ? (ps.length ? tr('Periksa isian yang ditandai.') : e.message) : tr('Pengguna gagal disimpan.'))
      setSaving(false)
    }
  }

  return (
    <>
      <Card>
        <div className={s.formHead}>
          <div>
            <h2>{existing ? tr('Ubah pengguna') : tr('Tambah pengguna')}</h2>
            <p>{tr('Isi identitas dan peran aplikasi. Akses data ditetapkan terpisah oleh pengelola akses data.')}</p>
          </div>
          <Link className="btn" to="/settings/users">
            <ArrowLeft size={14} aria-hidden />{' '}{tr('Kembali ke daftar')}
          </Link>
        </div>

        <Section icon={<UserRound size={20} aria-hidden />} title={tr('Informasi dasar')} sub={tr('Identitas pengguna dan peran aplikasi DOD.')}>
          <div className={s.basic}>
            <div className="field">
              <label htmlFor="u-name" className="t-label">{tr('Nama lengkap')}{' '}<span className="req">*</span></label>
              <div className="input-wrap">
                <UserRound size={14} aria-hidden />
                <input id="u-name" className="input" value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder={tr('Masukkan nama lengkap pengguna')} maxLength={120} aria-invalid={!!problem('name')} />
              </div>
              <Err msg={problem('name')} />
            </div>
            <div className="field">
              <label htmlFor="u-username" className="t-label">{tr('Username')}{' '}<span className="req">*</span></label>
              <div className="input-wrap">
                <UserRound size={14} aria-hidden />
                <input id="u-username" className="input mono" value={v.username} onChange={(e) => set({ username: e.target.value })} placeholder={tr('Masukkan username')} maxLength={64} autoComplete="off" spellCheck={false} aria-invalid={!!problem('username')} />
              </div>
              <span className={s.hint}>{tr('Digunakan untuk login dan ditampilkan di aplikasi.')}</span>
              <Err msg={problem('username')} />
            </div>
            <div className="field">
              <span className="t-label">{tr('Peran aplikasi')}{' '}<span className="req">*</span></span>
              <div className={s.choiceRow} role="radiogroup" aria-label={tr('Peran aplikasi')}>
                {ROLES.map((r) => {
                  const locked = self && r.value !== 'admin'
                  return (
                    <label key={r.value} className={`${s.choice}${v.role === r.value ? ` ${s.choiceOn}` : ''}`} title={locked ? tr('Anda tidak dapat menurunkan peran akun Anda sendiri.') : r.hint} aria-disabled={locked}>
                      <input type="radio" name="role" checked={v.role === r.value} disabled={locked} onChange={() => set({ role: r.value })} />
                      {r.label}
                    </label>
                  )
                })}
              </div>
              <span className={s.hint}>{ROLES.find((r) => r.value === v.role)?.hint}{tr('. Peran hanya mengatur izin aplikasi, bukan data yang terlihat.')}</span>
            </div>
            <div className="field">
              <label htmlFor="u-password" className="t-label">{existing ? tr('Password baru') : tr('Password awal')} {!existing && <span className="req">*</span>}</label>
              <div className="input-wrap">
                <KeyRound size={14} aria-hidden />
                <input id="u-password" className="input" type="password" value={v.password ?? ''} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" placeholder={existing ? tr('Kosongkan bila tidak diganti') : tr('Minimal 8 karakter')} aria-invalid={!!problem('password')} />
              </div>
              <span className={s.hint}>{existing ? tr('Mengganti password mengakhiri semua sesi pengguna ini.') : tr('Sampaikan ke pengguna melalui saluran yang aman.')}</span>
              <Err msg={problem('password')} />
            </div>
          </div>
        </Section>

        <Section icon={<Link2 size={20} aria-hidden />} title={tr('Identitas SSO')} optional sub={tr('Untuk integrasi SSO tahap berikutnya; login saat ini dikelola DOD.')}>
          <div className={s.sso}>
            <div className="field">
              <label htmlFor="u-issuer" className="t-label">{tr('Identity issuer')}</label>
              <input id="u-issuer" className="input mono" value={v.identityIssuer ?? ''} onChange={(e) => set({ identityIssuer: e.target.value || null })} placeholder={tr('Masukkan identity issuer')} spellCheck={false} aria-invalid={!!problem('identityIssuer')} />
              <span className={s.hint}>{tr('Contoh: https://sso.perusahaan.com')}</span>
              <Err msg={problem('identityIssuer')} />
            </div>
            <div className="field">
              <label htmlFor="u-subject" className="t-label">{tr('External subject')}</label>
              <input id="u-subject" className="input mono" value={v.externalSubject ?? ''} onChange={(e) => set({ externalSubject: e.target.value || null })} placeholder={tr('Masukkan external subject')} spellCheck={false} aria-invalid={!!problem('externalSubject')} />
              <span className={s.hint}>{tr('Identitas unik pengguna dari penyedia identitas. Diisi bersama issuer; bukan username atau e-mail.')}</span>
              <Err msg={problem('externalSubject')} />
            </div>
          </div>
        </Section>

        <Section icon={<Settings2 size={20} aria-hidden />} title={tr('Status akun')} sub={existing ? tr('Dibuat {0} · diperbarui {1}{2}', formatDateTime(existing.createdAt), formatDateTime(existing.updatedAt), existing.updatedBy ? ` oleh ${existing.updatedBy.name}` : '') : tr('Akun baru langsung aktif bila status Aktif.')}>
          <div className={s.status}>
            <div className={s.statusLine}>
              {self ? <span className="badge badge--success">{tr('Aktif')}</span> : <Switch checked={v.active} onChange={(a) => set({ active: a })} label={v.active ? tr('Aktif') : tr('Nonaktif')} />}
              <span className={s.hint}>{self ? tr('Anda tidak dapat menonaktifkan akun Anda sendiri.') : tr('Pengguna yang nonaktif tidak dapat login ke DOD; sesinya langsung berakhir.')}</span>
            </div>
          </div>
        </Section>

        {error && <div className="callout callout--danger" role="alert" style={{ marginTop: 14 }}><span>{error}</span></div>}

        <div className={s.footer}>
          <p>
            <ShieldCheck size={14} aria-hidden />{' '}{tr('Field bertanda')}{' '}<span className="req" style={{ color: 'var(--danger)' }}>*</span>{' '}{tr('wajib diisi. ID dan informasi audit dibuat oleh sistem.')}
          </p>
          <div className={s.footerActs}>
            {todo.length > 0 && <span className="t-meta">{tr('Lengkapi:')}{' '}{todo.join(', ')}.</span>}
            <Link className="btn" to="/settings/users">{tr('Batal')}</Link>
            <Button variant="primary" icon={<Save size={14} aria-hidden />} loading={saving} disabled={todo.length > 0} onClick={() => void save()}>
              {tr('Simpan pengguna')}
            </Button>
          </div>
        </div>
      </Card>

      {existing ? (
        <Card>
          <Section icon={<Network size={20} aria-hidden />} title={tr('Akses data')} sub={tr('Unit Operasional yang dapat dilihat pengguna ini di semua laporan dan tabel.')}>
            <AccessSection userId={existing.id} />
          </Section>
        </Card>
      ) : (
        <div className="callout callout--info" role="note">
          <Info size={16} aria-hidden />
          <span>{tr('Pengguna baru tidak memiliki akses data. Setelah disimpan, pengelola akses data menetapkan assignment-nya.')}</span>
        </div>
      )}
    </>
  )
}
