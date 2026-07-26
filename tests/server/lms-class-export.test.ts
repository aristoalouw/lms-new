import { beforeEach, describe, expect, it } from 'vitest'
import {
  correctAttendance,
  resetAcademicClassStateForTests,
  updateAcademicClass,
  upsertMockKrsClassEnrollment,
} from '../../server/services/academic-classes'
import { learningMockState, resetLearningMockState } from '../../server/services/learning-mock'
import {
  finalizeLearningSubmission,
  gradeLearningSubmission,
  saveLearningSubmissionDraft,
} from '../../server/services/learning-submissions'
import { exportLmsClassDataCsv } from '../../server/services/lms-class-export'
import type { CampusError } from '../../server/utils/errors'
import { mockState, resetMockState } from '../../server/utils/mock-store'
import { mvpApiDecision } from '../../shared/features'
import { authContext } from './fixtures'

const classId = 'class-mgt-401-a'
const assignmentId = 'learning-assignment-case-analysis'
const openedAt = Date.parse('2026-07-22T03:00:00.000Z')
const admin = () => authContext('admin-001', ['administrator'])
const lecturer = () => authContext('advisor-001', ['lecturer', 'advisor'], ['management-s1'])
const student = (id = 'student-001') => {
  const context = authContext(id, ['student'], ['management-s1'])
  context.scope.studentIds = [id]
  return context
}

async function finalAttempt(studentId: string, suffix: string, text: string) {
  const draft = await saveLearningSubmissionDraft(
    student(studentId),
    {
      assignmentId,
      expectedVersion: 0,
      content: { format: 'PLAIN_TEXT', text },
      fileIds: [],
    },
    `class-export-draft-${suffix}`,
    undefined,
    openedAt,
  )
  return finalizeLearningSubmission(
    student(studentId),
    { assignmentId, expectedVersion: draft.submission.version },
    `class-export-final-${suffix}`,
    undefined,
    openedAt,
  )
}

