/**
 * User domain rules (no database): identity and application role only, the SSO identity pair, and rejection
 * of fields the client may not send — including the retired level/scope/ownership fields (data access is
 * assigned separately, see dataAccessScope.test.ts).
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ROLES, ssoProblems, UserCreateSchema, UserUpdateSchema } from '../src/users/model.ts'

const base = { username: 'budi.s', name: 'Budi Santoso', role: 'viewer', password: 'rahasia-123' }

describe('user input schema', () => {
  test('four application roles; nothing else is a role', () => {
    assert.deepEqual([...ROLES], ['admin', 'analyst', 'publisher', 'viewer'])
    assert.equal(UserCreateSchema.safeParse({ ...base, role: 'owner' }).success, false)
    assert.equal(UserCreateSchema.safeParse(base).success, true)
  })

  test('identity is separate from data access: level, scope and ownership fields are rejected', () => {
    for (const extra of [{ levelCode: 'COMPANY' }, { companyCode: 'C01' }, { groupCode: 'ALL' }, { ownershipCode: 'VIP' }, { orgLevel1Code: 'A' }, { assignments: [] }, { unrestricted: true }]) {
      assert.equal(UserCreateSchema.safeParse({ ...base, ...extra }).success, false, JSON.stringify(extra))
      assert.equal(UserUpdateSchema.safeParse({ ...base, ...extra }).success, false, JSON.stringify(extra))
    }
  })

  test('rejects id, password_hash and other unknown fields (no mass assignment)', () => {
    for (const extra of [{ id: 'x' }, { password_hash: 'scrypt$…' }, { passwordHash: 'x' }, { createdAt: '2026-01-01' }]) {
      assert.equal(UserCreateSchema.safeParse({ ...base, ...extra }).success, false, JSON.stringify(extra))
      assert.equal(UserUpdateSchema.safeParse({ ...base, ...extra }).success, false, JSON.stringify(extra))
    }
  })

  test('password: required on create, optional on edit, minimum 8 characters', () => {
    const noPw = { ...base, password: undefined }
    assert.equal(UserCreateSchema.safeParse(noPw).success, false)
    assert.equal(UserUpdateSchema.safeParse(noPw).success, true)
    assert.equal(UserCreateSchema.safeParse({ ...base, password: 'short' }).success, false)
  })

  test('empty strings become null', () => {
    const v = UserCreateSchema.parse({ ...base, identityIssuer: '', externalSubject: '  ' })
    assert.equal(v.identityIssuer, null)
    assert.equal(v.externalSubject, null)
  })
})

describe('SSO identity pair', () => {
  test('both or neither', () => {
    assert.deepEqual(ssoProblems(null, null), [])
    assert.deepEqual(ssoProblems('https://sso.perusahaan.com', 'abc-123'), [])
    assert.deepEqual(ssoProblems('https://sso.perusahaan.com', null).map((p) => p.field), ['externalSubject'])
    assert.deepEqual(ssoProblems(null, 'abc-123').map((p) => p.field), ['identityIssuer'])
  })

  test('the issuer is an https URL without credentials', () => {
    for (const bad of ['sso.perusahaan.com', 'http://sso.perusahaan.com', 'https://u:p@sso.perusahaan.com', 'budi@perusahaan.com']) {
      assert.deepEqual(ssoProblems(bad, 'abc').map((p) => p.field), ['identityIssuer'], bad)
    }
  })
})
