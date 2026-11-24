import { beforeEach, describe, expect, it } from 'vitest'
import { createAcademicClass, resetAcademicClassStateForTests } from '../../server/services/academic-classes'
import {
  createAcademicCourseVersion,
  upsertAcademicPeriod,
} from '../../server/services/academic-administration'
import { resetAcademicAdministrationStateForTests } from '../../server/services/academic-administration-state'
import { resetAccountStateForTests } from '../../server/services/accounts'
import { resetBillingStateForTests } from '../../server/services/billing-state'
import { listKrsCatalog, saveKrsDraft } from '../../server/services/krs-enrollment'
import { krsModuleState, resetKrsModuleState } from '../../server/services/krs-state'
import { onboardStudent } from '../../server/services/student-onboarding'
import { deriveStudentSemester, evaluateKrsSemesterEligibility } from '../../server/utils/academic-semester'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const clock = new Date('2026-07-21T04:00:00.000Z')

describe('student semester tracking and KRS Ganjil/Genap rules', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.APP_FEATURE_PROFILE = 'full-campus'
    resetMockState()
    resetAccountStateForTests()
    resetAcademicAdministrationStateForTests()
    resetAcademicClassStateForTests()
    resetBillingStateForTests()
    resetKrsModuleState()
  })

  it('evaluates Ganjil/Genap parity and upper/lower semester tracks accurately', () => {
    expect(deriveStudentSemester(2023, '2026/2027', 'ODD')).toBe(7)
    expect(deriveStudentSemester(2023, '2026/2027', 'EVEN')).toBe(8)

    // ODD period, Semester 5 student
    expect(evaluateKrsSemesterEligibility({ studentSemester: 5, courseSemester: 5, periodTerm: 'ODD' })).toMatchObject({ eligible: true, track: 'CURRENT', courseParity: 'ODD' })
    expect(evaluateKrsSemesterEligibility({ studentSemester: 5, courseSemester: 3, periodTerm: 'ODD' })).toMatchObject({ eligible: true, track: 'LOWER', courseParity: 'ODD' })
    expect(evaluateKrsSemesterEligibility({ studentSemester: 5, courseSemester: 7, periodTerm: 'ODD' })).toMatchObject({ eligible: true, track: 'UPPER', courseParity: 'ODD' })
    expect(evaluateKrsSemesterEligibility({ studentSemester: 5, courseSemester: 4, periodTerm: 'ODD' })).toMatchObject({ eligible: false, code: 'SEMESTER_PARITY_MISMATCH', courseParity: 'EVEN' })

    // EVEN period, Semester 4 student
    expect(evaluateKrsSemesterEligibility({ studentSemester: 4, courseSemester: 4, periodTerm: 'EVEN' })).toMatchObject({ eligible: true, track: 'CURRENT', courseParity: 'EVEN' })
    expect(evaluateKrsSemesterEligibility({ studentSemester: 4, courseSemester: 2, periodTerm: 'EVEN' })).toMatchObject({ eligible: true, track: 'LOWER', courseParity: 'EVEN' })
    expect(evaluateKrsSemesterEligibility({ studentSemester: 4, courseSemester: 6, periodTerm: 'EVEN' })).toMatchObject({ eligible: true, track: 'UPPER', courseParity: 'EVEN' })
    expect(evaluateKrsSemesterEligibility({ studentSemester: 4, courseSemester: 3, periodTerm: 'EVEN' })).toMatchObject({ eligible: false, code: 'SEMESTER_PARITY_MISMATCH', courseParity: 'ODD' })

    // SHORT period, Semester 4 student
    expect(evaluateKrsSemesterEligibility({ studentSemester: 4, courseSemester: 3, periodTerm: 'SHORT' })).toMatchObject({ eligible: true, track: 'LOWER' })
    expect(evaluateKrsSemesterEligibility({ studentSemester: 4, courseSemester: 6, periodTerm: 'SHORT' })).toMatchObject({ eligible: false, code: 'SEMESTER_SHORT_UPPER_NOT_ALLOWED' })
  })

  it('persists currentSemester during student onboarding and propagates semesterRecommendation to classes', async () => {
    const staff = authContext('academic-001', ['administrator', 'academic_staff'], ['management-s1'])
    const onboarded = await onboardStudent(staff, {
      accountEmail: 'rafi.ramadhan@example.test',
      studentId: 'student-002',
      studentNumber: '23011002',
      programStudyId: 'management-s1',
      cohortYear: 2023,
      currentSemester: 6,
      advisorEmail: 'budi.santoso@example.test',
      currentPeriodId: '2025-2026-2',
      curriculumVersionId: 'curriculum-mgt-2023_v1',
      status: 'ACTIVE',
      pathway: 'REGULAR',
      maximumCredits: 24,
      registeredCredits: 18,
      totalEarnedCredits: 90,
      cumulativeGpa: 3.5,
      completedCourseCodes: [],
      reason: 'Penetapan semester berjalan mahasiswa aktif.',
      expectedVersion: 0,
    }, 'onboard-semester-0001')

    expect(onboarded.profile.currentSemester).toBe(6)
    expect(onboarded.krsState.currentSemester).toBe(6)

    await upsertAcademicPeriod(staff, {
      id: '2026-2027-1',
      academicYear: '2026/2027',
      term: 'ODD',
      startsAt: '2026-08-01T00:00:00.000Z',
      endsAt: '2027-01-31T23:59:59.000Z',
      krsOpensAt: '2026-07-01T00:00:00.000Z',
      krsClosesAt: '2026-08-15T23:59:59.000Z',
      krsRevisionClosesAt: '2026-08-31T23:59:59.000Z',
      krsStatus: 'KRS_OPEN',
      active: true,
      expectedVersion: 0,
    }, 'period-sem-test-0001')

    const course = await createAcademicCourseVersion(staff, {
      courseId: 'course-teo301',
      code: 'TEO301',
      name: 'Hermeneutika Dasar',
      programStudyId: 'management-s1',
      credits: 3,
      semesterRecommendation: 3,
      prerequisiteCourseCodes: [],
      equivalentCourseCodes: [],
      status: 'ACTIVE',
      expectedCurrentVersion: 0,
    }, 'course-sem-test-0001')

    const createdClass = await createAcademicClass(staff, {
      courseVersionId: course.value.id,
      section: 'A',
      periodId: '2026-2027-1',
      lecturerIds: ['advisor-001'],
      lecturerNames: ['Dr. Budi Santoso'],
      capacity: 40,
      firstMeetingStartsAt: '2026-08-24T02:00:00.000Z',
      meetingCount: 16,
      meetingDurationMinutes: 100,
    }, 'class-sem-test-0001')

    expect(createdClass.value.classRecord.semesterRecommendation).toBe(3)
  })

  it('allows current/lower/upper ODD classes in ODD period and blocks EVEN classes in KRS catalog and draft', async () => {
    const student = authContext('student-010', ['student'], ['management-s1'])
    student.scope.studentIds = ['student-010']

    // Add an EVEN (Semester 4) class into the ODD 2026-2027-1 period
    const template = krsModuleState().classes.get('class-mgt-502-a')!
    krsModuleState().classes.set('class-mgt-402-a', {
      ...structuredClone(template),
      id: 'class-mgt-402-a',
      courseCode: 'MGT402',
      courseName: 'Akuntansi Biaya (Genap)',
      semesterRecommendation: 4,
    })

    const catalog = await listKrsCatalog(student, '2026-2027-1')
    expect(catalog.student.currentSemester).toBe(5)
    expect(catalog.period.term).toBe('ODD')

    const currentEntry = catalog.classes.find(item => item.classRecord.id === 'class-mgt-501-a')
    const lowerEntry = catalog.classes.find(item => item.classRecord.id === 'class-mgt-503-a')
    const upperEntry = catalog.classes.find(item => item.classRecord.id === 'class-mgt-504-a')
    const evenEntry = catalog.classes.find(item => item.classRecord.id === 'class-mgt-402-a')

    expect(currentEntry).toMatchObject({ semesterTrack: 'CURRENT', eligibleBySemester: true, semesterParity: 'ODD' })
    expect(lowerEntry).toMatchObject({ semesterTrack: 'LOWER', eligibleBySemester: true, semesterParity: 'ODD' })
    expect(upperEntry).toMatchObject({ semesterTrack: 'UPPER', eligibleBySemester: true, semesterParity: 'ODD' })
    expect(evenEntry).toMatchObject({ semesterTrack: 'LOWER', eligibleBySemester: false, semesterParity: 'EVEN' })

    // Selecting current (Sem 5) + lower (Sem 3) succeeds in ODD period
    const okDraft = await saveKrsDraft(student, {
      periodId: '2026-2027-1',
      classIds: ['class-mgt-501-a', 'class-mgt-503-a'],
      expectedVersion: 0,
    }, 'krs-odd-ok-000001', undefined, clock)
    expect(okDraft.record.classIds).toEqual(['class-mgt-501-a', 'class-mgt-503-a'])

    // Selecting EVEN (Sem 4) class in ODD period is strictly rejected
    await expect(saveKrsDraft(student, {
      periodId: '2026-2027-1',
      classIds: ['class-mgt-402-a'],
      expectedVersion: 1,
    }, 'krs-even-blocked-01', undefined, clock)).rejects.toMatchObject({
      statusCode: 409,
      code: 'SEMESTER_PARITY_MISMATCH',
    })
  })
})
