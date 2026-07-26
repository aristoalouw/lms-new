import type { LearningGrade, LearningSubmission } from '../../server/types/learning'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetAcademicClassStateForTests } from '../../server/services/academic-classes'
import { getLearningSpaceDetail } from '../../server/services/learning'
import { learningMockState, resetLearningMockState } from '../../server/services/learning-mock'
import {
  learningGradeId,
  learningSubmissionAttemptId,
  learningSubmissionId,
} from '../../server/services/learning-record-ids'
import {
  finalizeLearningSubmission,
  getOwnLearningAssignmentHistory,
  gradeLearningSubmission,
  saveLearningSubmissionDraft,
} from '../../server/services/learning-submissions'
import type { CampusError } from '../../server/utils/errors'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const spaceId = 'class-mgt-401-a'
const assignmentId = 'learning-assignment-case-analysis'
const openedAt = Date.parse('2026-07-22T03:00:00.000Z')
const lecturer = () => authContext('advisor-001', ['lecturer', 'advisor'], ['management-s1'])
const student = (id = 'student-001') => authContext(id, ['student'], ['management-s1'])

async function submit(
  studentId: string,
  expectedVersion: number,
  suffix: string,
  text: string,
) {
  const draft = await saveLearningSubmissionDraft(
    student(studentId),
    {
      assignmentId,
      expectedVersion,
      content: { format: 'PLAIN_TEXT', text },
      fileIds: [],
    },
    `attempt-history-draft-${suffix}`,
    undefined,
    openedAt,
  )
  return finalizeLearningSubmission(
    student(studentId),
    { assignmentId, expectedVersion: draft.submission.version },
    `attempt-history-final-${suffix}`,
    undefined,
    openedAt,
  )
}

