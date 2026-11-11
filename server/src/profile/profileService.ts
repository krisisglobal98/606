/**
 * Data Profil (Analisis → card "Data Profil"): read-only profiles of single master records, straight from the
 * organization master database (dor_apims_master, DOD_DB_<TARGET>_MASTER_NAME) on the application database's
 * server and account. Nothing is copied and the master is never written: every session is read-only with a
 * statement timeout.
 *
 *   Profil Blok      ms_block + unit, afdeling, rayon, estate, status tanaman, varietas, terrain, soil,
 *                    kepemilikan, landuse, kondisi rawat/panen, jumlah TPH (ms_tph)
 *   Kartu Kendaraan  ms_vehicle + unit, kelompok (ms_vehiclegroup, satuan), model (ms_vehiclemodel)
 *
 * Source quirks handled here: placeholder dates ("1900-01-01", "1900-01-00", "[NULL]") and placeholder texts
 * ("", "-", "[NULL]") come back as null, so the page shows "–" instead of a fake value.
 */
import pg from 'pg'
import type { Config } from '../config/config.ts'
import { AppError, toSourceError } from '../http/errors.ts'
import type { Logger } from '../log/logger.ts'
import { blockCondition, vehicleCondition, type ProfileFilter } from '../dataAccess/guard.ts'

/** A block or vehicle with the PIMS ids the data access check needs (unit, rayon, division, ownership). */
export interface ProfileRef {
  kind: 'block' | 'vehicle'
  id: string
  code: string
  unitId: string | null
  unitCode: string | null
  companyId: string | null
  plantedHa: number | null
  uom: string | null
  divisionCode: string | null
  divisionId: string | null
  rayonId: string | null
  ownership: string | null
}

const ACTIVE = (t: string) => `(${t}.is_active AND NOT ${t}.is_deleted)`
/** Text or null for the source's placeholders. */
const TXT = (c: string) => `NULLIF(NULLIF(NULLIF(trim(${c}::text), ''), '-'), '[NULL]')`
/** ISO date or null; the source stores dates as text or timestamps and uses 1900 for "unknown". */
const DAY = (c: string) => `CASE WHEN ${TXT(c)} ~ '^\\d{4}-\\d{2}-\\d{2}' AND left(${TXT(c)}, 4)::int > 1900 AND substr(${TXT(c)}, 6, 5) !~ '-00$' THEN left(${TXT(c)}, 10) END`
const TZ = (c: string) => `to_char((${c}) AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`

/** A kebun / business unit with its number of active blocks and vehicles. */
export interface ProfileUnit { id: string; code: string; name: string; blocks: number; vehicles: number }
export interface BlockItem { id: string; code: string; name: string; unit: string | null; division: string | null; plantedHa: number | null; status: string | null }
export interface VehicleItem { id: string; code: string; name: string; unit: string | null; group: string | null; registrationNo: string | null }
/** A picker page: every record of one unit (at most UNIT_LIMIT), or at most LIMIT without a unit; `more` when the search should be narrowed. */
export interface Picked<T> { items: T[]; more: boolean }
export interface VehicleGroup { id: string; code: string; name: string; category: string | null }

export interface BlockProfile {
  id: string
  code: string
  name: string
  active: boolean
  org: { company: string | null; unit: string | null; unitCode: string | null; estate: string | null; estateCode: string | null; rayon: string | null; division: string | null }
  planting: { plantedOn: string | null; ageYears: number | null; status: string | null; statusCode: string | null; variety: string | null; breeder: string | null; tahunLc: number | null }
  land: { terrain: string | null; soil: string | null; ownership: string | null; landuse: string | null; upkeep: string | null; upkeepCode: string | null; harvest: string | null; harvestCode: string | null }
  area: { blockHa: number | null; plantedHa: number | null; other: { label: string; ha: number }[] }
  stand: { initial: number | null; total: number | null; productive: number | null; insertion: number | null; dead: number | null; perHa: number | null }
  tph: number
  remark: string | null
  validFrom: string | null
  updatedAt: string | null
}

