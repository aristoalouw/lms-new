import type {
  AcademicCalendarEvent,
  AcademicCourseVersion,
  AcademicGradeRecord,
  AcademicPeriodDefinition,
  AcademicProgramStudy,
  AdvisingSession,
  CurriculumVersion,
  LeaveRequest,
  MbkmActivity,
  RpsHead,
  RpsVersion,
  StudentAcademicProfileRecord,
  ThesisRecord,
} from '../types/academic-administration'

interface IdempotencyEntry { requestHash: string; response: unknown; createdAt: string }

export interface AcademicAdministrationMockState {
  programs: Map<string, AcademicProgramStudy>
  periods: Map<string, AcademicPeriodDefinition>
  courses: Map<string, AcademicCourseVersion>
  curricula: Map<string, CurriculumVersion>
  profiles: Map<string, StudentAcademicProfileRecord>
  calendar: Map<string, AcademicCalendarEvent>
  leaveRequests: Map<string, LeaveRequest>
  advisingSessions: Map<string, AdvisingSession>
  rpsHeads: Map<string, RpsHead>
  rpsVersions: Map<string, RpsVersion>
  theses: Map<string, ThesisRecord>
  mbkmActivities: Map<string, MbkmActivity>
  grades: Map<string, AcademicGradeRecord>
  idempotency: Map<string, IdempotencyEntry>
}

const program: AcademicProgramStudy = { id: 'management-s1', facultyId: 'faculty-economics', code: 'MNJ', name: 'S1 Manajemen', level: 'S1', active: true, accreditationStatus: 'Baik Sekali', accreditationExpiresAt: '2027-03-31', version: 1 }
const period: AcademicPeriodDefinition = { id: '2025-2026-2', academicYear: '2025/2026', term: 'EVEN', startsAt: '2026-02-02T00:00:00.000Z', endsAt: '2026-08-31T16:59:59.000Z', krsOpensAt: '2026-01-12T00:00:00.000Z', krsClosesAt: '2026-01-23T16:59:59.000Z', krsRevisionClosesAt: '2026-01-30T16:59:59.000Z', krsStatus: 'KRS_CLOSED', active: true, version: 1 }
const course: AcademicCourseVersion = { id: 'course-mgt401_v1', courseId: 'course-mgt401', code: 'MGT401', name: 'Manajemen Strategik', programStudyId: program.id, version: 1, credits: 3, semesterRecommendation: 6, prerequisiteCourseCodes: ['MGT301'], equivalentCourseCodes: [], status: 'ACTIVE', createdAt: '2025-11-01T00:00:00.000Z', createdBy: 'academic-001', immutable: true }
const curriculum: CurriculumVersion = { id: 'curriculum-mgt-2023_v1', curriculumId: 'curriculum-mgt-2023', programStudyId: program.id, name: 'Kurikulum Manajemen 2023', version: 1, effectiveCohortFrom: 2023, effectiveCohortTo: 2026, courseVersionIds: [course.id], totalCredits: 144, status: 'ACTIVE', createdAt: '2025-11-01T00:00:00.000Z', createdBy: 'academic-001', immutable: true }
const profile: StudentAcademicProfileRecord = {
  studentId: 'student-001', studentUid: 'student-001', studentNumber: '23011001', studentName: 'Nabila Putri', programStudyId: program.id, facultyId: program.facultyId,
  cohortYear: 2023, currentSemester: 6, advisorId: 'advisor-001', currentPeriodId: period.id, status: 'ACTIVE', pathway: 'REGULAR', curriculumVersionId: curriculum.id,
  totalEarnedCredits: 78, cumulativeGpa: 3.62, version: 1,
  statusHistory: [{ id: 'status-student-001-active', status: 'ACTIVE', periodId: '2023-2024-1', reason: 'Registrasi mahasiswa baru.', effectiveAt: '2023-09-01T00:00:00.000Z', recordedBy: 'system:admissions' }],
  updatedAt: '2026-07-01T00:00:00.000Z',
}
const calendar: AcademicCalendarEvent[] = [
  { id: 'calendar-final-exam', periodId: period.id, programStudyIds: [program.id], title: 'Ujian akhir semester', category: 'EXAM', startsAt: '2026-07-27T01:00:00.000Z', endsAt: '2026-08-07T10:00:00.000Z', description: 'Jadwal rinci mengikuti kelas masing-masing.', version: 1, createdAt: '2026-01-05T00:00:00.000Z', createdBy: 'academic-001' },
  { id: 'calendar-grade-deadline', periodId: period.id, programStudyIds: [program.id], title: 'Batas publikasi nilai', category: 'DEADLINE', startsAt: '2026-08-14T09:00:00.000Z', endsAt: '2026-08-14T09:00:00.000Z', version: 1, createdAt: '2026-01-05T00:00:00.000Z', createdBy: 'academic-001' },
]
const grades: AcademicGradeRecord[] = [
  { id: 'grade-history-mgt301', studentId: profile.studentId, periodId: '2025-2026-1', courseCode: 'MGT301', courseName: 'Manajemen Operasi', credits: 3, numericScore: 86, letterGrade: 'A', gradePoint: 4, publicationId: 'publication-mgt301-v1', publishedAt: '2026-01-20T00:00:00.000Z', immutable: true },
  { id: 'grade-history-eco302', studentId: profile.studentId, periodId: '2025-2026-1', courseCode: 'ECO302', courseName: 'Ekonomi Manajerial', credits: 3, numericScore: 78, letterGrade: 'B+', gradePoint: 3.5, publicationId: 'publication-eco302-v1', publishedAt: '2026-01-20T00:00:00.000Z', immutable: true },
]

function clone<T>(value: T): T { return structuredClone(value) }

function initialState(): AcademicAdministrationMockState {
  return {
    programs: new Map([[program.id, clone(program)]]), periods: new Map([[period.id, clone(period)]]), courses: new Map([[course.id, clone(course)]]), curricula: new Map([[curriculum.id, clone(curriculum)]]),
    profiles: new Map([[profile.studentId, clone(profile)]]), calendar: new Map(calendar.map(item => [item.id, clone(item)])), grades: new Map(grades.map(item => [item.id, clone(item)])),
    leaveRequests: new Map(), advisingSessions: new Map(), rpsHeads: new Map(), rpsVersions: new Map(), theses: new Map(), mbkmActivities: new Map(), idempotency: new Map(),
  }
}

let state = initialState()

export function academicAdministrationState(): AcademicAdministrationMockState { return state }
export function resetAcademicAdministrationStateForTests(): void { state = initialState() }
