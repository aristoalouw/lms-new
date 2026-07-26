import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  AcademicClassRecord,
  AttendanceRecord,
  ClassEnrollment,
} from '../types/academic-classes'
import type {
  LearningAssignment,
  LearningSubmission,
  LearningSubmissionAttempt,
} from '../types/learning'
import { appendAudit } from '../utils/audit'
import { conflict } from '../utils/errors'
import {
  getAcademicClassExportContext,
  listClassAttendancePage,
  listClassEnrollmentsForExportPage,
  type AcademicClassExportMode,
} from './academic-classes'
import { getLearningSpaceDetail } from './learning'
import {
  listLearningAssignmentSubmissionsPage,
  type LearningSubmissionReviewRow,
} from './learning-submissions'

const EXPORT_PAGE_SIZE = 50
const MAX_ENROLLMENT_ROWS = 500
const MAX_ATTENDANCE_ROWS = 5_000
const MAX_ASSIGNMENTS = 49
const MAX_SUBMISSION_ROWS = 5_000

const ADMIN_CSV_COLUMNS = [
  'record_type',
  'class_id',
  'course_code',
  'course_name',
  'section',
  'period_id',
  'program_study_id',
  'class_status',
  'capacity',
  'enrollment_count',
  'lecturer_names',
  'student_id',
  'student_number',
  'student_name',
  'enrollment_status',
  'enrollment_source',
  'enrollment_version',
] as const

const LECTURER_CSV_COLUMNS = [
  ...ADMIN_CSV_COLUMNS,
  'meeting_number',
  'attendance_status',
  'attendance_source',
  'attendance_at',
  'attendance_version',
  'assignment_id',
  'assignment_title',
  'final_attempt_count',
  'latest_attempt_number',
  'latest_submitted_at',
  'latest_timeliness',
  'assignment_version',
  'published_score',
  'published_grade_attempt_number',
  'published_grade_updated_at',
] as const

type CsvColumn = (typeof LECTURER_CSV_COLUMNS)[number]
type CsvValue = string | number | null | undefined
type CsvRecord = Partial<Record<CsvColumn, CsvValue>>

export interface LmsClassDataExport {
  content: string
  fileName: string
  mode: AcademicClassExportMode
  auditId: string
  counts: {
    enrollmentRows: number
    attendanceRows: number
    submissionRows: number
  }
}

function safeCsvCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  let text = String(value).replace(/\0/g, '')
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

function recordsToCsv(
  records: CsvRecord[],
  columns: readonly CsvColumn[],
): string {
  const rows: CsvValue[][] = [
    [...columns],
    ...records.map(record => columns.map(column => record[column])),
  ]
  return `\uFEFF${rows.map(row => row.map(safeCsvCell).join(',')).join('\r\n')}\r\n`
}

function limitExceeded(label: string, maximum: number): never {
  conflict(
    'CLASS_EXPORT_LIMIT_EXCEEDED',
    `Export ${label} melebihi batas aman ${maximum} baris. Persempit kelas atau hubungi administrator sistem.`,
    { maximum },
  )
}

async function collectEnrollments(
  context: AuthContext,
  classId: string,
): Promise<ClassEnrollment[]> {
  const records: ClassEnrollment[] = []
  let cursor: string | undefined
  do {
    const page = await listClassEnrollmentsForExportPage(context, classId, {
      cursor,
      limit: EXPORT_PAGE_SIZE,
    })
    records.push(...page.items)
    if (records.length > MAX_ENROLLMENT_ROWS) limitExceeded('enrolment', MAX_ENROLLMENT_ROWS)
    cursor = page.nextCursor
  } while (cursor)
  return records
}

async function collectAttendance(
  context: AuthContext,
  classId: string,
): Promise<AttendanceRecord[]> {
  const records: AttendanceRecord[] = []
  let cursor: string | undefined
  do {
    const page = await listClassAttendancePage(context, classId, {
      cursor,
      limit: EXPORT_PAGE_SIZE,
    })
    records.push(...page.items)
    if (records.length > MAX_ATTENDANCE_ROWS) limitExceeded('presensi', MAX_ATTENDANCE_ROWS)
    cursor = page.nextCursor
  } while (cursor)
  return records
}

async function collectAssignmentSubmissions(
  context: AuthContext,
  assignment: LearningAssignment,
  currentCount: number,
): Promise<LearningSubmissionReviewRow[]> {
  const records: LearningSubmissionReviewRow[] = []
  let cursor: string | undefined
  do {
    const page = await listLearningAssignmentSubmissionsPage(context, assignment.id, {
      cursor,
      limit: EXPORT_PAGE_SIZE,
    })
    records.push(...page.items)
    if (currentCount + records.length > MAX_SUBMISSION_ROWS) {
      limitExceeded('submission', MAX_SUBMISSION_ROWS)
    }
    cursor = page.nextCursor
  } while (cursor)
  return records
}

function classRecordRow(record: AcademicClassRecord): CsvRecord {
  return {
    record_type: 'CLASS',
    class_id: record.id,
    course_code: record.courseCode,
    course_name: record.courseName,
    section: record.section,
    period_id: record.periodId,
    program_study_id: record.programStudyId,
    class_status: record.status,
    capacity: record.capacity,
    enrollment_count: record.enrollmentCount,
    lecturer_names: record.lecturerNames.join(' | '),
  }
}

