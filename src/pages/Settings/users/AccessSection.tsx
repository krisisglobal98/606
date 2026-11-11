import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, Plus, Save, ShieldAlert, Trash2 } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { ErrorState, Skeleton } from '@/components/common/StateView'
import { useResource } from '@/hooks/useResource'
import { ApiError } from '@/services/api/apiClient'
import { userService } from '@/services/users/userService'
import { toast } from '@/stores/uiStore'
import type { Assignment, AssignmentInput, Level, OrgLevel, OrgOptionItem, OrgStatus } from '@/types/users'
import { formatDateTime } from '@/utils/format'
import { LEVEL_LABEL, LEVELS, ORG_LEVEL_LABEL, OWNERSHIP_ORG_LEVELS, toInput } from './userMeta'
import s from './Users.module.css'
import { tr } from '@/i18n'

/** Assignment row as shown (saved ones, and new ones not yet saved). */
type Row = { key: string; input: AssignmentInput; label: string; saved: Assignment | null }

const toRow = (a: Assignment): Row => ({
  key: a.id,
  label: a.label,
  saved: a,
  input: { level: a.level, ...(a.level === 'OWNERSHIP' ? { orgLevel: a.orgLevel } : {}), orgKind: a.orgKind, orgId: a.orgId, subKind: a.subKind, subId: a.subId, ownership: a.ownership },
})

/**
 * Data access of one user: the assignments (each an independent scope; several are combined), their validity
 * against the PIMS master, and — for an access manager on another user's account — the editor.
 */
