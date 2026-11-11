/**
 * Data access scope resolution (pure): the nine levels against an organization snapshot, by PIMS ids only;
 * ownership AND inside one assignment; several assignments never mix their parts; Rayon / Divisi as
 * (BU id, rayon/division id) pairs; and every case that must grant nothing (fail-closed).
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { grantsCoverRecord, LEVELS, resolveAssignment, resolveAssignments, type Grant } from '../src/dataAccess/scope.ts'
import { asg, ID, rules, snapshot } from './support/dataAccessFixture.ts'

const s = snapshot()
const grant = (a: Parameters<typeof asg>[0]) => {
  const r = resolveAssignment(asg(a), s, rules)
  if (!('grant' in r)) throw new Error(`expected a grant: ${r.problem.code} ${r.problem.message}`)
  return r.grant
}
const problem = (a: Parameters<typeof asg>[0]) => {
  const r = resolveAssignment(asg(a), s, rules)
  assert.ok('problem' in r, 'expected a problem (no grant)')
  return (r as { problem: { code: string } }).problem.code
}

describe('nine levels, in the required order', () => {
  test('order: Kepemilikan, Group, Wilayah Administrasi, Region, GMK, Perusahaan, Unit Operasional, Rayon, Divisi', () => {
    assert.deepEqual([...LEVELS], ['OWNERSHIP', 'GROUP', 'WILAYAH', 'REGION', 'GMK', 'COMPANY', 'BUSINESS_UNIT', 'RAYON', 'DIVISION'])
  })

  test('Group → every BU of the group (company.group_id)', () => {
    assert.deepEqual(grant({ level: 'GROUP', orgKind: 'ms_group', orgId: ID.FRG }).unitCodes, ['CLP-1', 'SAM-1', 'SAM-2'])
    assert.deepEqual(grant({ level: 'GROUP', orgKind: 'ms_group', orgId: ID.FAP }).unitCodes, ['BHP-1'])
  })

  test('Wilayah Administrasi → BU of the approved SO node only', () => {
    assert.deepEqual(grant({ level: 'WILAYAH', orgKind: 'ms_so_node', orgId: ID.N_DP_RIAU_1 }).unitCodes, ['CLP-1', 'SAM-1'])
    // HEAD MILL is a KEDP node too, but not an approved Direktur area: nothing.
    assert.equal(problem({ level: 'WILAYAH', orgKind: 'ms_so_node', orgId: ID.N_HMILL }), 'ORG_NOT_APPROVED')
  })

  test('Region (ms_region source) → BU of the companies of that region; Region is not Wilayah', () => {
    assert.deepEqual(grant({ level: 'REGION', orgKind: 'ms_region', orgId: ID.PKU }).unitCodes, ['CLP-1', 'SAM-1', 'SAM-2'])
    assert.equal(problem({ level: 'REGION', orgKind: 'ms_so_node', orgId: ID.N_MD_RIAU }), 'ORG_KIND_MISMATCH', 'only the configured source')
    assert.equal(problem({ level: 'WILAYAH', orgKind: 'ms_region', orgId: ID.PKU }), 'ORG_KIND_MISMATCH')
  })

  test('Region (SO source) → only REGION nodes; unconfigured source → nothing', () => {
    const so = { ...rules, regionSource: 'so_region' as const }
    const r = resolveAssignment(asg({ level: 'REGION', orgKind: 'ms_so_node', orgId: ID.N_MD_RIAU }), s, so)
    assert.ok('grant' in r && r.grant.unitCodes.join() === 'CLP-1,SAM-1,SAM-2')
    const kedp = resolveAssignment(asg({ level: 'REGION', orgKind: 'ms_so_node', orgId: ID.N_DP_RIAU_1 }), s, so)
    assert.ok('problem' in kedp && kedp.problem.code === 'ORG_KIND_MISMATCH', 'a KEDP node is not a Region')
    const none = resolveAssignment(asg({ level: 'REGION', orgKind: 'ms_region', orgId: ID.PKU }), s, { ...rules, regionSource: null })
    assert.ok('problem' in none && none.problem.code === 'LEVEL_NOT_CONFIGURED')
  })

  test('GMK → BU of an approved header only', () => {
    assert.deepEqual(grant({ level: 'GMK', orgKind: 'ms_gmk_header', orgId: ID.GMK1 }).unitCodes, ['BHP-1'])
    // FR-RIAU-1 is a GMK header with the same BU as a Wilayah node: not offered as a GMK.
    assert.equal(problem({ level: 'GMK', orgKind: 'ms_gmk_header', orgId: ID.FR_RIAU_1 }), 'ORG_NOT_APPROVED')
  })

  test('Perusahaan → every BU of the company (company_id)', () => {
    assert.deepEqual(grant({ level: 'COMPANY', orgKind: 'ms_company', orgId: ID.SAM }).unitCodes, ['SAM-1', 'SAM-2'])
  })

  test('Unit Operasional → that BU only', () => {
    assert.deepEqual(grant({ level: 'BUSINESS_UNIT', orgKind: 'ms_businessunit', orgId: ID.SAM1 }).unitCodes, ['SAM-1'])
  })

  test('Rayon / Divisi → (parent BU id, rayon/division id)', () => {
    const r = grant({ level: 'RAYON', orgKind: 'ms_businessunit', orgId: ID.SAM1, subKind: 'ms_rayon', subId: ID.RAYON_A })
    assert.deepEqual([r.unitCodes, r.rayon], [['SAM-1'], { id: ID.RAYON_A, code: 'A', name: 'Rayon A' }])
    const d = grant({ level: 'DIVISION', orgKind: 'ms_businessunit', orgId: ID.SAM1, subKind: 'ms_division', subId: ID.DIV01 })
    assert.deepEqual([d.unitCodes, d.division?.code], [['SAM-1'], '01'])
  })

  test('K-07a: a division the master does not relate to the BU is still a valid pair (the relation is not proof)', () => {
    // SAM-1 / 02 is absent from ms_businessunitdivision; the pair still resolves (it can only yield less data).
    assert.equal(grant({ level: 'DIVISION', orgKind: 'ms_businessunit', orgId: ID.SAM1, subKind: 'ms_division', subId: ID.DIV02 }).division?.code, '02')
  })

  test('Rayon / Divisi need the pair: no sub id, a wrong kind or a sub id on another level = nothing', () => {
    assert.equal(problem({ level: 'RAYON', orgKind: 'ms_businessunit', orgId: ID.SAM1 }), 'ASSIGNMENT_INVALID')
    assert.equal(problem({ level: 'DIVISION', orgKind: 'ms_businessunit', orgId: ID.SAM1, subKind: 'ms_rayon', subId: ID.RAYON_A }), 'ASSIGNMENT_INVALID')
    assert.equal(problem({ level: 'BUSINESS_UNIT', orgKind: 'ms_businessunit', orgId: ID.SAM1, subKind: 'ms_rayon', subId: ID.RAYON_A }), 'ASSIGNMENT_INVALID')
  })
})

describe('Kepemilikan: organization AND category in one assignment', () => {
  test('the grant carries both parts', () => {
    const g = grant({ level: 'OWNERSHIP', orgLevel: 'GROUP', orgKind: 'ms_group', orgId: ID.FRG, ownership: ['plasma'] })
    assert.deepEqual([g.unitCodes, g.ownership], [['CLP-1', 'SAM-1', 'SAM-2'], ['PLASMA']])
  })
  test('categories must exist in the master; ownership on another level is refused', () => {
    assert.equal(problem({ level: 'OWNERSHIP', orgLevel: 'GROUP', orgKind: 'ms_group', orgId: ID.FRG, ownership: ['SWASTA'] }), 'OWNERSHIP_NOT_FOUND')
    assert.equal(problem({ level: 'OWNERSHIP', orgLevel: 'GROUP', orgKind: 'ms_group', orgId: ID.FRG, ownership: [] }), 'ASSIGNMENT_INVALID')
    assert.equal(problem({ level: 'GROUP', orgKind: 'ms_group', orgId: ID.FRG, ownership: ['INTI'] }), 'ASSIGNMENT_INVALID')
  })
})

describe('multiple assignments: a union of independent grants', () => {
  test('FRG+PLASMA and SAM+INTI never become FRG+INTI', () => {
    const { grants } = resolveAssignments(
      [
        asg({ level: 'OWNERSHIP', orgLevel: 'GROUP', orgKind: 'ms_group', orgId: ID.FRG, ownership: ['PLASMA'] }),
        asg({ level: 'OWNERSHIP', orgLevel: 'COMPANY', orgKind: 'ms_company', orgId: ID.SAM, ownership: ['INTI'] }),
      ],
      s,
      rules,
    )
    assert.equal(grants.length, 2)
    const allowed = (unit: string, own: string) => grants.some((g) => g.unitCodes.includes(unit) && g.ownership!.includes(own))
    assert.equal(allowed('CLP-1', 'PLASMA'), true)
    assert.equal(allowed('SAM-1', 'INTI'), true)
    assert.equal(allowed('CLP-1', 'INTI'), false, 'FRG + INTI outside SAM is not granted')
  })
  test('an invalid assignment does not remove the valid ones, and grants nothing itself', () => {
    const r = resolveAssignments([asg({ level: 'BUSINESS_UNIT', orgKind: 'ms_businessunit', orgId: ID.SAM1 }), asg({ level: 'BUSINESS_UNIT', orgKind: 'ms_businessunit', orgId: '999' })], s, rules)
    assert.deepEqual([r.grants.map((g) => g.unitCodes), r.problems.map((p) => p.code)], [[['SAM-1']], ['ORG_NOT_FOUND']])
  })
})

describe('fail-closed resolution', () => {
  test('unknown or inactive organizations, malformed ids, inactive assignments: nothing', () => {
    assert.equal(problem({ level: 'COMPANY', orgKind: 'ms_company', orgId: '999' }), 'ORG_NOT_FOUND')
    assert.equal(problem({ level: 'COMPANY', orgKind: 'ms_company', orgId: 'SAM' }), 'INVALID_ORG_ID', 'a code is never an id')
    assert.equal(problem({ level: 'GROUP', orgKind: 'ms_company', orgId: ID.SAM }), 'ORG_KIND_MISMATCH')
    assert.equal(problem({ level: 'BUSINESS_UNIT', orgKind: 'ms_businessunit', orgId: ID.SAM1, active: false }), 'ASSIGNMENT_INACTIVE')
    assert.equal(problem({ level: 'RAYON', orgKind: 'ms_businessunit', orgId: ID.SAM1, subKind: 'ms_rayon', subId: '999' }), 'ORG_NOT_FOUND')
  })
})

describe('Data Profil records (blocks / vehicles)', () => {
  const g = (a: Parameters<typeof asg>[0]): Grant[] => [grant(a)]
  test('BU scope covers its blocks and vehicles only', () => {
    const gs = g({ level: 'BUSINESS_UNIT', orgKind: 'ms_businessunit', orgId: ID.SAM1 })
    assert.equal(grantsCoverRecord(gs, { kind: 'block', unitId: ID.SAM1, rayonId: ID.RAYON_B }), true)
    assert.equal(grantsCoverRecord(gs, { kind: 'vehicle', unitId: ID.SAM2 }), false)
    assert.equal(grantsCoverRecord(gs, { kind: 'block', unitId: null }), false)
  })
  test('Rayon / Divisi: the block field when present; vehicles fall back to the parent BU only', () => {
    const r = g({ level: 'RAYON', orgKind: 'ms_businessunit', orgId: ID.SAM1, subKind: 'ms_rayon', subId: ID.RAYON_A })
    assert.equal(grantsCoverRecord(r, { kind: 'block', unitId: ID.SAM1, rayonId: ID.RAYON_A }), true)
    assert.equal(grantsCoverRecord(r, { kind: 'block', unitId: ID.SAM1, rayonId: ID.RAYON_B }), false)
    assert.equal(grantsCoverRecord(r, { kind: 'block', unitId: ID.SAM1, rayonId: null }), false, 'a block without rayon is not in a rayon scope')
    assert.equal(grantsCoverRecord(r, { kind: 'vehicle', unitId: ID.SAM1 }), true)
    assert.equal(grantsCoverRecord(r, { kind: 'vehicle', unitId: ID.SAM2 }), false, 'fallback never opens another BU')
    const d = g({ level: 'DIVISION', orgKind: 'ms_businessunit', orgId: ID.SAM1, subKind: 'ms_division', subId: ID.DIV01 })
    assert.equal(grantsCoverRecord(d, { kind: 'block', unitId: ID.SAM1, divisionId: ID.DIV02 }), false)
    assert.equal(grantsCoverRecord(d, { kind: 'block', unitId: ID.SAM1, divisionId: ID.DIV01 }), true)
  })
  test('Kepemilikan: block ownership must match; vehicles have none → not covered', () => {
    const o = g({ level: 'OWNERSHIP', orgLevel: 'COMPANY', orgKind: 'ms_company', orgId: ID.SAM, ownership: ['INTI'] })
    assert.equal(grantsCoverRecord(o, { kind: 'block', unitId: ID.SAM1, ownership: 'INTI' }), true)
    assert.equal(grantsCoverRecord(o, { kind: 'block', unitId: ID.SAM1, ownership: 'PLASMA' }), false)
    assert.equal(grantsCoverRecord(o, { kind: 'vehicle', unitId: ID.SAM1 }), false)
  })
})
