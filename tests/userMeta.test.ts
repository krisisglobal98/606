/** Settings → Pengguna (browser side): nine levels in order, assignment shape by PIMS id, identity form rules. */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { LEVELS, missing, NEW_USER, orgKindOf, toInput } from '@/pages/Settings/users/userMeta'
import { LEVELS as SERVER_LEVELS } from '../server/src/dataAccess/scope.ts'

const draft = (p: Partial<Parameters<typeof toInput>[0]>) => ({ level: '' as const, orgLevel: '' as const, orgId: '', subId: '', ownership: [] as string[], ...p })

describe('access levels (browser)', () => {
  test('exactly the nine levels in the required order, the same as the server', () => {
    assert.deepEqual(LEVELS.map((l) => l.label), ['Kepemilikan', 'Group', 'Wilayah Administrasi', 'Region', 'GMK', 'Perusahaan', 'Unit Operasional', 'Rayon', 'Divisi'])
    assert.deepEqual(LEVELS.map((l) => l.level), [...SERVER_LEVELS])
  })

  test('Region follows the server source; Wilayah is an SO node, never a region', () => {
    assert.equal(orgKindOf('REGION', 'ms_region'), 'ms_region')
    assert.equal(orgKindOf('REGION', 'so_region'), 'ms_so_node')
    assert.equal(orgKindOf('REGION', null), null)
    assert.equal(orgKindOf('WILAYAH', 'ms_region'), 'ms_so_node')
  })

  test('assignments carry PIMS ids; Rayon / Divisi are (BU id, rayon/division id) pairs', () => {
    assert.deepEqual(toInput(draft({ level: 'COMPANY', orgId: '301' }), 'ms_region'), { level: 'COMPANY', orgKind: 'ms_company', orgId: '301', subKind: null, subId: null, ownership: null })
    assert.deepEqual(toInput(draft({ level: 'DIVISION', orgId: '401', subId: '702' }), 'ms_region'), { level: 'DIVISION', orgKind: 'ms_businessunit', orgId: '401', subKind: 'ms_division', subId: '702', ownership: null })
    assert.equal(typeof toInput(draft({ level: 'RAYON', orgId: '401' }), 'ms_region'), 'string', 'a rayon needs its id')
  })

  test('Kepemilikan: one assignment with an organization part AND categories', () => {
    assert.deepEqual(toInput(draft({ level: 'OWNERSHIP', orgLevel: 'GROUP', orgId: '101', ownership: ['PLASMA'] }), 'ms_region'), { level: 'OWNERSHIP', orgLevel: 'GROUP', orgKind: 'ms_group', orgId: '101', subKind: null, subId: null, ownership: ['PLASMA'] })
    assert.equal(typeof toInput(draft({ level: 'OWNERSHIP', orgLevel: 'GROUP', orgId: '101' }), 'ms_region'), 'string', 'categories required')
    assert.equal(typeof toInput(draft({ level: 'OWNERSHIP', orgId: '101', ownership: ['INTI'] }), 'ms_region'), 'string', 'organization level required')
  })
})

describe('identity form', () => {
  test('identity only: name, username, password on create, SSO pair', () => {
    assert.deepEqual(missing({ ...NEW_USER, name: 'Budi', username: 'budi', password: 'rahasia-123' }, true), [])
    assert.equal(missing({ ...NEW_USER, name: 'Budi', username: 'budi', password: 'x' }, true).length, 1)
    assert.equal(missing({ ...NEW_USER, name: 'Budi', username: 'budi', identityIssuer: 'https://sso.x' }, false).length, 1)
    assert.ok(!('levelCode' in NEW_USER) && !('ownershipCode' in NEW_USER), 'no data access fields on the user')
  })
})
