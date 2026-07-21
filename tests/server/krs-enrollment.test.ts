import { beforeEach, describe, expect, it } from 'vitest'
import { getOwnKrs, listKrsCatalog, saveKrsDraft, submitKrs } from '../../server/services/krs-enrollment'
import { krsModuleState, resetKrsModuleState } from '../../server/services/krs-state'
import { reviewKrs } from '../../server/services/krs'
import type { AuthContext } from '../../server/types/auth'
import { CampusError } from '../../server/utils/errors'
import { mockState, resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const clock = new Date('2026-07-21T04:00:00.000Z')

function studentContext(uid = 'student-010'): AuthContext {
  const context = authContext(uid, ['student'])
  context.scope.studentIds = [uid]
  return context
}

async function draft(
  context = studentContext(),
  classIds = ['class-mgt-501-a', 'class-mgt-502-a'],
  key = 'draft-idempotency-0001',
) {
  return saveKrsDraft(context, { periodId: '2026-2027-1', classIds, expectedVersion: 0 }, key, undefined, clock)
}

describe('KRS draft, eligibility, seats, and submission', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState()
    resetKrsModuleState()
  })

  it('returns an ownership-scoped catalog with prerequisite and capacity facts', async () => {
    const result = await listKrsCatalog(studentContext(), '2026-2027-1')
    expect(result.student.id).toBe('student-010')
    expect(result.classes.find(item => item.classRecord.id === 'class-mgt-501-a')).toMatchObject({
      eligibleByPrerequisite: true,
      availableSeats: 40,
    })
    expect(result.classes.find(item => item.classRecord.id === 'class-mgt-505-a')?.availableSeats).toBe(0)
  })

  it('saves a versioned draft and replays the same idempotency key', async () => {
    const context = studentContext()
    const first = await draft(context)
    const replay = await draft(context)
    expect(first.record).toMatchObject({ status: 'DRAFT', totalCredits: 6, version: 1 })
    expect(replay.replayed).toBe(true)
    expect(await getOwnKrs(context, '2026-2027-1')).toMatchObject({ id: first.record.id, version: 1 })
  })

  it('rejects schedule conflicts and unmet prerequisites before persisting', async () => {
    await expect(draft(studentContext(), ['class-mgt-501-a', 'class-mgt-504-a'], 'draft-conflict-0001'))
      .rejects.toMatchObject({ code: 'SCHEDULE_CONFLICT' } satisfies Partial<CampusError>)

    const student = krsModuleState().students.get('student-010')!
    krsModuleState().students.set(student.id, { ...student, completedCourseCodes: [] })
    await expect(draft(studentContext(), ['class-mgt-501-a'], 'draft-prerequisite-0001'))
      .rejects.toMatchObject({ code: 'PREREQUISITE_NOT_MET' } satisfies Partial<CampusError>)
    expect(mockState().krs.size).toBe(2)
  })

  it('enforces the authoritative credit limit and active holds', async () => {
    const student = krsModuleState().students.get('student-010')!
    krsModuleState().students.set(student.id, { ...student, maximumCredits: 3 })
    await expect(draft(studentContext(), ['class-mgt-501-a', 'class-mgt-502-a'], 'draft-credit-limit-0001'))
      .rejects.toMatchObject({ code: 'CREDIT_LIMIT_EXCEEDED' } satisfies Partial<CampusError>)

    krsModuleState().students.set(student.id, {
      ...student,
      holds: [{ id: 'invoice-overdue-1', type: 'FINANCE', reason: 'Tunggakan aktif', active: true }],
    })
    const saved = await draft(studentContext(), ['class-mgt-501-a'], 'draft-held-00000001')
    await expect(submitKrs(studentContext(), saved.record.id, { expectedVersion: saved.record.version }, 'submit-held-000001', undefined, clock))
      .rejects.toMatchObject({ code: 'KRS_HELD' } satisfies Partial<CampusError>)
  })

  it('atomically reserves seats and records the authoritative eligibility snapshot', async () => {
    const context = studentContext()
    const saved = await draft(context)
    const result = await submitKrs(context, saved.record.id, { expectedVersion: 1 }, 'submit-idempotency-0001', undefined, clock)
    expect(result.record).toMatchObject({ status: 'SUBMITTED', seatsReserved: true, eligibilityVersion: 3, version: 2 })
    expect(krsModuleState().classes.get('class-mgt-501-a')?.reservedSeatCount).toBe(1)
    expect(krsModuleState().reservations.size).toBe(2)
    expect(mockState().auditEntries.some(entry => entry.action === 'KRS_SUBMITTED')).toBe(true)

    const replay = await submitKrs(context, saved.record.id, { expectedVersion: 1 }, 'submit-idempotency-0001', undefined, clock)
    expect(replay.replayed).toBe(true)
    expect(krsModuleState().classes.get('class-mgt-501-a')?.reservedSeatCount).toBe(1)
  })

  it('allows only one of two concurrent submissions to claim the last seat', async () => {
    const first = studentContext('student-010')
    const original = krsModuleState().students.get('student-010')!
    krsModuleState().students.set('student-011', {
      ...structuredClone(original), id: 'student-011', studentUid: 'student-011', studentNumber: '23011011', studentName: 'Mahasiswa Kedua',
    })
    const classRecord = krsModuleState().classes.get('class-mgt-503-a')!
    krsModuleState().classes.set(classRecord.id, { ...classRecord, capacity: 1, reservedSeatCount: 0 })
    const second = studentContext('student-011')
    const [firstDraft, secondDraft] = await Promise.all([
      draft(first, ['class-mgt-503-a'], 'draft-last-seat-0001'),
      draft(second, ['class-mgt-503-a'], 'draft-last-seat-0002'),
    ])
    const results = await Promise.allSettled([
      submitKrs(first, firstDraft.record.id, { expectedVersion: 1 }, 'submit-last-seat-001', undefined, clock),
      submitKrs(second, secondDraft.record.id, { expectedVersion: 1 }, 'submit-last-seat-002', undefined, clock),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ code: 'CLASS_FULL' })
    expect(krsModuleState().classes.get('class-mgt-503-a')?.reservedSeatCount).toBe(1)
  })

  it('releases reservations on advisor rejection', async () => {
    const saved = await draft()
    const submitted = await submitKrs(studentContext(), saved.record.id, { expectedVersion: 1 }, 'submit-before-reject-01', undefined, clock)
    const result = await reviewKrs(submitted.record.id, authContext('advisor-001', ['advisor']), {
      decision: 'REJECT', notes: 'Perbaiki beban studi.', expectedVersion: 2,
    })
    expect(result.record).toMatchObject({ status: 'REJECTED', seatsReserved: false })
    expect(krsModuleState().reservations.size).toBe(0)
    expect(krsModuleState().classes.get('class-mgt-501-a')?.reservedSeatCount).toBe(0)
  })

  it('turns approved reservations into roster enrollment without double counting', async () => {
    const saved = await draft(studentContext(), ['class-mgt-501-a'], 'draft-before-approve-01')
    const submitted = await submitKrs(studentContext(), saved.record.id, { expectedVersion: 1 }, 'submit-before-approve-1', undefined, clock)
    const result = await reviewKrs(submitted.record.id, authContext('advisor-001', ['advisor']), {
      decision: 'APPROVE', expectedVersion: 2,
    })
    expect(result.record.status).toBe('APPROVED')
    expect(krsModuleState().classes.get('class-mgt-501-a')?.rosterStudentIds).toContain('student-010')
    expect(krsModuleState().classes.get('class-mgt-501-a')?.reservedSeatCount).toBe(1)
    expect([...krsModuleState().reservations.values()][0]?.status).toBe('ENROLLED')
  })

  it('fails closed when a non-student tries to change a draft', async () => {
    await expect(draft(authContext('staff-001', ['academic_staff']), ['class-mgt-501-a'], 'draft-staff-denied-01'))
      .rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' } satisfies Partial<CampusError>)
  })
})
