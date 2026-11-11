/**
 * DataAccessService with an in-memory database and a controllable clock: the fixed-lifetime organization cache
 * (no sliding expiry, no stale data, 503 when expired and unreachable), assignment changes on the next request,
 * admin role without data access, unrestricted_data, access managers, audit of assignments / grants / denials,
 * and the configuration guards of the read-only organization role.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ConfigError, loadConfig } from '../src/config/config.ts'
import { DataAccessService } from '../src/dataAccess/dataAccessService.ts'
import { OrgMasterReader, SnapshotCache } from '../src/dataAccess/orgMaster.ts'
import type { OrgSnapshot } from '../src/dataAccess/scope.ts'
import { AppError } from '../src/http/errors.ts'
import { createLogger } from '../src/log/logger.ts'
import { accessConfig, asg, fakeDb, ID, snapshot, user } from './support/dataAccessFixture.ts'

const log = createLogger('silent', false)
const MIN = 60_000

/** Loader under test control: counts loads, can fail. */
function loader() {
  const st = { loads: 0, fail: false }
  const load = async (): Promise<OrgSnapshot> => {
    st.loads++
    if (st.fail) throw new AppError(503, 'ORG_MASTER_UNAVAILABLE', 'Master organisasi tidak dapat dihubungi; data tidak ditampilkan.')
    return snapshot()
  }
  return { st, load }
}

describe('organization snapshot cache: fixed 5 minutes', () => {
  test('served while younger than 5 minutes; use does not extend it (no sliding expiry)', async () => {
    let now = 0
    const l = loader()
    const c = new SnapshotCache(l.load, 5 * MIN, () => now)
    await c.get()
    now = 3 * MIN
    await c.get() // used before the refresh-ahead window (last minute)
    now = 5 * MIN
    await c.get()
    assert.equal(l.st.loads, 2, 'reloaded at 5:00 although it was used at 3:00')
  })
  test('refresh ahead: in the last minute the valid snapshot is served and ONE background reload starts', async () => {
    let now = 0
    const l = loader()
    const c = new SnapshotCache(l.load, 5 * MIN, () => now)
    const first = await c.get()
    now = 4.5 * MIN
    const [a, b] = await Promise.all([c.get(), c.get()])
    assert.ok(a === first && b === first, 'still the valid snapshot, without waiting')
    await new Promise((r) => setImmediate(r))
    assert.equal(l.st.loads, 2, 'one background reload for both requests')
    now = 5.5 * MIN
    const next = await c.get()
    assert.equal(next.loadedAt, 4.5 * MIN, 'the refreshed snapshot is used, no wait at 5:00')
    assert.equal(l.st.loads, 2)
  })
  test('refresh ahead failure: reported; the valid snapshot is kept until its own expiry, never after (503)', async () => {
    let now = 0
    const l = loader()
    const errors: unknown[] = []
    const c = new SnapshotCache(l.load, 5 * MIN, () => now, (e) => errors.push(e))
    const first = await c.get()
    now = 4.5 * MIN
    l.st.fail = true
    assert.equal(await c.get(), first)
    await new Promise((r) => setImmediate(r))
    assert.equal(errors.length, 1)
    now = 5 * MIN
    await assert.rejects(c.get(), (e) => e instanceof AppError && e.status === 503, 'expired: no stale data')
  })
  test('invalidate during a background reload: that reload never becomes current; the next request reads again', async () => {
    let now = 0
    let release: (() => void) | null = null
    let loads = 0
    const c = new SnapshotCache(async () => {
      loads++
      if (loads === 2) await new Promise<void>((r) => (release = r))
      return snapshot()
    }, 5 * MIN, () => now)
    await c.get()
    now = 4.5 * MIN
    await c.get() // starts the slow background reload
    c.invalidate()
    release!()
    await new Promise((r) => setImmediate(r))
    assert.equal(c.loadedAt, null, 'the reload started before invalidate is discarded')
    const s = await c.get()
    assert.equal(loads, 3)
    assert.equal(s.loadedAt, 4.5 * MIN)
  })
  test('expired + master unreachable → 503; the expired snapshot is never served', async () => {
    let now = 0
    const l = loader()
    const c = new SnapshotCache(l.load, 5 * MIN, () => now)
    await c.get()
    now = 6 * MIN
    l.st.fail = true
    await assert.rejects(c.get(), (e) => e instanceof AppError && e.status === 503 && e.code === 'ORG_MASTER_UNAVAILABLE')
    await assert.rejects(c.get(), (e) => e instanceof AppError && e.status === 503, 'still no stale data on the next call')
    l.st.fail = false
    assert.ok(await c.get())
  })
  test('concurrent requests share one load; invalidate forces a reload', async () => {
    const l = loader()
    const c = new SnapshotCache(l.load, 5 * MIN, () => 0)
    await Promise.all([c.get(), c.get(), c.get()])
    assert.equal(l.st.loads, 1)
    c.invalidate()
    await c.get()
    assert.equal(l.st.loads, 2)
  })
  test('the real reader without DOD_ORG_DB_* is 503, never a connection with another account', async () => {
    const r = new OrgMasterReader({ orgDb: null } as never, log)
    await assert.rejects(r.load(), (e) => e instanceof AppError && e.status === 503 && e.code === 'ORG_MASTER_NOT_CONFIGURED')
  })
})

