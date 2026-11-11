import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Folder, FolderOpen, Search } from 'lucide-react'
import type { Dataset } from '@/types/contracts'
import s from './Analysis.module.css'
import { tr } from '@/i18n'

const NONE = tr('Tanpa kategori')

interface Node {
  name: string
  /** Datasets placed on the category itself (not in a sub-category). */
  direct: Dataset[]
  subs: Map<string, Dataset[]>
}

/** Kategori → Sub-kategori → Dataset. Categories come only from the master list in DOD's database. */
function tree(datasets: Dataset[]): Node[] {
  const by = new Map<string, Node>()
  for (const d of datasets) {
    const name = d.category?.name ?? NONE
    const n: Node = by.get(name) ?? { name, direct: [], subs: new Map() }
    const sub = d.category?.sub
    if (sub) n.subs.set(sub, [...(n.subs.get(sub) ?? []), d])
    else n.direct.push(d)
    by.set(name, n)
  }
  return [...by.values()].sort((a, b) => Number(a.name === NONE) - Number(b.name === NONE) || a.name.localeCompare(b.name, 'id'))
}
const total = (n: Node) => n.direct.length + [...n.subs.values()].reduce((x, v) => x + v.length, 0)

/**
 * Dataset picker of Pengaturan Data: drill down Kategori → Sub-kategori → Dataset in a scrolling
 * list, starting at the current dataset's place. Typing searches every dataset at once.
 */
export function DatasetBrowser({ datasets, current, onPick, className }: { datasets: Dataset[]; current: Dataset | null; onPick: (d: Dataset) => void; className?: string }) {
  const nodes = useMemo(() => tree(datasets), [datasets])
  // Nothing chosen yet: start at the list of categories.
  const home = current ? (current.category?.name ?? NONE) : null
  const [path, setPath] = useState<{ cat: string | null; sub: string | null }>(() => ({ cat: home, sub: current?.category?.sub ?? null }))
  const [q, setQ] = useState('')
  const node = nodes.find((n) => n.name === path.cat) ?? null
  const term = q.trim().toLowerCase()
  const hits = term ? datasets.filter((d) => `${d.label} ${d.description} ${d.category?.name ?? ''} ${d.category?.sub ?? ''}`.toLowerCase().includes(term)) : null

  const option = (d: Dataset, crumb?: string) => (
    <label key={d.id} className={s.dwOpt}>
      <input type="radio" name="dw" checked={d.id === current?.id} onChange={() => onPick(d)} />
      <span>
        <strong className={s.dwLabel}>{d.label}</strong>
        <small>
          {crumb ? `${crumb} · ` : tr('')}
          {`${d.source?.connectionName ?? ''} · ${d.source?.tables?.join(', ') ?? ''}${d.source?.available === false ? tr(' · tidak tersedia') : ''}`}
        </small>
      </span>
    </label>
  )
  const folder = (label: string, count: number, onClick: () => void, open = false) => (
    <button key={label} type="button" className={s.dwFolder} onClick={onClick}>
      {open ? <FolderOpen size={14} aria-hidden /> : <Folder size={14} aria-hidden />}
      <b>{label}</b>
      <small>{count}</small>
      <ChevronRight size={14} aria-hidden />
    </button>
  )

  return (
    <div id="dw-list" className={`${s.dwList}${className ? ` ${className}` : ''}`}>
      <div className={s.dwSearch}>
        <Search size={13} aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Cari dataset…')} aria-label={tr('Cari dataset')} />
      </div>
      {!hits && path.cat && (
        <nav className={s.dwCrumb} aria-label={tr('Posisi kategori')}>
          <button type="button" onClick={() => setPath(path.sub ? { cat: path.cat, sub: null } : { cat: null, sub: null })}>
            <ChevronLeft size={13} aria-hidden /> {path.sub ? path.cat : tr('Semua kategori')}
          </button>
          <span aria-current="location">{path.sub ?? path.cat}</span>
        </nav>
      )}
      <div className={s.dwScroll} role="radiogroup" aria-label={tr('Dataset')}>
        {hits ? (
          hits.length ? hits.map((d) => option(d, d.category ? [d.category.name, d.category.sub].filter(Boolean).join(' › ') : NONE)) : <p className={s.dwEmpty}>{tr('Tidak ada dataset yang cocok.')}</p>
        ) : !node ? (
          nodes.map((n) => folder(n.name, total(n), () => setPath({ cat: n.name, sub: null }), n.name === home))
        ) : path.sub ? (
          (node.subs.get(path.sub) ?? []).map((d) => option(d))
        ) : (
          <>
            {[...node.subs.entries()].sort((a, b) => a[0].localeCompare(b[0], 'id')).map(([name, list]) => folder(name, list.length, () => setPath({ cat: node.name, sub: name }), name === current?.category?.sub && node.name === current?.category?.name))}
            {node.direct.map((d) => option(d))}
          </>
        )}
      </div>
    </div>
  )
}