describe('learner assignment attempt history', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState()
    resetAcademicClassStateForTests()
    resetLearningMockState()
  })

  it('returns immutable attempts and links a published grade to the exact graded attempt', async () => {
    const first = await submit('student-001', 0, '0001', 'Jawaban attempt pertama.')
    const second = await submit(
      'student-001',
      first.submission.version,
      '0002',
      'Jawaban attempt kedua.',
    )
    await gradeLearningSubmission(lecturer(), {
      attemptId: first.attempt.id,
      expectedVersion: 0,
      score: 91,
      feedback: { format: 'PLAIN_TEXT', text: 'Nilai merujuk snapshot pertama.' },
      status: 'PUBLISHED',
    })

    const history = await getOwnLearningAssignmentHistory(student(), assignmentId)
    expect(history.submission?.id).toBe(learningSubmissionId(assignmentId, 'student-001'))
    expect(history.attempts).toEqual([
      expect.objectContaining({
        id: learningSubmissionAttemptId(history.submission!.id, 1),
        attemptNumber: 1,
        content: { format: 'PLAIN_TEXT', text: 'Jawaban attempt pertama.' },
      }),
      expect.objectContaining({
        id: learningSubmissionAttemptId(history.submission!.id, 2),
        attemptNumber: 2,
        content: { format: 'PLAIN_TEXT', text: 'Jawaban attempt kedua.' },
      }),
    ])
    expect(history.publishedGrade).toMatchObject({
      id: learningGradeId(assignmentId, 'student-001'),
      attemptId: first.attempt.id,
      score: 91,
    })

    history.attempts[0]!.content = { format: 'PLAIN_TEXT', text: 'Mutasi lokal.' }
    const fresh = await getOwnLearningAssignmentHistory(student(), assignmentId)
    expect(fresh.attempts[0]?.content).toEqual({
      format: 'PLAIN_TEXT',
      text: 'Jawaban attempt pertama.',
    })
    expect(second.attempt.id).not.toBe(first.attempt.id)
  })

  it('never exposes another student submission or grade', async () => {
    const final = await submit('student-001', 0, '0003', 'Jawaban privat mahasiswa satu.')
    await gradeLearningSubmission(lecturer(), {
      attemptId: final.attempt.id,
      expectedVersion: 0,
      score: 85,
      feedback: { format: 'PLAIN_TEXT', text: 'Feedback privat mahasiswa satu.' },
      status: 'PUBLISHED',
    })

    const otherStudentHistory = await getOwnLearningAssignmentHistory(
      student('student-002'),
      assignmentId,
    )
    expect(otherStudentHistory).toEqual({ assignmentId, attempts: [] })
    expect(JSON.stringify(otherStudentHistory)).not.toContain('student-001')
    expect(JSON.stringify(otherStudentHistory)).not.toContain('Feedback privat')
    await expect(
      getOwnLearningAssignmentHistory(student('student-003'), assignmentId),
    ).rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)

    learningMockState().submissions.set(
      learningSubmissionId(assignmentId, 'student-002'),
      structuredClone(final.submission),
    )
    await expect(
      getOwnLearningAssignmentHistory(student('student-002'), assignmentId),
    ).rejects.toMatchObject({
      code: 'LEARNING_HISTORY_INTEGRITY',
    } satisfies Partial<CampusError>)
  })

  it('finds the learner record deterministically after more than 50 class records', async () => {
    const timestamp = new Date(openedAt).toISOString()
    for (let index = 0; index < 60; index += 1) {
      const fakeStudentId = `student-fake-${String(index).padStart(3, '0')}`
      const submissionId = learningSubmissionId(assignmentId, fakeStudentId)
      const submission: LearningSubmission = {
        id: submissionId,
        assignmentId,
        spaceId,
        studentId: fakeStudentId,
        studentUid: fakeStudentId,
        draftFiles: [],
        status: 'SUBMITTED',
        attemptCount: 1,
        latestAttemptId: learningSubmissionAttemptId(submissionId, 1),
        version: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const grade: LearningGrade = {
        id: learningGradeId(assignmentId, fakeStudentId),
        assignmentId,
        spaceId,
        studentId: fakeStudentId,
        attemptId: submission.latestAttemptId!,
        score: 70,
        feedback: { format: 'PLAIN_TEXT', text: 'Nilai data skala.' },
        status: 'PUBLISHED',
        version: 1,
        gradedAt: timestamp,
        gradedBy: 'advisor-001',
        updatedAt: timestamp,
      }
      learningMockState().submissions.set(submission.id, submission)
      learningMockState().grades.set(grade.id, grade)
    }

    const final = await submit('student-001', 0, '0004', 'Jawaban setelah 60 submission.')
    await gradeLearningSubmission(lecturer(), {
      attemptId: final.attempt.id,
      expectedVersion: 0,
      score: 94,
      feedback: { format: 'PLAIN_TEXT', text: 'Tetap ditemukan tanpa class scan.' },
      status: 'PUBLISHED',
    })

    const detail = await getLearningSpaceDetail(student(), spaceId)
    expect(detail.ownSubmissions).toEqual([
      expect.objectContaining({
        id: learningSubmissionId(assignmentId, 'student-001'),
        studentId: 'student-001',
      }),
    ])
    expect(detail.ownGrades).toEqual([
      expect.objectContaining({
        id: learningGradeId(assignmentId, 'student-001'),
        studentId: 'student-001',
        score: 94,
      }),
    ])
  })

  it('keeps draft grades private in detail and learner history', async () => {
    const final = await submit('student-001', 0, '0005', 'Jawaban dengan draf nilai.')
    await gradeLearningSubmission(lecturer(), {
      attemptId: final.attempt.id,
      expectedVersion: 0,
      score: 80,
      feedback: { format: 'PLAIN_TEXT', text: 'Belum diterbitkan.' },
      status: 'DRAFT',
    })

    expect((await getLearningSpaceDetail(student(), spaceId)).ownGrades).toEqual([])
    expect(
      (await getOwnLearningAssignmentHistory(student(), assignmentId)).publishedGrade,
    ).toBeUndefined()
  })
})
