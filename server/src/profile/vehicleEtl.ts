/**
 * ETL of the Data Profil: what a unit database holds that the cards keep in DOD's own tables.
 *   tr_tractionpremi                 → dor_vehicle_cost UPAH (operator and helper premium per vehicle and month)
 *   material record                  → dor_vehicle_cost BBM, OLI, SPAREPART, BAN
 *   other vehicle costs              → dor_vehicle_cost BENGKEL, SERVICE_LUAR, PAJAK, PENYUSUTAN, SEWA
 *   vehicle assets and standards     → dor_vehicle_card
 * KPI, Kegiatan and Work Order are read live and need no copy. The material, cost and asset sources are the
 * dummy schema dod_dummy for now (only dor_apims_psa has it; elsewhere they read as empty): point the queries at the
 * real tables when they exist.
 *
 * Safe to run again: rows it wrote are replaced, rows the source no longer has are removed, and what an administrator
 * entered is never overwritten (a cost without the "ETL:" sumber, a card without the "ETL:" keterangan). Pattern and steps for other units: docs/VEHICLE_PROFILE_ETL.md.
 */
import type { MetadataDb } from '../db/metadataDb.ts'
import { rollback } from '../db/connection.ts'
import { badRequest } from '../http/errors.ts'
import type { CompanyDbMap } from './companyDb.ts'
import type { ProfileService } from './profileService.ts'
import type { UnitSources } from './unitSource.ts'

const JOB = 'data-profil'
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/
export const etlSumber = (database: string) => `ETL: tr_tractionpremi (${database})`
const dummySumber = (table: string, database: string) => `ETL: dod_dummy.${table} (${database})`
/** Costs read from the dummy schema carry it in their sumber, so the tabs can say so. */
export const isDummySumber = (sumber: string | null | undefined) => !!sumber?.includes('dod_dummy.')

interface CostRow {
  vehicle_id: string
  periode: string
  kategori: string
  nilai: string
  qty: string | null
  sumber: string
}

export interface EtlResult {
  dryRun: boolean
  alias: string
  database: string
  vehicles: number
  months: string[]
  read: number
  written: number
  skipped: number
  removed: number
  /** Source rows whose vehicle is not in the master for this company. */
  unknownVehicles: number
  total: number
  cards: number
}

export class VehicleEtl {
  private readonly profile: Pick<ProfileService, 'read'>
  private readonly units: Pick<UnitSources, 'query'>
  private readonly map: Pick<CompanyDbMap, 'compute'>
  private readonly db: MetadataDb

  constructor(profile: Pick<ProfileService, 'read'>, units: Pick<UnitSources, 'query'>, map: Pick<CompanyDbMap, 'compute'>, db: MetadataDb) {
    this.profile = profile
    this.units = units
    this.map = map
    this.db = db
  }

  /** One company, by its alias. With dryRun nothing is written, not even the run log. */
  async run(opts: { alias: string; period?: string; dryRun?: boolean }): Promise<EtlResult> {
    if (opts.period && !PERIOD.test(opts.period)) throw badRequest('INVALID_PERIOD', 'Periode harus berformat YYYY-MM.')
    const alias = opts.alias.trim().toLowerCase()
    const companies = (await this.map.compute()).filter((c) => c.alias?.toLowerCase() === alias)
    const database = companies.find((c) => c.exists)?.database
    if (!companies.length) throw badRequest('ETL_UNKNOWN_COMPANY', `Perusahaan dengan alias "${opts.alias}" tidak ada di ms_company.`)
    if (!database) throw badRequest('ETL_NO_DATABASE', `Database dor_apims_${alias} tidak ada di server.`)

    const run = opts.dryRun ? null : (await this.db.query<{ id: string }>(`INSERT INTO dor_etl_run (job, scope, database_name, period, status) VALUES ($1,$2,$3,$4,'running') RETURNING id`, [JOB, alias, database, opts.period ?? null])).rows[0]!.id
    try {
      const result = await this.load(alias, database, companies.map((c) => c.companyId), opts.period, !!opts.dryRun)
      if (run) await this.db.query(`UPDATE dor_etl_run SET rows_read = $2, rows_written = $3, rows_skipped = $4, rows_removed = $5, status = 'succeeded', finished_at = now() WHERE id = $1`, [run, result.read, result.written + result.cards, result.skipped, result.removed])
      return result
    } catch (e) {
      if (run) await this.db.query(`UPDATE dor_etl_run SET status = 'failed', message = $2, finished_at = now() WHERE id = $1`, [run, String((e as Error).message).slice(0, 500)])
      throw e
    }
  }

