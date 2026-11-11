import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, CornerDownRight, Database, FolderPlus, Pencil, Plus, Trash2, X } from 'lucide-react'
import { SearchInput } from '@/components/forms/SearchInput'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { Modal } from '@/components/common/Modal'
import { EmptyState, ErrorState, Skeleton } from '@/components/common/StateView'
import { PageHeader } from '@/components/data/PageHeader'
import { useResource } from '@/hooks/useResource'
import { ApiError } from '@/services/api/apiClient'
import { datasetService as analysisCatalog } from '@/services/dataset/datasetService'
import { dataWarehouseService } from '@/services/warehouse/dataWarehouseService'
import { useAuthStore } from '@/stores/authStore'
import { toast } from '@/stores/uiStore'
import type { DwCategory, WhDatasetSummary } from '@/types/warehouse'
import s from './Categories.module.css'
import { tr } from '@/i18n'

const fail = (e: unknown, fallback: string) => toast(e instanceof ApiError ? e.message : fallback, 'error')

/**
 * Data → Dataset → Kategori: master Kategori and Sub-kategori. A dataset is placed in one of them when
 * it is created (Buat dataset); Analisis › Pengaturan Data lists datasets by Kategori → Sub-kategori.
 */
export default function CategoriesPage() {
  const [nonce, setNonce] = useState(0)
  const list = useResource((signal) => dataWarehouseService.getCategories(signal), `cats${nonce}`)
  // The datasets of each category, for the drill-down (Kategori → Sub-kategori → Dataset). A failure only hides them.
  const ds = useResource((signal) => dataWarehouseService.listDatasets(signal), `cats-ds${nonce}`)
  const role = useAuthStore((st) => st.user?.role)
  const canEdit = role === 'admin' || role === 'analyst'
  const reload = () => {
    analysisCatalog.invalidate()
    setNonce((n) => n + 1)
  }
  const rows = useMemo(() => list.data ?? [], [list.data])
  const roots = rows.filter((c) => !c.parentId)
  const [q, setQ] = useState('')
  // Categories the user opened or closed; with a search, the matching ones open on their own.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const byCategory = useMemo(() => {
    const m = new Map<string, WhDatasetSummary[]>()
    for (const d of ds.data ?? []) if (d.category) m.set(d.category.id, [...(m.get(d.category.id) ?? []), d])
    for (const v of m.values()) v.sort((a, b) => a.name.localeCompare(b.name, 'id'))
    return m
  }, [ds.data])
  const term = q.trim().toLowerCase()
  // A new search starts from its own result: the matching categories open, earlier open/close choices are dropped.
  const [seenTerm, setSeenTerm] = useState(term)
  if (seenTerm !== term) {
    setSeenTerm(term)
    setToggled({})
  }
  const hit = (text: string) => !term || text.toLowerCase().includes(term)
  // What a search keeps: a category whose name matches keeps everything; otherwise only matching subs and datasets.
  const view = roots
    .map((c) => {
      const subs = rows.filter((x) => x.parentId === c.id)
      if (hit(`${c.name} ${c.description}`)) return { c, subs, direct: byCategory.get(c.id) ?? [], subDs: (id: string) => byCategory.get(id) ?? [] }
      const keepSubs = subs.filter((x) => hit(`${x.name} ${x.description}`) || (byCategory.get(x.id) ?? []).some((d) => hit(d.name)))
      const subDs = (id: string) => {
        const sub = subs.find((x) => x.id === id)
        const all = byCategory.get(id) ?? []
        return sub && hit(`${sub.name} ${sub.description}`) ? all : all.filter((d) => hit(d.name))
      }
      return { c, subs: keepSubs, direct: (byCategory.get(c.id) ?? []).filter((d) => hit(d.name)), subDs }
    })
    .filter((v) => !term || v.subs.length || v.direct.length || hit(`${v.c.name} ${v.c.description}`))
  const isOpen = (id: string) => toggled[id] ?? !!term
  const flip = (id: string) => setToggled((t) => ({ ...t, [id]: !isOpen(id) }))
  const setAll = (open: boolean) => setToggled(Object.fromEntries(rows.map((c) => [c.id, open])))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
      <PageHeader
        title={tr('Kategori Dataset')}
        description={tr('Master kategori dan sub-kategori. Saat membuat dataset, pilih kategorinya; di Analisis, dataset ditelusuri per Kategori → Sub-kategori.')}
        actions={
          <Link className="btn" to="/data/dataset">
            <ArrowLeft size={14} aria-hidden />{' '}{tr('Dataset')}
          </Link>
        }
      />
      <Card>
        {list.status === 'error' && !list.data ? (
          <ErrorState title={tr('Backend DOD tidak dapat dihubungi')} message={list.error ?? tr('')} onRetry={list.reload} />
        ) : !list.data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-busy="true">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} h={36} />)}</div>
        ) : (
          <>
            {canEdit && <AddRow parentId={null} placeholder={tr('Nama kategori baru, mis. Panen')} onDone={reload} />}
            {!roots.length ? (
              <EmptyState
                title={tr('Belum ada kategori')}
                message={tr('Ketik nama kategori utama di atas (mis. Panen), lalu tambahkan sub-kategori di dalamnya.')}
              />
            ) : (
              <>
                <div className={`toolbar ${s.bar}`}>
                  <SearchInput value={q} onChange={setQ} placeholder={tr('Cari kategori, sub-kategori, dataset…')} label={tr('Cari kategori')} />
                  <span className="grow" />
                  <span className="t-meta" aria-live="polite">
                    {term ? tr('{0} dari {1} kategori cocok', view.length, roots.length) : tr('{0} kategori · {1} sub-kategori', roots.length, rows.length - roots.length)}
                  </span>
                  <Button size="sm" variant="ghost" icon={<ChevronsUpDown size={13} aria-hidden />} onClick={() => setAll(true)}>{tr('Buka semua')}</Button>
                  <Button size="sm" variant="ghost" icon={<ChevronsDownUp size={13} aria-hidden />} onClick={() => setAll(false)}>{tr('Tutup semua')}</Button>
                </div>
                {/* The tree scrolls inside the card, so a long master list never runs far down the page. */}
                <div className={s.scroll}>
                  {!view.length ? (
                    <EmptyState title={tr('Tidak ada kategori yang cocok')} message={tr('Ubah kata kunci pencarian.')} />
                  ) : (
                    <ul className={s.tree} aria-label={tr('Kategori')}>
                      {view.map((v) => (
                        <CategoryItem key={v.c.id} c={v.c} subs={v.subs} allSubs={rows.filter((x) => x.parentId === v.c.id).length} total={v.c.datasetCount + rows.filter((x) => x.parentId === v.c.id).reduce((n, x) => n + x.datasetCount, 0)} direct={v.direct} datasetsOf={v.subDs} canEdit={canEdit} onChanged={reload} open={isOpen(v.c.id)} onToggle={() => flip(v.c.id)} isOpen={isOpen} flip={flip} />
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

interface ItemProps {
  c: DwCategory
  /** Sub-categories shown (narrowed by a search) and how many there are in all. */
  subs: DwCategory[]
  allSubs: number
  /** Datasets in the category and all its sub-categories. */
  total: number
  /** Datasets placed on the category itself, and those of a sub-category. */
  direct: WhDatasetSummary[]
  datasetsOf: (subId: string) => WhDatasetSummary[]
  canEdit: boolean
  onChanged: () => void
  open: boolean
  onToggle: () => void
  isOpen: (id: string) => boolean
  flip: (id: string) => void
}

/** A category: its row, and when opened its sub-categories (each opens on its datasets) and its own datasets. */
function CategoryItem({ c, subs, allSubs, total, direct, datasetsOf, canEdit, onChanged, open, onToggle, isOpen, flip }: ItemProps) {
  const [adding, setAdding] = useState(false)
  const listId = `cat-${c.id}`
  return (
    <li className={s.root}>
      <Row c={c} canEdit={canEdit} onChanged={onChanged} meta={tr('{0} sub-kategori · {1} dataset', allSubs, total)} blocked={allSubs ? tr('Hapus atau pindahkan {0} sub-kategorinya terlebih dahulu.', allSubs) : null} toggle={{ open, onToggle, controls: listId }}>
        {canEdit && (
          <Button size="sm" variant="ghost" icon={<FolderPlus size={13} aria-hidden />} onClick={() => (setAdding((a) => !a), !open && onToggle())} aria-expanded={adding}>
            {tr('Sub-kategori')}
          </Button>
        )}
      </Row>
      {open && (
        <ul id={listId} className={s.subs} aria-label={tr('Sub-kategori {0}', c.name)}>
          {subs.map((x) => {
            const list = datasetsOf(x.id)
            const subOpen = isOpen(x.id)
            return (
              <li key={x.id}>
                <Row c={x} canEdit={canEdit} onChanged={onChanged} meta={tr('{0} dataset', x.datasetCount)} sub blocked={null} toggle={x.datasetCount > 0 ? { open: subOpen, onToggle: () => flip(x.id), controls: `cat-${x.id}` } : undefined} />
                {subOpen && <DatasetList id={`cat-${x.id}`} list={list} />}
              </li>
            )
          })}
          {direct.length > 0 && (
            <li>
              <p className={s.directHead}>{tr('Langsung di {0}', c.name)}</p>
              <DatasetList list={direct} />
            </li>
          )}
          {!subs.length && !direct.length && !adding && <li className={s.none}>{tr('Belum ada sub-kategori atau dataset.')}</li>}
          {adding && (
            <li>
              <AddRow parentId={c.id} placeholder={tr('Sub-kategori {0}, mis. Hasil Panen', c.name)} onDone={() => (setAdding(false), onChanged())} onCancel={() => setAdding(false)} autoFocus />
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

/** The datasets of a category, linking to each dataset; a long list scrolls inside. */
function DatasetList({ id, list }: { id?: string; list: WhDatasetSummary[] }) {
  if (!list.length) return <p id={id} className={s.none}>{tr('Tidak ada dataset yang cocok.')}</p>
  return (
    <ul id={id} className={s.datasets}>
      {list.map((d) => (
        <li key={d.id}>
          <Link to={`/data/dataset/${d.id}`} className={s.dataset}>
            <Database size={13} aria-hidden />
            <span>{d.name}</span>
            <small>{d.connectionName}</small>
            <span className={`badge ${d.status === 'active' ? 'badge--success' : ''}`}>{d.status === 'active' ? tr('Aktif') : d.status === 'draft' ? tr('Draft') : tr('Diarsipkan')}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Row({ c, canEdit, onChanged, meta, sub, blocked, children, toggle }: { c: DwCategory; canEdit: boolean; onChanged: () => void; meta: string; sub?: boolean; blocked: string | null; children?: ReactNode; toggle?: { open: boolean; onToggle: () => void; controls: string } }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(c.name)
  const [description, setDescription] = useState(c.description)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await dataWarehouseService.updateCategory(c.id, { name: name.trim(), description: description.trim() })
      setEditing(false)
      onChanged()
    } catch (err) {
      fail(err, tr('Kategori gagal disimpan.'))
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await dataWarehouseService.deleteCategory(c.id)
      toast(tr('"{0}" dihapus.', c.name), 'success')
      onChanged()
    } catch (err) {
      fail(err, tr('Kategori gagal dihapus.'))
      setBusy(false)
      setConfirm(false)
    }
  }
  if (editing)
    return (
      <form className={`${s.row} ${s.editing}`} onSubmit={(e) => void save(e)}>
        {sub && <CornerDownRight size={14} className={s.branch} aria-hidden />}
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label={tr('Nama')} maxLength={80} autoFocus />
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} aria-label={tr('Deskripsi')} placeholder={tr('Deskripsi (opsional)')} maxLength={500} />
        <span className={s.acts}>
          <Button size="sm" variant="primary" type="submit" icon={<Check size={13} aria-hidden />} loading={busy} disabled={name.trim().length < 2}>{tr('Simpan')}</Button>
          <Button size="sm" icon={<X size={13} aria-hidden />} onClick={() => (setEditing(false), setName(c.name), setDescription(c.description))}>{tr('Batal')}</Button>
        </span>
      </form>
    )
  return (
    <div className={s.row}>
      {sub && <CornerDownRight size={14} className={s.branch} aria-hidden />}
      {toggle ? (
        <button type="button" className={s.name} onClick={toggle.onToggle} aria-expanded={toggle.open} aria-controls={toggle.controls}>
          <b>
            {toggle.open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            {c.name}
          </b>
          <small>{c.description ? `${c.description} · ` : tr('')}{meta}</small>
        </button>
      ) : (
        <span className={`${s.name} ${s.nameStatic}`}>
          <b>{c.name}</b>
          <small>{c.description ? `${c.description} · ` : tr('')}{meta}</small>
        </span>
      )}
      <span className={s.acts}>
        {children}
        {canEdit && (
          <>
            <button type="button" className="icon-btn" onClick={() => setEditing(true)} aria-label={tr('Ubah {0}', c.name)} title={tr('Ubah')}><Pencil size={14} /></button>
            <button type="button" className="icon-btn" onClick={() => (blocked ? toast(blocked, 'error') : setConfirm(true))} aria-label={tr('Hapus {0}', c.name)} title={tr('Hapus')}><Trash2 size={14} /></button>
          </>
        )}
      </span>
      {confirm && (
        <Modal
          title={tr('Hapus {0}?', sub ? 'sub-kategori' : 'kategori')}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button onClick={() => setConfirm(false)}>{tr('Batal')}</Button>
              <Button variant="primary" loading={busy} onClick={() => void remove()}>{tr('Hapus')}</Button>
            </>
          }
        >
          <p>
            <b>{c.name}</b>{' '}{tr('akan dihapus dari master.')}{tr(' ')}
            {c.datasetCount > 0 ? tr('{0} dataset di dalamnya tidak terhapus, tetapi menjadi tanpa kategori.', c.datasetCount) : tr('Tidak ada dataset di dalamnya.')}
          </p>
        </Modal>
      )}
    </div>
  )
}

function AddRow({ parentId, placeholder, onDone, onCancel, autoFocus }: { parentId: string | null; placeholder: string; onDone: () => void; onCancel?: () => void; autoFocus?: boolean }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await dataWarehouseService.createCategory({ name: name.trim(), parentId })
      setName('')
      onDone()
    } catch (err) {
      fail(err, tr('Kategori gagal dibuat.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className={`${s.row} ${s.add}`} onSubmit={(e) => void submit(e)}>
      {parentId && <CornerDownRight size={14} className={s.branch} aria-hidden />}
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} aria-label={parentId ? tr('Nama sub-kategori baru') : tr('Nama kategori baru')} maxLength={80} autoFocus={autoFocus} />
      <span className={s.acts}>
        <Button size="sm" variant="primary" type="submit" icon={<Plus size={13} aria-hidden />} loading={busy} disabled={name.trim().length < 2}>
          {parentId ? tr('Tambah sub') : tr('Tambah kategori')}
        </Button>
        {onCancel && <Button size="sm" onClick={onCancel}>{tr('Batal')}</Button>}
      </span>
    </form>
  )
}
