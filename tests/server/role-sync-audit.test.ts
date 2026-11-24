import { beforeEach, describe, expect, it } from 'vitest'
import {
  resetAcademicClassStateForTests,
} from '../../server/services/academic-classes'
import {
  createAcademicCourseVersion,
  deleteAcademicMaster,
  getAcademicAdministrationWorkspace,
  listLmsAcademicCatalog,
  upsertAcademicPeriod,
  upsertAcademicProgram,
} from '../../server/services/academic-administration'
import { resetAcademicAdministrationStateForTests } from '../../server/services/academic-administration-state'
import {
  createTariffPlanVersion,
  listTariffPlans,
  resetBillingStateForTests,
} from '../../server/services/billing'
import {
  listEvaluationPeriods,
} from '../../server/services/evaluations'
import { resetEvaluationMockState } from '../../server/services/evaluations-mock'
import { listGraduationApplications } from '../../server/services/graduation'
import { resetGraduationModuleState } from '../../server/services/graduation-state'
import { listKrsCatalog } from '../../server/services/krs-enrollment'
import { krsModuleState, resetKrsModuleState } from '../../server/services/krs-state'
import {
  listScholarshipPrograms,
  resetStudentAffairsStateForTests,
  saveScholarshipProgram,
} from '../../server/services/student-affairs'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

