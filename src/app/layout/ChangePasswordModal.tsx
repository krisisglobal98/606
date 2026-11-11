import { useState, type FormEvent } from 'react'
import { AlertCircle, KeyRound } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Modal } from '@/components/common/Modal'
import { ApiError } from '@/services/api/apiClient'
import { authService } from '@/services/auth/authService'
import { toast } from '@/stores/uiStore'
import { tr } from '@/i18n'

const MIN = 8

/** The signed-in user changes their own password (menu Akun → Ubah password); no administrator needed. */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const problem =
    next && next.length < MIN ? tr('Password baru minimal {0} karakter.', MIN) : next && current && next === current ? tr('Password baru harus berbeda dari password saat ini.') : confirm && confirm !== next ? tr('Konfirmasi tidak sama dengan password baru.') : null
  const ready = !!current && next.length >= MIN && next === confirm && next !== current

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setSaving(true)
    setError(null)
    try {
      const r = await authService.changePassword({ currentPassword: current, newPassword: next })
      toast(r.otherSessionsEnded ? tr('Password diubah. {0} sesi lain telah dikeluarkan.', r.otherSessionsEnded) : tr('Password diubah.'), 'success')
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tr('Password gagal diubah.'))
      setSaving(false)
    }
  }

  return (
    <Modal
      title={tr('Ubah password')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{tr('Batal')}</Button>
          <Button variant="primary" type="submit" form="change-password" icon={<KeyRound size={14} aria-hidden />} loading={saving} disabled={!ready}>
            {tr('Simpan password')}
          </Button>
        </>
      }
    >
      <form id="change-password" onSubmit={(e) => void submit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 12 }} noValidate>
        <label className="field">
          <span className="t-label">{tr('Password saat ini')}{' '}<span className="req">*</span></span>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus required />
        </label>
        <label className="field">
          <span className="t-label">{tr('Password baru')}{' '}<span className="req">*</span></span>
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={MIN} required aria-describedby="pw-hint" />
          <span id="pw-hint" className="t-meta">{tr('Minimal')}{' '}{MIN}{' '}{tr('karakter, berbeda dari password saat ini.')}</span>
        </label>
        <label className="field">
          <span className="t-label">{tr('Ulangi password baru')}{' '}<span className="req">*</span></span>
          <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {(problem || error) && (
          <span className="field-error" role="alert">
            <AlertCircle size={13} aria-hidden />
            {error ?? problem}
          </span>
        )}
        <p className="t-meta">{tr('Setelah disimpan, sesi Anda di perangkat lain dikeluarkan. Sesi ini tetap masuk.')}</p>
      </form>
    </Modal>
  )
}
