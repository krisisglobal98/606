/**
 * Operational tabs of Data Profil, per month:
 *
 *   Profil Blok      Produksi   FieldOperation.trx_harvest (janjang, brondolan), trx_blockactivity modul PANEN (kg, ha),
 *                               trx_bjr_monthly, trx_taksasi_header (AKP); budget from DO_PIMS_REPORT.data_budget.budget_produksi_harian
 *                    Perawatan  trx_blockactivity (non-panen, non-pupuk) + material of trx_progress_*
 *                    Pemupukan  trx_blockactivity (kegiatan pupuk) + material of trx_progress_*
 *                    Biaya      Keuangan.tr_costallocation (alokasi biaya tenaga kerja ke blok)
 *   Kartu Kendaraan  TractionWorkshop.tr_tractionvehicleactivity(+detail) (meter, trip, muatan, jam), tr_tractionpremi
 *                    (operator), tr_workorder(+detailvehicle); costs, budget tariff, standards and asset values from
 *                    dor_vehicle_cost and dor_vehicle_card (DOD, filled by an administrator)
 *
 * Source data are read live and read-only from the unit database of the record's business unit (unitSource.ts).
 * Names of job codes and materials come from the master. Only aggregates leave this module.
 */
import { z } from 'zod'
import type { CompanyDbMap } from './companyDb.ts'
import { isDummySumber } from './vehicleEtl.ts'
import type { MetadataDb } from '../db/metadataDb.ts'
import { rollback } from '../db/connection.ts'
import { badRequest } from '../http/errors.ts'
import type { ProfileService } from './profileService.ts'
import type { UnitSources } from './unitSource.ts'

const FO = '"FieldOperation"'
const TW = '"TractionWorkshop"'
const KU = '"Keuangan"'
const LIVE = (t: string) => `${t}.is_active AND NOT ${t}.is_deleted`
const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const z0 = (v: unknown) => n(v) ?? 0

/* ---------------- periods ---------------- */
const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/
export function monthRange(period: string): { from: string; to: string; ym: number } {
  const m = PERIOD.exec(period)
  if (!m) throw badRequest('INVALID_PERIOD', 'Periode harus berformat YYYY-MM.')
  const y = Number(m[1])
  const mo = Number(m[2])
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
  return { from: `${period}-01`, to: `${next}-01`, ym: y * 100 + mo }
}
const pickPeriod = (wanted: string | undefined, periods: string[]) => (wanted && PERIOD.test(wanted) ? wanted : (periods[0] ?? null))

/** "03:23", "7 Jam 0 Menit" or "7" → minutes. */
export function minutesOf(v: unknown): number {
  const s = String(v ?? '').trim()
  let m = /^(\d{1,3}):(\d{2})/.exec(s)
  if (m) return Number(m[1]) * 60 + Number(m[2])
  m = /^(\d{1,3})\s*jam(?:\s*(\d{1,2})\s*menit)?/i.exec(s)
  if (m) return Number(m[1]) * 60 + Number(m[2] ?? 0)
  return /^\d+(\.\d+)?$/.test(s) ? Math.round(Number(s) * 60) : 0
}

export type BlockTab = 'produksi' | 'perawatan' | 'pemupukan' | 'biaya'
export const BLOCK_TABS: BlockTab[] = ['produksi', 'perawatan', 'pemupukan', 'biaya']
export const COST_CATEGORIES = [
  ['BBM', 'BBM'],
  ['OLI', 'Oli & Pelumas'],
  ['SPAREPART', 'Sparepart'],
  ['BAN', 'Ban'],
  ['SERVICE_LUAR', 'Service Luar'],
  ['UPAH', 'Upah Sopir/Operator'],
  ['BENGKEL', 'Bengkel'],
  ['PAJAK', 'Pajak/KIR/Asuransi'],
  ['PENYUSUTAN', 'Penyusutan'],
  ['SEWA', 'Sewa'],
] as const
export type CostCategory = (typeof COST_CATEGORIES)[number][0]
/** Repairs counted in the cumulative repair ratio of the replacement decision. */
const REPAIR: CostCategory[] = ['SPAREPART', 'BAN', 'SERVICE_LUAR', 'BENGKEL']
const PUPUK = `~* 'pupuk|pemupukan|fertili'`