export interface VehicleCard {
  id: string
  code: string
  name: string
  active: boolean
  downtime: boolean
  org: { company: string | null; unit: string | null; unitCode: string | null }
  group: { code: string | null; name: string | null; category: string | null; uom: string | null }
  identity: { registrationNo: string | null; assetNumber: string | null; controlAllocation: string | null; engineNo: string | null; chassisNo: string | null; merk: string | null; type: string | null; model: string | null }
  ownership: { kind: string | null; description: string | null }
  dates: { made: string | null; purchased: string | null; stnkUntil: string | null; whitened: string | null }
  meter: { start: number | null; end: number | null; startAdjust: number | null; endAdjust: number | null }
  remark: string | null
  validFrom: string | null
  updatedAt: string | null
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const LIMIT = 50
const UNIT_LIMIT = 1000
/** Search text: letters, digits and a few separators; LIKE wildcards are escaped. */
const like = (q: string | undefined) => (q?.trim() ? `%${q.trim().slice(0, 60).replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null)
const id = (v: string | undefined) => (v && /^\d{1,20}$/.test(v) ? v : null)

export class ProfileService {
  private readonly config: Config
  private readonly log: Logger
  private pool: pg.Pool | null = null

  constructor(config: Config, log: Logger) {
    this.config = config
    this.log = log
  }

  get configured(): boolean {
    return !!this.config.orgMaster
  }

  /** Units with blocks/vehicles. `f` = data access filter (null = unrestricted); counts include only rows it allows. */
  async units(f: ProfileFilter | null): Promise<ProfileUnit[]> {
    const params: unknown[] = []
    const kOk = blockCondition(f, params, 'k', 'ow')
    const vOk = vehicleCondition(f, params, 'v')
    const blockFrom = `ms_block k LEFT JOIN ms_blockownership ow ON ow.id = k.ownership_id WHERE k.businessunit_id = b.id AND ${ACTIVE('k')} AND ${kOk}`
    const vehicleFrom = `ms_vehicle v WHERE v.businessunit_id = b.id AND ${ACTIVE('v')} AND ${vOk}`
    const rows = await this.q<ProfileUnit & { blocks: string; vehicles: string }>(
      `SELECT b.id::text AS id, b.code, COALESCE(NULLIF(trim(b.name), ''), b.code) AS name,
              (SELECT count(DISTINCT k.id) FROM ${blockFrom}) AS blocks,
              (SELECT count(*) FROM ${vehicleFrom}) AS vehicles
       FROM ms_businessunit b
       WHERE EXISTS (SELECT 1 FROM ${blockFrom}) OR EXISTS (SELECT 1 FROM ${vehicleFrom})
       ORDER BY b.code`,
      params,
    )
    return rows.map((r) => ({ ...r, blocks: Number(r.blocks), vehicles: Number(r.vehicles) }))
  }

  async vehicleGroups(): Promise<VehicleGroup[]> {
    return this.q<VehicleGroup>(`SELECT g.id::text AS id, g.code, g.name, ${TXT('g.category')} AS category FROM ms_vehiclegroup g WHERE ${ACTIVE('g')} ORDER BY g.code`)
  }

  async blocks(f: { unit?: string; q?: string }, scope: ProfileFilter | null): Promise<Picked<BlockItem>> {
    const params: unknown[] = [id(f.unit), like(f.q)]
    const ok = blockCondition(scope, params, 'k', 'ow')
    const rows = await this.q<BlockItem & { plantedHa: string | null }>(
      // DISTINCT ON: the master holds some blocks twice under one id.
      `SELECT DISTINCT ON (b.code, d.name, k.code, k.id) k.id::text AS id, k.code, COALESCE(NULLIF(trim(k.name), ''), k.code) AS name, b.code AS unit, d.name AS division,
              k.planted_hectarage AS "plantedHa", st.code AS status
       FROM ms_block k LEFT JOIN ms_businessunit b ON b.id = k.businessunit_id LEFT JOIN ms_division d ON d.id = k.division_id
       LEFT JOIN ms_status_tanaman st ON st.id = k.statustanaman_id LEFT JOIN ms_blockownership ow ON ow.id = k.ownership_id
       WHERE ${ACTIVE('k')} AND ($1::bigint IS NULL OR k.businessunit_id = $1) AND ($2::text IS NULL OR k.code ILIKE $2 OR k.name ILIKE $2) AND ${ok}
       ORDER BY b.code, d.name, k.code, k.id LIMIT ${max(f.unit) + 1}`,
      params,
    )
    return page(rows.map((r) => ({ ...r, plantedHa: num(r.plantedHa) })), max(f.unit))
  }

  async vehicles(f: { unit?: string; group?: string; q?: string }, scope: ProfileFilter | null): Promise<Picked<VehicleItem>> {
    const params: unknown[] = [id(f.unit), id(f.group), like(f.q)]
    const ok = vehicleCondition(scope, params, 'v')
    const rows = await this.q<VehicleItem>(
      `SELECT v.id::text AS id, v.code, COALESCE(NULLIF(trim(v.name), ''), v.code) AS name, b.code AS unit, g.name AS "group", ${TXT('v.registration_no')} AS "registrationNo"
       FROM ms_vehicle v LEFT JOIN ms_businessunit b ON b.id = v.businessunit_id LEFT JOIN ms_vehiclegroup g ON g.id = v.vehiclegroup_id
       WHERE ${ACTIVE('v')} AND ($1::bigint IS NULL OR v.businessunit_id = $1) AND ($2::bigint IS NULL OR v.vehiclegroup_id = $2)
         AND ($3::text IS NULL OR v.code ILIKE $3 OR v.name ILIKE $3 OR v.registration_no ILIKE $3 OR v.asset_number ILIKE $3) AND ${ok}
       ORDER BY b.code, v.code LIMIT ${max(f.unit) + 1}`,
      params,
    )
    return page(rows, max(f.unit))
  }

  async block(blockId: string): Promise<BlockProfile> {
    const key = id(blockId)
    const r = key
      ? (
          await this.q<Record<string, unknown>>(
            `SELECT k.*, ${ACTIVE('k')} AS active_now, b.code AS unit_code, b.name AS unit_name, c.name AS company, e.name AS estate, e.code AS estate_code, ry.name AS rayon, d.name AS division,
                    st.code AS st_code, st.name AS st_name, va.name AS variety, ${TXT('va.breeder')} AS breeder, te.name AS terrain, so.name AS soil, ow.name AS ownership,
                    lu.name AS landuse, cu.name AS upkeep, cu.code AS upkeep_code, ch.name AS harvest, ch.code AS harvest_code, ${DAY('k.tanggal_tanam')} AS planted_on,
                    ${TZ('k.updated_at')} AS updated_on, k.valid_from::text AS valid_on,
                    (SELECT count(*) FROM ms_tph t WHERE t.block_id = k.id AND ${ACTIVE('t')})::int AS tph
             FROM ms_block k
             LEFT JOIN ms_businessunit b ON b.id = k.businessunit_id LEFT JOIN ms_company c ON c.id = b.company_id
             LEFT JOIN ms_estate e ON e.id = k.estate_id LEFT JOIN ms_rayon ry ON ry.id = k.rayon_id LEFT JOIN ms_division d ON d.id = k.division_id
             LEFT JOIN ms_status_tanaman st ON st.id = k.statustanaman_id LEFT JOIN ms_variety va ON va.id = k.variety_id
             LEFT JOIN ms_terrain te ON te.id = k.terrain_id LEFT JOIN ms_soil so ON so.id = k.soil_id LEFT JOIN ms_blockownership ow ON ow.id = k.ownership_id
             LEFT JOIN ms_landuse lu ON lu.id = k.landuse_id LEFT JOIN ms_condition cu ON cu.id = k.condition_upkeep_id LEFT JOIN ms_condition ch ON ch.id = k.condition_harvest_id
             WHERE k.id = $1 AND NOT k.is_deleted`,
            [key],
          )
        )[0]
      : undefined
    if (!r) throw new AppError(404, 'PROFILE_NOT_FOUND', 'Blok tidak ditemukan di data master.')
    const plantedOn = (r.planted_on as string | null) ?? null
    const plantedHa = num(r.planted_hectarage)
    const total = num(r.total_stand)
    const OTHER: [string, string][] = [['cadangan_ha', 'Cadangan'], ['okupasi_ha', 'Ditempati'], ['rendahan_ha', 'Rendahan'], ['sungai_ha', 'Sungai'], ['rumah_ha', 'Rumah'], ['kantor_ha', 'Kantor'], ['pabrik_ha', 'Pabrik'], ['jalan_ha', 'Jalan'], ['kolam_ha', 'Kolam'], ['umum_ha', 'Umum']]
    return {
      id: String(r.id),
      code: String(r.code),
      name: String(r.name ?? r.code),
      active: !!r.active_now,
      org: { company: s(r.company), unit: s(r.unit_name), unitCode: s(r.unit_code), estate: s(r.estate), estateCode: s(r.estate_code), rayon: s(r.rayon), division: s(r.division) },
      planting: { plantedOn, ageYears: plantedOn ? ageYears(plantedOn) : null, status: s(r.st_name), statusCode: s(r.st_code), variety: s(r.variety), breeder: s(r.breeder), tahunLc: num(r.tahun_lc) },
      land: { terrain: s(r.terrain), soil: s(r.soil), ownership: s(r.ownership), landuse: s(r.landuse), upkeep: s(r.upkeep), upkeepCode: s(r.upkeep_code), harvest: s(r.harvest), harvestCode: s(r.harvest_code) },
      area: { blockHa: num(r.block_hectarage), plantedHa, other: OTHER.map(([c, label]) => ({ label, ha: num(r[c]) ?? 0 })) },
      stand: { initial: num(r.initial_stand), total, productive: num(r.productive_stand), insertion: num(r.insertion_stand), dead: num(r.dead_stand), perHa: total && plantedHa ? Math.round(total / plantedHa) : null },
      tph: Number(r.tph ?? 0),
      remark: s(r.remark),
      validFrom: s(r.valid_on),
      updatedAt: s(r.updated_on),
    }
  }

  async vehicle(vehicleId: string): Promise<VehicleCard> {
    const key = id(vehicleId)
    const r = key
      ? (
          await this.q<Record<string, unknown>>(
            `SELECT v.id::text AS id, v.code, v.name, ${ACTIVE('v')} AS active_now, COALESCE(v.downtime, false) AS downtime, b.code AS unit_code, b.name AS unit_name, c.name AS company,
                    g.code AS g_code, g.name AS g_name, ${TXT('g.category')} AS g_category, u.name AS uom, md.model_name AS model,
                    ${TXT('v.registration_no')} AS registration_no, ${TXT('v.asset_number')} AS asset_number, ${TXT('v.control_allocation')} AS control_allocation,
                    ${TXT('v.engine_no')} AS engine_no, ${TXT('v.chasis_no')} AS chasis_no, ${TXT('v.merk')} AS merk, ${TXT('v.type')} AS type,
                    ${TXT('v.ownership')} AS ownership, ${TXT('v.ownership_desc')} AS ownership_desc,
                    ${DAY('v.date_of_made')} AS made, ${DAY('v.date_of_purchase')} AS purchased,
                    ${DAY(TZ('v.end_of_stnk'))} AS stnk, ${DAY(TZ('v.tanggal_pemutihan'))} AS whitened,
                    v.km_hm_awal, v.km_hm_akhir, v.km_hm_awal_adjust, v.km_hm_akhir_adjust, ${TXT('v.remark')} AS remark,
                    v.valid_from::text AS valid_on, ${TZ('v.updated_at')} AS updated_on
             FROM ms_vehicle v
             LEFT JOIN ms_businessunit b ON b.id = v.businessunit_id LEFT JOIN ms_company c ON c.id = b.company_id
             LEFT JOIN ms_vehiclegroup g ON g.id = v.vehiclegroup_id LEFT JOIN ms_uom u ON u.id = g.uom_id LEFT JOIN ms_vehiclemodel md ON md.id = v.vehiclemode_id
             WHERE v.id = $1 AND NOT v.is_deleted`,
            [key],
          )
        )[0]
      : undefined
    if (!r) throw new AppError(404, 'PROFILE_NOT_FOUND', 'Kendaraan tidak ditemukan di data master.')
    // A meter that never moved from 0 is "not recorded", not a reading.
    const meter = (v: unknown) => (num(v) ? num(v) : null)
    return {
      id: String(r.id),
      code: String(r.code),
      name: String(r.name ?? r.code),
      active: !!r.active_now,
      downtime: !!r.downtime,
      org: { company: s(r.company), unit: s(r.unit_name), unitCode: s(r.unit_code) },
      group: { code: s(r.g_code), name: s(r.g_name), category: s(r.g_category), uom: s(r.uom) },
      identity: { registrationNo: s(r.registration_no), assetNumber: s(r.asset_number), controlAllocation: s(r.control_allocation), engineNo: s(r.engine_no), chassisNo: s(r.chasis_no), merk: s(r.merk), type: s(r.type), model: s(r.model) },
      ownership: { kind: s(r.ownership), description: s(r.ownership_desc) },
      dates: { made: s(r.made), purchased: s(r.purchased), stnkUntil: s(r.stnk), whitened: s(r.whitened) },
      meter: { start: meter(r.km_hm_awal), end: meter(r.km_hm_akhir), startAdjust: meter(r.km_hm_awal_adjust), endAdjust: meter(r.km_hm_akhir_adjust) },
      remark: s(r.remark),
      validFrom: s(r.valid_on),
      updatedAt: s(r.updated_on),
    }
  }

  /** Read-only query on the master database (used by the operational tabs in ops.ts). */
  read<R extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<R[]> {
    return this.q<R>(sql, params)
  }

  /** Id, code and business unit of a block or vehicle (the unit picks its operational database). */
  async ref(kind: 'block' | 'vehicle', recordId: string): Promise<ProfileRef> {
    const key = id(recordId)
    const r = key
      ? (
          await this.q<{ id: string; code: string; unit_id: string | null; unit_code: string | null; company_id: string | null; planted: string | null; uom: string | null; division: string | null; division_id: string | null; rayon_id: string | null; ownership: string | null }>(
            kind === 'block'
              ? `SELECT k.id::text AS id, k.code, b.id::text AS unit_id, b.code AS unit_code, b.company_id::text AS company_id, k.planted_hectarage AS planted, NULL AS uom, d.code AS division,
                        k.division_id::text AS division_id, k.rayon_id::text AS rayon_id, ow.name AS ownership
                   FROM ms_block k LEFT JOIN ms_businessunit b ON b.id = k.businessunit_id LEFT JOIN ms_division d ON d.id = k.division_id
                   LEFT JOIN ms_blockownership ow ON ow.id = k.ownership_id WHERE k.id = $1 AND NOT k.is_deleted`
              : `SELECT v.id::text AS id, v.code, b.id::text AS unit_id, b.code AS unit_code, b.company_id::text AS company_id, NULL AS planted, u.name AS uom, NULL AS division,
                        NULL AS division_id, NULL AS rayon_id, NULL AS ownership
                   FROM ms_vehicle v LEFT JOIN ms_businessunit b ON b.id = v.businessunit_id LEFT JOIN ms_vehiclegroup g ON g.id = v.vehiclegroup_id
                   LEFT JOIN ms_uom u ON u.id = g.uom_id WHERE v.id = $1 AND NOT v.is_deleted`,
            [key],
          )
        )[0]
      : undefined
    if (!r) throw new AppError(404, 'PROFILE_NOT_FOUND', kind === 'block' ? 'Blok tidak ditemukan di data master.' : 'Kendaraan tidak ditemukan di data master.')
    return { kind, id: r.id, code: r.code, unitId: r.unit_id, unitCode: r.unit_code, companyId: r.company_id, plantedHa: num(r.planted), uom: r.uom, divisionCode: r.division, divisionId: r.division_id, rayonId: r.rayon_id, ownership: r.ownership }
  }

  async close() {
    const p = this.pool
    this.pool = null
    await p?.end().catch(() => undefined)
  }

  private async q<R extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<R[]> {
    try {
      return (await this.master().query<R>(sql, params)).rows
    } catch (e) {
      if (e instanceof AppError) throw e
      this.log.warn({ code: (e as { code?: string }).code }, 'profile master read failed')
      throw toSourceError(e)
    }
  }

  private master(): pg.Pool {
    const db = this.config.orgMaster
    if (!db) throw new AppError(409, 'PROFILE_MASTER_NOT_CONFIGURED', 'Database master belum dikonfigurasi di server (DOD_DB_<TARGET>_MASTER_NAME), sehingga Data Profil belum tersedia.')
    if (!this.pool) {
      const c = this.config.metadataDb
      this.pool = new pg.Pool({
        host: c.host,
        port: c.port,
        database: db.database,
        user: c.user,
        password: c.password,
        ssl: c.ssl ? { rejectUnauthorized: false } : false,
        max: 3,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        application_name: 'dod-profile',
        options: '-c default_transaction_read_only=on -c statement_timeout=15000',
      })
      this.pool.on('error', (e) => this.log.warn({ code: (e as { code?: string }).code }, 'profile master pool error'))
    }
    return this.pool
  }
}

const max = (unit: string | undefined) => (id(unit) ? UNIT_LIMIT : LIMIT)
const page = <T>(rows: T[], limit: number): Picked<T> => ({ items: rows.slice(0, limit), more: rows.length > limit })
const s = (v: unknown) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim())

/** Whole years between a YYYY-MM-DD day and today (Asia/Jakarta). */
export function ageYears(day: string, today = new Date()): number {
  const now = today.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const [ny, nm, nd] = now.split('-').map(Number) as [number, number, number]
  return Math.max(0, ny - y - (nm < m || (nm === m && nd < d) ? 1 : 0))
}