describe('audit regressions: catalog sync, campus-wide multi-role scope, and deletedAt exclusion', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.APP_FEATURE_PROFILE = 'full-campus'
    resetMockState()
    resetAcademicClassStateForTests()
    resetAcademicAdministrationStateForTests()
    resetBillingStateForTests()
    resetEvaluationMockState()
    resetGraduationModuleState()
    resetKrsModuleState()
    resetStudentAffairsStateForTests()
  })

  it('keeps Kelas & Enrolment catalog 1-to-1 synced with Master Data Akademik including inactive and trashed records', async () => {
    const campusAdminStaff = authContext('admin-001', ['administrator', 'academic_staff'], [])

    await upsertAcademicProgram(campusAdminStaff, {
      id: 'teologi-nonaktif',
      facultyId: 'stt-saint-paul',
      code: 'TEONON',
      name: 'Teologi Nonaktif',
      level: 'S1',
      active: false,
      accreditationStatus: 'Baik Sekali',
      accreditationExpiresAt: '2030-12-31',
      expectedVersion: 0,
    }, 'sync-prog-nonaktif-0001')

    await upsertAcademicPeriod(campusAdminStaff, {
      id: '2028-2029-1',
      academicYear: '2028/2029',
      term: 'ODD',
      startsAt: '2028-08-01T00:00:00.000Z',
      endsAt: '2029-01-31T23:59:59.000Z',
      krsOpensAt: '2028-07-01T00:00:00.000Z',
      krsClosesAt: '2028-08-15T23:59:59.000Z',
      krsRevisionClosesAt: '2028-08-31T23:59:59.000Z',
      krsStatus: 'KRS_OPEN',
      active: true,
      expectedVersion: 0,
    }, 'sync-period-0001')
    await deleteAcademicMaster(campusAdminStaff, { resource: 'period', id: '2028-2029-1' })

    await createAcademicCourseVersion(campusAdminStaff, {
      courseId: 'mk-uji-sync',
      code: 'UJI101',
      name: 'Mata Kuliah Uji Sync',
      programStudyId: 'teologi-nonaktif',
      credits: 3,
      semesterRecommendation: 1,
      prerequisiteCourseCodes: [],
      equivalentCourseCodes: [],
      status: 'DRAFT',
      expectedCurrentVersion: 0,
    }, 'sync-course-0001')

    const catalog = await listLmsAcademicCatalog(campusAdminStaff, true)
    expect(catalog.programs.some(item => item.id === 'teologi-nonaktif')).toBe(false)
    expect(catalog.allPrograms?.some(item => item.id === 'teologi-nonaktif' && !item.active)).toBe(true)
    expect(catalog.allCourses?.some(item => item.courseId === 'mk-uji-sync' && item.status === 'DRAFT')).toBe(true)
    expect(catalog.deleted?.periods.some(item => item.id === '2028-2029-1')).toBe(true)

    const masterWorkspace = await getAcademicAdministrationWorkspace(campusAdminStaff, undefined, { includeAll: true })
    expect(masterWorkspace.programs.some(item => item.id === 'teologi-nonaktif' && !item.active)).toBe(true)
    expect(masterWorkspace.periods.some(item => item.id === '2028-2029-1' && Boolean(item.deletedAt))).toBe(true)

    const defaultWorkspace = await getAcademicAdministrationWorkspace(campusAdminStaff)
    expect(defaultWorkspace.periods.some(item => item.id === '2028-2029-1')).toBe(false)
  })

  it('allows campus-wide multi-role staff (programStudyIds: []) across finance, student affairs, graduation, and evaluations while keeping pure administrator restricted', async () => {
    const campusFinance = authContext('admin-001', ['administrator', 'finance_staff'], [])
    const pureAdmin = authContext('admin-pure', ['administrator'], [])

    const tariff = await createTariffPlanVersion(campusFinance, {
      logicalId: 'ukt-campus-wide',
      name: 'UKT Kampus',
      status: 'ACTIVE',
      applicability: { programStudyIds: ['management-s1'], periodIds: ['2026-2027-1'], cohortYearFrom: 2024, cohortYearTo: 2028 },
      components: [{ id: 'ukt-main', code: 'UKT', label: 'Biaya Kuliah', kind: 'MANDATORY', unitAmountIdr: 3_000_000 }],
      expectedLatestVersion: 0,
    }, 'campus-tariff-0001')
    expect(tariff.value.logicalId).toBe('ukt-campus-wide')

    const listedTariffs = await listTariffPlans(campusFinance, { page: 1, pageSize: 20 })
    expect(listedTariffs.items.some(item => item.logicalId === 'ukt-campus-wide')).toBe(true)
    await expect(listTariffPlans(pureAdmin, { page: 1, pageSize: 20 })).rejects.toThrow()

    const campusStudentAffairs = authContext('admin-001', ['administrator', 'student_affairs_staff'], [])
    const scholarship = await saveScholarshipProgram(campusStudentAffairs, {
      name: 'Beasiswa Pelayan Kampus',
      description: 'Beasiswa untuk mahasiswa aktif berprestasi di semua program studi.',
      periodId: '2026-2027-1',
      programStudyIds: ['management-s1'],
      status: 'OPEN',
      applicationOpensAt: new Date(Date.now() + 60_000).toISOString(),
      applicationClosesAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      minGpa: 3.0,
      minCredits: 12,
      quota: 10,
      checklist: [{ id: 'active-check', label: 'Status mahasiswa aktif', kind: 'ACTIVE_STATUS' }],
      expectedVersion: 0,
    }, 'campus-scholarship-0001')
    expect(scholarship.value.name).toBe('Beasiswa Pelayan Kampus')

    const scholarships = await listScholarshipPrograms(campusStudentAffairs, { page: 1, pageSize: 20 })
    expect(scholarships.items.some(item => item.id === scholarship.value.id)).toBe(true)
    await expect(listScholarshipPrograms(pureAdmin, { page: 1, pageSize: 20 })).rejects.toThrow()

    const campusAcademic = authContext('admin-001', ['administrator', 'academic_staff'], [])
    const gradApps = await listGraduationApplications(campusAcademic, {})
    expect(Array.isArray(gradApps)).toBe(true)

    const evalPeriods = await listEvaluationPeriods(campusAcademic, 'management-s1')
    expect(Array.isArray(evalPeriods)).toBe(true)
  })

  it('excludes soft-deleted classes from KRS catalog', async () => {
    const student = authContext('student-010', ['student'], ['management-s1'])
    student.scope.studentIds = ['student-010']
    const period = [...krsModuleState().periods.values()][0]!
    const target = [...krsModuleState().classes.values()].find(item => item.periodId === period.id && item.programStudyId === 'management-s1')
    expect(target).toBeDefined()

    const beforeCatalog = await listKrsCatalog(student, period.id)
    expect(beforeCatalog.classes.some(entry => entry.classRecord.id === target!.id)).toBe(true)

    krsModuleState().classes.set(target!.id, { ...target!, deletedAt: new Date().toISOString(), deletedBy: 'admin-001' })

    const afterCatalog = await listKrsCatalog(student, period.id)
    expect(afterCatalog.classes.some(entry => entry.classRecord.id === target!.id)).toBe(false)
  })
})