describe('scopeFor', () => {
  const setup = (over = {}) => {
    const f = fakeDb()
    const l = loader()
    let now = 0
    const svc = new DataAccessService(f.db, accessConfig(over), log, l.load, () => now)
    return { f, l, svc, tick: (ms: number) => (now += ms) }
  }

  test('an application admin without an assignment has no data access', async () => {
    const { svc } = setup()
    const s = await svc.scopeFor(user('admin', 'admin'))
    assert.deepEqual([s.kind, s.kind === 'none' && s.reason], ['none', 'NO_ASSIGNMENT'])
  })
  test('unrestricted_data comes from the environment list, not the role; its use is audited (once per hour)', async () => {
    const { svc, f, tick } = setup()
    assert.equal((await svc.scopeFor(user('auditor', 'viewer'))).kind, 'unrestricted')
    await svc.scopeFor(user('auditor', 'viewer'))
    tick(61 * MIN)
    await svc.scopeFor(user('auditor', 'viewer'))
    await new Promise((r) => setImmediate(r))
    assert.equal(f.audit.filter((a) => a.action === 'data.unrestricted.use').length, 2)
  })
  test('unrestricted and "no assignment" need no master; a scoped user needs it (503 when unreachable)', async () => {
    const { svc, f, l } = setup()
    l.st.fail = true
    assert.equal((await svc.scopeFor(user('auditor'))).kind, 'unrestricted')
    assert.equal((await svc.scopeFor(user('nobody'))).kind, 'none')
    f.assignments.set('id-budi', [asg({ level: 'BUSINESS_UNIT', orgKind: 'ms_businessunit', orgId: ID.SAM1 })])
    await assert.rejects(svc.scopeFor(user('budi')), (e) => e instanceof AppError && e.status === 503)
  })
  test('an assignment change applies to the next request (no per-user cache)', async () => {
    const { svc, f } = setup()
    f.assignments.set('id-budi', [asg({ level: 'BUSINESS_UNIT', orgKind: 'ms_businessunit', orgId: ID.SAM1 })])
    const a = await svc.scopeFor(user('budi'))
    f.assignments.set('id-budi', [asg({ level: 'COMPANY', orgKind: 'ms_company', orgId: ID.SAM })])
    const b = await svc.scopeFor(user('budi'))
    assert.ok(a.kind === 'scoped' && b.kind === 'scoped')
    assert.deepEqual([a.grants[0]!.unitCodes, b.grants[0]!.unitCodes], [['SAM-1'], ['SAM-1', 'SAM-2']])
    assert.notEqual(a.fingerprint, b.fingerprint)
    f.assignments.set('id-budi', [])
    assert.equal((await svc.scopeFor(user('budi'))).kind, 'none', 'removed → no data at once')
  })
  test('only invalid assignments → no data (ALL_INVALID), never a wider scope', async () => {
    const { svc, f } = setup()
    f.assignments.set('id-budi', [asg({ level: 'COMPANY', orgKind: 'ms_company', orgId: '999' })])
    const s = await svc.scopeFor(user('budi'))
    assert.deepEqual([s.kind, s.kind === 'none' && s.reason], ['none', 'ALL_INVALID'])
  })
})

