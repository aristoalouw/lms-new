import { beforeEach, describe, expect, it } from 'vitest'
import { getPddiktiReadiness } from '../../server/services/pddikti'
import {
  comparePddiktiSnapshots,
  decidePddiktiReconciliation,
  getPddiktiReconciliation,
  listPddiktiReconciliations,
} from '../../server/services/pddikti-reconciliation'
import { pddiktiModuleState, resetPddiktiModuleState } from '../../server/services/pddikti-state'
import { CampusError } from '../../server/utils/errors'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const staff = () => authContext('academic-001', ['academic_staff'], ['management-s1'])
const input = { entityType: 'grade' as const, programStudyId: 'management-s1', periodId: '2025-2026-2' }

describe('PDDIKTI readiness and explicit reconciliation', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.NODE_ENV = 'test'
    resetMockState()
    resetPddiktiModuleState()
  })

  it('reports entity completeness and blocker codes from eligible internal snapshots', async () => {
    const readiness = await getPddiktiReadiness(staff(), { programStudyId: input.programStudyId, periodId: input.periodId })
    const grades = readiness.entities.find(entity => entity.entityType === 'grade')!

    expect(readiness).toMatchObject({ programStudyId: 'management-s1', blocked: 1 })
    expect(grades).toMatchObject({ total: 6, eligible: 5, blocked: 1, blockerCounts: { FINAL_GRADE_MISSING: 1 }, mappingVersion: 'grade-mapping-v1' })
    expect(grades.completenessPercent).toBeCloseTo(83.33, 2)
  })

  it('compares fingerprints and field names without overwriting either snapshot', async () => {
    const internalBefore = structuredClone(pddiktiModuleState().sourceRecords.get('grade:grade-102'))
    const remoteBefore = structuredClone(pddiktiModuleState().remoteSnapshots.get('grade:management-s1:2025-2026-2'))
    const result = await comparePddiktiSnapshots(staff(), input, 'pddikti-reconcile-compare-0001')

    expect(result.reconciliation.summary).toEqual({ MATCH: 1, DIFFERENT: 1, MISSING_REMOTE: 3, MISSING_INTERNAL: 1 })
    const different = result.reconciliation.rows.find(row => row.state === 'DIFFERENT')!
    expect(different).toMatchObject({ internalId: 'grade-102', remoteId: 'remote-grade-102' })
    expect(different.differingFields).toEqual(['finalGrade', 'letterGrade'])
    expect(different).not.toHaveProperty('internalValue')
    expect(different).not.toHaveProperty('remoteValue')
    expect(pddiktiModuleState().sourceRecords.get('grade:grade-102')).toEqual(internalBefore)
    expect(pddiktiModuleState().remoteSnapshots.get('grade:management-s1:2025-2026-2')).toEqual(remoteBefore)
  })

  it('records explicit decisions, queues internal truth safely, and rejects stale decisions', async () => {
    const compared = await comparePddiktiSnapshots(staff(), input, 'pddikti-reconcile-decision-0001')
    const different = compared.reconciliation.rows.find(row => row.state === 'DIFFERENT')!
    const queued = await decidePddiktiReconciliation(staff(), compared.reconciliation.id, {
      expectedVersion: 1,
      rowKeys: [different.key],
      decision: 'QUEUE_INTERNAL',
    }, 'pddikti-reconcile-queue-0001')
    const replay = await decidePddiktiReconciliation(staff(), compared.reconciliation.id, {
      expectedVersion: 1,
      rowKeys: [different.key],
      decision: 'QUEUE_INTERNAL',
    }, 'pddikti-reconcile-queue-0001')

    expect(queued.reconciliation).toMatchObject({ version: 2, status: 'OPEN' })
    expect(queued.reconciliation.rows.find(row => row.key === different.key)).toMatchObject({ decision: 'QUEUE_INTERNAL', decidedBy: 'academic-001' })
    expect(queued.queuedJob).toMatchObject({ entityIds: ['grade-102'], status: 'QUEUED' })
    expect(replay).toMatchObject({ replayed: true, queuedJob: { id: queued.queuedJob!.id } })
    await expect(decidePddiktiReconciliation(staff(), compared.reconciliation.id, {
      expectedVersion: 1,
      rowKeys: [different.key],
      decision: 'ACKNOWLEDGE_REMOTE',
    }, 'pddikti-reconcile-stale-0001')).rejects.toMatchObject({ code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
  })

  it('enforces program scope and keeps leaders read-only', async () => {
    const compared = await comparePddiktiSnapshots(staff(), input, 'pddikti-reconcile-scope-0001')
    const outsider = authContext('academic-info-001', ['academic_staff'], ['informatics-s1'])
    const leader = authContext('leader-001', ['leader'], [])

    await expect(getPddiktiReconciliation(outsider, compared.reconciliation.id))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
    expect((await getPddiktiReconciliation(leader, compared.reconciliation.id)).id).toBe(compared.reconciliation.id)
    expect(await listPddiktiReconciliations(leader)).toHaveLength(1)
    await expect(comparePddiktiSnapshots(leader, input, 'pddikti-reconcile-leader-0001'))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
  })
})
