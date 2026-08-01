import { beforeEach, describe, expect, it } from 'vitest'
import {
  createAcademicCourseVersion,
  createAcademicCurriculumVersion,
  resetAcademicAdministrationStateForTests,
  upsertAcademicCalendarEvent,
  upsertAcademicPeriod,
  upsertAcademicProgram,
} from '../../server/services/academic-administration'
import { academicAdministrationState } from '../../server/services/academic-administration-state'
import { krsModuleState, resetKrsModuleState } from '../../server/services/krs-state'
import { authContext } from './fixtures'

const staff = (programs = ['management-s1']) => authContext('academic-001', ['academic_staff'], programs)

describe('academic master data management', () => {
  beforeEach(() => { process.env.CAMPUS_DATA_MODE = 'mock'; resetAcademicAdministrationStateForTests(); resetKrsModuleState() })

  it('updates a scoped program optimistically and idempotently', async () => {
    const input = { id: 'management-s1', facultyId: 'faculty-economics', code: 'MNJ', name: 'S1 Manajemen', level: 'S1', active: true, accreditationStatus: 'Unggul', accreditationExpiresAt: '2030-12-31', expectedVersion: 1 }
    const first = await upsertAcademicProgram(staff(), input, 'academic-program-0001')
    const replay = await upsertAcademicProgram(staff(), input, 'academic-program-0001')
    expect(first.value).toMatchObject({ version: 2, accreditationStatus: 'Unggul' })
    expect(replay).toMatchObject({ replayed: true, value: { version: 2 } })
    await expect(upsertAcademicProgram(staff(), input, 'academic-program-0002')).rejects.toMatchObject({ statusCode: 409, code: 'VERSION_CONFLICT' })
    await expect(upsertAcademicProgram(staff(['informatics-s1']), input, 'academic-program-0003')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('creates a validated academic period with explicit KRS dates', async () => {
    const result = await upsertAcademicPeriod(staff(), { id: '2026-2027-1', academicYear: '2026/2027', term: 'ODD', startsAt: '2026-09-01T00:00:00.000Z', endsAt: '2027-01-31T16:59:59.000Z', krsOpensAt: '2026-08-10T00:00:00.000Z', krsClosesAt: '2026-08-21T16:59:59.000Z', krsRevisionClosesAt: '2026-09-04T16:59:59.000Z', krsStatus: 'KRS_OPEN', active: true, expectedVersion: 0 }, 'academic-period-0001')
    expect(result.value).toMatchObject({ id: '2026-2027-1', version: 1, term: 'ODD', krsStatus: 'KRS_OPEN' })
    expect(krsModuleState().periods.get('2026-2027-1')).toMatchObject({ status: 'KRS_OPEN', revisionClosesAt: '2026-09-04T16:59:59.000Z', version: 1 })
    await expect(upsertAcademicPeriod(staff(), { id: 'bad-period', academicYear: '2026/2027', term: 'ODD', startsAt: '2027-01-01T00:00:00.000Z', endsAt: '2026-01-01T00:00:00.000Z', krsOpensAt: '2026-08-10T00:00:00.000Z', krsClosesAt: '2026-08-21T00:00:00.000Z', krsRevisionClosesAt: '2026-09-04T00:00:00.000Z', krsStatus: 'DRAFT', active: true, expectedVersion: 0 }, 'academic-period-0002')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('creates immutable course versions with prerequisites and equivalences', async () => {
    const input = { courseId: 'course-mgt401', code: 'MGT401', name: 'Manajemen Strategik Lanjutan', programStudyId: 'management-s1', credits: 3, semesterRecommendation: 7, prerequisiteCourseCodes: ['MGT301'], equivalentCourseCodes: ['MGT400'], status: 'ACTIVE', expectedCurrentVersion: 1 }
    const result = await createAcademicCourseVersion(staff(), input, 'academic-course-0001')
    expect(result.value).toMatchObject({ id: 'course-mgt401_v2', version: 2, immutable: true, prerequisiteCourseCodes: ['MGT301'] })
    expect(academicAdministrationState().courses.get('course-mgt401_v1')?.name).toBe('Manajemen Strategik')
    expect((await createAcademicCourseVersion(staff(), input, 'academic-course-0001')).replayed).toBe(true)
  })

  it('derives curriculum credits from immutable course versions', async () => {
    const result = await createAcademicCurriculumVersion(staff(), { curriculumId: 'curriculum-mgt-2027', programStudyId: 'management-s1', name: 'Kurikulum Manajemen 2027', effectiveCohortFrom: 2027, effectiveCohortTo: 2030, courseVersionIds: ['course-mgt401_v1'], status: 'DRAFT', expectedCurrentVersion: 0 }, 'academic-curriculum-0001')
    expect(result.value).toMatchObject({ version: 1, totalCredits: 3, immutable: true })
    await expect(createAcademicCurriculumVersion(staff(), { curriculumId: 'curriculum-bad', programStudyId: 'management-s1', name: 'Kurikulum Tidak Valid', effectiveCohortFrom: 2027, effectiveCohortTo: 2030, courseVersionIds: ['missing-course'], status: 'DRAFT', expectedCurrentVersion: 0 }, 'academic-curriculum-0002')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('creates scoped calendar deadlines and rejects student writes', async () => {
    const input = { id: 'calendar-krs-2027', periodId: '2026-2027-1', programStudyIds: ['management-s1'], title: 'Batas pengisian KRS', category: 'KRS', startsAt: '2026-08-21T09:00:00.000Z', endsAt: '2026-08-21T16:59:59.000Z', description: 'KRS ditutup sesuai kalender akademik.', expectedVersion: 0 }
    expect((await upsertAcademicCalendarEvent(staff(), input, 'academic-calendar-0001')).value).toMatchObject({ version: 1, category: 'KRS' })
    await expect(upsertAcademicCalendarEvent(authContext('student-001', ['student']), input, 'academic-calendar-0002')).rejects.toMatchObject({ statusCode: 403 })
  })
})