describe('assignments: separation of duties and audit', () => {
  const setup = () => {
    const f = fakeDb()
    f.users.set('id-budi', 'budi')
    f.users.set('id-manager', 'manager')
    const svc = new DataAccessService(f.db, accessConfig(), log, loader().load)
    return { f, svc }
  }
  const sam1 = { level: 'BUSINESS_UNIT' as const, orgKind: 'ms_businessunit' as const, orgId: ID.SAM1, subKind: null, subId: null, ownership: null }

  test('an admin who is not an access manager cannot change assignments', async () => {
    const { svc } = setup()
    await assert.rejects(svc.putAssignments(user('admin', 'admin'), 'id-budi', [sam1]), (e) => e instanceof AppError && e.status === 403)
  })
  test('an access manager cannot change their own assignments', async () => {
    const { svc } = setup()
    await assert.rejects(svc.putAssignments(user('manager'), 'id-manager', [sam1]), (e) => e instanceof AppError && e.code === 'ACCESS_SELF_ASSIGNMENT')
  })
  test('every assignment must resolve; duplicates are refused', async () => {
    const { svc } = setup()
    await assert.rejects(svc.putAssignments(user('manager'), 'id-budi', [{ ...sam1, orgId: '999' }]), (e) => e instanceof AppError && e.code === 'ASSIGNMENT_INVALID')
    await assert.rejects(svc.putAssignments(user('manager'), 'id-budi', [sam1, sam1]), (e) => e instanceof AppError && e.code === 'ASSIGNMENT_INVALID')
    await assert.rejects(svc.putAssignments(user('manager'), 'id-budi', [{ ...sam1, level: 'OWNERSHIP', ownership: ['INTI'] }]), (e) => e instanceof AppError && e.code === 'ASSIGNMENT_INVALID', 'Kepemilikan needs its organization level')
  })
  test('a manager replaces the assignments; before/after go to the audit log; K-07a warns', async () => {
    const { svc, f } = setup()
    const div = { level: 'DIVISION' as const, orgKind: 'ms_businessunit' as const, orgId: ID.SAM1, subKind: 'ms_division' as const, subId: ID.DIV02, ownership: null }
    const r = await svc.putAssignments(user('manager'), 'id-budi', [sam1, div, { level: 'OWNERSHIP', orgLevel: 'GROUP', orgKind: 'ms_group', orgId: ID.FRG, subKind: null, subId: null, ownership: ['plasma'] }])
    assert.equal(r.assignments.length, 3)
    assert.deepEqual(r.assignments.map((a) => a.valid), [true, true, true])
    assert.match(r.assignments[1]!.warning ?? '', /tidak tercatat/)
    assert.deepEqual(f.assignments.get('id-budi')![2]!.ownership, ['PLASMA'])
    const a = f.audit.find((x) => x.action === 'access.assignments.update')!
    assert.equal(a.user_id, 'id-manager')
    assert.equal((a.detail as { after: unknown[] }).after.length, 3)
  })
})

