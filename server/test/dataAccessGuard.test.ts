/**
 * DataAccessGuard (pure): dataset standard status → data or refusal; notification rules per level; the row
 * predicate in the generated SQL of every source before aggregation and the FULL JOIN; bind parameters only.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { SqlBuilder } from '../src/analytics/sqlBuilder.ts'
import { datasetOrgProfile, datasetOrgStatus, validateUnitValues } from '../src/dataAccess/datasetOrg.ts'
import { FAILED_MESSAGE, forDataset, NOT_STANDARD_MESSAGE, UNVERIFIED_MESSAGE, type AccessScope, type RowScope } from '../src/dataAccess/guard.ts'
import { resolveAssignments } from '../src/dataAccess/scope.ts'
import { dialectOf } from '../src/dw/sql.ts'
import { AppError } from '../src/http/errors.ts'
import { asg, budgetWithoutBu, dataset, ID, model, noBu, nonPims, rules, snapshot, tables, UPDATED } from './support/dataAccessFixture.ts'

const s = snapshot()
const scoped = (...a: Parameters<typeof asg>[0][]): AccessScope => {
  const { grants, problems } = resolveAssignments(a.map(asg), s, rules)
  return { kind: 'scoped', grants, problems, snapshot: s, fingerprint: 'fp' }
}
const ok = { status: 'ok' as const, datasetUpdatedAt: UPDATED }
const partial = { status: 'partial' as const, datasetUpdatedAt: UPDATED }
const SAM1 = { level: 'BUSINESS_UNIT' as const, orgKind: 'ms_businessunit' as const, orgId: ID.SAM1 }
const refuse = (fn: () => unknown, code: string, check?: (d: { notify?: boolean; status?: string }) => void) =>
  assert.throws(fn, (e) => {
    assert.ok(e instanceof AppError && e.code === code, `expected ${code}, got ${(e as AppError).code}`)
    check?.((e.details ?? {}) as { notify?: boolean; status?: string })
    return true
  })

describe('dataset organization profile and status', () => {
  test('business_unit and kodebisnisunit are ONE Business Unit dimension', () => {
    const p = datasetOrgProfile(model())
    assert.deepEqual(p.businessUnit, { dim: 'bisnis_unit', forms: { actual: 'bu_code', budget: 'bu_code' } })
    assert.equal(p.standardProblem, null)
    assert.equal((p.rayon as { forms: Record<string, string | null> }).forms.actual, 'rayon_code')
    assert.equal(p.company?.forms.actual, 'company_alias')
  })
  test('OK / PARTIAL / UNVERIFIED / FAILED / NONPIMS / NONE', () => {
    const p = datasetOrgProfile(model())
    assert.equal(datasetOrgStatus(p, ok, UPDATED), 'OK')
    assert.equal(datasetOrgStatus(p, partial, UPDATED), 'PARTIAL')
    assert.equal(datasetOrgStatus(p, null, UPDATED), 'UNVERIFIED')
    assert.equal(datasetOrgStatus(p, { ...ok, datasetUpdatedAt: '2026-01-01T00:00:00Z' }, UPDATED), 'UNVERIFIED', 'a validation of an older version does not count')
    assert.equal(datasetOrgStatus(p, { status: 'failed', datasetUpdatedAt: UPDATED }, UPDATED), 'FAILED')
    assert.equal(datasetOrgStatus(datasetOrgProfile(nonPims()), ok, UPDATED), 'NONPIMS')
    assert.equal(datasetOrgStatus(datasetOrgProfile(noBu()), ok, UPDATED), 'NONE')
    assert.equal(datasetOrgStatus(datasetOrgProfile(budgetWithoutBu()), ok, UPDATED), 'NONE', 'one source without BU makes the whole dataset non-standard')
  })
  test('validation: company codes in the BU column make it PARTIAL; no BU code at all = failed', () => {
    const codes = new Set([...s.units.values()].map((u) => u.code))
    const v = validateUnitValues({ actual: [{ value: 'SAM-1', rows: 90 }, { value: 'CLP', rows: 10 }], budget: [{ value: 'SAM-1', rows: 5 }] }, codes)
    assert.deepEqual([v.status, v.unmappedRows, v.rows, v.unmappedValues], ['partial', 10, 105, ['CLP']])
    assert.equal(validateUnitValues({ actual: [{ value: 'SAM-1', rows: 3 }] }, codes).status, 'ok')
    assert.equal(validateUnitValues({ actual: [{ value: 'KEBUN-X', rows: 3 }, { value: null, rows: 1 }] }, codes).status, 'failed')
  })
})

describe('forDataset', () => {
  test('unrestricted_data: everything, without a predicate; it is not a role', () => {
    assert.deepEqual(forDataset({ kind: 'unrestricted', fingerprint: 'unrestricted' }, dataset('d', noBu()), null), { kind: 'all', fingerprint: 'all' })
  })
  test('no assignment (incl. an admin without one): 403, never data', () => {
    refuse(() => forDataset({ kind: 'none', reason: 'NO_ASSIGNMENT', problems: [], fingerprint: 'none' }, dataset('d'), ok), 'SCOPE_UNRESOLVED')
  })
  test('non-standard datasets return no data for every level', () => {
    for (const [m, v, status] of [[nonPims(), ok, 'NONPIMS'], [model(), null, 'UNVERIFIED'], [model(), { status: 'failed' as const, datasetUpdatedAt: UPDATED }, 'FAILED']] as const)
      refuse(() => forDataset(scoped(SAM1), dataset('d', m), v), 'DATASET_NOT_STANDARD', (d) => assert.equal(d.status, status))
  })
  test('not yet validated / values not in the master: their own message with what to do, for every level', () => {
    const gmk = { level: 'GMK' as const, orgKind: 'ms_gmk_header' as const, orgId: ID.GMK1 }
    for (const a of [SAM1, gmk]) {
      assert.throws(() => forDataset(scoped(a), dataset('d'), null), (e) => e instanceof AppError && e.message === UNVERIFIED_MESSAGE, a.level)
      assert.throws(() => forDataset(scoped(a), dataset('d'), { status: 'failed', datasetUpdatedAt: UPDATED }), (e) => e instanceof AppError && e.message === FAILED_MESSAGE, a.level)
    }
    assert.match(UNVERIFIED_MESSAGE, /Validasi akses data/)
  })
  test('no Unit Operasional column (in the dataset or one source): ACCESS_FIELD_MISSING, notified, for every level', () => {
    const levels = [SAM1, { level: 'GMK' as const, orgKind: 'ms_gmk_header' as const, orgId: ID.GMK1 }, { level: 'RAYON' as const, orgKind: 'ms_businessunit' as const, orgId: ID.SAM1, subKind: 'ms_rayon' as const, subId: ID.RAYON_A }]
    for (const m of [noBu(), budgetWithoutBu()])
      for (const a of levels)
        assert.throws(() => forDataset(scoped(a), dataset('d', m), ok), (e) => e instanceof AppError && e.code === 'ACCESS_FIELD_MISSING' && e.status === 403 && /field Unit Operasional .*tidak memiliki otoritas/.test(e.message) && (e.details as { notify: boolean }).notify === true, a.level)
  })
  test('Rayon / Divisi grant on a dataset without that column: ACCESS_FIELD_MISSING (never the whole unit)', () => {
    const noRay = model({ dimensions: model().dimensions.filter((d) => d.id !== 'ray') })
    const noAfd = model({ dimensions: model().dimensions.filter((d) => d.id !== 'afdeling') })
    assert.throws(() => forDataset(scoped({ level: 'RAYON', orgKind: 'ms_businessunit', orgId: ID.SAM1, subKind: 'ms_rayon', subId: ID.RAYON_A }), dataset('d', noRay), ok), (e) => e instanceof AppError && e.code === 'ACCESS_FIELD_MISSING' && /field Rayon/.test(e.message))
    assert.throws(() => forDataset(scoped({ level: 'DIVISION', orgKind: 'ms_businessunit', orgId: ID.SAM1, subKind: 'ms_division', subId: ID.DIV01 }), dataset('d', noAfd), ok), (e) => e instanceof AppError && e.code === 'ACCESS_FIELD_MISSING' && /field Divisi/.test(e.message))
    // With another grant that does apply, that one still gives its rows; the rayon grant adds nothing.
    const r = forDataset(scoped({ level: 'RAYON', orgKind: 'ms_businessunit', orgId: ID.SAM1, subKind: 'ms_rayon', subId: ID.RAYON_A }, { level: 'BUSINESS_UNIT', orgKind: 'ms_businessunit', orgId: ID.SAM2 }), dataset('d', noRay), ok) as Extract<RowScope, { kind: 'rows' }>
    assert.deepEqual(r.grants.map((g) => g.level), ['BUSINESS_UNIT'])
  })
  test('notification: levels 1–4, 6, 7 get the "tabel belum standar" text; GMK, Rayon, Divisi do not', () => {
    const notified = [
      { level: 'OWNERSHIP' as const, orgLevel: 'GROUP' as const, orgKind: 'ms_group' as const, orgId: ID.FRG, ownership: ['INTI'] },
      { level: 'GROUP' as const, orgKind: 'ms_group' as const, orgId: ID.FRG },
      { level: 'WILAYAH' as const, orgKind: 'ms_so_node' as const, orgId: ID.N_DP_RIAU_1 },
      { level: 'REGION' as const, orgKind: 'ms_region' as const, orgId: ID.PKU },
      { level: 'COMPANY' as const, orgKind: 'ms_company' as const, orgId: ID.SAM },
      SAM1,
    ]
    for (const a of notified)
      assert.throws(() => forDataset(scoped(a), dataset('d', nonPims()), ok), (e) => e instanceof AppError && e.message === NOT_STANDARD_MESSAGE && (e.details as { notify: boolean }).notify === true, a.level)
    const silent = [
      { level: 'GMK' as const, orgKind: 'ms_gmk_header' as const, orgId: ID.GMK1 },
      { level: 'RAYON' as const, orgKind: 'ms_businessunit' as const, orgId: ID.SAM1, subKind: 'ms_rayon' as const, subId: ID.RAYON_A },
      { level: 'DIVISION' as const, orgKind: 'ms_businessunit' as const, orgId: ID.SAM1, subKind: 'ms_division' as const, subId: ID.DIV01 },
    ]
    for (const a of silent)
      assert.throws(() => forDataset(scoped(a), dataset('d', nonPims()), ok), (e) => e instanceof AppError && e.code === 'DATASET_NOT_STANDARD' && e.message !== NOT_STANDARD_MESSAGE && (e.details as { notify: boolean }).notify === false, a.level)
  })
  test('Kepemilikan on a dataset without an ownership column: no data, notified (field missing)', () => {
    const m = model({ dimensions: model().dimensions.filter((d) => d.id !== 'kepemilikan') })
    refuse(() => forDataset(scoped({ level: 'OWNERSHIP', orgLevel: 'GROUP', orgKind: 'ms_group', orgId: ID.FRG, ownership: ['INTI'] }), dataset('d', m), ok), 'ACCESS_FIELD_MISSING', (d) => assert.equal(d.notify, true))
  })
  test('OK and PARTIAL datasets are usable', () => {
    assert.equal(forDataset(scoped(SAM1), dataset('d'), ok).kind, 'rows')
    assert.equal((forDataset(scoped(SAM1), dataset('d'), partial) as Extract<RowScope, { kind: 'rows' }>).status, 'PARTIAL')
  })
})

describe('generated SQL', () => {
  const b = new SqlBuilder(model(), 'pg_temp', [tables.t_act!, tables.t_bud!], dialectOf('postgresql'))
  const rows = forDataset(scoped(SAM1), dataset('d'), ok)
  const q = b.build({ dims: ['bisnis_unit'], groupingSets: [[0], []], measures: ['produksi', 'budget_produksi'], windows: [{ id: 'cur', from: '2026-01-01', to: '2026-12-31' }], filters: [], scope: rows, limit: 100 })

  test('every source is restricted where its rows are read, before GROUPING SETS and the FULL JOIN', () => {
    const act = /actual_r AS \(SELECT .*? FROM "pg_temp"\."t_act" WHERE (.*?)\),/s.exec(q.sql)?.[1] ?? ''
    const bud = /budget_r AS \(SELECT .*? FROM "pg_temp"\."t_bud" WHERE (.*?)\),/s.exec(q.sql)?.[1] ?? ''
    assert.match(act, /"business_unit" = ANY\(\$\d+::text\[\]\)/)
    assert.match(bud, /"kodebisnisunit" = ANY\(\$\d+::text\[\]\)/)
    // The restriction comes before the aggregation CTEs and the join of the sources.
    assert.ok(q.sql.indexOf('"business_unit" = ANY') < q.sql.indexOf('GROUPING SETS'))
    assert.ok(q.sql.indexOf('"kodebisnisunit" = ANY') < q.sql.indexOf('FULL JOIN'))
  })
  test('values are bind parameters only (no BU code in the SQL text)', () => {
    assert.ok(!q.sql.includes("'SAM-1'"))
    assert.ok(q.params.some((p) => Array.isArray(p) && (p as string[]).includes('SAM-1')))
  })
  test('K-09 consistency: group / region / company columns must match the BU master values (NULL is not checked)', () => {
    // One lookup of the pair (BU, master value) per column: the row's own value must be the master's for its BU.
    assert.match(q.sql, /"groupcode" IS NULL OR "business_unit" \|\| chr\(1\) \|\| "groupcode" = ANY\(\$\d+::text\[\]\)/)
    const pairs = q.params.filter((p): p is string[] => Array.isArray(p)).flat()
    assert.ok(pairs.includes('SAM-1\u0001FRG') && pairs.includes('SAM-1\u0001PKU') && pairs.includes('SAM-1\u0001SAM'))
  })
  test('a build without a scope is refused', () => {
    assert.throws(() => b.build({ dims: [], groupingSets: [[]], measures: ['produksi'], windows: [{ id: 'cur', from: '2026-01-01', to: '2026-12-31' }], filters: [], scope: undefined as unknown as RowScope, limit: 10 }), (e) => e instanceof AppError && e.code === 'SCOPE_MISSING')
  })
})
