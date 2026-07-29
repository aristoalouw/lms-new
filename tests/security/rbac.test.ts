import { afterEach, describe, expect, it } from 'vitest'
import { can, normalizeRoles, requireKrsApprovalScope, requirePaymentScope } from '../../server/utils/rbac'
import { CampusError } from '../../server/utils/errors'
import { MOCK_INVOICES, MOCK_KRS } from '../../server/data/mock-data'
import { authContext } from '../server/fixtures'

describe('server RBAC', () => {
  afterEach(() => {
    delete process.env.APP_FEATURE_PROFILE
  })

  it('drops unknown role claims instead of trusting them', () => {
    expect(normalizeRoles(['student', 'superuser', 123])).toEqual(['student'])
  })

  it('unions permissions for multi-role accounts without escalating unknown roles', () => {
    const user = authContext('advisor-001', ['lecturer', 'advisor'])
    expect(can(user, 'dashboard:view_academic')).toBe(true)
    expect(can(user, 'krs:approve')).toBe(true)
    expect(can(user, 'payments:record')).toBe(false)
  })

  it('enforces both role and object scope for sensitive mutations', () => {
    expect(() => requireKrsApprovalScope(authContext('advisor-001', ['advisor']), MOCK_KRS[0]!)).not.toThrow()
    expect(() => requirePaymentScope(authContext('finance-001', ['finance_staff'], ['informatics-s1']), MOCK_INVOICES[0]!))
      .toThrowError(CampusError)
  })

  it('uses the reduced role contract for the LMS MVP profile', () => {
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    const administrator = authContext('admin-001', ['administrator'])
    const student = authContext('student-001', ['student'])
    expect(can(administrator, 'classes:manage')).toBe(true)
    expect(can(administrator, 'learning:grade')).toBe(false)
    expect(can(administrator, 'learning:submit')).toBe(false)
    expect(can(administrator, 'finance.write')).toBe(false)
    expect(can(student, 'learning:submit')).toBe(true)
    expect(can(student, 'learning:manage_content')).toBe(false)
  })
})