export function AccessSection({ userId }: { userId: string }) {
  const [nonce, setNonce] = useState(0)
  const access = useResource((signal) => userService.access(userId, signal), `access-${userId}-${nonce}`)
  const status = useResource((signal) => userService.orgStatus(signal), `org-status-${nonce}`)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (access.status === 'error' && !access.data) return <ErrorState message={access.error ?? ''} onRetry={access.reload} />
  if (!access.data) return <Skeleton h={160} />
  const a = access.data
  const shown = rows ?? a.assignments.map(toRow)
  const dirty = rows !== null

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await userService.saveAccess(userId, shown.map((r) => r.input))
      toast(tr('Akses data disimpan.'), 'success')
      setRows(null)
      setNonce((n) => n + 1)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tr('Akses data gagal disimpan.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {a.unrestricted && (
        <div className="callout callout--warning" role="note">
          <ShieldAlert size={16} aria-hidden />
          <span>{tr('Pengguna ini memegang hak khusus unrestricted_data (diatur di server): ia melihat seluruh data tanpa batas cakupan. Assignment di bawah tidak membatasinya.')}</span>
        </div>
      )}
      {!a.masterAvailable && (
        <div className="callout callout--danger" role="alert">
          <AlertCircle size={16} aria-hidden />
          <span>{tr('Master organisasi PIMS tidak dapat dihubungi: validitas assignment tidak dapat diperiksa, dan pengguna berlevel tidak mendapat data sampai master tersedia.')}</span>
        </div>
      )}
      {!shown.length ? (
        <div className="callout callout--info" role="note">
          <Info size={16} aria-hidden />
          <span>{tr('Belum ada assignment: pengguna ini tidak dapat melihat data laporan (termasuk administrator aplikasi).')}</span>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }} aria-label={tr('Assignment akses data')}>
          {shown.map((r) => (
            <li key={r.key} className="card" style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="badge badge--info">{LEVEL_LABEL[r.input.level]}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="strong">{r.label}</span>
                {r.saved && (
                  <span className="sub">
                    {r.saved.valid === true ? <><CheckCircle2 size={12} aria-hidden />{' '}{tr('{0} Unit Operasional', r.saved.unitCount ?? 0)}</> : r.saved.valid === false ? <><AlertCircle size={12} aria-hidden />{' '}{r.saved.problem}</> : tr('Validitas belum dapat diperiksa')}
                    {r.saved.warning && <> · {r.saved.warning}</>}
                    {' · '}{tr('ditetapkan {0}', formatDateTime(r.saved.createdAt))}
                  </span>
                )}
                {!r.saved && <span className="sub">{tr('Belum disimpan')}</span>}
              </span>
              {a.canEdit && (
                <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden />} onClick={() => setRows(shown.filter((x) => x.key !== r.key))} aria-label={tr('Hapus assignment')}>
                  {tr('Hapus')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {a.canEdit ? (
        <>
          <AddAssignment status={status.data} onAdd={(input, label) => setRows([...shown, { key: `new-${Date.now()}`, input, label, saved: null }])} />
          {error && <div className="callout callout--danger" role="alert"><span>{error}</span></div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {dirty && <Button onClick={() => (setRows(null), setError(null))}>{tr('Batalkan perubahan')}</Button>}
            <Button variant="primary" icon={<Save size={14} aria-hidden />} loading={saving} disabled={!dirty} onClick={() => void save()}>
              {tr('Simpan akses data')}
            </Button>
          </div>
        </>
      ) : (
        <p className="t-meta">{tr('Hanya pengelola akses data yang dapat mengubah assignment, dan tidak untuk akunnya sendiri.')}</p>
      )}
    </div>
  )
}

/** Choose a level, then the organization by its PIMS id; Rayon/Divisi need the parent Unit Operasional first. */
function AddAssignment({ status, onAdd }: { status: OrgStatus | null; onAdd: (a: AssignmentInput, label: string) => void }) {
  const [level, setLevel] = useState<Level | ''>('')
  const [orgLevel, setOrgLevel] = useState<OrgLevel | ''>('')
  const [company, setCompany] = useState('')
  const [orgId, setOrgId] = useState('')
  const [subId, setSubId] = useState('')
  const [ownership, setOwnership] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const def = LEVELS.find((l) => l.level === level)
  const effOrgLevel: OrgLevel | null = def ? (def.level === 'OWNERSHIP' ? orgLevel || null : def.orgLevel) : null
  const needsCompany = effOrgLevel === 'BUSINESS_UNIT'

  const opts = useResource((signal) => (effOrgLevel && (!needsCompany || company) ? userService.orgOptions(effOrgLevel, needsCompany ? company : null, signal) : Promise.resolve([] as OrgOptionItem[])), `org-${effOrgLevel}-${needsCompany ? company : ''}`)
  const companies = useResource((signal) => (needsCompany ? userService.orgOptions('COMPANY', null, signal) : Promise.resolve([] as OrgOptionItem[])), `org-companies-${needsCompany}`)
  const subs = useResource((signal) => (def?.sub && orgId ? userService.orgOptions(def.sub, def.sub === 'DIVISION' ? orgId : null, signal) : Promise.resolve([] as OrgOptionItem[])), `org-sub-${def?.sub}-${orgId}`)
  const owners = useResource((signal) => (level === 'OWNERSHIP' ? userService.orgOptions('OWNERSHIP', null, signal) : Promise.resolve([] as OrgOptionItem[])), `org-own-${level}`)
  const label = useMemo(() => {
    const org = (opts.data ?? []).find((o) => o.id === orgId)
    const sub = (subs.data ?? []).find((o) => o.id === subId)
    if (!def || !org) return ''
    return `${def.label}${def.level === 'OWNERSHIP' ? ` · ${ownership.join('/')} · ${effOrgLevel ? ORG_LEVEL_LABEL[effOrgLevel] : ''}` : ''} · ${org.code}${org.name && org.name !== org.code ? ` · ${org.name}` : ''}${sub ? ` / ${sub.code} · ${sub.name}` : ''}`
  }, [def, opts.data, subs.data, orgId, subId, ownership, effOrgLevel])

  const reset = (keepLevel = true) => {
    if (!keepLevel) setLevel('')
    setOrgLevel('')
    setCompany('')
    setOrgId('')
    setSubId('')
    setOwnership([])
    setProblem(null)
  }
  const add = () => {
    const r = toInput({ level, orgLevel, orgId, subId, ownership }, status?.regionSource ?? null)
    if (typeof r === 'string') return setProblem(r)
    onAdd(r, label)
    reset(false)
  }
  const disabledLevel = (l: Level) => !!status && !status.levels[l]

  return (
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <b>{tr('Tambah assignment')}</b>
      <div className={s.choiceRow} role="radiogroup" aria-label={tr('Level akses')}>
        {LEVELS.map((l) => (
          <label key={l.level} className={`${s.choice}${level === l.level ? ` ${s.choiceOn}` : ''}`} title={disabledLevel(l.level) ? tr('Sumber organisasi level ini belum ditetapkan di server.') : l.hint} aria-disabled={disabledLevel(l.level)}>
            <input type="radio" name="access-level" checked={level === l.level} disabled={disabledLevel(l.level)} onChange={() => (setLevel(l.level), reset())} />
            {l.label}
          </label>
        ))}
      </div>
      {def && <span className={s.hint}>{def.hint}</span>}

      {level === 'OWNERSHIP' && (
        <div className="field">
          <label className="t-label" htmlFor="acc-orglevel">{tr('Cakupan organisasi Kepemilikan')}</label>
          <select id="acc-orglevel" className="select" value={orgLevel} onChange={(e) => (setOrgLevel(e.target.value as OrgLevel), setOrgId(''), setCompany(''))}>
            <option value="">{tr('Pilih level organisasi')}</option>
            {OWNERSHIP_ORG_LEVELS.filter((l) => !status || status.levels[l]).map((l) => <option key={l} value={l}>{ORG_LEVEL_LABEL[l]}</option>)}
          </select>
          <div className={s.choiceRow} role="group" aria-label={tr('Kategori kepemilikan')}>
            {(owners.data ?? []).map((o) => (
              <label key={o.id} className={`${s.choice}${ownership.includes(o.code) ? ` ${s.choiceOn}` : ''}`}>
                <input type="checkbox" checked={ownership.includes(o.code)} onChange={(e) => setOwnership(e.target.checked ? [...ownership, o.code] : ownership.filter((x) => x !== o.code))} />
                {o.code}
              </label>
            ))}
          </div>
          <span className={s.hint}>{tr('Data terlihat hanya bila Unit Operasional DAN kategori kepemilikan sama-sama cocok.')}</span>
        </div>
      )}

      {needsCompany && (
        <div className="field">
          <label className="t-label" htmlFor="acc-company">{tr('Perusahaan (untuk memilih Unit Operasional)')}</label>
          <select id="acc-company" className="select" value={company} onChange={(e) => (setCompany(e.target.value), setOrgId(''), setSubId(''))}>
            <option value="">{tr('Pilih perusahaan')}</option>
            {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}{c.alias ? ` (${c.alias})` : ''}</option>)}
          </select>
        </div>
      )}

      {effOrgLevel && (!needsCompany || company) && (
        <div className="field">
          <label className="t-label" htmlFor="acc-org">{ORG_LEVEL_LABEL[effOrgLevel]}</label>
          <select id="acc-org" className="select" value={orgId} onChange={(e) => (setOrgId(e.target.value), setSubId(''))}>
            <option value="">{opts.status === 'loading' ? tr('Memuat…') : tr('Pilih {0}', ORG_LEVEL_LABEL[effOrgLevel])}</option>
            {(opts.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.code}{o.name && o.name !== o.code ? ` · ${o.name}` : ''}{o.group ? ` (${o.group})` : ''}{o.units != null ? ` · ${o.units} BU` : ''}
              </option>
            ))}
          </select>
          {opts.status === 'error' && <span className="field-error"><AlertCircle size={13} aria-hidden />{opts.error}</span>}
        </div>
      )}

      {def?.sub && orgId && (
        <div className="field">
          <label className="t-label" htmlFor="acc-sub">{def.sub === 'RAYON' ? tr('Rayon') : tr('Divisi')}</label>
          <select id="acc-sub" className="select" value={subId} onChange={(e) => setSubId(e.target.value)}>
            <option value="">{def.sub === 'RAYON' ? tr('Pilih Rayon') : tr('Pilih Divisi')}</option>
            {(subs.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} · {o.name}{o.relatedToUnit === false ? ` ${tr('(tidak tercatat untuk BU ini di master)')}` : ''}
              </option>
            ))}
          </select>
          <span className={s.hint}>{tr('Disimpan sebagai pasangan id Unit Operasional induk dan id {0}.', def.sub === 'RAYON' ? tr('Rayon') : tr('Divisi'))}</span>
        </div>
      )}

      {problem && <span className="field-error"><AlertCircle size={13} aria-hidden />{problem}</span>}
      <div>
        <Button size="sm" icon={<Plus size={14} aria-hidden />} disabled={!level} onClick={add}>{tr('Tambahkan ke daftar')}</Button>
      </div>
    </div>
  )
}