  private async readCosts(database: string, period: string | undefined): Promise<CostRow[]> {
    const q = (sql: string, sumber: string) => this.units.query<CostRow>(database, sql, [period ?? null, sumber])
    const [premi, material, other] = await Promise.all([
      q(
        `SELECT vehicle_id::text AS vehicle_id, to_char(date_trunc('month', traksi_date), 'YYYY-MM-DD') AS periode, 'UPAH' AS kategori, sum(grandtotalpremi) AS nilai, NULL AS qty, $2::text AS sumber
           FROM "TractionWorkshop".tr_tractionpremi p
          WHERE p.is_active AND NOT p.is_deleted AND p.vehicle_id IS NOT NULL AND ($1::text IS NULL OR to_char(p.traksi_date, 'YYYY-MM') = $1) GROUP BY 1, 2`,
        etlSumber(database),
      ),
      q(
        `SELECT vehicle_id::text AS vehicle_id, to_char(date_trunc('month', trans_date), 'YYYY-MM-DD') AS periode, category AS kategori, sum(total_value) AS nilai, CASE WHEN category IN ('BBM', 'OLI') THEN sum(qty) END AS qty, $2::text AS sumber
           FROM dod_dummy.material_record WHERE ($1::text IS NULL OR to_char(trans_date, 'YYYY-MM') = $1) GROUP BY 1, 2, 3`,
        dummySumber('material_record', database),
      ),
      q(
        `SELECT vehicle_id::text AS vehicle_id, to_char(periode, 'YYYY-MM-DD') AS periode, kategori, nilai, NULL AS qty, $2::text AS sumber
           FROM dod_dummy.vehicle_other_cost WHERE ($1::text IS NULL OR to_char(periode, 'YYYY-MM') = $1)`,
        dummySumber('vehicle_other_cost', database),
      ),
    ])
    return [...premi, ...material, ...other]
  }

