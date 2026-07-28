import { beforeEach, describe, expect, it } from 'vitest'
import {
  accountRuntimeForTests,
  createAccount,
  listAccounts,
  parseAccountListQuery,
  resetAccountStateForTests,
  updateAccount,
} from '../../server/services/accounts'
import {
  configurePasswordResetDelivery,
  passwordResetDeliveriesForTests,
  requestPasswordReset,
  resetPasswordResetStateForTests,
} from '../../server/services/accounts-password-reset'
import { CampusError } from '../../server/utils/errors'
import { resetMockState, mockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const admin = () => authContext('admin-001', ['administrator'], [])
const scopedStaffPayload = {
  email: 'dimas.operator@example.test',
  displayName: 'Dimas Operator',
  roles: ['academic_staff', 'finance_staff'],
  scope: {
    unitIds: ['faculty-economics'],
    programStudyIds: ['management-s1'],
    cohortYears: [],
    studentIds: [],
  },
  status: 'active',
}

describe('account lifecycle', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.NODE_ENV = 'test'
    resetMockState()
    resetAccountStateForTests()
    resetPasswordResetStateForTests()
  })

  it('lists accounts with server pagination and combined filters', async () => {
    const page = await listAccounts(admin(), parseAccountListQuery({
      page: '1',
      pageSize: '1',
      role: 'student',
      status: 'active',
      programStudyId: 'management-s1',
      search: 'a',
    }))

    expect(page).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]?.roles).toContain('student')
  })

  it('denies account inventory to non-administrators even inside the same program scope', async () => {
    const academic = authContext('academic-001', ['academic_staff'], ['management-s1'])
    await expect(listAccounts(academic, parseAccountListQuery({})))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)

    const guardian = authContext('guardian-001', ['guardian'], [])
    guardian.scope.studentIds = ['student-001']
    await expect(listAccounts(guardian, parseAccountListQuery({})))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })

  it('creates a scoped multi-role account once and replays the same response', async () => {
    const first = await createAccount(admin(), scopedStaffPayload, 'account-create-key-0001')
    const replay = await createAccount(admin(), scopedStaffPayload, 'account-create-key-0001')

    expect(first).toMatchObject({ replayed: false, account: { roles: ['academic_staff', 'finance_staff'], version: 1 } })
    expect(replay.replayed).toBe(true)
    expect(replay.account.id).toBe(first.account.id)
    expect(accountRuntimeForTests().accounts.filter((account) => account.email === scopedStaffPayload.email)).toHaveLength(1)
    expect(mockState().auditEntries.filter((entry) => entry.action === 'ACCOUNT_CREATED')).toHaveLength(1)
  })

  it('rejects unknown roles, invalid role combinations, and unscoped staff', async () => {
    await expect(createAccount(admin(), { ...scopedStaffPayload, roles: ['super_admin'] }, 'account-create-key-0002'))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    await expect(createAccount(admin(), { ...scopedStaffPayload, roles: ['student', 'finance_staff'] }, 'account-create-key-0003'))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    await expect(createAccount(admin(), { ...scopedStaffPayload, roles: ['advisor'], scope: { unitIds: ['faculty-economics'] } }, 'account-create-key-0004'))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    await expect(createAccount(admin(), {
      ...scopedStaffPayload,
      roles: ['academic_staff'],
      scope: { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] },
    }, 'account-create-key-0005')).rejects.toMatchObject({ code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
  })

  it('rejects a non-canonical scope identifier before creating account side effects', async () => {
    const before = accountRuntimeForTests()
    const auditCount = mockState().auditEntries.length

    await expect(createAccount(admin(), {
      ...scopedStaffPayload,
      scope: { ...scopedStaffPayload.scope, unitIds: ['STT Saint Paul'] },
    }, 'account-create-invalid-scope')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_INPUT',
      message: 'scope.unitIds[0] memiliki format yang tidak valid.',
    } satisfies Partial<CampusError>)

    expect(accountRuntimeForTests().accounts).toHaveLength(before.accounts.length)
    expect(accountRuntimeForTests().identities).toHaveLength(before.identities.length)
    expect(mockState().auditEntries).toHaveLength(auditCount)
  })

  it('enforces role-specific LMS scope independently of the account editor', async () => {
    const previousProfile = process.env.APP_FEATURE_PROFILE
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    try {
      await expect(createAccount(admin(), {
        email: 'mixed.roles@example.test',
        displayName: 'Mixed Roles',
        roles: ['administrator', 'lecturer'],
        scope: { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] },
        status: 'active',
      }, 'account-lms-mixed-roles')).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_INPUT',
      } satisfies Partial<CampusError>)

      await expect(createAccount(admin(), {
        email: 'student.scope@example.test',
        displayName: 'Student Scope',
        roles: ['student'],
        scope: { unitIds: ['campus'], programStudyIds: ['management-s1'], cohortYears: [2026], studentIds: ['2026001'] },
        status: 'active',
      }, 'account-lms-scope-student')).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_INPUT',
      } satisfies Partial<CampusError>)

      await expect(createAccount(admin(), {
        email: 'duplicate.student@example.test',
        displayName: 'Duplicate Student',
        roles: ['student'],
        scope: { unitIds: [], programStudyIds: ['management-s1'], cohortYears: [2026], studentIds: ['student-001'] },
        status: 'active',
      }, 'account-lms-duplicate-student')).rejects.toMatchObject({
        statusCode: 409,
        code: 'STUDENT_ID_ALREADY_USED',
      } satisfies Partial<CampusError>)

      await expect(createAccount(admin(), {
        email: 'lecturer.scope@example.test',
        displayName: 'Lecturer Scope',
        roles: ['lecturer'],
        scope: { unitIds: [], programStudyIds: ['management-s1'], cohortYears: [], studentIds: ['student-001'] },
        status: 'active',
      }, 'account-lms-scope-lecturer')).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_INPUT',
      } satisfies Partial<CampusError>)

      const administrator = await createAccount(admin(), {
        email: 'administrator.scope@example.test',
        displayName: 'Administrator Scope',
        roles: ['administrator'],
        scope: { unitIds: ['campus'], programStudyIds: ['management-s1'], cohortYears: [2026], studentIds: [] },
        status: 'active',
      }, 'account-lms-scope-administrator')
      expect(administrator.account.scope).toEqual({
        unitIds: [],
        programStudyIds: [],
        cohortYears: [],
        studentIds: [],
      })
    } finally {
      if (previousProfile === undefined) delete process.env.APP_FEATURE_PROFILE
      else process.env.APP_FEATURE_PROFILE = previousProfile
    }
  })

  it('rejects duplicate email and an idempotency key reused for another payload', async () => {
    await expect(createAccount(admin(), { ...scopedStaffPayload, email: 'rina.wijaya@example.test' }, 'account-create-key-0006'))
      .rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_ALREADY_USED' } satisfies Partial<CampusError>)

    await createAccount(admin(), scopedStaffPayload, 'account-create-key-0007')
    await expect(createAccount(admin(), { ...scopedStaffPayload, displayName: 'Nama Berbeda' }, 'account-create-key-0007'))
      .rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED' } satisfies Partial<CampusError>)
  })

  it('creates a guardian with a student-only claim scope and no inherited program access', async () => {
    const result = await createAccount(admin(), {
      email: 'orangtua.baru@example.test',
      displayName: 'Orang Tua Baru',
      roles: ['guardian'],
      scope: { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] },
      guardianStudentIds: ['student-001', 'student-002'],
      status: 'active',
    }, 'account-guardian-key-0001')

    expect(result.account.roles).toEqual(['guardian'])
    expect(result.account.scope).toEqual({
      unitIds: [],
      programStudyIds: [],
      cohortYears: [],
      studentIds: ['student-001', 'student-002'],
    })
    const identity = accountRuntimeForTests().identities.find((item) => item.uid === result.account.id)
    expect(identity?.claims).toMatchObject({
      roles: ['guardian'],
      scope: { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: ['student-001', 'student-002'] },
    })
  })

  it('fails guardian linkage closed for missing and non-student targets', async () => {
    const base = {
      email: 'wali.invalid@example.test',
      displayName: 'Wali Invalid',
      roles: ['guardian'],
      scope: { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] },
      status: 'active',
    }
    await expect(createAccount(admin(), { ...base, guardianStudentIds: ['student-does-not-exist'] }, 'account-guardian-key-0002'))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    await expect(createAccount(admin(), { ...base, guardianStudentIds: ['academic-001'] }, 'account-guardian-key-0003'))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
  })

  it('blocks an account, revokes sessions, increments its version, and audits only once', async () => {
    const first = await updateAccount(admin(), 'student-001', {
      status: 'blocked',
      expectedVersion: 2,
    }, 'account-update-key-0001')
    const replay = await updateAccount(admin(), 'student-001', {
      status: 'blocked',
      expectedVersion: 2,
    }, 'account-update-key-0001')

    expect(first.account).toMatchObject({ status: 'blocked', version: 3 })
    expect(replay.replayed).toBe(true)
    expect(accountRuntimeForTests().revokedSessionUids).toContain('student-001')
    expect(accountRuntimeForTests().identities.find((item) => item.uid === 'student-001')?.disabled).toBe(true)
    expect(mockState().auditEntries.filter((entry) => entry.action === 'ACCOUNT_STATE_CHANGED')).toHaveLength(1)
  })

  it('can block a legacy LMS account without accepting its obsolete scope on authorization changes', async () => {
    const previousProfile = process.env.APP_FEATURE_PROFILE
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    try {
      const blocked = await updateAccount(admin(), 'student-001', {
        status: 'blocked',
        expectedVersion: 2,
      }, 'account-update-legacy-block')

      expect(blocked.account).toMatchObject({
        status: 'blocked',
        version: 3,
        scope: { unitIds: ['faculty-economics'] },
      })

      await expect(updateAccount(admin(), 'student-002', {
        scope: {
          unitIds: ['faculty-economics'],
          programStudyIds: ['management-s1'],
          cohortYears: [2023],
          studentIds: ['student-002'],
        },
        expectedVersion: 1,
      }, 'account-update-legacy-scope')).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_INPUT',
      } satisfies Partial<CampusError>)
    } finally {
      if (previousProfile === undefined) delete process.env.APP_FEATURE_PROFILE
      else process.env.APP_FEATURE_PROFILE = previousProfile
    }
  })

  it('validates current scope and student identity before reactivating a contained LMS account', async () => {
    const previousProfile = process.env.APP_FEATURE_PROFILE
    process.env.APP_FEATURE_PROFILE = 'full-campus'
    try {
      const duplicate = await createAccount(admin(), {
        email: 'legacy.duplicate@example.test',
        displayName: 'Legacy Duplicate',
        roles: ['student'],
        scope: {
          unitIds: [],
          programStudyIds: ['management-s1'],
          cohortYears: [2023],
          studentIds: ['student-001'],
        },
        status: 'active',
      }, 'account-create-legacy-duplicate')

      process.env.APP_FEATURE_PROFILE = 'lms-mvp'
      const blocked = await updateAccount(admin(), duplicate.account.id, {
        status: 'blocked',
        expectedVersion: 1,
      }, 'account-block-legacy-duplicate')
      expect(blocked.account.status).toBe('blocked')

      await expect(updateAccount(admin(), duplicate.account.id, {
        status: 'active',
        expectedVersion: 2,
      }, 'account-reactivate-legacy-duplicate')).rejects.toMatchObject({
        statusCode: 409,
        code: 'STUDENT_ID_ALREADY_USED',
      } satisfies Partial<CampusError>)
    } finally {
      if (previousProfile === undefined) delete process.env.APP_FEATURE_PROFILE
      else process.env.APP_FEATURE_PROFILE = previousProfile
    }
  })

  it('does not reactivate a contained account with a legacy non-LMS role', async () => {
    const previousProfile = process.env.APP_FEATURE_PROFILE
    process.env.APP_FEATURE_PROFILE = 'full-campus'
    try {
      const guardian = await createAccount(admin(), {
        email: 'legacy.guardian@example.test',
        displayName: 'Legacy Guardian',
        roles: ['guardian'],
        scope: { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] },
        guardianStudentIds: ['student-001'],
        status: 'active',
      }, 'account-create-legacy-guardian')

      process.env.APP_FEATURE_PROFILE = 'lms-mvp'
      const blocked = await updateAccount(admin(), guardian.account.id, {
        status: 'blocked',
        expectedVersion: 1,
      }, 'account-block-legacy-guardian')
      expect(blocked.account.status).toBe('blocked')

      await expect(updateAccount(admin(), guardian.account.id, {
        status: 'active',
        expectedVersion: 2,
      }, 'account-reactivate-legacy-guardian')).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_INPUT',
      } satisfies Partial<CampusError>)
    } finally {
      if (previousProfile === undefined) delete process.env.APP_FEATURE_PROFILE
      else process.env.APP_FEATURE_PROFILE = previousProfile
    }
  })

  it('revokes existing sessions when role or scope is reduced', async () => {
    await updateAccount(admin(), 'academic-001', {
      roles: ['academic_staff'],
      scope: { unitIds: ['faculty-economics'], programStudyIds: ['management-s1'], cohortYears: [2024], studentIds: [] },
      expectedVersion: 3,
    }, 'account-update-key-0002')
    expect(accountRuntimeForTests().revokedSessionUids).toContain('academic-001')
  })

  it('rejects stale versions and prevents administrator self-lockout', async () => {
    await expect(updateAccount(admin(), 'student-001', { status: 'disabled', expectedVersion: 1 }, 'account-update-key-0003'))
      .rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
    await expect(updateAccount(admin(), 'admin-001', { status: 'blocked', expectedVersion: 1 }, 'account-update-key-0004'))
      .rejects.toMatchObject({ statusCode: 409, code: 'SELF_LOCKOUT' } satisfies Partial<CampusError>)
    await expect(updateAccount(admin(), 'admin-001', { roles: ['leader'], expectedVersion: 1 }, 'account-update-key-0005'))
      .rejects.toMatchObject({ statusCode: 409, code: 'SELF_ADMIN_REQUIRED' } satisfies Partial<CampusError>)
  })

  it('updates guardian linkage while preserving the restricted scope', async () => {
    const result = await updateAccount(admin(), 'guardian-001', {
      guardianStudentIds: ['student-002'],
      expectedVersion: 1,
    }, 'account-update-key-0006')
    expect(result.account.guardianStudentIds).toEqual(['student-002'])
    expect(result.account.scope).toEqual({ unitIds: [], programStudyIds: [], cohortYears: [], studentIds: ['student-002'] })

    await expect(updateAccount(admin(), 'guardian-001', {
      guardianStudentIds: ['academic-001'],
      expectedVersion: 2,
    }, 'account-update-key-0007')).rejects.toMatchObject({ code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
  })

  it('denies account state changes from a guardian and same-scope staff account', async () => {
    const guardian = authContext('guardian-001', ['guardian'], [])
    guardian.scope.studentIds = ['student-001']
    await expect(updateAccount(guardian, 'student-001', { status: 'blocked', expectedVersion: 2 }, 'cross-scope-key-0001'))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
    await expect(updateAccount(authContext('academic-001', ['academic_staff']), 'student-001', {
      status: 'disabled',
      expectedVersion: 2,
    }, 'cross-scope-key-0002')).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })
})

