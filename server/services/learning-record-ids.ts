import { opaqueId } from '../utils/security'

export function learningSubmissionId(assignmentId: string, studentId: string): string {
  return opaqueId('learning_submission', `${assignmentId}:${studentId}`)
}

export function learningSubmissionAttemptId(submissionId: string, attemptNumber: number): string {
  return opaqueId('learning_attempt', `${submissionId}:${attemptNumber}`)
}

export function learningGradeId(assignmentId: string, studentId: string): string {
  return opaqueId('learning_grade', `${assignmentId}:${studentId}`)
}
