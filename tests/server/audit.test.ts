import { describe, expect, it } from 'vitest'
import { requestHash, sanitizeForAudit } from '../../server/utils/security'

describe('security utilities', () => {
  it('redacts recursively sensitive fields before audit persistence', () => {
    expect(sanitizeForAudit({
      password: 'secret',
      profile: { accessToken: 'token', displayName: 'Nabila' },
    })).toEqual({ password: '[REDACTED]', profile: { accessToken: '[REDACTED]', displayName: 'Nabila' } })
  })

  it('generates the same request hash regardless of object key insertion order', () => {
    expect(requestHash({ invoiceId: 'one', amount: 10 })).toBe(requestHash({ amount: 10, invoiceId: 'one' }))
  })
})
