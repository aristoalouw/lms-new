import { describe, expect, it } from 'vitest'
import { can, normalizeRoles, requireKrsApprovalScope, requirePaymentScope } from '../../server/utils/rbac'
import { CampusError } from '../../server/utils/errors'
import { MOCK_INVOICES, MOCK_KRS } from '../../server/data/mock-data'
import { authContext } from '../server/fixtures'

describe('server RBAC', () => {
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
})
