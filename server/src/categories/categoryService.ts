/**
 * Dataset categories: a master list of categories (e.g. Panen, Perawatan, Pemupukan) with their
 * sub-categories (e.g. Panen → Hasil Panen, Jumlah Kg). A dataset is assigned to one of them when it
 * is created; the Analysis page lists datasets by Kategori → Sub-kategori.
 */
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { MetadataDb } from '../db/metadataDb.ts'
import { AppError, badRequest, notFound } from '../http/errors.ts'

export interface Category {
  id: string
  name: string
  description: string
  parentId: string | null
  sortOrder: number
  /** Datasets assigned directly to this category (archived excluded). */
  datasetCount: number
  createdAt: string
  updatedAt: string
}

export const CategoryInputSchema = z.object({
  name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(80),
  description: z.string().trim().max(500).default(''),
  parentId: z.string().min(1).nullable().default(null),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
})
export const CategoryPatchSchema = CategoryInputSchema.partial().omit({ parentId: true })

interface Row {
  id: string
  name: string
  description: string
  parent_id: string | null
  sort_order: number
  n: string
  created_at: Date
  updated_at: Date
}

export class CategoryService {
  private readonly db: MetadataDb

  constructor(db: MetadataDb) {
    this.db = db
  }

  async list(): Promise<Category[]> {
    const rows = (
      await this.db.query<Row>(
        `SELECT c.*, (SELECT count(*) FROM dor_dataset d WHERE d.category_id = c.id AND d.status <> 'archived') AS n
         FROM dor_category c ORDER BY c.parent_id NULLS FIRST, c.sort_order, lower(c.name)`,
      )
    ).rows
    return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, parentId: r.parent_id, sortOrder: r.sort_order, datasetCount: Number(r.n), createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() }))
  }

  async get(id: string): Promise<Category> {
    const c = (await this.list()).find((x) => x.id === id)
    if (!c) throw notFound('Kategori tidak ditemukan.')
    return c
  }

  /** Throws when the id does not exist; used by dataset create/update. */
  async assertExists(id: string) {
    const r = await this.db.query('SELECT 1 FROM dor_category WHERE id = $1', [id])
    if (!r.rowCount) throw badRequest('UNKNOWN_CATEGORY', 'Kategori yang dipilih tidak ditemukan.')
  }

  async create(input: z.infer<typeof CategoryInputSchema>, userId: string | null): Promise<Category> {
    if (input.parentId) {
      const p = await this.get(input.parentId)
      if (p.parentId) throw badRequest('CATEGORY_DEPTH', 'Sub-kategori hanya bisa dibuat di bawah kategori utama (maksimal dua tingkat).')
    }
    const id = `cat-${randomBytes(5).toString('hex')}`
    const order = input.sortOrder ?? Number((await this.db.query<{ n: string }>('SELECT count(*) AS n FROM dor_category WHERE parent_id IS NOT DISTINCT FROM $1', [input.parentId])).rows[0]?.n ?? 0)
    try {
      await this.db.query('INSERT INTO dor_category (id, name, description, parent_id, sort_order, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [id, input.name, input.description, input.parentId, order, userId])
    } catch (e) {
      throw this.conflict(e, input.name)
    }
    await this.audit(userId, 'category.create', id, { name: input.name, parentId: input.parentId })
    return this.get(id)
  }

  async update(id: string, patch: z.infer<typeof CategoryPatchSchema>, userId: string | null): Promise<Category> {
    await this.get(id)
    try {
      await this.db.query('UPDATE dor_category SET name = COALESCE($2, name), description = COALESCE($3, description), sort_order = COALESCE($4, sort_order), updated_at = now() WHERE id = $1', [id, patch.name ?? null, patch.description ?? null, patch.sortOrder ?? null])
    } catch (e) {
      throw this.conflict(e, patch.name ?? '')
    }
    await this.audit(userId, 'category.update', id, { fields: Object.keys(patch) })
    return this.get(id)
  }

  /** A category with sub-categories cannot be deleted; datasets of a deleted category become uncategorised. */
  async remove(id: string, userId: string | null) {
    const c = await this.get(id)
    const subs = (await this.list()).filter((x) => x.parentId === id)
    if (subs.length) throw new AppError(409, 'CATEGORY_HAS_CHILDREN', `Kategori "${c.name}" masih memiliki ${subs.length} sub-kategori. Hapus atau pindahkan sub-kategorinya terlebih dahulu.`)
    await this.db.query('DELETE FROM dor_category WHERE id = $1', [id])
    await this.audit(userId, 'category.delete', id, { name: c.name, datasets: c.datasetCount })
  }

  private conflict(e: unknown, name: string) {
    if ((e as { code?: string }).code === '23505') return new AppError(409, 'CATEGORY_EXISTS', `Nama "${name}" sudah dipakai di tingkat yang sama.`)
    return e
  }

  private audit(userId: string | null, action: string, target: string, detail: unknown) {
    return this.db.query('INSERT INTO dor_audit (user_id, action, target, detail) VALUES ($1,$2,$3,$4)', [userId, action, target, JSON.stringify(detail)])
  }
}
