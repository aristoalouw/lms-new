import { beforeEach, describe, expect, it } from 'vitest'
import { resetAccountStateForTests } from '../../server/services/accounts'
import { academicAdministrationState, resetAcademicAdministrationStateForTests } from '../../server/services/academic-administration-state'
import { billingModuleState, resetBillingStateForTests } from '../../server/services/billing-state'
import { krsModuleState, resetKrsModuleState } from '../../server/services/krs-state'
import { getStudentOnboarding, onboardStudent } from '../../server/services/student-onboarding'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const staff = (programs = ['management-s1']) => authContext('academic-001', ['academic_staff'], programs)
const input = () => ({
  accountEmail: 'rafi.ramadhan@example.test',
  studentId: 'student-002',
  studentNumber: '23011002',
  programStudyId: 'management-s1',
  cohortYear: 2023,
  advisorEmail: 'budi.santoso@example.test',
  currentPeriodId: '2025-2026-2',
  curriculumVersionId: 'curriculum-mgt-2023_v1',
  status: 'ACTIVE',
  pathway: 'REGULAR',
  maximumCredits: 24,
  registeredCredits: 20,
  totalEarnedCredits: 0,
  cumulativeGpa: 0,
  completedCourseCodes: [],
  reason: 'Registrasi awal berdasarkan dokumen akademik tervalidasi.',
  expectedVersion: 0,
})

describe('canonical student onboarding', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState(); resetAccountStateForTests(); resetAcademicAdministrationStateForTests(); resetKrsModuleState(); resetBillingStateForTests()
  })

  it('materializes academic, KRS, and billing projections idempotently', async () => {
    const first = await onboardStudent(staff(), input(), 'student-onboard-0001')
    const replay = await onboardStudent(staff(), input(), 'student-onboard-0001')

    expect(first).toMatchObject({ replayed: false, profile: { studentId: 'student-002', version: 1, advisorId: 'advisor-001' }, krsState: { active: true, maximumCredits: 24 }, billingProfile: { registeredCredits: 20 } })
    expect(replay).toMatchObject({ replayed: true, profile: { version: 1 } })
    expect(academicAdministrationState().profiles.get('student-002')?.studentUid).toBe('student-002')
    expect(krsModuleState().students.get('student-002')?.studentNumber).toBe('23011002')
    expect(billingModuleState().profiles.get('student-002')?.currentPeriodId).toBe('2025-2026-2')
    expect(await getStudentOnboarding(staff(), 'student-002')).toMatchObject({ profile: { version: 1 }, krsState: { version: 1 } })
  })

  it('updates with optimistic locking and preserves finance holds', async () => {
    const created = await onboardStudent(staff(), input(), 'student-onboard-0002')
    krsModuleState().students.set('student-002', { ...created.krsState, holds: [{ id: 'finance-current', type: 'FINANCE', reason: 'Tagihan belum lunas', active: true }] })
    const update = { ...input(), accountEmail: undefined, accountId: created.profile.studentUid, advisorEmail: undefined, advisorId: created.profile.advisorId, status: 'LEAVE', registeredCredits: 0, maximumCredits: 0, reason: 'Cuti akademik telah disetujui untuk periode berjalan.', expectedVersion: 1 }
    const result = await onboardStudent(staff(), update, 'student-onboard-0003')
    expect(result.profile).toMatchObject({ status: 'LEAVE', version: 2 })
    expect(result.krsState).toMatchObject({ active: false, maximumCredits: 0, holds: [expect.objectContaining({ id: 'finance-current' })] })
    expect(result.billingProfile.enrollmentStatus).toBe('LEAVE')
    await expect(onboardStudent(staff(), update, 'student-onboard-0004')).rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' })
  })

  it('exposes partial legacy projections so staff can repair them', async () => {
    academicAdministrationState().profiles.delete('student-001')
    const snapshot = await getStudentOnboarding(staff(), 'student-001')
    expect(snapshot).toMatchObject({ complete: false, billingProfile: { studentId: 'student-001' } })
    expect(snapshot.profile).toBeUndefined()
  })

  it('rejects cross-program staff, students, and mismatched account scope', async () => {
    await expect(onboardStudent(staff(['informatics-s1']), input(), 'student-onboard-0005')).rejects.toMatchObject({ statusCode: 403 })
    await expect(onboardStudent(authContext('student-001', ['student'], ['management-s1']), input(), 'student-onboard-0006')).rejects.toMatchObject({ statusCode: 403 })
    await expect(onboardStudent(authContext('admin-001', ['administrator'], []), input(), 'student-onboard-admin-denied')).rejects.toMatchObject({ statusCode: 403 })
    await expect(onboardStudent(staff(), { ...input(), studentId: 'student-wrong' }, 'student-onboard-0007')).rejects.toMatchObject({ statusCode: 409, code: 'STUDENT_SCOPE_MISMATCH' })
  })
})