describe('privacy-safe LMS class export', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    resetMockState()
    resetAcademicClassStateForTests()
    resetLearningMockState()
  })

  it('exports only class and enrolment metadata for administrators', async () => {
    await updateAcademicClass(admin(), classId, {
      expectedVersion: 1,
      courseName: '=HYPERLINK("https://invalid.example")',
    }, 'class-export-update-0001')
    upsertMockKrsClassEnrollment({
      classId,
      studentId: 'student-001',
      studentUid: 'private-student@example.test',
      studentNumber: '23011001',
      studentName: '+cmd',
      programStudyId: 'management-s1',
      periodId: '2025-2026-2',
      sourceRef: 'Alasan-internal-yang-tidak-boleh-diekspor',
      actorId: 'admin-001',
      now: '2026-07-27T00:00:00.000Z',
    })

    const result = await exportLmsClassDataCsv(admin(), classId)
    expect(result).toMatchObject({
      mode: 'ADMIN_METADATA',
      counts: { enrollmentRows: 2, attendanceRows: 0, submissionRows: 0 },
    })
    expect(result.content.startsWith('\uFEFF')).toBe(true)
    expect(result.content).toContain('"CLASS"')
    expect(result.content).toContain('"ENROLLMENT"')
    expect(result.content).toContain('"\'=HYPERLINK(""https://invalid.example"")"')
    expect(result.content).toContain(`"'+cmd"`)
    expect(result.content).not.toContain('attendance_status')
    expect(result.content).not.toContain('assignment_id')
    expect(result.content).not.toContain('published_score')
    expect(result.content).not.toContain('private-student@example.test')
    expect(result.content).not.toContain('Alasan-internal')
    expect(mockState().auditEntries[0]).toMatchObject({
      action: 'LMS_CLASS_DATA_EXPORTED',
      resource: { type: 'academic_class', id: classId },
      metadata: { mode: 'ADMIN_METADATA', format: 'CSV', bounded: true },
    })
  })

  it('gives assigned lecturers operational metadata without private learning content', async () => {
    upsertMockKrsClassEnrollment({
      classId,
      studentId: 'student-001',
      studentUid: 'private-student@example.test',
      studentNumber: '23011001',
      studentName: 'Nabila Putri',
      programStudyId: 'management-s1',
      periodId: '2025-2026-2',
      sourceRef: 'private-enrollment-source',
      actorId: 'admin-001',
      now: '2026-07-27T00:00:00.000Z',
    })
    await correctAttendance(lecturer(), classId, {
      meetingNumber: 1,
      studentId: 'student-001',
      status: 'EXCUSED',
      reason: 'Surat medis rahasia telah diverifikasi oleh dosen.',
      expectedVersion: 0,
    }, 'class-export-attendance-0001')

    const assignment = learningMockState().assignments.get(assignmentId)!
    assignment.title = '@SUM(1+1)'
    const published = await finalAttempt(
      'student-001',
      '0001',
      'Isi submission sangat rahasia dan tidak boleh masuk CSV.',
    )
    const storedAttempt = learningMockState().submissionAttempts.get(published.attempt.id)!
    storedAttempt.files = [{
      fileId: 'private-file-001',
      fileVersion: 1,
      fileName: 'C:\\private\\submission-secret.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_024,
    }]
    await gradeLearningSubmission(lecturer(), {
      attemptId: published.attempt.id,
      expectedVersion: 0,
      score: 88.5,
      feedback: { format: 'PLAIN_TEXT', text: 'Feedback rahasia untuk mahasiswa satu.' },
      status: 'PUBLISHED',
    })

    const draftGrade = await finalAttempt(
      'student-002',
      '0002',
      'Isi submission mahasiswa dua juga rahasia.',
    )
    await gradeLearningSubmission(lecturer(), {
      attemptId: draftGrade.attempt.id,
      expectedVersion: 0,
      score: 37.25,
      feedback: { format: 'PLAIN_TEXT', text: 'Draf feedback yang belum diterbitkan.' },
      status: 'DRAFT',
    })

    const result = await exportLmsClassDataCsv(lecturer(), classId)
    expect(result).toMatchObject({
      mode: 'LECTURER_OPERATIONS',
      counts: { enrollmentRows: 2, attendanceRows: 1, submissionRows: 2 },
    })
    expect(result.content).toContain('"ATTENDANCE"')
    expect(result.content).toContain('"SUBMISSION"')
    expect(result.content).toContain('"\'@SUM(1+1)"')
    expect(result.content).toContain('88.5')
    expect(result.content).not.toContain('37.25')
    expect(result.content).not.toContain('Isi submission')
    expect(result.content).not.toContain('Feedback rahasia')
    expect(result.content).not.toContain('Draf feedback')
    expect(result.content).not.toContain('submission-secret.pdf')
    expect(result.content).not.toContain('private-student@example.test')
    expect(result.content).not.toContain('Surat medis rahasia')
    expect(mockState().auditEntries[0]).toMatchObject({
      action: 'LMS_CLASS_DATA_EXPORTED',
      metadata: { mode: 'LECTURER_OPERATIONS', format: 'CSV', bounded: true },
    })
  })

  it('denies students and unassigned lecturers and keeps admin precedence for dual-role accounts', async () => {
    await expect(exportLmsClassDataCsv(student(), classId))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
    await expect(exportLmsClassDataCsv(
      authContext('lecturer-999', ['lecturer'], ['management-s1']),
      classId,
    )).rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)

    const dualRole = authContext(
      'advisor-001',
      ['administrator', 'lecturer'],
      ['management-s1'],
    )
    const result = await exportLmsClassDataCsv(dualRole, classId)
    expect(result.mode).toBe('ADMIN_METADATA')
    expect(result.content).not.toContain('attendance_status')
    expect(result.content).not.toContain('assignment_id')
  })

  it('fails explicitly instead of truncating an export beyond its safe row bound', async () => {
    for (let index = 0; index < 499; index += 1) {
      const suffix = String(index).padStart(3, '0')
      upsertMockKrsClassEnrollment({
        classId,
        studentId: `export-bound-${suffix}`,
        studentUid: `export-bound-${suffix}`,
        studentNumber: `E${suffix}`,
        studentName: `Mahasiswa Export ${suffix}`,
        programStudyId: 'management-s1',
        periodId: '2025-2026-2',
        sourceRef: `export-bound-source-${suffix}`,
        actorId: 'admin-001',
        now: '2026-07-27T00:00:00.000Z',
      })
    }
    await expect(exportLmsClassDataCsv(admin(), classId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CLASS_EXPORT_LIMIT_EXCEEDED',
      details: { maximum: 500 },
    } satisfies Partial<CampusError>)
  })

  it('declares the generated CSV endpoint in the LMS MVP feature policy', () => {
    expect(mvpApiDecision(`/api/academic/classes/${classId}/export`, 'GET')).toBe('allowed')
  })
})
