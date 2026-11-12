import { Link } from 'react-router'
import { useResource } from '@/hooks/useResource'
import { dataWarehouseService } from '@/services/warehouse/dataWarehouseService'
import { tr } from '@/i18n'

/**
 * Kategori / Sub-kategori picker from the master list (Data › Dataset › Kategori). A category with
 * sub-categories offers itself and each of its subs; the dataset goes to the one chosen.
 */
export function CategorySelect({ value, onChange, id, emptyLabel = tr('Tanpa kategori') }: { value: string | null; onChange: (id: string | null) => void; id?: string; emptyLabel?: string }) {
  const list = useResource((signal) => dataWarehouseService.getCategories(signal), 'categories')
  const rows = list.data ?? []
  const roots = rows.filter((c) => !c.parentId)
  return (
    <>
      {/* Named by its <label htmlFor> when an id is given; otherwise by itself (e.g. inside a definition list). */}
      <select id={id} aria-label={id ? undefined : tr('Kategori')} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} disabled={!list.data} aria-busy={!list.data}>
        <option value="">{list.data ? emptyLabel : list.status === 'error' ? tr('Kategori tidak dapat dimuat') : tr('Memuat kategori…')}</option>
        {roots.map((c) => {
          const subs = rows.filter((x) => x.parentId === c.id)
          return subs.length ? (
            <optgroup key={c.id} label={c.name}>
              <option value={c.id}>{c.name}{' '}{tr('(umum)')}</option>
              {subs.map((x) => (
                <option key={x.id} value={x.id}>
                  {c.name} › {x.name}
                </option>
              ))}
            </optgroup>
          ) : (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          )
        })}
      </select>
      {list.data && !rows.length && (
        <span className="t-meta">
          {tr('Belum ada kategori.')}{' '}<Link to="/data/categories">{tr('Buat di master Kategori')}</Link>.
        </span>
      )}
    </>
  )
}
