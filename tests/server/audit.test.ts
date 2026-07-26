import { describe, expect, it } from 'vitest'
import { auditEntrySummary } from '../../server/utils/audit'
import { requestHash, sanitizeForAudit } from '../../server/utils/security'

describe('security utilities', () => {
  it('redacts recursively sensitive fields before audit persistence', () => {
    expect(sanitizeForAudit({
      password: 'secret',
      profile: { accessToken: 'token', displayName: 'Nabila', note: 'Hubungi nabila@example.test' },
      result: { score: 88, feedback: 'Jawaban rinci' },
    })).toEqual({
      password: '[REDACTED]',
      profile: { accessToken: '[REDACTED]', displayName: '[REDACTED]', note: 'Hubungi [REDACTED_EMAIL]' },
      result: { score: '[REDACTED]', feedback: '[REDACTED]' },
    })
  })

  it('generates the same request hash regardless of object key insertion order', () => {
    expect(requestHash({ invoiceId: 'one', amount: 10 })).toBe(requestHash({ amount: 10, invoiceId: 'one' }))
  })

  it('projects audit list records without request or before/after payloads', () => {
    const summary = auditEntrySummary({
      id: 'audit_1234567890abcdef12345678',
      occurredAt: '2026-07-27T00:00:00.000Z',
      actor: { uid: 'admin-001', roles: ['administrator'] },
      action: 'CLASS_ENROLLMENT_OVERRIDDEN',
      resource: { type: 'class_enrollment', id: 'enrollment-001' },
      outcome: 'SUCCESS',
      request: { requestId: 'request-001', ipAddress: '127.0.0.1' },
      before: { studentName: 'Private' },
      after: { studentName: 'Private' },
      metadata: { email: 'private@example.test' },
    })
    expect(summary).toEqual({
      id: 'audit_1234567890abcdef12345678',
      occurredAt: '2026-07-27T00:00:00.000Z',
      actor: { uid: 'admin-001', roles: ['administrator'] },
      action: 'CLASS_ENROLLMENT_OVERRIDDEN',
      resource: { type: 'class_enrollment', id: 'enrollment-001' },
      outcome: 'SUCCESS',
    })
  })
})
