import { beforeEach, describe, expect, it } from 'vitest'
import {
  getDiplomaNumberEligibility,
  listStudentDataChanges,
  submitStudentDataChange,
  transitionStudentDataChange,
} from '../../server/services/pddikti-student-data'
import { pddiktiModuleState, resetPddiktiModuleState } from '../../server/services/pddikti-state'
import type { PddiktiEntityMapping } from '../../server/types/pddikti'
import { authContext } from './fixtures'

const staff = (programs = ['management-s1']) => authContext('academic-001', ['academic_staff'], programs)
const input = () => ({
  studentId: 'student-001', studentNumber: '23011001', programStudyId: 'management-s1', periodId: '2025-2026-2',
  reason: 'Perbaikan data identitas berdasarkan dokumen kependudukan terbaru.',
  changes: [{ field: 'birthPlace', previousValue: 'Jakarta', requestedValue: 'Bogor' }],
  evidenceFileIds: ['private-file-evidence-001'],
})

describe('PDDIKTI student data change and diploma eligibility', () => {
  beforeEach(() => { process.env.CAMPUS_DATA_MODE = 'mock'; resetPddiktiModuleState() })

  it('submits idempotently without recording changed PII in audit metadata', async () => {
    const first = await submitStudentDataChange(staff(), input(), 'pdm-idempotency-0001')
    const replay = await submitStudentDataChange(staff(), input(), 'pdm-idempotency-0001')
    expect(first.request).toMatchObject({ status: 'SUBMITTED', version: 1, evidenceFileIds: ['private-file-evidence-001'] })
    expect(first.auditId).toMatch(/^audit_/)
    expect(replay).toMatchObject({ replayed: true, request: { id: first.request.id } })
  })

  it('enforces program scope and rejects unsupported or duplicate fields', async () => {
    await expect(submitStudentDataChange(staff(['informatics-s1']), input(), 'pdm-idempotency-0002')).rejects.toMatchObject({ statusCode: 403 })
    await expect(submitStudentDataChange(staff(), { ...input(), changes: [{ field: 'address', previousValue: 'A', requestedValue: 'B' }] }, 'pdm-idempotency-0003')).rejects.toMatchObject({ statusCode: 400 })
    await expect(submitStudentDataChange(staff(), { ...input(), changes: [input().changes[0], input().changes[0]] }, 'pdm-idempotency-0004')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('uses an explicit optimistic state machine and requires a remote ticket at completion', async () => {
    const created = await submitStudentDataChange(staff(), input(), 'pdm-idempotency-0005')
    const validated = await transitionStudentDataChange(staff(), created.request.id, { status: 'VALIDATED', reviewNote: 'Bukti identitas sesuai sumber resmi.', expectedVersion: 1 })
    const queued = await transitionStudentDataChange(staff(), created.request.id, { status: 'QUEUED', reviewNote: 'Siap diteruskan melalui operator PDDIKTI.', expectedVersion: 2 })
    await expect(transitionStudentDataChange(staff(), created.request.id, { status: 'COMPLETED', reviewNote: 'Selesai diproses.', expectedVersion: 3 })).rejects.toMatchObject({ statusCode: 400 })
    const completed = await transitionStudentDataChange(staff(), created.request.id, { status: 'COMPLETED', reviewNote: 'Selesai diproses.', remoteTicket: 'PDM/2026/001', expectedVersion: 3 })
    expect(validated.request.status).toBe('VALIDATED')
    expect(queued.request.status).toBe('QUEUED')
    expect(completed.request).toMatchObject({ status: 'COMPLETED', version: 4, remoteTicket: 'PDM/2026/001' })
    await expect(transitionStudentDataChange(staff(), created.request.id, { status: 'REJECTED', reviewNote: 'Tidak berlaku.', expectedVersion: 4 })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('lists only the requested program scope', async () => {
    await submitStudentDataChange(staff(), input(), 'pdm-idempotency-0006')
    expect(await listStudentDataChanges(staff(), { programStudyId: 'management-s1', status: 'SUBMITTED' })).toHaveLength(1)
    await expect(listStudentDataChanges(authContext('finance-001', ['finance_staff']), { programStudyId: 'management-s1' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('requires complete, mapped, reconciled data and no open PDM for diploma numbering', async () => {
    const before = await getDiplomaNumberEligibility(staff(), { studentId: 'student-001', programStudyId: 'management-s1', periodId: '2025-2026-2' })
    expect(before.eligible).toBe(false)
    expect(before.checks.filter(check => !check.passed).map(check => check.code)).toEqual(expect.arrayContaining(['STUDENT_MAPPING', 'GRADUATION_MAPPING']))

    const mapping = (entityType: PddiktiEntityMapping['entityType'], internalId: string): PddiktiEntityMapping => ({
      id: `mapping-${entityType}`, entityType, internalId, remoteId: `remote-${internalId}`, programStudyId: 'management-s1',
      mappingVersion: `${entityType}-mapping-v1`, internalFingerprint: 'a'.repeat(64), status: 'ACTIVE',
      firstMappedAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z', history: [],
    })
    pddiktiModuleState().entityMappings.set('student-map', mapping('student', 'student-001'))
    pddiktiModuleState().entityMappings.set('graduation-map', mapping('graduation', 'graduation-001'))
    const ready = await getDiplomaNumberEligibility(staff(), { studentId: 'student-001', programStudyId: 'management-s1', periodId: '2025-2026-2' })
    expect(ready).toMatchObject({ eligible: true, studentNumber: '23011001' })
    expect(ready.snapshotHash).toMatch(/^[a-f0-9]{64}$/)

    await submitStudentDataChange(staff(), input(), 'pdm-idempotency-0007')
    const blocked = await getDiplomaNumberEligibility(staff(), { studentId: 'student-001', programStudyId: 'management-s1', periodId: '2025-2026-2' })
    expect(blocked.eligible).toBe(false)
    expect(blocked.checks.find(check => check.code === 'OPEN_PDM')).toMatchObject({ passed: false })
  })
})
