import { beforeEach, describe, expect, it } from 'vitest'
import {
  createLmsCatalogCourseVersion,
  listLmsAcademicCatalog,
  resetAcademicAdministrationStateForTests,
  resolveLmsClassCatalogSelection,
  upsertLmsCatalogProgram,
  upsertLmsCatalogPeriod,
} from '../../server/services/academic-administration'
import { academicAdministrationState } from '../../server/services/academic-administration-state'
import { createAcademicClass, resetAcademicClassStateForTests, updateAcademicClass } from '../../server/services/academic-classes'
import { resetLearningMockState } from '../../server/services/learning-mock'
import { authContext } from './fixtures'

const administrator = () => authContext('admin-001', ['administrator'], [])
const academicStaff = () => authContext('academic-001', ['academic_staff'], ['management-s1'])
const lecturer = () => authContext('advisor-001', ['lecturer'], ['management-s1'])
const classSchedule = {
  section: 'C',
  lecturerIds: ['advisor-001'],
  lecturerNames: ['Dr. Budi Santoso'],
  capacity: 40,
  firstMeetingStartsAt: '2026-09-07T01:00:00.000Z',
  meetingCount: 16,
  meetingDurationMinutes: 100,
}

describe('LMS administrator academic catalog', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    resetAcademicAdministrationStateForTests()
    resetAcademicClassStateForTests()
    resetLearningMockState()
  })

  it('lists only active class-ready catalog records for administrators', async () => {
    const state = academicAdministrationState()
    const base = state.courses.get('course-mgt401_v1')!
    state.courses.set('course-mgt401_v2', {
      ...base,
      id: 'course-mgt401_v2',
      version: 2,
      status: 'DRAFT',
    })

    const catalog = await listLmsAcademicCatalog(administrator())
    expect(catalog.programs.map(item => item.id)).toEqual(['management-s1'])
    expect(catalog.periods.map(item => item.id)).toEqual(['2025-2026-2'])
    expect(catalog.courses.map(item => item.id)).toEqual(['course-mgt401_v1'])
    await expect(listLmsAcademicCatalog(lecturer())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('reuses versioned period and course writes behind the classes permission', async () => {
    const program = await upsertLmsCatalogProgram(administrator(), {
      id: 'informatics-s1',
      facultyId: 'faculty-engineering',
      code: 'IF',
      name: 'Informatika',
      level: 'S1',
      active: true,
      accreditationStatus: 'Baik Sekali',
      accreditationExpiresAt: '2030-12-31',
      expectedVersion: 0,
    }, 'lms-catalog-program-0001')
    const period = await upsertLmsCatalogPeriod(administrator(), {
      id: '2026-2027-1',
      academicYear: '2026/2027',
      term: 'ODD',
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: '2027-01-31T16:59:59.000Z',
      krsOpensAt: '2026-08-10T00:00:00.000Z',
      krsClosesAt: '2026-08-21T16:59:59.000Z',
      active: true,
      expectedVersion: 0,
    }, 'lms-catalog-period-0001')
    const course = await createLmsCatalogCourseVersion(administrator(), {
      courseId: 'course-mgt401',
      code: 'MGT401',
      name: 'Manajemen Strategik Versi LMS',
      programStudyId: 'management-s1',
      credits: 3,
      semesterRecommendation: 7,
      prerequisiteCourseCodes: ['MGT301'],
      equivalentCourseCodes: [],
      status: 'ACTIVE',
      expectedCurrentVersion: 1,
    }, 'lms-catalog-course-0001', undefined, new Date('2026-07-27T00:00:00.000Z'))

    expect(program.value).toMatchObject({ id: 'informatics-s1', active: true, version: 1 })
    expect(period.value).toMatchObject({ id: '2026-2027-1', active: true, version: 1 })
    expect(course.value).toMatchObject({ id: 'course-mgt401_v2', immutable: true, status: 'ACTIVE' })
    expect((await listLmsAcademicCatalog(administrator())).courses.map(item => item.id))
      .toEqual(['course-mgt401_v2', 'course-mgt401_v1'])
    await expect(upsertLmsCatalogPeriod(lecturer(), period.value, 'lms-catalog-period-0002'))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(upsertLmsCatalogProgram(lecturer(), {
      ...program.value,
      expectedVersion: program.value.version,
    }, 'lms-catalog-program-0002')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('derives the class snapshot from an active immutable course version and active period', async () => {
    const result = await createAcademicClass(administrator(), {
      courseVersionId: 'course-mgt401_v1',
      periodId: '2025-2026-2',
      ...classSchedule,
    }, 'lms-catalog-class-0001')

    expect(result.value.classRecord).toMatchObject({
      courseVersionId: 'course-mgt401_v1',
      courseCode: 'MGT401',
      courseName: 'Manajemen Strategik',
      credits: 3,
      programStudyId: 'management-s1',
      unitId: 'faculty-economics',
      periodId: '2025-2026-2',
    })
    expect(result.value.learningSpace).toMatchObject({
      academicClassId: result.value.classRecord.id,
      courseCode: 'MGT401',
      programStudyId: 'management-s1',
    })
  })

  it('rejects missing, inactive, or ambiguous LMS catalog selections', async () => {
    const state = academicAdministrationState()
    await expect(createAcademicClass(administrator(), {
      periodId: '2025-2026-2',
      ...classSchedule,
    }, 'lms-catalog-class-0002')).rejects.toMatchObject({ statusCode: 400 })

    await expect(resolveLmsClassCatalogSelection(administrator(), 'missing-course_v1', '2025-2026-2'))
      .rejects.toMatchObject({ statusCode: 404 })

    const period = state.periods.get('2025-2026-2')!
    state.periods.set(period.id, { ...period, active: false })
    await expect(resolveLmsClassCatalogSelection(administrator(), 'course-mgt401_v1', period.id))
      .rejects.toMatchObject({ code: 'ACADEMIC_PERIOD_NOT_ACTIVE' })

    state.periods.set(period.id, period)
    const course = state.courses.get('course-mgt401_v1')!
    state.courses.set(course.id, { ...course, status: 'DRAFT' })
    await expect(resolveLmsClassCatalogSelection(administrator(), course.id, period.id))
      .rejects.toMatchObject({ code: 'COURSE_VERSION_NOT_ACTIVE' })

    await expect(createAcademicClass(administrator(), {
      courseVersionId: course.id,
      courseCode: course.code,
      periodId: period.id,
      ...classSchedule,
    }, 'lms-catalog-class-0003')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('keeps catalog provenance immutable on LMS PATCH while allowing section updates', async () => {
    const created = await createAcademicClass(administrator(), {
      courseVersionId: 'course-mgt401_v1',
      periodId: '2025-2026-2',
      ...classSchedule,
    }, 'lms-catalog-class-0004')
    const classId = created.value.classRecord.id
    const protectedChanges = [
      ['courseCode', 'MGT999'],
      ['courseName', 'Nama bebas'],
      ['credits', 4],
      ['periodId', '2026-2027-1'],
      ['programStudyId', 'informatics-s1'],
      ['unitId', 'faculty-engineering'],
    ] as const

    for (const [index, [field, value]] of protectedChanges.entries()) {
      await expect(updateAcademicClass(administrator(), classId, {
        expectedVersion: 1,
        [field]: value,
      }, `lms-catalog-patch-${String(index).padStart(4, '0')}`)).rejects.toMatchObject({
        code: 'CLASS_CATALOG_PROVENANCE_IMMUTABLE',
      })
    }

    const sectionUpdate = await updateAcademicClass(administrator(), classId, {
      expectedVersion: 1,
      section: 'D',
    }, 'lms-catalog-section-0001')
    expect(sectionUpdate.value.classRecord).toMatchObject({
      courseVersionId: 'course-mgt401_v1',
      courseCode: 'MGT401',
      periodId: '2025-2026-2',
      section: 'D',
      version: 2,
    })
  })

  it('keeps the legacy full-campus class request compatible', async () => {
    process.env.APP_FEATURE_PROFILE = 'full-campus'
    const result = await createAcademicClass(academicStaff(), {
      courseCode: 'MGT499',
      courseName: 'Praktik Strategi',
      credits: 3,
      periodId: '2025-2026-2',
      programStudyId: 'management-s1',
      unitId: 'faculty-economics',
      ...classSchedule,
    }, 'full-campus-class-0001')

    expect(result.value.classRecord).toMatchObject({
      courseCode: 'MGT499',
      courseName: 'Praktik Strategi',
      periodId: '2025-2026-2',
    })
    expect(result.value.classRecord.courseVersionId).toBeUndefined()
  })
})