export const CardSchema = z.object({
  tarifBudget: z.number().nonnegative().nullable(),
  satuan: z.enum(['KM', 'HM']).nullable(),
  bbmStandar: z.number().nonnegative().nullable(),
  intervalService: z.number().positive().nullable(),
  nilaiPerolehan: z.number().nonnegative().nullable(),
  nilaiBuku: z.number().nonnegative().nullable(),
  nilaiBukuPer: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  biayaPerbaikanAwal: z.number().nonnegative().default(0),
  batasPantau: z.number().positive().max(10).default(0.5),
  batasEvaluasi: z.number().positive().max(10).default(0.75),
  keterangan: z.string().trim().max(500).nullable().default(null),
}).refine((c) => c.batasEvaluasi >= c.batasPantau, { message: 'Batas evaluasi harus ≥ batas pantau.', path: ['batasEvaluasi'] })
export type Card = z.infer<typeof CardSchema>
export const CostsSchema = z.object({
  items: z.array(z.object({ kategori: z.enum(COST_CATEGORIES.map((c) => c[0]) as [CostCategory, ...CostCategory[]]), nilai: z.number().nonnegative(), qty: z.number().nonnegative().nullable().default(null), sumber: z.string().trim().max(200).nullable().default(null) })).max(COST_CATEGORIES.length),
})

export class ProfileOps {
  private readonly profile: ProfileService
  private readonly units: UnitSources
  private readonly db: MetadataDb
  private readonly companies?: Pick<CompanyDbMap, 'dbFor'>
  private budgets?: BudgetSource

  constructor(profile: ProfileService, units: UnitSources, db: MetadataDb, companies?: Pick<CompanyDbMap, 'dbFor'>, budgets?: BudgetSource) {
    this.profile = profile
    this.units = units
    this.db = db
    this.companies = companies
    this.budgets = budgets
  }

  private async unitDb(kind: 'block' | 'vehicle', recordId: string) {
    const ref = await this.profile.ref(kind, recordId)
    // The company mapping first; the name of the business unit code for a company it does not know.
    const database = (await this.companies?.dbFor(ref.companyId).catch(() => null)) ?? (await this.units.dbFor(ref.unitCode))
    return { ref, database }
  }

  /* ======================= Profil Blok ======================= */
  async block(recordId: string, tab: string, wanted?: string) {
    if (!(BLOCK_TABS as string[]).includes(tab)) throw badRequest('INVALID_TAB', 'Tab profil blok tidak dikenal.')
    const { ref, database } = await this.unitDb('block', recordId)
    const base = { tab: tab as BlockTab, block: { id: ref.id, code: ref.code, unitCode: ref.unitCode, plantedHa: ref.plantedHa }, source: database }
    if (!database) return { ...base, periods: [] as string[], period: null, data: null, notice: `Database operasional unit ${ref.unitCode ?? '–'} tidak ditemukan di server.` }
    const q = <R extends Record<string, unknown>>(sql: string, params: unknown[]) => this.units.query<R>(database, sql, params)
    const periods = (
      await q<{ p: string }>(
        `SELECT p FROM (SELECT to_char(transdate, 'YYYY-MM') AS p FROM ${FO}.trx_blockactivity a WHERE a.block_id = $1 AND ${LIVE('a')}
                        UNION SELECT to_char(transdate, 'YYYY-MM') FROM ${FO}.trx_harvest h WHERE h.block_id = $1 AND ${LIVE('h')}
                        UNION SELECT to_char(tanggal, 'YYYY-MM') FROM ${KU}.tr_costallocation c WHERE c.businessunit_id = $2 AND split_part(c.targetcode, ' - ', 2) = $3 AND ${LIVE('c')}) x
         WHERE p IS NOT NULL ORDER BY p DESC LIMIT 36`,
        [ref.id, ref.unitId, ref.code],
      )
    ).map((r) => r.p)
    const period = pickPeriod(wanted, periods)
    if (!period) return { ...base, periods, period: null, data: null, notice: 'Belum ada transaksi operasional untuk blok ini.' }
    const r = monthRange(period)
    const data =
      tab === 'produksi' ? await this.production(q, ref, r) : tab === 'biaya' ? await this.blockCost(q, ref, r) : await this.activities(q, ref, r, tab === 'pemupukan')
    return { ...base, periods, period, data, notice: null }
  }

