import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ChevronRight, CornerDownRight, Home, Info, Lock, Minus, RotateCcw, Save, Undo2 } from 'lucide-react'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { Modal } from '@/components/common/Modal'
import { ErrorState, Skeleton } from '@/components/common/StateView'
import { Switch } from '@/components/common/Switch'
import { useResource } from '@/hooks/useResource'
import { accessService } from '@/services/access/accessService'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/uiStore'
import type { MenuChanges, MenuMatrix, MenuRow, Role } from '@/types/access'
import { formatDateTime, formatRelative } from '@/utils/format'
import { ROLE_LABEL, ROLES } from '../users/userMeta'
import s from './Permissions.module.css'
import { tr } from '@/i18n'

type Draft = Partial<Record<Role, Record<string, boolean>>>

/** Settings → Hak Akses Menu: which menus every role may open. The server enforces the same choices on its API. */
export default function PermissionsPage() {
  const loaded = useResource((signal) => accessService.matrix(signal), 'access-menus')
  const [saved, setSaved] = useState<MenuMatrix | null>(null)
  const matrix = saved ?? loaded.data
  return (
    <div className={s.page}>
      <nav className={s.crumbs} aria-label={tr('Lokasi halaman')}>
        <Home size={13} aria-hidden />
        <Link to="/settings">{tr('Settings')}</Link>
        <ChevronRight size={12} aria-hidden />
        <span aria-current="page">{tr('Hak Akses Menu')}</span>
      </nav>
      {matrix ? (
        <Editor matrix={matrix} onSaved={setSaved} />
      ) : loaded.status === 'error' ? (
        <Card>
          <ErrorState message={loaded.error ?? tr('')} onRetry={loaded.reload} />
        </Card>
      ) : (
        <Card>
          <Skeleton h={420} />
        </Card>
      )}
    </div>
  )
}

