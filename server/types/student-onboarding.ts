import type { StudentAcademicProfileRecord } from './academic-administration'
import type { BillingStudentProfile } from './billing'
import type { KrsStudentAcademicState } from './krs-enrollment'

export interface StudentOnboardingRecord {
  profile: StudentAcademicProfileRecord
  krsState: KrsStudentAcademicState
  billingProfile: BillingStudentProfile
}

export interface StudentOnboardingSnapshot {
  profile?: StudentAcademicProfileRecord
  krsState?: KrsStudentAcademicState
  billingProfile?: BillingStudentProfile
  complete: boolean
}

export interface StudentOnboardingResult extends StudentOnboardingRecord {
  replayed: boolean
  auditId?: string
}

export interface BulkStudentOnboardingInput {
  sourceName: string
  format: 'csv' | 'tsv'
  content: string
}

export interface BulkStudentOnboardingRow {
  rowNumber: number
  email: string
  displayName: string
  studentId: string
  studentNumber: string
  programStudyId: string
  cohortYear: number
  currentSemester?: number
  advisorEmail: string
  currentPeriodId: string
  curriculumVersionId: string
  status: StudentAcademicProfileRecord['status']
  pathway: StudentAcademicProfileRecord['pathway']
  originInstitution?: string
  partnerInstitution?: string
  maximumCredits: number
  registeredCredits: number
  totalEarnedCredits: number
  cumulativeGpa: number
  completedCourseCodes: string[]
  reason: string
}

export interface BulkStudentOnboardingResultRow {
  rowNumber: number
  status: 'ONBOARDED' | 'REPLAYED' | 'FAILED'
  accountCreated: boolean
  code?: string
  message?: string
}

export interface BulkStudentOnboardingResult {
  sourceName: string
  total: number
  onboarded: number
  replayed: number
  failed: number
  rows: BulkStudentOnboardingResultRow[]
}