  private async production(q: Q, ref: Ref, r: Range) {
    const [h, p, bjr, akp, daily, monthly, budgetTon] = await Promise.all([
      q<Record<string, unknown>>(
        `SELECT sum(tbs_total) AS jjg, sum(brondolan_kg) AS brd, count(DISTINCT transdate::date) AS hari, count(DISTINCT employee_workinfo_id) AS pemanen
           FROM ${FO}.trx_harvest h WHERE h.block_id = $1 AND h.transdate >= $2 AND h.transdate < $3 AND ${LIVE('h')}`,
        [ref.id, r.from, r.to],
      ),
      q<Record<string, unknown>>(
        `SELECT sum(qty) AS kg, sum(hectare) AS ha, count(*) AS hk FROM ${FO}.trx_blockactivity a
          WHERE a.block_id = $1 AND a.modul_name = 'PANEN' AND a.transdate >= $2 AND a.transdate < $3 AND ${LIVE('a')}`,
        [ref.id, r.from, r.to],
      ),
      q<Record<string, unknown>>(`SELECT kg_bjr, jml_jjg, kg_total FROM ${FO}.trx_bjr_monthly b WHERE b.block_id = $1 AND b.period = $2 AND ${LIVE('b')} LIMIT 1`, [ref.id, r.ym]),
      q<Record<string, unknown>>(`SELECT avg(akp_percentage) AS akp, count(*) AS n FROM ${FO}.trx_taksasi_header t WHERE t.block_id = $1 AND t.transdate >= $2 AND t.transdate < $3 AND ${LIVE('t')}`, [ref.id, r.from, r.to]),
      q<Record<string, unknown>>(
        `SELECT to_char(d, 'YYYY-MM-DD') AS day, sum(jjg) AS jjg, sum(kg) AS kg FROM (
           SELECT transdate::date AS d, tbs_total AS jjg, NULL::numeric AS kg FROM ${FO}.trx_harvest h WHERE h.block_id = $1 AND h.transdate >= $2 AND h.transdate < $3 AND ${LIVE('h')}
           UNION ALL SELECT transdate, NULL, qty FROM ${FO}.trx_blockactivity a WHERE a.block_id = $1 AND a.modul_name = 'PANEN' AND a.transdate >= $2 AND a.transdate < $3 AND ${LIVE('a')}) x
         GROUP BY d ORDER BY d`,
        [ref.id, r.from, r.to],
      ),
      q<Record<string, unknown>>(
        `SELECT to_char(transdate, 'YYYY-MM') AS period, sum(qty) AS kg, sum(hectare) AS ha FROM ${FO}.trx_blockactivity a
          WHERE a.block_id = $1 AND a.modul_name = 'PANEN' AND ${LIVE('a')} GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
        [ref.id],
      ),
      // A budget table that cannot be reached leaves the budget empty; the rest of the tab still shows.
      ref.unitCode && this.budgets ? this.budgets.blockBudgetTon(ref.unitCode, ref.divisionCode, ref.code, r.from, r.to).catch(() => null) : null,
    ])
    const jjg = z0(h[0]?.jjg)
    const kg = z0(p[0]?.kg)
    const ton = kg / 1000
    return {
      kpi: {
        janjang: jjg,
        brondolanKg: z0(h[0]?.brd),
        tonase: ton,
        haPanen: z0(p[0]?.ha),
        hkPanen: z0(p[0]?.hk),
        hariPanen: z0(h[0]?.hari),
        pemanen: z0(h[0]?.pemanen),
        bjr: n(bjr[0]?.kg_bjr) ?? (jjg ? kg / jjg : null),
        bjrSource: bjr[0] ? 'trx_bjr_monthly' : jjg ? 'tonase ÷ janjang' : null,
        produktivitas: ref.plantedHa ? ton / ref.plantedHa : null,
        outputHk: z0(p[0]?.hk) ? ton / z0(p[0]?.hk) : null,
        akp: n(akp[0]?.akp),
        taksasi: z0(akp[0]?.n),
        budgetTon,
        achievement: budgetTon ? (ton / budgetTon) * 100 : null,
      },
      daily: daily.map((d) => ({ day: String(d.day), janjang: z0(d.jjg), kg: z0(d.kg) })),
      monthly: monthly.map((m) => ({ period: String(m.period), ton: z0(m.kg) / 1000, ha: z0(m.ha) })).reverse(),
    }
  }

  private async activities(q: Q, ref: Ref, r: Range, pupuk: boolean) {
    const acts = await q<Record<string, unknown>>(
      `SELECT activitycode_code AS code, activitycode_name AS name, modul_name AS modul, count(*) AS hk, count(DISTINCT employee_id) AS pekerja,
              count(DISTINCT transdate) AS hari, sum(hectare) AS ha, sum(qty) AS qty, avg(NULLIF(dosis, 0)) AS dosis,
              to_char(min(transdate), 'YYYY-MM-DD') AS first, to_char(max(transdate), 'YYYY-MM-DD') AS last
         FROM ${FO}.trx_blockactivity a
        WHERE a.block_id = $1 AND a.transdate >= $2 AND a.transdate < $3 AND ${LIVE('a')}
          AND a.modul_name NOT IN ('PANEN', 'TUKANG MUAT') AND ${pupuk ? '' : 'NOT '}(a.activitycode_name ${PUPUK})
        GROUP BY 1, 2, 3 ORDER BY sum(hectare) DESC NULLS LAST`,
      [ref.id, r.from, r.to],
    )
    const mats = await q<Record<string, unknown>>(
      `SELECT m.item_code AS item, h.activitycode_id AS job, sum(m.amount) AS amount, count(DISTINCT h.id) AS docs
         FROM ${FO}.trx_progress_material m JOIN ${FO}.trx_progress_header h ON h.id = m.progress_header_id
        WHERE h.block_id = $1 AND h.transdate >= $2 AND h.transdate < $3 AND ${LIVE('m')} AND ${LIVE('h')}
        GROUP BY 1, 2`,
      [ref.id, r.from, r.to],
    )
    // Names from the master: activity (job code) of each material document, and the material itself.
    const jobIds = [...new Set(mats.map((m) => String(m.job)).filter((x) => /^\d{1,20}$/.test(x)))]
    const codes = [...new Set([...acts.map((a) => String(a.code)), ...mats.map((m) => String(m.item))])]
    const [jobs, items] = await Promise.all([
      jobIds.length ? this.profile.read<{ id: string; code: string; name: string; uom: string | null }>(`SELECT j.id::text AS id, j.code, j.name, u.name AS uom FROM ms_jobcode j LEFT JOIN ms_uom u ON u.id = j.uom_id_output WHERE j.id = ANY($1::bigint[])`, [jobIds]) : [],
      codes.length ? this.profile.read<{ code: string; name: string; uom: string | null; category: string | null; kind: string }>(
            `SELECT item_code AS code, item_description AS name, uom_code AS uom, item_category AS category, 'item' AS kind FROM mst_material_oracle WHERE item_code = ANY($1)
             UNION ALL SELECT j.code, j.name, u.name, NULL, 'job' FROM ms_jobcode j LEFT JOIN ms_uom u ON u.id = j.uom_id_output WHERE j.code = ANY($1)`,
            [codes],
          ) : [],
    ])
    const job = new Map(jobs.map((j) => [j.id, j]))
    const item = new Map(items.filter((i) => i.kind === 'item').map((i) => [i.code, i]))
    const jobUom = new Map(items.filter((i) => i.kind === 'job').map((i) => [i.code, i.uom]))
    const isPupuk = (name: string | null | undefined) => /pupuk|pemupukan|fertili/i.test(name ?? '')
    const byItem = new Map<string, { code: string; name: string; uom: string | null; category: string | null; qty: number; activities: Set<string> }>()
    for (const m of mats) {
      const j = job.get(String(m.job))
      // A material belongs to this tab through its activity; without a known activity, a fertilizer category decides.
      const it = item.get(String(m.item))
      const pupukDoc = j ? isPupuk(j.name) : /pupuk|fert/i.test(it?.category ?? it?.name ?? '')
      if (pupukDoc !== pupuk) continue
      const k = String(m.item)
      const e = byItem.get(k) ?? { code: k, name: it?.name ?? k, uom: it?.uom ?? null, category: it?.category ?? null, qty: 0, activities: new Set<string>() }
      e.qty += z0(m.amount)
      if (j) e.activities.add(j.name)
      byItem.set(k, e)
    }
    const activities = acts.map((a) => ({
      code: String(a.code), name: String(a.name), modul: String(a.modul ?? ''), hk: z0(a.hk), pekerja: z0(a.pekerja), hari: z0(a.hari), ha: z0(a.ha), qty: z0(a.qty),
      uom: jobUom.get(String(a.code)) ?? null, dosis: n(a.dosis), first: String(a.first), last: String(a.last),
    }))
    const materials = [...byItem.values()].map(({ activities: s, ...m }) => ({ ...m, activities: [...s], perHa: ref.plantedHa ? m.qty / ref.plantedHa : null })).sort((a, b) => b.qty - a.qty)
    return {
      activities,
      materials,
      totals: { hk: activities.reduce((s, a) => s + a.hk, 0), ha: activities.reduce((s, a) => s + a.ha, 0), kegiatan: activities.length, material: materials.length },
    }
  }

  private async blockCost(q: Q, ref: Ref, r: Range) {
    const rows = await q<Record<string, unknown>>(
      `SELECT jobcode_id::text AS job, sum(qty) AS qty, sum(qty * rate) AS nilai, count(*) AS n
         FROM ${KU}.tr_costallocation c
        WHERE c.businessunit_id = $1 AND split_part(c.targetcode, ' - ', 2) = $2 AND c.tanggal >= $3 AND c.tanggal < $4 AND ${LIVE('c')}
        GROUP BY 1 ORDER BY 3 DESC`,
      [ref.unitId, ref.code, r.from, r.to],
    )
    const ids = rows.map((x) => String(x.job)).filter((x) => /^\d{1,20}$/.test(x))
    const jobs = ids.length ? await this.profile.read<{ id: string; code: string; name: string }>('SELECT id::text AS id, code, name FROM ms_jobcode WHERE id = ANY($1::bigint[])', [ids]) : []
    const job = new Map(jobs.map((j) => [j.id, j]))
    const items = rows.map((x) => {
      const j = job.get(String(x.job))
      const qty = z0(x.qty)
      const nilai = z0(x.nilai)
      return { code: j?.code ?? String(x.job), name: j?.name ?? 'Kegiatan tidak dikenal', hk: qty, nilai, rate: qty ? nilai / qty : null, entries: z0(x.n) }
    })
    const total = items.reduce((s, i) => s + i.nilai, 0)
    return { items, total, hk: items.reduce((s, i) => s + i.hk, 0), perHa: ref.plantedHa ? total / ref.plantedHa : null }
  }

  /* ======================= Kartu Kendaraan ======================= */
  async vehicle(recordId: string, wanted?: string) {
    const { ref, database } = await this.unitDb('vehicle', recordId)
    const [cardRow, costMonths] = await Promise.all([
      this.db.query<Record<string, unknown>>('SELECT * FROM dor_vehicle_card WHERE vehicle_id = $1', [ref.id]),
      this.db.query<{ p: string }>("SELECT DISTINCT to_char(periode, 'YYYY-MM') AS p FROM dor_vehicle_cost WHERE vehicle_id = $1", [ref.id]),
    ])
    const card = cardRow.rows[0] ? cardOf(cardRow.rows[0]) : null
    const q = <R extends Record<string, unknown>>(sql: string, params: unknown[]) => (database ? this.units.query<R>(database, sql, params) : Promise.resolve([] as R[]))
    const srcMonths = (
      await q<{ p: string }>(
        `SELECT DISTINCT to_char(h.activity_date, 'YYYY-MM') AS p FROM ${TW}.tr_tractionvehicleactivitydetail d JOIN ${TW}.tr_tractionvehicleactivity h ON h.id = d.activity_header_id
          WHERE d.vehicle_id = $1 AND ${LIVE('d')} AND ${LIVE('h')}`,
        [ref.id],
      )
    ).map((r) => r.p)
    const periods = [...new Set([...srcMonths, ...costMonths.rows.map((r) => r.p)])].filter(Boolean).sort().reverse()
    const period = pickPeriod(wanted, periods)
    const satuan = card?.satuan ?? (ref.uom ? (/hour|jam/i.test(ref.uom) ? 'HM' : 'KM') : 'KM')
    const base = { vehicle: { id: ref.id, code: ref.code, unitCode: ref.unitCode }, source: database, periods, period, satuan, card }
    if (!period) return { ...base, data: null, notice: database ? 'Belum ada aktivitas atau biaya untuk kendaraan ini.' : `Database operasional unit ${ref.unitCode ?? '–'} tidak ditemukan di server; hanya data kartu DOD yang tersedia.` }
    const r = monthRange(period)
    const [details, operators, wo, costs, repairsBefore] = await Promise.all([
      q<Record<string, unknown>>(
        `SELECT to_char(h.activity_date, 'YYYY-MM-DD') AS day, d.jobcode_id::text AS job, d.awal, d.akhir, d.trip, d.qty_kilogram AS kg,
                d.jam_operasi, d.jam_rusak, d.jam_tersedia, d.angkutan_dari AS dari, d.angkutan_ke AS ke
           FROM ${TW}.tr_tractionvehicleactivitydetail d JOIN ${TW}.tr_tractionvehicleactivity h ON h.id = d.activity_header_id
          WHERE d.vehicle_id = $1 AND h.activity_date >= $2 AND h.activity_date < $3 AND ${LIVE('d')} AND ${LIVE('h')}
          ORDER BY h.activity_date, d.awal`,
        [ref.id, r.from, r.to],
      ),
      q<{ name: string; days: string }>(
        `SELECT operator_name AS name, count(DISTINCT traksi_date::date) AS days FROM ${TW}.tr_tractionpremi p
          WHERE p.vehicle_id = $1 AND p.traksi_date >= $2 AND p.traksi_date < $3 AND ${LIVE('p')} AND operator_name IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
        [ref.id, r.from, r.to],
      ),
      q<Record<string, unknown>>(
        `SELECT w.nomor, to_char(w.tanggal, 'YYYY-MM-DD') AS tanggal, to_char(w.tanggalmasuk, 'YYYY-MM-DD') AS masuk, w.jenistask, w.jenisworkshop,
                COALESCE(NULLIF(w.deskripsikerusakan, ''), NULLIF(w.keterangan, ''), w.remark) AS keluhan, w.penyebabkerusakan AS penyebab, w.kmhmmasuk AS meter
           FROM ${TW}.tr_workorder w JOIN ${TW}.tr_workorderdetailvehicle v ON v.workorder_id = w.id
          WHERE v.vehicle_id = $1 AND w.tanggal >= $2 AND w.tanggal < $3 AND ${LIVE('w')} AND ${LIVE('v')} ORDER BY w.tanggal`,
        [ref.id, r.from, r.to],
      ),
      this.db.query<Record<string, unknown>>('SELECT kategori, nilai, qty, sumber FROM dor_vehicle_cost WHERE vehicle_id = $1 AND periode = $2', [ref.id, r.from]),
      this.db.query<{ s: string | null }>(`SELECT sum(nilai) AS s FROM dor_vehicle_cost WHERE vehicle_id = $1 AND periode < $2 AND kategori = ANY($3)`, [ref.id, r.from, REPAIR]),
    ])

    // Meter, trips, load and hours; availability once per day (the source repeats it on every line of the day).
    let usage = 0
    let trip = 0
    let kg = 0
    let opMin = 0
    let brokenMin = 0
    const availPerDay = new Map<string, number>()
    const byJob = new Map<string, { usage: number; trip: number; kg: number; lines: number }>()
    let meterStart: number | null = null
    let meterEnd: number | null = null
    for (const d of details) {
      const a = n(d.awal)
      const b = n(d.akhir)
      const u = a != null && b != null && b >= a ? b - a : 0
      usage += u
      trip += z0(d.trip)
      kg += z0(d.kg)
      opMin += minutesOf(d.jam_operasi)
      brokenMin += minutesOf(d.jam_rusak)
      availPerDay.set(String(d.day), Math.max(availPerDay.get(String(d.day)) ?? 0, minutesOf(d.jam_tersedia)))
      if (a != null && a > 0) meterStart = meterStart == null ? a : Math.min(meterStart, a)
      if (b != null && b > 0) meterEnd = meterEnd == null ? b : Math.max(meterEnd, b)
      const j = byJob.get(String(d.job)) ?? { usage: 0, trip: 0, kg: 0, lines: 0 }
      j.usage += u
      j.trip += z0(d.trip)
      j.kg += z0(d.kg)
      j.lines += 1
      byJob.set(String(d.job), j)
    }
    const availMin = [...availPerDay.values()].reduce((s, x) => s + x, 0)
    const jobIds = [...byJob.keys()].filter((x) => /^\d{1,20}$/.test(x))
    const jobs = jobIds.length ? await this.profile.read<{ id: string; code: string; name: string }>('SELECT id::text AS id, code, name FROM ms_jobcode WHERE id = ANY($1::bigint[])', [jobIds]) : []
    const jobName = new Map(jobs.map((j) => [j.id, j]))

    const costRows = new Map(costs.rows.map((c) => [String(c.kategori), c]))
    const costItems = COST_CATEGORIES.map(([k, label]) => {
      const c = costRows.get(k)
      return { kategori: k, label, nilai: c ? z0(c.nilai) : 0, qty: c ? n(c.qty) : null, sumber: c ? ((c.sumber as string | null) ?? null) : null, recorded: !!c }
    })
    const totalCost = costItems.reduce((s, c) => s + c.nilai, 0)
    const hasCost = costItems.some((c) => c.recorded)
    const dummyCost = costItems.some((c) => isDummySumber(c.sumber))
    const partialCost = hasCost && costItems.filter((c) => c.recorded).every((c) => c.sumber?.startsWith('ETL:'))
    const tarifAktual = hasCost && usage ? totalCost / usage : null
    const bbm = costRows.get('BBM')
    const bbmLiter = bbm ? n(bbm.qty) : null
    const ton = kg / 1000
    const repairNow = costItems.filter((c) => REPAIR.includes(c.kategori)).reduce((s, c) => s + c.nilai, 0)
    const repairBefore = (card?.biayaPerbaikanAwal ?? 0) + z0(repairsBefore.rows[0]?.s)
    const cumulative = repairBefore + repairNow
    const ratio = card?.nilaiBuku ? cumulative / card.nilaiBuku : null
    const rekomendasi = ratio == null || !card ? null : ratio >= card.batasEvaluasi ? 'EVALUASI PEREMAJAAN' : ratio >= card.batasPantau ? 'PANTAU' : 'PERTAHANKAN'

    return {
      ...base,
      notice: database
        ? dummyCost
          ? 'Data biaya kendaraan ini adalah data dummy untuk pengujian (dor_apims_psa), bukan data operasional.'
          : partialCost
          ? 'Biaya baru berisi premi sopir/operator dan helper dari APIMS. BBM, sparepart, bengkel, dan lainnya belum punya sumber data, jadi total biaya dan tarif aktual lebih rendah dari yang sebenarnya.'
          : null
        : `Database operasional unit ${ref.unitCode ?? '–'} tidak ditemukan di server; aktivitas dan work order tidak tersedia.`,
      data: {
        kpi: {
          pemakaian: usage, trip, muatanTon: ton, jamOperasi: opMin / 60, jamRusak: brokenMin / 60, jamTersedia: availMin / 60,
          pa: availMin ? Math.max(0, availMin - brokenMin) / availMin : null, hariOperasi: availPerDay.size, meterStart, meterEnd,
          jumlahWO: wo.length, bbmLiter, bbmRasio: bbmLiter != null && usage ? bbmLiter / usage : null, totalBiaya: hasCost ? totalCost : null,
          tarifAktual, biayaPerTon: hasCost && ton ? totalCost / ton : null, indeks: tarifAktual != null && card?.tarifBudget ? tarifAktual / card.tarifBudget : null,
        },
        operators: operators.map((o) => ({ name: o.name, days: z0(o.days) })),
        costs: costItems,
        costRecorded: hasCost,
        activities: [...byJob.entries()]
          .map(([id, j]) => ({ code: jobName.get(id)?.code ?? id, name: jobName.get(id)?.name ?? 'Kegiatan tidak dikenal', usage: j.usage, trip: j.trip, kg: j.kg, lines: j.lines, share: usage ? j.usage / usage : 0, charge: tarifAktual != null ? j.usage * tarifAktual : null }))
          .sort((a, b) => b.usage - a.usage),
        workOrders: wo.map((w) => ({ nomor: String(w.nomor ?? ''), tanggal: (w.tanggal as string | null) ?? null, masuk: (w.masuk as string | null) ?? null, jenis: (w.jenistask as string | null) ?? null, bengkel: (w.jenisworkshop as string | null) ?? null, keluhan: (w.keluhan as string | null) ?? null, penyebab: (w.penyebab as string | null) ?? null, meter: n(w.meter) })),
        cumulative: { sdBulanLalu: repairBefore, bulanIni: repairNow, total: cumulative, nilaiBuku: card?.nilaiBuku ?? null, rasio: ratio, rekomendasi, batasPantau: card?.batasPantau ?? null, batasEvaluasi: card?.batasEvaluasi ?? null },
      },
    }
  }

