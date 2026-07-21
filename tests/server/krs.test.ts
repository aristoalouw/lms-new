import { beforeEach, describe, expect, it } from 'vitest'
import { reviewKrs } from '../../server/services/krs'
import { CampusError } from '../../server/utils/errors'
import { mockState, resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

describe('KRS approval', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState()
  })

  it('allows the assigned advisor and records an append-only audit entry', async () => {
    const advisor = authContext('advisor-001', ['advisor', 'lecturer'])
    const result = await reviewKrs('krs-2026-0001', advisor, {
      decision: 'APPROVE',
      notes: 'Beban studi sesuai hasil perwalian.',
      expectedVersion: 3,
    })

    expect(result.record.status).toBe('APPROVED')
    expect(result.record.version).toBe(4)
    expect(result.record.reviewedBy).toBe('advisor-001')
    expect(mockState().auditEntries[0]).toMatchObject({ action: 'KRS_APPROVED', resource: { id: 'krs-2026-0001' } })
  })

  it('fails closed for an advisor who does not own the advisee', async () => {
    const otherAdvisor = authContext('advisor-999', ['advisor'])
    await expect(reviewKrs('krs-2026-0001', otherAdvisor, { decision: 'APPROVE' }))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })

  it('rejects stale optimistic versions', async () => {
    const advisor = authContext('advisor-001', ['advisor'])
    await expect(reviewKrs('krs-2026-0001', advisor, { decision: 'APPROVE', expectedVersion: 2 }))
      .rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
  })
})
