/**
 * Company mapping and vehicle ETL on temporary databases: an application database, a master and one unit database.
 * Opt-in like the other integration tests: DOD_TEST_PG_HOST. Everything it creates is dropped afterwards.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import pg from 'pg'
import { loadConfig } from '../src/config/config.ts'
import { createContainer, type Container } from '../src/container.ts'
import { createLogger } from '../src/log/logger.ts'
import { etlSumber } from '../src/profile/vehicleEtl.ts'

const host = process.env.DOD_TEST_PG_HOST
const skip = host ? false : 'set DOD_TEST_PG_HOST to run the vehicle ETL integration test on temporary databases'
const admin = { host: host ?? '', port: Number(process.env.DOD_TEST_PG_PORT || 5432), user: process.env.DOD_TEST_PG_USER || undefined, password: process.env.DOD_TEST_PG_PASSWORD || undefined }
const id = randomBytes(4).toString('hex')
const ALIAS = `t${id}`
const APP = `dor_test_${id}`
const MASTER = `dor_test_m_${id}`
const UNIT = `dor_apims_${ALIAS}`

async function run(database: string, sql: string, values: unknown[] = []) {
  const c = new pg.Client({ ...admin, database })
  await c.connect()
  try {
    return await c.query(sql, values)
  } finally {
    await c.end()
  }
}

describe('company mapping and vehicle ETL', { skip }, () => {
  let k: Container
  const costs = async () => (await k.db.query<{ vehicle_id: string; p: string; nilai: string; sumber: string }>(`SELECT vehicle_id::text AS vehicle_id, to_char(periode, 'YYYY-MM') AS p, nilai, sumber FROM dor_vehicle_cost ORDER BY 1, 2`)).rows

  before(async () => {
    for (const d of [APP, MASTER, UNIT]) await run('postgres', `CREATE DATABASE ${d}`)
    await run(MASTER, `
      CREATE TABLE ms_company (id bigint, code text, name text, "companyAlias" text, is_deleted boolean DEFAULT false);
      CREATE TABLE ms_businessunit (id bigint, code text, company_id bigint);
      CREATE TABLE ms_vehicle (id bigint, businessunit_id bigint, is_deleted boolean DEFAULT false);
      CREATE TABLE ms_block (id bigint, businessunit_id bigint, is_deleted boolean DEFAULT false);
      INSERT INTO ms_block VALUES (500, 10, false), (500, 10, false), (900, 30, false);
      INSERT INTO ms_company VALUES (1, 'A05', 'PT Satu', '${ALIAS.toUpperCase()}', false), (2, 'R07', 'PT Satu Region', '${ALIAS}', false), (3, 'X01', 'PT Tanpa DB', 'nihil${id}', false), (4, 'X02', 'PT Tanpa Alias', NULL, false), (5, 'X03', 'PT Dihapus', 'hapus', true);
      INSERT INTO ms_businessunit VALUES (10, 'U1', 1), (20, 'U2', 2), (30, 'U3', 3);
      INSERT INTO ms_vehicle VALUES (100, 10, false), (101, 20, false), (102, 10, false), (300, 30, false);`)
    await run(UNIT, `
      CREATE SCHEMA "TractionWorkshop";
      CREATE TABLE "TractionWorkshop".tr_tractionpremi (vehicle_id bigint, traksi_date timestamp, grandtotalpremi numeric, is_active boolean DEFAULT true, is_deleted boolean DEFAULT false);
      INSERT INTO "TractionWorkshop".tr_tractionpremi VALUES
        (100, '2026-10-02', 1000, true, false), (100, '2026-10-03', 500, true, false), (100, '2026-09-30', 700, true, false),
        (101, '2026-10-05', 200, true, false), (102, '2026-10-05', 300, true, false),
        (100, '2026-10-06', 9999, true, true), (999, '2026-10-06', 50, true, false);`)
    k = createContainer(loadConfig({ NODE_ENV: 'test', DOD_DB_HOST: admin.host, DOD_DB_PORT: String(admin.port), DOD_DB_NAME: APP, DOD_DB_MASTER_NAME: MASTER, DOD_DB_USER: admin.user ?? process.env.USER ?? 'postgres', DOD_DB_PASSWORD: admin.password ?? '', DOD_PUBLISH_DIR: '/tmp/dod-etl-test' }), createLogger('silent', false))
    await k.db.migrate()
  })

  after(async () => {
    await k?.profile.close()
    await k?.db.close()
    for (const d of [APP, MASTER, UNIT]) await run('postgres', `DROP DATABASE IF EXISTS ${d} WITH (FORCE)`)
  })

  test('the mapping follows companyAlias and the databases on the server', async () => {
    const before = await k.companyDb.compute()
    assert.deepEqual(before.map((r) => [r.code, r.database, r.exists]).filter((r) => r[0] !== 'X01'), [['A05', UNIT, true], ['R07', UNIT, true], ['X02', null, false]])
    assert.equal(before.find((r) => r.code === 'X01')!.exists, false)
    assert.deepEqual(await k.companyDb.sync(), { companies: 4, withDatabase: 2 })
    assert.equal(await k.companyDb.dbFor('1'), UNIT)
    assert.equal(await k.companyDb.dbFor('3'), null)
    await run(MASTER, `UPDATE ms_company SET is_deleted = true WHERE code = 'X02'`)
    await k.companyDb.sync()
    assert.equal((await k.db.query(`SELECT 1 FROM dor_company_db WHERE company_code = 'X02'`)).rowCount, 0)
  })

  test('a dry run reports and writes nothing', async () => {
    const r = await k.vehicleEtl.run({ alias: ALIAS.toUpperCase(), dryRun: true })
    assert.deepEqual([r.vehicles, r.months, r.read, r.written, r.unknownVehicles, r.total], [3, ['2026-09', '2026-10'], 5, 4, 1, 2700])
    assert.deepEqual(await costs(), [])
    assert.equal((await k.db.query('SELECT 1 FROM dor_etl_run')).rowCount, 0)
  })

  test('premium per vehicle and month; running again changes nothing; manual figures stay', async () => {
    await k.db.query(`INSERT INTO dor_vehicle_cost (vehicle_id, periode, kategori, nilai, sumber) VALUES (102, '2026-10-01', 'UPAH', 12345, 'Input admin'), (102, '2026-10-01', 'BBM', 77, NULL)`)
    const first = await k.vehicleEtl.run({ alias: ALIAS })
    assert.deepEqual([first.written, first.skipped, first.removed], [3, 1, 0])
    const expected = [['100', '2026-09', '700.00'], ['100', '2026-10', '1500.00'], ['101', '2026-10', '200.00'], ['102', '2026-10', '77.00'], ['102', '2026-10', '12345.00']]
    const read = async () => (await costs()).map((c) => [c.vehicle_id, c.p, c.nilai]).sort()
    assert.deepEqual(await read(), expected.sort())
    await k.vehicleEtl.run({ alias: ALIAS })
    assert.deepEqual(await read(), expected, 'idempotent')
    assert.equal((await costs()).find((c) => c.vehicle_id === '100')!.sumber, etlSumber(UNIT))

    await run(UNIT, `DELETE FROM "TractionWorkshop".tr_tractionpremi WHERE traksi_date < '2026-10-01'`)
    await run(UNIT, `UPDATE "TractionWorkshop".tr_tractionpremi SET grandtotalpremi = 800 WHERE vehicle_id = 101`)
    const again = await k.vehicleEtl.run({ alias: ALIAS })
    assert.equal(again.removed, 1, 'a month the source no longer has leaves')
    const after = await read()
    assert.ok(!after.some((r) => r[0] === '100' && r[1] === '2026-09'))
    assert.ok(after.some((r) => r[0] === '101' && r[2] === '800.00'))
    const log = (await k.db.query<{ status: string; rows_written: number }>(`SELECT status, rows_written FROM dor_etl_run ORDER BY id`)).rows
    assert.deepEqual(log.map((l) => l.status), ['succeeded', 'succeeded', 'succeeded'])
  })

  test('material, other costs and card from the dummy schema; a manual card stays', async () => {
    await run(UNIT, `
      CREATE SCHEMA dod_dummy;
      CREATE TABLE dod_dummy.material_record (vehicle_id bigint, trans_date date, category text, qty numeric, total_value numeric);
      CREATE TABLE dod_dummy.vehicle_other_cost (vehicle_id bigint, periode date, kategori text, nilai numeric);
      CREATE TABLE dod_dummy.vehicle_asset (vehicle_id bigint, satuan text, tarif_budget numeric, bbm_standar numeric, interval_service numeric, nilai_perolehan numeric, nilai_buku numeric, nilai_buku_per date, biaya_perbaikan_awal numeric);
      INSERT INTO dod_dummy.material_record VALUES (100, '2026-10-02', 'BBM', 100, 1450000), (100, '2026-10-20', 'BBM', 50, 725000), (100, '2026-10-20', 'SPAREPART', 1, 900000), (300, '2026-10-20', 'BBM', 1, 1);
      INSERT INTO dod_dummy.vehicle_other_cost VALUES (100, '2026-10-01', 'PENYUSUTAN', 4000000);
      INSERT INTO dod_dummy.vehicle_asset VALUES (100, 'KM', 7000, 0.33, 5000, 500000000, 200000000, '2026-10-31', 1000000), (101, 'KM', 7000, 0.33, 5000, 500000000, 200000000, '2026-10-31', 0);`)
    await k.db.query(`INSERT INTO dor_vehicle_card (vehicle_id, tarif_budget, keterangan) VALUES (101, 1, 'Input admin')`)
    const dry = await k.vehicleEtl.run({ alias: ALIAS, dryRun: true })
    assert.deepEqual([dry.cards, dry.unknownVehicles], [2, 2], 'a vehicle of another company is left out')
    const r = await k.vehicleEtl.run({ alias: ALIAS })
    assert.equal(r.cards, 1, 'the manual card is not overwritten')
    const bbm = (await k.db.query<{ nilai: string; qty: string; sumber: string }>(`SELECT nilai, qty, sumber FROM dor_vehicle_cost WHERE vehicle_id = 100 AND kategori = 'BBM'`)).rows[0]!
    assert.deepEqual([bbm.nilai, bbm.qty], ['2175000.00', '150.000'])
    assert.match(bbm.sumber, /dod_dummy\.material_record/)
    assert.equal((await k.db.query(`SELECT 1 FROM dor_vehicle_cost WHERE vehicle_id = 300`)).rowCount, 0)
    assert.equal((await k.db.query<{ tarif_budget: string }>(`SELECT tarif_budget FROM dor_vehicle_card WHERE vehicle_id = 101`)).rows[0]!.tarif_budget, '1.00')
    assert.equal((await k.db.query<{ nilai_buku: string }>(`SELECT nilai_buku FROM dor_vehicle_card WHERE vehicle_id = 100`)).rows[0]!.nilai_buku, '200000000.00')
  })

  test('an unknown company or a company without a database is refused', async () => {
    await assert.rejects(k.vehicleEtl.run({ alias: 'tidakada' }), /tidak ada di ms_company/)
    await assert.rejects(k.vehicleEtl.run({ alias: `nihil${id}` }), /tidak ada di server/)
  })
})
