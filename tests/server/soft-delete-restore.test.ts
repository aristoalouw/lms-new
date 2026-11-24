import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteAcademicClass,
  listAcademicClasses,
  resetAcademicClassStateForTests,
  restoreAcademicClass,
} from '../../server/services/academic-classes'
import {
  createAcademicCourseVersion,
  deleteAcademicMaster,
  listLmsAcademicCatalog,
  restoreAcademicMaster,
  upsertAcademicPeriod,
  upsertAcademicProgram,
} from '../../server/services/academic-administration'
import { resetAcademicAdministrationStateForTests } from '../../server/services/academic-administration-state'
import {
  createEvaluationForm,
  createEvaluationPeriod,
  deleteEvaluationForm,
  deleteEvaluationPeriod,
  listEvaluationForms,
  listEvaluationPeriods,
  restoreEvaluationForm,
  restoreEvaluationPeriod,
} from '../../server/services/evaluations'
import { resetEvaluationMockState } from '../../server/services/evaluations-mock'
import { listLearningSpaces } from '../../server/services/learning'
import { resetLearningMockState } from '../../server/services/learning-mock'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

describe('soft-delete and restore across classes, evaluations, and academic master data', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.APP_FEATURE_PROFILE = 'full-campus'
    resetMockState()
    resetAcademicClassStateForTests()
    resetAcademicAdministrationStateForTests()
    resetEvaluationMockState()
    resetLearningMockState()
  })

  it('soft-deletes and restores an academic class without losing it', async () => {
    const staff = authContext('staff-001', ['academic_staff', 'administrator'], [])
    const before = await listAcademicClasses(staff)
    const target = before[0]!
    expect(target).toBeDefined()

    const deleted = await deleteAcademicClass(staff, target.id, { expectedVersion: target.version ?? 1 })
    expect(deleted.classRecord.deletedAt).toBeTruthy()
    expect(deleted.classRecord.status).toBe('CLOSED')

    const visibleDefault = await listAcademicClasses(staff)
    expect(visibleDefault.some(item => item.id === target.id)).toBe(false)
    const spacesWhileDeleted = await listLearningSpaces(staff)
    expect(spacesWhileDeleted.some(space => space.id === target.id)).toBe(false)

    const visibleWithTrash = await listAcademicClasses(staff, { includeDeleted: true })
    expect(visibleWithTrash.some(item => item.id === target.id && Boolean(item.deletedAt))).toBe(true)

    const restored = await restoreAcademicClass(staff, target.id, { expectedVersion: deleted.classRecord.version })
    expect(restored.classRecord.deletedAt).toBeUndefined()
    expect(restored.classRecord.status).toBe(target.status)

    const visibleAfterRestore = await listAcademicClasses(staff)
    expect(visibleAfterRestore.some(item => item.id === target.id)).toBe(true)
    const spacesAfterRestore = await listLearningSpaces(staff)
    expect(spacesAfterRestore.some(space => space.id === target.id)).toBe(true)
  })

  it('soft-deletes and restores evaluation forms and periods', async () => {
    const staff = authContext('staff-001', ['academic_staff', 'administrator'], ['management-s1'])
    const createdForm = await createEvaluationForm(staff, {
      name: 'Survei Mutu Uji',
      programStudyId: 'management-s1',
      questions: [{ id: 'q1', label: 'Materi jelas dan terstruktur.', type: 'LIKERT_1_5', required: true }],
    }, 'eval-form-trash-test-0001')

    const createdPeriod = await createEvaluationPeriod(staff, {
      name: 'Periode Uji',
      academicPeriodId: '2026-2027-1',
      programStudyId: 'management-s1',
      formId: createdForm.form.id,
      formVersion: createdForm.form.currentVersion,
      opensAt: '2026-07-01T00:00:00.000Z',
      closesAt: '2026-08-01T00:00:00.000Z',
      minimumResponses: 5,
    }, 'eval-period-trash-test-0001')

    const deletedPeriod = await deleteEvaluationPeriod(staff, createdPeriod.period.id, createdPeriod.period.version)
    expect(deletedPeriod.period.deletedAt).toBeTruthy()
    expect((await listEvaluationPeriods(staff, 'management-s1')).some(p => p.id === createdPeriod.period.id)).toBe(false)
    expect((await listEvaluationPeriods(staff, 'management-s1', true)).some(p => p.id === createdPeriod.period.id && Boolean(p.deletedAt))).toBe(true)

    const restoredPeriod = await restoreEvaluationPeriod(staff, createdPeriod.period.id, deletedPeriod.period.version)
    expect(restoredPeriod.period.deletedAt).toBeUndefined()
    expect((await listEvaluationPeriods(staff, 'management-s1')).some(p => p.id === createdPeriod.period.id)).toBe(true)

    const deletedForm = await deleteEvaluationForm(staff, createdForm.form.id, createdForm.form.version)
    expect(deletedForm.form.deletedAt).toBeTruthy()
    expect((await listEvaluationForms(staff, 'management-s1')).some(f => f.id === createdForm.form.id)).toBe(false)

    const restoredForm = await restoreEvaluationForm(staff, createdForm.form.id, deletedForm.form.version)
    expect(restoredForm.form.deletedAt).toBeUndefined()
    expect(restoredForm.form.status).toBe('ACTIVE')
    expect((await listEvaluationForms(staff, 'management-s1')).some(f => f.id === createdForm.form.id)).toBe(true)
  })

  it('soft-deletes and restores academic master data (program, period, course)', async () => {
    const staff = authContext('staff-001', ['academic_staff', 'administrator'], [])
    await upsertAcademicProgram(staff, {
      id: 'teologi-uji',
      facultyId: 'stt-saint-paul',
      code: 'TEOUJI',
      name: 'Teologi Uji',
      level: 'S1',
      active: true,
      accreditationStatus: 'Baik Sekali',
      accreditationExpiresAt: '2030-12-31',
      expectedVersion: 0,
    }, 'master-prog-trash-0001')

    await upsertAcademicPeriod(staff, {
      id: '2027-2028-1',
      academicYear: '2027/2028',
      term: 'ODD',
      startsAt: '2027-08-01T00:00:00.000Z',
      endsAt: '2028-01-31T00:00:00.000Z',
      krsOpensAt: '2027-07-01T00:00:00.000Z',
      krsClosesAt: '2027-08-15T00:00:00.000Z',
      krsRevisionClosesAt: '2027-08-30T00:00:00.000Z',
      krsStatus: 'KRS_OPEN',
      active: true,
      expectedVersion: 0,
    }, 'master-period-trash-0001')

    await createAcademicCourseVersion(staff, {
      courseId: 'course-teo-uji',
      code: 'TEOUJI101',
      name: 'Pengantar Uji',
      programStudyId: 'teologi-uji',
      credits: 3,
      semesterRecommendation: 1,
      prerequisiteCourseCodes: [],
      equivalentCourseCodes: [],
      status: 'ACTIVE',
      expectedCurrentVersion: 0,
    }, 'master-course-trash-0001')

    await deleteAcademicMaster(staff, { resource: 'course', id: 'course-teo-uji' })
    let cat = await listLmsAcademicCatalog(staff, true)
    expect(cat.courses.some(c => c.courseId === 'course-teo-uji')).toBe(false)
    expect(cat.deleted?.courses.some(c => c.courseId === 'course-teo-uji')).toBe(true)

    await restoreAcademicMaster(staff, { resource: 'course', id: 'course-teo-uji' })
    cat = await listLmsAcademicCatalog(staff, true)
    expect(cat.courses.some(c => c.courseId === 'course-teo-uji')).toBe(true)

    await deleteAcademicMaster(staff, { resource: 'program', id: 'teologi-uji' })
    cat = await listLmsAcademicCatalog(staff, true)
    expect(cat.programs.some(p => p.id === 'teologi-uji')).toBe(false)
    expect(cat.deleted?.programs.some(p => p.id === 'teologi-uji')).toBe(true)

    await restoreAcademicMaster(staff, { resource: 'program', id: 'teologi-uji' })
    cat = await listLmsAcademicCatalog(staff, true)
    expect(cat.programs.some(p => p.id === 'teologi-uji')).toBe(true)

    await deleteAcademicMaster(staff, { resource: 'period', id: '2027-2028-1' })
    cat = await listLmsAcademicCatalog(staff, true)
    expect(cat.periods.some(p => p.id === '2027-2028-1')).toBe(false)

    await restoreAcademicMaster(staff, { resource: 'period', id: '2027-2028-1' })
    cat = await listLmsAcademicCatalog(staff, true)
    expect(cat.periods.some(p => p.id === '2027-2028-1')).toBe(true)
  })
})
