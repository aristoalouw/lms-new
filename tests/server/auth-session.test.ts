import type { H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const firebase = vi.hoisted(() => {
  const state = {
    account: {} as Record<string, unknown>,
    decoded: {} as Record<string, unknown>,
  }
  const verifyIdToken = vi.fn(async () => state.decoded)
  const createSessionCookie = vi.fn()
  const get = vi.fn(async () => ({
    exists: true,
    data: () => state.account,
  }))
  const doc = vi.fn(() => ({ get }))
  const collection = vi.fn(() => ({ doc }))
  return {
    state,
    verifyIdToken,
    createSessionCookie,
    get,
    doc,
    collection,
  }
})

vi.mock('../../server/utils/firebase-admin', () => ({
  authAdmin: () => ({
    verifyIdToken: firebase.verifyIdToken,
    createSessionCookie: firebase.createSessionCookie,
  }),
  firestoreAdmin: () => ({ collection: firebase.collection }),
}))

import {
  authenticate,
  createFirebaseSession,
  publicSession,
  verifyFirebaseAppSessionToken,
} from '../../server/utils/auth'
import { LMS_MVP_ROLE_PERMISSIONS, type LmsMvpUserRole } from '../../shared/auth'

function requestWithCookie(token: string): H3Event {
  return {
    context: {},
    node: {
      req: {
        headers: { cookie: `campus_session=${token}` },
        socket: {},
      },
    },
  } as unknown as H3Event
}

describe('Firebase application sessions', () => {
  const originalSecret = process.env.NUXT_SESSION_SECRET
  const originalFeatureProfile = process.env.APP_FEATURE_PROFILE

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-28T08:00:00.000Z'))
    process.env.NUXT_SESSION_SECRET = 'test-application-session-secret-32-bytes-minimum'
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    firebase.verifyIdToken.mockClear()
    firebase.createSessionCookie.mockClear()
    firebase.get.mockClear()
    firebase.doc.mockClear()
    firebase.collection.mockClear()
    firebase.state.decoded = {
      uid: 'firebase-admin-001',
      roles: ['student'],
      scope: { studentIds: ['stale-student'] },
      auth_time: Math.floor(Date.now() / 1000),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
    }
    firebase.state.account = {
      email: 'admin@example.test',
      displayName: 'Administrator',
      roles: ['administrator'],
      scope: { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] },
      status: 'active',
      version: 7,
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalSecret === undefined) delete process.env.NUXT_SESSION_SECRET
    else process.env.NUXT_SESSION_SECRET = originalSecret
    if (originalFeatureProfile === undefined) delete process.env.APP_FEATURE_PROFILE
    else process.env.APP_FEATURE_PROFILE = originalFeatureProfile
  })

  it('verifies the Firebase ID token locally and derives authorization from the canonical account', async () => {
    const created = await createFirebaseSession('fresh-firebase-id-token')

    expect(firebase.verifyIdToken).toHaveBeenCalledWith('fresh-firebase-id-token', false)
    expect(firebase.createSessionCookie).not.toHaveBeenCalled()
    expect(created.context).toMatchObject({
      uid: 'firebase-admin-001',
      roles: ['administrator'],
      provider: 'firebase',
    })
    expect(created.context.scope.studentIds).toEqual([])
    expect(verifyFirebaseAppSessionToken(created.token)).toMatchObject({
      uid: 'firebase-admin-001',
      accountVersion: 7,
    })

    await expect(authenticate(requestWithCookie(created.token))).resolves.toMatchObject({
      uid: 'firebase-admin-001',
      roles: ['administrator'],
    })

    const remembered = await createFirebaseSession('fresh-firebase-id-token', { remember: true })
    expect(remembered.context.expiresAt - remembered.context.issuedAt).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('rejects tampered, expired, changed-version, and disabled-account sessions', async () => {
    const { token } = await createFirebaseSession('fresh-firebase-id-token')
    const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`
    expect(verifyFirebaseAppSessionToken(tampered)).toBeNull()

    firebase.state.account = { ...firebase.state.account, version: 8 }
    await expect(authenticate(requestWithCookie(token))).resolves.toBeNull()

    firebase.state.account = { ...firebase.state.account, version: 7, status: 'disabled' }
    await expect(authenticate(requestWithCookie(token))).resolves.toBeNull()

    firebase.state.account = { ...firebase.state.account, version: 7, status: 'active', sessionValidAfter: Date.now() + 1_000 }
    await expect(authenticate(requestWithCookie(token))).resolves.toBeNull()

    vi.advanceTimersByTime(8 * 60 * 60 * 1000 + 1)
    expect(verifyFirebaseAppSessionToken(token)).toBeNull()
  })

  it('rejects an ID token issued before the account session-revocation boundary', async () => {
    firebase.state.account = {
      ...firebase.state.account,
      sessionValidAfter: Date.now() + 1_000,
    }

    await expect(createFirebaseSession('revoked-firebase-id-token')).rejects.toMatchObject({
      statusCode: 401,
      code: 'RECENT_LOGIN_REQUIRED',
    })
  })

  it('distinguishes invalid identity tokens from upstream authentication failures', async () => {
    firebase.verifyIdToken.mockRejectedValueOnce({ code: 'auth/argument-error' })
    await expect(createFirebaseSession('malformed-token')).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_ID_TOKEN',
    })

    firebase.verifyIdToken.mockRejectedValueOnce({ code: 'app/network-error' })
    await expect(createFirebaseSession('temporarily-unverifiable-token')).rejects.toMatchObject({
      statusCode: 503,
      code: 'AUTH_UNAVAILABLE',
    })
  })

  it('fails before the browser timeout when Firebase token verification stalls', async () => {
    firebase.verifyIdToken.mockImplementationOnce(() => new Promise(() => {}))
    const pending = createFirebaseSession('stalled-firebase-id-token')
    const rejection = expect(pending).rejects.toMatchObject({
      statusCode: 503,
      code: 'AUTH_TIMEOUT',
    })

    await vi.advanceTimersByTimeAsync(10_001)
    await rejection
  })

  it('publishes only the LMS permission contract for each production role', async () => {
    for (const role of ['student', 'lecturer', 'administrator'] satisfies LmsMvpUserRole[]) {
      firebase.state.account = {
        ...firebase.state.account,
        roles: [role],
        scope: role === 'student'
          ? { unitIds: [], programStudyIds: ['management-s1'], cohortYears: [2026], studentIds: ['student-001'] }
          : role === 'lecturer'
            ? { unitIds: [], programStudyIds: ['management-s1'], cohortYears: [], studentIds: [] }
            : { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] },
      }
      const created = await createFirebaseSession(`fresh-${role}-id-token`)
      const session = publicSession(created.context)

      expect(session.roles).toEqual([role])
      expect(session.permissions).toEqual(LMS_MVP_ROLE_PERMISSIONS[role])
      expect(session.rolePermissions[role]).toEqual(LMS_MVP_ROLE_PERMISSIONS[role])
    }

    const administrator = publicSession((await createFirebaseSession('fresh-administrator-check')).context)
    expect(administrator.permissions).not.toEqual(expect.arrayContaining([
      'learning:submit',
      'learning:grade',
      'payments:record',
      'pmb.write',
      'finance.write',
    ]))
  })

  it.each([
    {
      label: 'role LMS gabungan',
      roles: ['administrator', 'lecturer'],
      scope: { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] },
    },
    {
      label: 'mahasiswa tanpa tepat satu identitas dan program studi',
      roles: ['student'],
      scope: { unitIds: [], programStudyIds: [], cohortYears: [2026], studentIds: [] },
    },
    {
      label: 'mahasiswa dengan scope unit lama',
      roles: ['student'],
      scope: { unitIds: ['campus'], programStudyIds: ['management-s1'], cohortYears: [2026], studentIds: ['student-001'] },
    },
    {
      label: 'dosen dengan scope mahasiswa',
      roles: ['lecturer'],
      scope: { unitIds: [], programStudyIds: ['management-s1'], cohortYears: [], studentIds: ['student-001'] },
    },
    {
      label: 'administrator dengan scope organisasi lama',
      roles: ['administrator'],
      scope: { unitIds: ['campus'], programStudyIds: [], cohortYears: [], studentIds: [] },
    },
    {
      label: 'scope dengan ID tidak kanonis',
      roles: ['lecturer'],
      scope: { unitIds: [], programStudyIds: ['management s1'], cohortYears: [], studentIds: [] },
    },
  ])('menolak akun aktif dengan $label saat sesi dibuat', async ({ roles, scope }) => {
    firebase.state.account = { ...firebase.state.account, roles, scope }

    await expect(createFirebaseSession('invalid-authorization-id-token')).rejects.toMatchObject({
      statusCode: 403,
      code: 'ACCOUNT_AUTHORIZATION_INVALID',
    })
  })

  it('memvalidasi ulang kontrak role dan scope ketika application session digunakan', async () => {
    const { token } = await createFirebaseSession('valid-before-account-drift')
    firebase.state.account = {
      ...firebase.state.account,
      roles: ['administrator', 'lecturer'],
    }

    await expect(authenticate(requestWithCookie(token))).rejects.toMatchObject({
      statusCode: 403,
      code: 'ACCOUNT_AUTHORIZATION_INVALID',
    })
  })

  it('mempertahankan dukungan akun multi-role pada profil full-campus', async () => {
    process.env.APP_FEATURE_PROFILE = 'full-campus'
    firebase.state.account = {
      ...firebase.state.account,
      roles: ['administrator', 'lecturer'],
      scope: { unitIds: ['campus'], programStudyIds: ['management-s1'], cohortYears: [2026], studentIds: [] },
    }

    await expect(createFirebaseSession('full-campus-multi-role')).resolves.toMatchObject({
      context: {
        roles: ['administrator', 'lecturer'],
        scope: { unitIds: ['campus'], programStudyIds: ['management-s1'], cohortYears: [2026], studentIds: [] },
      },
    })
  })

  it('menerima akun mahasiswa lama dengan unit scope pada profil full-campus', async () => {
    process.env.APP_FEATURE_PROFILE = 'full-campus'
    firebase.state.account = {
      ...firebase.state.account,
      roles: ['student'],
      scope: {
        unitIds: ['campus'],
        programStudyIds: ['management-s1'],
        cohortYears: [2026],
        studentIds: ['student-001'],
      },
    }

    await expect(createFirebaseSession('full-campus-legacy-student')).resolves.toMatchObject({
      context: {
        roles: ['student'],
        scope: {
          unitIds: ['campus'],
          programStudyIds: ['management-s1'],
          cohortYears: [2026],
          studentIds: ['student-001'],
        },
      },
    })
  })

  it.each([
    {
      roles: ['student', 'finance_staff'],
      scope: { unitIds: [], programStudyIds: ['management-s1'], cohortYears: [2026], studentIds: ['student-001'] },
    },
    {
      roles: ['student'],
      scope: { unitIds: [], programStudyIds: ['management-s1'], cohortYears: [2026], studentIds: ['student-001', 'student-002'] },
    },
    {
      roles: ['advisor'],
      scope: { unitIds: [], programStudyIds: ['management-s1'], cohortYears: [], studentIds: [] },
    },
  ])('menolak invariant role dan identitas yang rusak pada full-campus', async ({ roles, scope }) => {
    process.env.APP_FEATURE_PROFILE = 'full-campus'
    firebase.state.account = { ...firebase.state.account, roles, scope }

    await expect(createFirebaseSession('full-campus-invalid-authorization')).rejects.toMatchObject({
      statusCode: 403,
      code: 'ACCOUNT_AUTHORIZATION_INVALID',
    })
  })
})