function enrollmentRow(record: ClassEnrollment): CsvRecord {
  return {
    record_type: 'ENROLLMENT',
    class_id: record.classId,
    period_id: record.periodId,
    program_study_id: record.programStudyId,
    student_id: record.studentId,
    student_number: record.studentNumber,
    student_name: record.studentName,
    enrollment_status: record.status,
    enrollment_source: record.source,
    enrollment_version: record.version,
  }
}

function attendanceRow(
  record: AttendanceRecord,
  enrollment: ClassEnrollment | undefined,
): CsvRecord {
  return {
    record_type: 'ATTENDANCE',
    class_id: record.classId,
    student_id: record.studentId,
    student_number: enrollment?.studentNumber,
    student_name: enrollment?.studentName,
    meeting_number: record.meetingNumber,
    attendance_status: record.status,
    attendance_source: record.source,
    attendance_at: record.checkedInAt ?? record.updatedAt,
    attendance_version: record.version,
  }
}

function submissionRow(
  assignment: LearningAssignment,
  submission: LearningSubmission,
  attempts: LearningSubmissionAttempt[],
  review: LearningSubmissionReviewRow,
  enrollment: ClassEnrollment | undefined,
): CsvRecord | undefined {
  if (!attempts.length) return undefined
  const latestAttempt = attempts.at(-1)!
  const publishedGrade = review.grade?.status === 'PUBLISHED' ? review.grade : undefined
  const gradedAttempt = publishedGrade
    ? attempts.find(attempt => attempt.id === publishedGrade.attemptId)
    : undefined
  return {
    record_type: 'SUBMISSION',
    class_id: assignment.spaceId,
    student_id: submission.studentId,
    student_number: enrollment?.studentNumber,
    student_name: enrollment?.studentName,
    assignment_id: assignment.id,
    assignment_title: assignment.title,
    final_attempt_count: attempts.length,
    latest_attempt_number: latestAttempt.attemptNumber,
    latest_submitted_at: latestAttempt.submittedAt,
    latest_timeliness: latestAttempt.timeliness,
    assignment_version: latestAttempt.assignmentVersion,
    published_score: publishedGrade?.score,
    published_grade_attempt_number: gradedAttempt?.attemptNumber,
    published_grade_updated_at: publishedGrade?.updatedAt,
  }
}

export async function exportLmsClassDataCsv(
  context: AuthContext,
  classId: string,
  event?: H3Event,
): Promise<LmsClassDataExport> {
  const access = await getAcademicClassExportContext(context, classId)
  const enrollments = await collectEnrollments(context, access.classRecord.id)
  const rows: CsvRecord[] = [
    classRecordRow(access.classRecord),
    ...enrollments.map(enrollmentRow),
  ]
  let attendanceRows = 0
  let submissionRows = 0
  let reviewedSubmissionRows = 0

  if (access.mode === 'LECTURER_OPERATIONS') {
    const [attendance, detail] = await Promise.all([
      collectAttendance(context, access.classRecord.id),
      getLearningSpaceDetail(context, access.classRecord.id),
    ])
    if (
      !detail.canManage
      || detail.space.academicClassId !== access.classRecord.id
    ) {
      conflict('CLASS_EXPORT_SCOPE_MISMATCH', 'Ruang pembelajaran tidak sesuai dengan kelas yang diekspor.')
    }
    if (detail.assignments.length > MAX_ASSIGNMENTS) {
      limitExceeded('tugas', MAX_ASSIGNMENTS)
    }
    const enrollmentByStudent = new Map(enrollments.map(record => [record.studentId, record]))
    rows.push(...attendance
      .sort((left, right) =>
        left.meetingNumber - right.meetingNumber
        || left.studentId.localeCompare(right.studentId, 'id'))
      .map(record => attendanceRow(
        record,
        enrollmentByStudent.get(record.studentId),
      )))
    attendanceRows = attendance.length

    for (const assignment of detail.assignments) {
      const reviews = await collectAssignmentSubmissions(
        context,
        assignment,
        reviewedSubmissionRows,
      )
      reviewedSubmissionRows += reviews.length
      for (const review of reviews) {
        const row = submissionRow(
          assignment,
          review.submission,
          review.attempts,
          review,
          enrollmentByStudent.get(review.submission.studentId),
        )
        if (row) {
          rows.push(row)
          submissionRows += 1
        }
      }
    }
  }

  const audit = await appendAudit({
    actor: context,
    action: 'LMS_CLASS_DATA_EXPORTED',
    resourceType: 'academic_class',
    resourceId: access.classRecord.id,
    metadata: {
      mode: access.mode,
      format: 'CSV',
      rosterRowCount: enrollments.length,
      presenceRowCount: attendanceRows,
      learningRowCount: submissionRows,
      bounded: true,
    },
    event,
  })
  const suffix = access.mode === 'ADMIN_METADATA' ? 'metadata' : 'operasional'
  return {
    content: recordsToCsv(
      rows,
      access.mode === 'ADMIN_METADATA' ? ADMIN_CSV_COLUMNS : LECTURER_CSV_COLUMNS,
    ),
    fileName: `kelas-${access.classRecord.courseCode}-${access.classRecord.section}-${suffix}.csv`,
    mode: access.mode,
    auditId: audit.id,
    counts: {
      enrollmentRows: enrollments.length,
      attendanceRows,
      submissionRows,
    },
  }
}