  private async load(alias: string, database: string, companyIds: string[], period: string | undefined, dryRun: boolean): Promise<EtlResult> {
    const vehicles = new Set((await this.profile.read<{ id: string }>(
      `SELECT v.id::text AS id FROM ms_vehicle v JOIN ms_businessunit b ON b.id = v.businessunit_id WHERE b.company_id = ANY($1::bigint[]) AND NOT v.is_deleted`,
      [companyIds],
    )).map((v) => v.id))
    const source = await this.readCosts(database, period)
    const rows = source.filter((r) => vehicles.has(r.vehicle_id))
    const months = [...new Set(rows.map((r) => r.periode.slice(0, 7)))].sort()
    const total = rows.reduce((a, r) => a + Number(r.nilai), 0)
    const base = { dryRun, alias, database, vehicles: new Set(rows.map((r) => r.vehicle_id)).size, months, read: source.length, unknownVehicles: source.length - rows.length, total }

    const ids = [...vehicles]
    const key = (v: string, p: string, k: string) => `${v}|${p}|${k}`
    const manual = new Set((await this.db.query<{ k: string }>(
      `SELECT vehicle_id::text || '|' || to_char(periode, 'YYYY-MM-DD') || '|' || kategori AS k FROM dor_vehicle_cost WHERE vehicle_id = ANY($1::bigint[]) AND COALESCE(sumber, '') NOT LIKE 'ETL:%'`,
      [ids],
    )).rows.map((m) => m.k))
    const write = rows.filter((r) => !manual.has(key(r.vehicle_id, r.periode, r.kategori)))
    const wanted = write.map((r) => key(r.vehicle_id, r.periode, r.kategori))
    const scoped = period ? `AND to_char(periode, 'YYYY-MM') = $3` : ''
    const staleSql = `FROM dor_vehicle_cost WHERE sumber LIKE 'ETL:%' AND vehicle_id = ANY($1::bigint[]) AND NOT ((vehicle_id::text || '|' || to_char(periode, 'YYYY-MM-DD') || '|' || kategori) = ANY($2::text[])) ${scoped}`
    const params = [ids, wanted, ...(period ? [period] : [])]

    const cards = (await this.units.query<Record<string, string>>(database, `SELECT vehicle_id::text AS vehicle_id, satuan, tarif_budget, bbm_standar, interval_service, nilai_perolehan, nilai_buku, to_char(nilai_buku_per, 'YYYY-MM-DD') AS nilai_buku_per, biaya_perbaikan_awal FROM dod_dummy.vehicle_asset`)).filter((c) => vehicles.has(c.vehicle_id!))

    if (dryRun) {
      const stale = (await this.db.query<{ n: string }>(`SELECT count(*) AS n ${staleSql}`, params)).rows[0]!
      return { ...base, written: write.length, skipped: rows.length - write.length, removed: Number(stale.n), cards: cards.length }
    }
    const c = await this.db.pool.connect()
    let broken: Error | undefined
    try {
      await c.query('BEGIN')
      for (const r of write) {
        await c.query(
          `INSERT INTO dor_vehicle_cost (vehicle_id, periode, kategori, nilai, qty, sumber) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (vehicle_id, periode, kategori) DO UPDATE SET nilai = EXCLUDED.nilai, qty = EXCLUDED.qty, sumber = EXCLUDED.sumber, updated_at = now() WHERE dor_vehicle_cost.sumber LIKE 'ETL:%'`,
          [r.vehicle_id, r.periode, r.kategori, r.nilai, r.qty, r.sumber],
        )
      }
      const removed = (await c.query(`DELETE ${staleSql}`, params)).rowCount ?? 0
      const note = `ETL: dod_dummy.vehicle_asset (${database})`
      let cardCount = 0
      for (const a of cards) {
        cardCount += (await c.query(
          `INSERT INTO dor_vehicle_card (vehicle_id, satuan, tarif_budget, bbm_standar, interval_service, nilai_perolehan, nilai_buku, nilai_buku_per, biaya_perbaikan_awal, keterangan) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           ON CONFLICT (vehicle_id) DO UPDATE SET satuan = EXCLUDED.satuan, tarif_budget = EXCLUDED.tarif_budget, bbm_standar = EXCLUDED.bbm_standar, interval_service = EXCLUDED.interval_service, nilai_perolehan = EXCLUDED.nilai_perolehan,
             nilai_buku = EXCLUDED.nilai_buku, nilai_buku_per = EXCLUDED.nilai_buku_per, biaya_perbaikan_awal = EXCLUDED.biaya_perbaikan_awal, keterangan = EXCLUDED.keterangan, updated_at = now()
           WHERE dor_vehicle_card.keterangan LIKE 'ETL:%'`,
          [a.vehicle_id, a.satuan, a.tarif_budget, a.bbm_standar, a.interval_service, a.nilai_perolehan, a.nilai_buku, a.nilai_buku_per, a.biaya_perbaikan_awal, note],
        )).rowCount ?? 0
      }
      await c.query(`DELETE FROM dor_vehicle_card WHERE keterangan LIKE 'ETL:%' AND vehicle_id = ANY($1::bigint[]) AND NOT (vehicle_id::text = ANY($2::text[]))`, [ids, cards.map((a) => a.vehicle_id)])
      await c.query('COMMIT')
      return { ...base, written: write.length, skipped: rows.length - write.length, removed, cards: cardCount }
    } catch (e) {
      broken = await rollback(c, e)
      throw e
    } finally {
      c.release(broken)
    }
  }
}
