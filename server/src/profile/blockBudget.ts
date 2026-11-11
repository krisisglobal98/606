/**
 * Production budget per block for Analisis → Data Profil → Profil Blok (tab Produksi): SUM(produksi_harian) of
 * DO_PIMS_REPORT.data_budget.budget_produksi_harian (DOD_PRODUCTION_DB, same server and account as the application
 * database), read in a read-only, time-limited session.
 *
 * The budget table does not share keys with the block master exactly: kebun codes differ in spelling (ATS-1 / ATS1),
 * afdeling codes are Roman or two-digit (VI / 06), block codes differ in leading zeros and case (H008 / H8). The
 * normalisation below makes the spellings comparable; the afdeling only decides when a block code is used in several.
 */
import pg from 'pg'
import type { Config } from '../config/config.ts'
import { AppError } from '../http/errors.ts'

const ROMAN: Record<string, number> = Object.fromEntries('I II III IV V VI VII VIII IX X XI XII XIII XIV XV XVI XVII XVIII XIX XX'.split(' ').map((r, i) => [r, i + 1]))
const BUDGET_TABLE = 'data_budget.budget_produksi_harian'

/** "ATS-1" / "ATS 1" / "ats1" → "ATS1". */
export const normKebun = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[\s_-]/g, '')
/**
 * "VI" / "06" / "AFD06" / "6" → "6"; anything else unchanged (upper case). "XX" is the production table's placeholder
 * for rows without an afdeling (not Roman 20) and stays "XX".
 */
export function normAfd(s: string | null | undefined): string {
  const v = (s ?? '').trim().toUpperCase()
  if (v !== 'XX' && ROMAN[v]) return String(ROMAN[v])
  const m = /^(?:AFD)?0*(\d+)$/.exec(v)
  return m ? m[1]! : v
}
/** "H008" → "H8", "d33a" → "D33A", "M25A" → "M25A"; codes of another shape stay as they are (upper case). */
export function normBlok(s: string | null | undefined): string {
  const v = (s ?? '').trim().toUpperCase()
  const m = /^([A-Z]+)0*(\d+)([A-Z]*)$/.exec(v)
  return m ? `${m[1]}${Number(m[2])}${m[3]}` : v
}

/** Ton of a block among a unit's budget rows; the afdeling decides only when a block code is used in several. */
export function budgetOfBlock(rows: { afdeling: string | null; blokcode: string | null; kg: string | number | null }[], afd: string | null, blockCode: string): number | null {
  const code = normBlok(blockCode)
  const same = rows.filter((r) => normBlok(r.blokcode) === code)
  const own = same.filter((r) => normAfd(r.afdeling) === normAfd(afd))
  const hit = own.length ? own : same
  if (!hit.length) return null
  return hit.reduce((s, r) => s + Number(r.kg), 0) / 1000
}

export class BlockBudget {
  private pool: pg.Pool | null = null
  private readonly cfg: Pick<Config, 'metadataDb' | 'production'>

  constructor(config: Pick<Config, 'metadataDb' | 'production'>) {
    this.cfg = config
  }

  get configured() {
    return !!this.cfg.production
  }

  private db(): pg.Pool {
    const p = this.cfg.production
    if (!p) throw new AppError(503, 'PRODUCTION_NOT_CONFIGURED', 'Data budget produksi belum dikonfigurasi di server (DOD_PRODUCTION_DB).')
    if (!this.pool) {
      const c = this.cfg.metadataDb
      this.pool = new pg.Pool({
        host: c.host,
        port: c.port,
        database: p.database,
        user: c.user,
        password: c.password,
        ssl: c.ssl ? { rejectUnauthorized: false } : false,
        max: 2,
        connectionTimeoutMillis: 8_000,
        idleTimeoutMillis: 30_000,
        application_name: 'dod-block-budget',
        // read-only, bounded: this connection can never change the production database
        options: '-c default_transaction_read_only=on -c statement_timeout=30000',
      })
      this.pool.on('error', () => undefined)
    }
    return this.pool
  }

  /**
   * Production budget of one block in [from, to), in ton. null when the table has no such block. Spellings of the unit
   * are listed so the query can use the kodebisnisunit index.
   */
  async blockBudgetTon(unitCode: string, afd: string | null, blockCode: string, from: string, to: string): Promise<number | null> {
    const norm = normKebun(unitCode)
    const spellings = [...new Set([unitCode, norm, norm.replace(/(\d+)$/, '-$1')])]
    const r = await this.db().query<{ afdeling: string | null; blokcode: string | null; kg: string | null }>(
      `SELECT afdeling, blokcode, sum(produksi_harian) AS kg FROM ${BUDGET_TABLE}
        WHERE kodebisnisunit = ANY($1) AND tanggal >= $2::date AND tanggal < $3::date GROUP BY 1, 2`,
      [spellings, from, to],
    )
    return budgetOfBlock(r.rows, afd, blockCode)
  }

  /** Ends the pool and forgets it: a later call opens a fresh pool instead of using an ended one. */
  async close() {
    const p = this.pool
    this.pool = null
    await p?.end()
  }
}