describe('password reset request', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.NODE_ENV = 'test'
    resetMockState()
    resetAccountStateForTests()
    resetPasswordResetStateForTests()
  })

  it('delivers one reset message for an active account and deduplicates retries', async () => {
    const first = await requestPasswordReset({ email: 'NABILA.PUTRI@example.test' }, 'password-reset-key-0001')
    const replay = await requestPasswordReset({ email: 'nabila.putri@example.test' }, 'password-reset-key-0001')

    expect(first).toEqual(replay)
    expect(first).toEqual({
      accepted: true,
      message: 'Jika akun memenuhi syarat, petunjuk pengaturan ulang kata sandi akan dikirim.',
    })
    expect(passwordResetDeliveriesForTests()).toHaveLength(1)
    expect(passwordResetDeliveriesForTests()[0]?.recipient).toBe('nabila.putri@example.test')
    expect(passwordResetDeliveriesForTests()[0]?.resetLink).not.toContain('nabila.putri')
  })

  it('returns the identical enumeration-safe response for missing and disabled accounts', async () => {
    const missing = await requestPasswordReset({ email: 'missing.user@example.test' }, 'password-reset-key-0002')
    const disabled = await requestPasswordReset({ email: 'anisa.candidate@example.test' }, 'password-reset-key-0003')
    const active = await requestPasswordReset({ email: 'nabila.putri@example.test' }, 'password-reset-key-0004')

    expect(missing).toEqual(active)
    expect(disabled).toEqual(active)
    expect(passwordResetDeliveriesForTests()).toHaveLength(1)
  })

  it('deduplicates a reused reset key without exposing whether either email exists', async () => {
    const first = await requestPasswordReset({ email: 'missing.user@example.test' }, 'password-reset-key-0006')
    const reused = await requestPasswordReset({ email: 'nabila.putri@example.test' }, 'password-reset-key-0006')
    expect(reused).toEqual(first)
    expect(passwordResetDeliveriesForTests()).toHaveLength(0)
  })

  it('rejects malformed request shapes without consulting account existence', async () => {
    await expect(requestPasswordReset({ email: 'bukan-email' }, 'password-reset-key-0007'))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    await expect(requestPasswordReset({ email: 'nabila.putri@example.test', debug: true }, 'password-reset-key-0008'))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_INPUT' } satisfies Partial<CampusError>)
    expect(passwordResetDeliveriesForTests()).toHaveLength(0)
  })

  it('keeps the public response enumeration-safe when delivery fails', async () => {
    configurePasswordResetDelivery({
      async deliver() {
        throw new Error('email provider unavailable')
      },
    })
    const response = await requestPasswordReset({ email: 'nabila.putri@example.test' }, 'password-reset-key-0005')
    expect(response).toEqual({
      accepted: true,
      message: 'Jika akun memenuhi syarat, petunjuk pengaturan ulang kata sandi akan dikirim.',
    })
    expect(mockState().auditEntries[0]).toMatchObject({
      action: 'PASSWORD_RESET_REQUEST_ACCEPTED',
      outcome: 'FAILURE',
      metadata: { operationalResult: 'DELIVERY_FAILED' },
    })
  })
})
