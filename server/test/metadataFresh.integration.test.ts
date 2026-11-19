/**
 * Columns of a source table (PostgreSQL, real catalog): a column added after the structure was read — a generated
 * column included, no ANALYZE run — is shown at once with fresh=1, and the refreshed metadata replaces the cache
 * that the dataset queries use. Runs on the temporary server of DOD_TEST_PG_HOST, in its own schema, dropped after.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import pg from 'pg'
import { loadConfig } from '../src/config/config.ts'
import type { MetadataDb } from '../src/db/metadataDb.ts'
import { PostgresMetadataService } from '../src/dw/postgresMetadataService.ts'
import { SourceRegistry } from '../src/dw/sourceRegistry.ts'
import { createLogger } from '../src/log/logger.ts'
import { QueryLog } from '../src/log/queryLog.ts'

const host = process.env.DOD_TEST_PG_HOST
const skip = host ? false : 'set DOD_TEST_PG_HOST to run the metadata refresh test on a temporary database'
const port = Number(process.env.DOD_TEST_PG_PORT || 5432)
const user = process.env.DOD_TEST_PG_USER || 'postgres'
const SCHEMA = `dodtest_meta_${process.pid}`

describe('source columns: fresh read after a column is added', { skip }, () => {
  let admin: pg.Client
  let sources: SourceRegistry
  let meta: PostgresMetadataService
  before(async () => {
    admin = new pg.Client({ host, port, user, password: process.env.DOD_TEST_PG_PASSWORD || undefined, database: 'postgres' })
    await admin.connect()
    await admin.query(`CREATE SCHEMA ${SCHEMA}`)
    await admin.query(`CREATE TABLE ${SCHEMA}.unit_harian (tanggal date, business_unit text, km numeric, bbm numeric)`)
    await admin.query(`INSERT INTO ${SCHEMA}.unit_harian VALUES ('2026-01-01', 'SAM-1', 100, 20)`)
    process.env.DOD_DW_T_PASSWORD = process.env.DOD_TEST_PG_PASSWORD || 'unused'
    const config = loadConfig({ DOD_DW_CONNECTIONS: 'T', DOD_DW_T_TYPE: 'postgresql', DOD_DW_T_HOST: host, DOD_DW_T_PORT: String(port), DOD_DW_T_DATABASE: 'postgres', DOD_DW_T_USERNAME: user, DOD_DW_T_SCHEMA: SCHEMA, DOD_DW_T_SSL_MODE: 'disable' })
    const log = createLogger('silent', false)
    sources = new SourceRegistry(config, log, new QueryLog({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as MetadataDb, log))
    meta = new PostgresMetadataService(sources, config)
  })
  after(async () => {
    delete process.env.DOD_DW_T_PASSWORD
    await sources?.closeAll()
    await admin?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => undefined)
    await admin?.end()
  })

  test('cached read keeps the old structure; fresh=1 shows the new and generated columns and refreshes the cache', async () => {
    const c = sources.list()[0]!
    const names = async (fresh = false) => (await meta.table(c, SCHEMA, 'unit_harian', undefined, fresh)).columns.map((x) => x.name)
    assert.deepEqual(await names(), ['tanggal', 'business_unit', 'km', 'bbm'])
    await admin.query(`ALTER TABLE ${SCHEMA}.unit_harian ADD COLUMN afdeling text, ADD COLUMN km_per_l numeric GENERATED ALWAYS AS (km / NULLIF(bbm, 0)) STORED`)
    assert.deepEqual(await names(), ['tanggal', 'business_unit', 'km', 'bbm'], 'within 60 s the cached structure is answered')
    assert.deepEqual(await names(true), ['tanggal', 'business_unit', 'km', 'bbm', 'afdeling', 'km_per_l'], 'no ANALYZE needed')
    assert.deepEqual(await names(), ['tanggal', 'business_unit', 'km', 'bbm', 'afdeling', 'km_per_l'], 'the cache the dataset queries read is refreshed')
  })

  test('a view is read like a table (columns, kind)', async () => {
    await admin.query(`CREATE VIEW ${SCHEMA}.v_unit AS SELECT tanggal, business_unit, km FROM ${SCHEMA}.unit_harian`)
    const t = await meta.table(sources.list()[0]!, SCHEMA, 'v_unit', undefined, true)
    assert.deepEqual(t.columns.map((x) => x.name), ['tanggal', 'business_unit', 'km'])
    assert.equal(t.kind, 'view')
  })
})