function Editor({ matrix, onSaved }: { matrix: MenuMatrix; onSaved: (m: MenuMatrix) => void }) {
  const refresh = useAuthStore((st) => st.refresh)
  const [draft, setDraft] = useState<Draft>({})
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const roles = matrix.roles
  const byId = useMemo(() => new Map(matrix.menus.map((m) => [m.id, m])), [matrix])

  const own = (m: MenuRow, r: Role) => draft[r]?.[m.id] ?? m.cells[r].state === 'on'
  /** On after the parents: what the role will really get. */
  const effective = (m: MenuRow, r: Role): boolean => m.cells[r].state !== 'unavailable' && own(m, r) && (!m.parent || effective(byId.get(m.parent)!, r))
  const changes = useMemo(() => {
    const out: MenuChanges = {}
    let n = 0
    for (const [r, cells] of Object.entries(draft) as [Role, Record<string, boolean>][])
      for (const [id, v] of Object.entries(cells))
        if (v !== (byId.get(id)!.cells[r].state === 'on')) {
          ;(out[r] ??= {})[id] = v
          n++
        }
    return { out, n }
  }, [draft, byId])

  const set = (r: Role, id: string, v: boolean) => setDraft((d) => ({ ...d, [r]: { ...d[r], [id]: v } }))
  const changed = (m: MenuRow, r: Role) => draft[r]?.[m.id] !== undefined && draft[r]![m.id] !== (m.cells[r].state === 'on')
  const count = (r: Role) => matrix.menus.filter((m) => effective(m, r)).length
  const usable = (r: Role) => matrix.menus.filter((m) => m.cells[r].state !== 'unavailable').length
  const stored = matrix.menus.some((m) => roles.some((r) => m.cells[r].stored))

  const save = async () => {
    setBusy('save')
    try {
      const next = await accessService.save(changes.out)
      setDraft({})
      onSaved(next)
      await refresh().catch(() => undefined)
      toast(tr('Hak akses disimpan ({0} perubahan). Pengguna mendapatkannya saat membuka ulang aplikasi.', changes.n), 'success')
    } catch {
      /* toast already shown */
    } finally {
      setBusy(null)
    }
  }
  const reset = async () => {
    setBusy('reset')
    try {
      const next = await accessService.reset()
      setDraft({})
      setConfirmReset(false)
      onSaved(next)
      await refresh().catch(() => undefined)
      toast(tr('Hak akses dikembalikan ke bawaan.'), 'success')
    } catch {
      /* toast already shown */
    } finally {
      setBusy(null)
    }
  }

  const parents = matrix.menus.filter((m) => !m.parent)
  return (
    <>
      <header className={s.head}>
        <h1 className="sr-only">{tr('Hak Akses Menu')}</h1>
        <div className={s.actions}>
          {changes.n > 0 && <span className="t-meta">{changes.n}{' '}{tr('perubahan belum disimpan')}</span>}
          <Button variant="outline" icon={<RotateCcw size={15} aria-hidden />} onClick={() => setConfirmReset(true)} disabled={!stored || !!busy}>
            {tr('Kembalikan bawaan')}
          </Button>
          {changes.n > 0 && (
            <Button icon={<Undo2 size={15} aria-hidden />} onClick={() => setDraft({})} disabled={!!busy}>
              {tr('Batalkan')}
            </Button>
          )}
          <Button variant="primary" icon={<Save size={15} aria-hidden />} onClick={save} loading={busy === 'save'} disabled={!changes.n || !!busy}>
            {tr('Simpan perubahan')}
          </Button>
        </div>
      </header>

      <div className={s.summary}>
        {roles.map((r) => (
          <div key={r} className={s.roleCard}>
            <b>{ROLE_LABEL[r]}</b>
            <span className={s.roleCount}>
              {count(r)}
              <small>{' '}{tr('dari')}{' '}{usable(r)}{' '}{tr('menu')}</small>
            </span>
            <span className="t-meta">{ROLES.find((x) => x.value === r)?.hint}</span>
          </div>
        ))}
      </div>

      <Card padded={false}>
        <div className={s.scroll}>
          <table className={s.table}>
            <caption className="sr-only">{tr('Menu yang dapat dibuka setiap peran')}</caption>
            <thead>
              <tr>
                <th scope="col" className={s.menuCol}>{tr('Menu')}</th>
                {roles.map((r) => (
                  <th key={r} scope="col" className={s.roleCol}>{ROLE_LABEL[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {parents.map((p) => {
                const kids = matrix.menus.filter((m) => m.parent === p.id)
                return (
                  <Fragment key={p.id}>
                    <Row menu={p} roles={roles} own={own} effective={effective} changed={changed} set={set} group={kids.length > 0} />
                    {kids.map((k) => (
                      <Row key={k.id} menu={k} roles={roles} own={own} effective={effective} changed={changed} set={set} parentOff={(r) => !effective(p, r)} />
                    ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className={s.foot}>
        <p className="t-meta">
          <Info size={13} aria-hidden /> {matrix.updatedAt ? <>{tr('Terakhir diubah')}{' '}{formatRelative(matrix.updatedAt)}{' '}{tr('oleh')}{' '}{matrix.updatedBy ?? tr('administrator')} <span title={formatDateTime(matrix.updatedAt)}>({formatDateTime(matrix.updatedAt)})</span>.</> : tr('Belum pernah diubah: semua peran memakai menu bawaan.')}
        </p>
      </div>

      {confirmReset && (
        <Modal
          title={tr('Kembalikan hak akses bawaan?')}
          onClose={() => !busy && setConfirmReset(false)}
          footer={
            <>
              <Button onClick={() => setConfirmReset(false)} disabled={!!busy}>{tr('Batal')}</Button>
              <Button variant="primary" icon={<RotateCcw size={15} aria-hidden />} onClick={reset} loading={busy === 'reset'}>
                {tr('Kembalikan bawaan')}
              </Button>
            </>
          }
        >
          <p>{tr('Semua pilihan yang tersimpan dihapus, sehingga setiap peran kembali mendapat semua menu yang tersedia untuknya.')}</p>
        </Modal>
      )}
    </>
  )
}

function Row({
  menu,
  roles,
  own,
  effective,
  changed,
  set,
  group,
  parentOff,
}: {
  menu: MenuRow
  roles: Role[]
  own: (m: MenuRow, r: Role) => boolean
  effective: (m: MenuRow, r: Role) => boolean
  changed: (m: MenuRow, r: Role) => boolean
  set: (r: Role, id: string, v: boolean) => void
  group?: boolean
  parentOff?: (r: Role) => boolean
}) {
  const child = !!menu.parent
  return (
    <tr className={`${child ? s.child : s.parentRow}${group ? ` ${s.group}` : ''}`}>
      <th scope="row" className={s.menuCol}>
        <span className={s.menuName}>
          {child && <CornerDownRight size={13} className={s.branch} aria-hidden />}
          <span>
            <b>{tr(menu.label)}</b>
            <small>{tr(menu.description)}</small>
          </span>
        </span>
      </th>
      {roles.map((r) => {
        const c = menu.cells[r]
        const label = tr('{0} untuk {1}', tr(menu.label), ROLE_LABEL[r])
        if (c.state === 'unavailable')
          return (
            <td key={r} className={s.cell} title={c.reason ? tr(c.reason) : undefined}>
              <span className={s.na} aria-label={tr('{0}: tidak tersedia. {1}', label, tr(c.reason ?? ''))}>
                <Minus size={14} aria-hidden />
              </span>
            </td>
          )
        if (c.locked)
          return (
            <td key={r} className={s.cell} title={c.reason ? tr(c.reason) : undefined}>
              <span className={s.locked} aria-label={tr('{0}: selalu aktif', label)}>
                <Lock size={13} aria-hidden />{' '}{tr('Aktif')}
              </span>
            </td>
          )
        const off = parentOff?.(r)
        return (
          <td key={r} className={`${s.cell}${changed(menu, r) ? ` ${s.changed}` : ''}${off ? ` ${s.muted}` : ''}`} title={off ? tr('Menu induknya mati untuk peran ini') : undefined}>
            <span className={s.switchWrap}>
              <Switch checked={own(menu, r)} onChange={(v) => set(r, menu.id, v)} label={label} hideLabel />
              {changed(menu, r) && <span className={s.dot} aria-hidden />}
            </span>
            {off && own(menu, r) && !effective(menu, r) && <span className="sr-only">{tr('ikut mati karena menu induk mati')}</span>}
          </td>
        )
      })}
    </tr>
  )
}