describe('audit of unrestricted_data grants and refusals', () => {
  test('grant and revoke of the environment list are audited at start', async () => {
    const f = fakeDb()
    await new DataAccessService(f.db, accessConfig({ unrestrictedUsers: ['auditor'] }), log, loader().load).syncUnrestrictedAudit()
    await new DataAccessService(f.db, accessConfig({ unrestrictedUsers: ['auditor'] }), log, loader().load).syncUnrestrictedAudit()
    await new DataAccessService(f.db, accessConfig({ unrestrictedUsers: ['direksi'] }), log, loader().load).syncUnrestrictedAudit()
    assert.deepEqual(f.audit.map((a) => `${a.action}:${a.target}`), ['data.unrestricted.grant:auditor', 'data.unrestricted.grant:direksi', 'data.unrestricted.revoke:auditor'])
  })
  test('refusals are audited, throttled per user, reason and target', async () => {
    const f = fakeDb()
    let now = 0
    const svc = new DataAccessService(f.db, accessConfig(), log, loader().load, () => now)
    svc.denied(user('budi'), 'SCOPE_UNRESOLVED', 'wh-1')
    svc.denied(user('budi'), 'SCOPE_UNRESOLVED', 'wh-1')
    svc.denied(user('budi'), 'SCOPE_UNRESOLVED', 'wh-2')
    now = 11 * MIN
    svc.denied(user('budi'), 'SCOPE_UNRESOLVED', 'wh-1')
    await new Promise((r) => setImmediate(r))
    assert.equal(f.audit.filter((a) => a.action === 'data.denied').length, 3)
  })
})

describe('configuration of the organization role', () => {
  const base = { NODE_ENV: 'test', DOD_DB_HOST: 'h', DOD_DB_NAME: 'app', DOD_DB_USER: 'dodmin', DOD_DB_MASTER_NAME: 'dor_apims_master' }
  test('the existing application account by default (no new role); never postgres', () => {
    assert.deepEqual(loadConfig({ ...base, DOD_DB_PASSWORD: 'p' }).orgDb, { host: 'h', port: 5432, database: 'dor_apims_master', user: 'dodmin', password: 'p', ssl: false })
    assert.throws(() => loadConfig({ ...base, DOD_ORG_DB_USER: 'postgres', DOD_ORG_DB_PASSWORD: 'x' }), ConfigError)
  })
  test('not configured (fail-closed) without password or master database; another account needs its own password', () => {
    assert.equal(loadConfig(base).orgDb, null, 'no password')
    assert.equal(loadConfig({ ...base, DOD_DB_PASSWORD: 'p', DOD_DB_MASTER_NAME: '' }).orgDb, null, 'no master database')
    assert.equal(loadConfig({ ...base, DOD_DB_PASSWORD: 'p', DOD_ORG_DB_USER: 'other_ro' }).orgDb, null, 'the app password is not reused for another account')
    assert.equal(loadConfig({ ...base, DOD_ORG_DB_USER: 'other_ro', DOD_ORG_DB_PASSWORD: 'x' }).orgDb?.user, 'other_ro')
  })
  test('cache at most 300 s; id and user lists validated', () => {
    assert.equal(loadConfig(base).dataAccess.cacheMs, 300_000)
    assert.throws(() => loadConfig({ ...base, DOD_ORG_CACHE_SECONDS: '600' }), ConfigError)
    assert.deepEqual(loadConfig({ ...base, DOD_ORG_WILAYAH_NODE_IDS: ' 1496709471336927232 , 1496709742133776384' }).dataAccess.wilayahNodeIds, ['1496709471336927232', '1496709742133776384'])
    assert.throws(() => loadConfig({ ...base, DOD_ORG_GMK_HEADER_IDS: 'GMK 1' }), ConfigError, 'names are never ids')
    assert.deepEqual(loadConfig({ ...base, DOD_DATA_UNRESTRICTED_USERS: 'Auditor, direksi' }).dataAccess.unrestrictedUsers, ['auditor', 'direksi'])
    assert.equal(loadConfig(base).dataAccess.regionSource, null, 'Region has no source until it is set')
  })
})
