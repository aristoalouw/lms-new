import { beforeEach, describe, expect, it } from 'vitest'
import {
  queuePddiktiSync,
  retryPddiktiJob,
  transitionPddiktiFailure,
} from '../../server/services/pddikti'
import { CampusError } from '../../server/utils/errors'
import { resetMockState } from '../../server/utils/mock-store'
import type { PddiktiSyncJob } from '../../server/types/domain'
import { authContext } from './fixtures'

describe('PDDIKTI sync queue', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState()
  })

  it('queues an idempotent sync job', async () => {
    const staff = authContext('academic-001', ['academic_staff'])
    const input = {
      entityType: 'grade' as const,
      entityIds: ['grade-101', 'grade-102'],
      programStudyId: 'management-s1',
      periodId: '2025-2026-2',
    }
    const first = await queuePddiktiSync(staff, input, 'pddikti-key-0001')
    const replay = await queuePddiktiSync(staff, input, 'pddikti-key-0001')
    expect(first.job).toMatchObject({ status: 'QUEUED', attempts: 0, maxAttempts: 5 })
    expect(replay.replayed).toBe(true)
    expect(replay.job.id).toBe(first.job.id)
  })

  it('requeues a failed job and audits the manual retry', async () => {
    const staff = authContext('academic-001', ['academic_staff'])
    const result = await retryPddiktiJob(staff, 'sync-student-20260721-001')
    expect(result.job.status).toBe('QUEUED')
    expect(result.auditId).toMatch(/^audit_/)
  })

  it('uses bounded exponential backoff and a dead-letter terminal state', () => {
    const base: PddiktiSyncJob = {
      id: 'job', entityType: 'student', entityIds: ['student'], programStudyId: 'management-s1', periodId: 'period', status: 'PROCESSING',
      attempts: 0, maxAttempts: 2, createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'user',
      updatedAt: '2026-01-01T00:00:00.000Z', nextAttemptAt: '2026-01-01T00:00:00.000Z',
    }
    const first = transitionPddiktiFailure(base, { code: 'TIMEOUT', message: 'timeout' }, new Date('2026-01-01T00:00:00.000Z'))
    expect(first).toMatchObject({ attempts: 1, status: 'QUEUED', nextAttemptAt: '2026-01-01T00:00:30.000Z' })
    const second = transitionPddiktiFailure(first, { code: 'TIMEOUT', message: 'timeout' }, new Date('2026-01-01T00:01:00.000Z'))
    expect(second).toMatchObject({ attempts: 2, status: 'DEAD_LETTER' })
  })

  it('rejects queue access from a finance-only role', async () => {
    const finance = authContext('finance-001', ['finance_staff'])
    await expect(queuePddiktiSync(finance, {
      entityType: 'grade', entityIds: ['g1'], programStudyId: 'management-s1', periodId: 'p1',
    }, 'pddikti-key-0002'))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
  })
})