  async setVehicleCard(recordId: string, body: unknown, userId: string) {
    const { ref } = await this.unitDb('vehicle', recordId)
    const c = CardSchema.parse(body)
    const r = await this.db.query<Record<string, unknown>>(
      `INSERT INTO dor_vehicle_card (vehicle_id, tarif_budget, satuan, bbm_standar, interval_service, nilai_perolehan, nilai_buku, nilai_buku_per, biaya_perbaikan_awal, batas_pantau, batas_evaluasi, keterangan, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (vehicle_id) DO UPDATE SET tarif_budget = EXCLUDED.tarif_budget, satuan = EXCLUDED.satuan, bbm_standar = EXCLUDED.bbm_standar, interval_service = EXCLUDED.interval_service,
         nilai_perolehan = EXCLUDED.nilai_perolehan, nilai_buku = EXCLUDED.nilai_buku, nilai_buku_per = EXCLUDED.nilai_buku_per, biaya_perbaikan_awal = EXCLUDED.biaya_perbaikan_awal,
         batas_pantau = EXCLUDED.batas_pantau, batas_evaluasi = EXCLUDED.batas_evaluasi, keterangan = EXCLUDED.keterangan, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      [ref.id, c.tarifBudget, c.satuan, c.bbmStandar, c.intervalService, c.nilaiPerolehan, c.nilaiBuku, c.nilaiBukuPer, c.biayaPerbaikanAwal, c.batasPantau, c.batasEvaluasi, c.keterangan, userId],
    )
    return cardOf(r.rows[0]!)
  }

  /** Replaces the costs of one month: categories left out are removed. */
  async setVehicleCosts(recordId: string, period: string, body: unknown, userId: string) {
    const { ref } = await this.unitDb('vehicle', recordId)
    const r = monthRange(period)
    const b = CostsSchema.parse(body)
    if (new Set(b.items.map((i) => i.kategori)).size !== b.items.length) throw badRequest('DUPLICATE_CATEGORY', 'Setiap kategori biaya hanya boleh satu kali per bulan.')
    const c = await this.db.pool.connect()
    let broken: Error | undefined
    try {
      await c.query('BEGIN')
      await c.query('DELETE FROM dor_vehicle_cost WHERE vehicle_id = $1 AND periode = $2', [ref.id, r.from])
      for (const i of b.items)
        await c.query('INSERT INTO dor_vehicle_cost (vehicle_id, periode, kategori, nilai, qty, sumber, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7)', [ref.id, r.from, i.kategori, i.nilai, i.qty, i.sumber, userId])
      await c.query('INSERT INTO dor_audit (user_id, action, target, detail) VALUES ($1, $2, $3, $4)', [userId, 'profile.vehicle.costs', ref.id, JSON.stringify({ period, categories: b.items.length })])
      await c.query('COMMIT')
    } catch (e) {
      broken = await rollback(c, e)
      throw e
    } finally {
      c.release(broken)
    }
    return { period, items: b.items.length }
  }
}

type Q = <R extends Record<string, unknown>>(sql: string, params: unknown[]) => Promise<R[]>
/** Production budget per block (BlockBudget, profile/blockBudget.ts). */
export type BudgetSource = { blockBudgetTon(unitCode: string, afd: string | null, blockCode: string, from: string, to: string): Promise<number | null> }

type Ref = Awaited<ReturnType<ProfileService['ref']>>
type Range = ReturnType<typeof monthRange>

function cardOf(r: Record<string, unknown>) {
  return {
    tarifBudget: n(r.tarif_budget),
    satuan: (r.satuan as 'KM' | 'HM' | null) ?? null,
    bbmStandar: n(r.bbm_standar),
    intervalService: n(r.interval_service),
    nilaiPerolehan: n(r.nilai_perolehan),
    nilaiBuku: n(r.nilai_buku),
    nilaiBukuPer: r.nilai_buku_per ? (r.nilai_buku_per instanceof Date ? isoDay(r.nilai_buku_per) : String(r.nilai_buku_per).slice(0, 10)) : null,
    biayaPerbaikanAwal: z0(r.biaya_perbaikan_awal),
    batasPantau: z0(r.batas_pantau),
    batasEvaluasi: z0(r.batas_evaluasi),
    keterangan: (r.keterangan as string | null) ?? null,
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : null,
  }
}
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
