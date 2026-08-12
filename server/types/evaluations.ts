export const EVALUATION_QUESTION_TYPES = ['LIKERT_1_5', 'BOOLEAN', 'TEXT'] as const
export type EvaluationQuestionType = (typeof EVALUATION_QUESTION_TYPES)[number]

export interface EvaluationQuestionDefinition {
  id: string
  label: string
  type: EvaluationQuestionType
  required: boolean
  helpText?: string
}

export interface EvaluationFormRecord {
  id: string
  name: string
  description?: string
  programStudyId: string
  currentVersion: number
  nextVersion: number
  version: number
  status: 'ACTIVE' | 'ARCHIVED'
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface EvaluationFormVersion {
  id: string
  formId: string
  version: number
  name: string
  description?: string
  programStudyId: string
  questions: EvaluationQuestionDefinition[]
  createdAt: string
  createdBy: string
}

export interface EvaluationPeriodRecord {
  id: string
  name: string
  academicPeriodId: string
  programStudyId: string
  formId: string
  formVersion: number
  opensAt: string
  closesAt: string
  minimumResponses: number
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface EvaluationEnrollment {
  id: string
  /** Canonical classEnrollments document ID; id may identify one lecturer target. */
  sourceEnrollmentId?: string
  studentUid: string
  studentId: string
  lecturerId: string
  lecturerName: string
  courseId: string
  courseCode: string
  courseName: string
  classId: string
  className: string
  programStudyId: string
  academicPeriodId: string
  status: 'ENROLLED' | 'DROPPED'
}

export type EvaluationAnswerValue = number | boolean | string

export interface EvaluationAnswer {
  questionId: string
  value: EvaluationAnswerValue
}

/** Stored separately from respondent identity and safe to aggregate. */
export interface AnonymousEvaluationResponse {
  id: string
  evaluationPeriodId: string
  academicPeriodId: string
  formId: string
  formVersion: number
  lecturerId: string
  lecturerName: string
  courseId: string
  courseCode: string
  courseName: string
  classId: string
  className: string
  programStudyId: string
  answers: EvaluationAnswer[]
  submittedAt: string
}

/** Confidential lookup used only for duplicate prevention, never reporting. */
export interface EvaluationRespondentIdentity {
  id: string
  evaluationPeriodId: string
  enrollmentId: string
  studentUid: string
  responseId: string
  submittedAt: string
}

export interface EvaluationAssignment {
  id: string
  evaluationPeriodId: string
  periodName: string
  closesAt: string
  enrollmentId: string
  lecturerId: string
  lecturerName: string
  courseId: string
  courseCode: string
  courseName: string
  classId: string
  className: string
  programStudyId: string
  completed: boolean
  questions: EvaluationQuestionDefinition[]
}

export interface EvaluationSubmissionReceipt {
  receiptId: string
  evaluationPeriodId: string
  submittedAt: string
  replayed: boolean
  auditId?: string
}

export type EvaluationReportGroupBy = 'lecturer' | 'course' | 'class' | 'program'

export interface EvaluationQuestionStatistic {
  questionId: string
  label: string
  type: EvaluationQuestionType
  answeredCount: number
  mean?: number
  median?: number
  minimum?: number
  maximum?: number
  favorablePercent?: number
  truePercent?: number
  distribution?: Record<string, number>
}

export interface EvaluationReportGroup {
  key: string
  label: string
  lecturerId?: string
  lecturerName?: string
  courseId?: string
  courseCode?: string
  courseName?: string
  classId?: string
  className?: string
  programStudyId: string
  suppressed: boolean
  responseCount: number | null
  minimumResponses: number
  overallMean?: number
  questions: EvaluationQuestionStatistic[]
}

export interface EvaluationReport {
  evaluationPeriod: {
    id: string
    name: string
    academicPeriodId: string
    programStudyId: string
    minimumResponses: number
    opensAt: string
    closesAt: string
  }
  groupBy: EvaluationReportGroupBy
  generatedAt: string
  groups: EvaluationReportGroup[]
  confidentiality: {
    respondentIdentityIncluded: false
    smallCohortsSuppressed: true
    freeTextExcluded: true
  }
}

export interface EvaluationReportFilters {
  evaluationPeriodId: string
  groupBy: EvaluationReportGroupBy
  programStudyId?: string
  lecturerId?: string
  courseId?: string
  classId?: string
}
