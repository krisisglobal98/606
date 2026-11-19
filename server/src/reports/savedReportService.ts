/**
 * Laporan Operasional: Analysis layouts saved under a name and a master category. A saved report holds the
 * configuration only (what to ask), never result data, so opening it queries the source as usual.
 */
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { User } from '../auth/authService.ts'
import type { CategoryService } from '../categories/categoryService.ts'
import type { MetadataDb } from '../db/metadataDb.ts'
import { badRequest, forbidden, notFound } from '../http/errors.ts'

const MAX_LAYOUT_BYTES = 200_000

export const SavedLayoutSchema = z.object({
  scope: z.record(z.string(), z.array(z.string())),
  filter: z.record(z.string(), z.unknown()),
  dimensions: z.array(z.string()),
  measureLayout: z.array(z.unknown()),
  measureSettings: z.record(z.string(), z.unknown()),
  chartType: z.string(),
  chartBy: z.string(),
  table: z.record(z.string(), z.unknown()),
  /** Calculated measures of the dataset: they live in the browser, and the layout may use them. */
  calc: z.array(z.unknown()).default([]),
})

export const CreateSavedReportSchema = z.object({
  name: z.string().trim().min(2, 'Nama laporan minimal 2 karakter').max(120),
  categoryId: z.string().min(1, 'Pilih kategori laporan.'),
  datasetId: z.string().min(1),
  layout: SavedLayoutSchema,
})

/** Changes to a saved report; its id, dataset and owner stay (links to the report keep working). */
export const UpdateSavedReportSchema = z
  .object({
    name: z.string().trim().min(2, 'Nama laporan minimal 2 karakter').max(120).optional(),
    categoryId: z.string().min(1, 'Pilih kategori laporan.').optional(),
    layout: SavedLayoutSchema.optional(),
  })
  .strict()
  .refine((x) => x.name !== undefined || x.categoryId !== undefined || x.layout !== undefined, 'Tidak ada yang diubah.')

export interface SavedReport {
  id: string
  name: string
  categoryId: string | null
  datasetId: string
  /** null: the dataset was deleted, so the report cannot be opened. */
  datasetName: string | null
  layout: z.infer<typeof SavedLayoutSchema>
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

interface Row {
  id: string
  name: string
  category_id: string | null
  dataset_id: string
  dataset_name: string | null
  layout: SavedReport['layout']
  created_by: string | null
  created_by_name: string | null
  created_at: Date
  updated_at: Date
}

const SELECT = `SELECT r.*, d.name AS dataset_name, u.name AS created_by_name
  FROM dor_saved_report r LEFT JOIN dor_dataset d ON d.id = r.dataset_id LEFT JOIN dor_user u ON u.id = r.created_by`

const toSaved = (r: Row): SavedReport => ({
  id: r.id,
  name: r.name,
  categoryId: r.category_id,
  datasetId: r.dataset_id,
  datasetName: r.dataset_name,
  layout: r.layout,
  createdBy: r.created_by,
  createdByName: r.created_by_name,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
})

export class SavedReportService {
  private readonly db: MetadataDb
  private readonly categories: CategoryService

  constructor(db: MetadataDb, categories: CategoryService) {
    this.db = db
    this.categories = categories
  }

  async list(): Promise<SavedReport[]> {
    return (await this.db.query<Row>(`${SELECT} ORDER BY r.updated_at DESC`)).rows.map(toSaved)
  }

  async create(input: z.infer<typeof CreateSavedReportSchema>, userId: string): Promise<SavedReport> {
    if (JSON.stringify(input.layout).length > MAX_LAYOUT_BYTES) throw badRequest('LAYOUT_TOO_LARGE', 'Layout terlalu besar untuk disimpan.')
    await this.categories.assertExists(input.categoryId)
    const dataset = await this.db.query('SELECT 1 FROM dor_dataset WHERE id = $1', [input.datasetId])
    if (!dataset.rowCount) throw badRequest('UNKNOWN_DATASET', 'Dataset laporan tidak ditemukan.')
    const id = `srp-${randomBytes(6).toString('hex')}`
    await this.db.query('INSERT INTO dor_saved_report (id, name, category_id, dataset_id, layout, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [id, input.name, input.categoryId, input.datasetId, JSON.stringify(input.layout), userId])
    await this.audit(userId, 'saved-report.create', id, { name: input.name, categoryId: input.categoryId, datasetId: input.datasetId })
    return toSaved((await this.db.query<Row>(`${SELECT} WHERE r.id = $1`, [id])).rows[0]!)
  }

  /** The owner or an administrator; the id stays, so links and bookmarks to the report keep working. */
  async update(id: string, input: z.infer<typeof UpdateSavedReportSchema>, user: Pick<User, 'id' | 'role'>): Promise<SavedReport> {
    const r = (await this.db.query<Row>('SELECT id, name, created_by FROM dor_saved_report WHERE id = $1', [id])).rows[0]
    if (!r) throw notFound('Laporan tidak ditemukan.')
    if (user.role !== 'admin' && r.created_by !== user.id) throw forbidden('Hanya pembuat laporan atau administrator yang dapat mengubahnya.')
    if (input.layout && JSON.stringify(input.layout).length > MAX_LAYOUT_BYTES) throw badRequest('LAYOUT_TOO_LARGE', 'Layout terlalu besar untuk disimpan.')
    if (input.categoryId) await this.categories.assertExists(input.categoryId)
    const sets: string[] = []
    const values: unknown[] = []
    const put = (col: string, v: unknown) => (values.push(v), sets.push(`${col} = $${values.length}`))
    if (input.name !== undefined) put('name', input.name)
    if (input.categoryId !== undefined) put('category_id', input.categoryId)
    if (input.layout !== undefined) put('layout', JSON.stringify(input.layout))
    values.push(id)
    await this.db.query(`UPDATE dor_saved_report SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values)
    await this.audit(user.id, 'saved-report.update', id, { name: input.name ?? r.name, fields: Object.keys(input) })
    return toSaved((await this.db.query<Row>(`${SELECT} WHERE r.id = $1`, [id])).rows[0]!)
  }

  /** The owner or an administrator. */
  async remove(id: string, user: Pick<User, 'id' | 'role'>): Promise<void> {
    const r = (await this.db.query<Row>('SELECT id, name, created_by FROM dor_saved_report WHERE id = $1', [id])).rows[0]
    if (!r) throw notFound('Laporan tidak ditemukan.')
    if (user.role !== 'admin' && r.created_by !== user.id) throw forbidden('Hanya pembuat laporan atau administrator yang dapat menghapusnya.')
    await this.db.query('DELETE FROM dor_saved_report WHERE id = $1', [id])
    await this.audit(user.id, 'saved-report.delete', id, { name: r.name })
  }

  private audit(userId: string, action: string, target: string, detail: unknown) {
    return this.db.query('INSERT INTO dor_audit (user_id, action, target, detail) VALUES ($1,$2,$3,$4)', [userId, action, target, JSON.stringify(detail)])
  }
}
