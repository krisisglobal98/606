/**
 * Company → APIMS unit database (table dor_company_db): ms_company.companyAlias gives dor_apims_<alias>, and the list
 * of databases on the server says whether it exists. The API reads the table; `sync` refreshes it from the master.
 */
import { rollback } from '../db/connection.ts'
import type { MetadataDb } from '../db/metadataDb.ts'
import type { ProfileService } from './profileService.ts'

const CACHE_MS = 10 * 60_000

export const unitDbName = (alias: string | null): string | null => (alias?.trim() ? `dor_apims_${alias.trim().toLowerCase()}` : null)

export interface CompanyDb {
  companyId: string
  code: string
  name: string
  alias: string | null
  database: string | null
  exists: boolean
}

export class CompanyDbMap {
  private readonly profile: Pick<ProfileService, 'read'>
  private readonly db: MetadataDb
  private cache: { at: number; byId: Map<string, string> } | null = null

  constructor(profile: Pick<ProfileService, 'read'>, db: MetadataDb) {
    this.profile = profile
    this.db = db
  }

  /** The mapping as the master and the server state it now. Reads only. */
  async compute(): Promise<CompanyDb[]> {
    const [companies, databases] = await Promise.all([
      this.profile.read<{ id: string; code: string; name: string; alias: string | null }>(`SELECT id::text AS id, code, name, "companyAlias" AS alias FROM ms_company WHERE NOT is_deleted ORDER BY code, id`),
      this.profile.read<{ datname: string }>(`SELECT datname FROM pg_database WHERE NOT datistemplate AND datname LIKE 'dor_apims\\_%'`),
    ])
    const known = new Set(databases.map((d) => d.datname))
    return companies.map((c) => {
      const database = unitDbName(c.alias)
      return { companyId: c.id, code: c.code, name: c.name, alias: c.alias?.trim() || null, database, exists: !!database && known.has(database) }
    })
  }

  /** Refreshes dor_company_db. Companies no longer in the master leave the table. */
  async sync(): Promise<{ companies: number; withDatabase: number }> {
    const rows = await this.compute()
    const c = await this.db.pool.connect()
    let broken: Error | undefined
    try {
      await c.query('BEGIN')
      for (const r of rows) {
        await c.query(
          `INSERT INTO dor_company_db (company_id, company_code, company_name, company_alias, database_name, db_exists, synced_at) VALUES ($1,$2,$3,$4,$5,$6,now())
           ON CONFLICT (company_id) DO UPDATE SET company_code = EXCLUDED.company_code, company_name = EXCLUDED.company_name, company_alias = EXCLUDED.company_alias,
             database_name = EXCLUDED.database_name, db_exists = EXCLUDED.db_exists, synced_at = now()`,
          [r.companyId, r.code, r.name, r.alias, r.database, r.exists],
        )
      }
      await c.query('DELETE FROM dor_company_db WHERE NOT (company_id = ANY($1::bigint[]))', [rows.map((r) => r.companyId)])
      await c.query('COMMIT')
    } catch (e) {
      broken = await rollback(c, e)
      throw e
    } finally {
      c.release(broken)
    }
    this.cache = null
    return { companies: rows.length, withDatabase: rows.filter((r) => r.exists).length }
  }

  /** The unit database of a company, or null when none is known. An empty table is filled on first use. */
  async dbFor(companyId: string | null): Promise<string | null> {
    if (!companyId) return null
    if (!this.cache || Date.now() - this.cache.at > CACHE_MS) {
      const read = () => this.db.query<{ company_id: string; database_name: string }>('SELECT company_id::text AS company_id, database_name FROM dor_company_db WHERE db_exists')
      let rows = (await read()).rows
      if (!rows.length) {
        await this.sync()
        rows = (await read()).rows
      }
      this.cache = { at: Date.now(), byId: new Map(rows.map((r) => [r.company_id, r.database_name])) }
    }
    return this.cache.byId.get(companyId) ?? null
  }
}
