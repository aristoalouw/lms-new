export type PortfolioKind = 'ACTIVITY' | 'ACHIEVEMENT'
export type PortfolioStatus = 'SUBMITTED' | 'VERIFIED' | 'REJECTED'
export type CaseSeverity = 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL'
export type CaseStatus = 'REPORTED' | 'NOTIFIED' | 'STUDENT_RESPONSE' | 'UNDER_REVIEW' | 'RESOLVED' | 'DISMISSED'
export type ScholarshipProgramStatus = 'DRAFT' | 'OPEN' | 'CLOSED'
export type ScholarshipApplicationStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'AWARDED' | 'REJECTED' | 'WITHDRAWN'
export type RequirementDocumentStatus = 'PENDING' | 'VERIFIED' | 'REJECTED'
export type LetterRequestStatus = 'SUBMITTED' | 'VERIFIED' | 'REJECTED' | 'ISSUED'

export interface EvidenceFileReference {
  fileId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  checksumSha256?: string
}

export interface StudentAffairsProfile {
  studentId: string
  studentNumber: string
  studentName: string
  programStudyId: string
  unitId: string
  cohortYear: number
  enrollmentStatus: 'ACTIVE' | 'LEAVE' | 'GRADUATED' | 'INACTIVE'
  currentPeriodId: string
  gpa: number
  earnedCredits: number
  financialHold: boolean
}

export interface StudentPortfolioRecord {
  id: string
  studentId: string
  programStudyId: string
  kind: PortfolioKind
  title: string
  category: string
  level: 'CAMPUS' | 'REGIONAL' | 'NATIONAL' | 'INTERNATIONAL'
  roleOrRank: string
  organization: string
  occurredAt: string
  description?: string
  evidence: EvidenceFileReference[]
  status: PortfolioStatus
  reviewNote?: string
  awardedRuleId?: string
  awardedPoints: number
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface PointRule {
  id: string
  label: string
  portfolioKind: PortfolioKind
  level: StudentPortfolioRecord['level']
  points: number
}

export interface PointPolicy {
  programStudyId: string
  version: number
  rules: PointRule[]
  adjustmentLimit: number
  updatedAt: string
  updatedBy: string
}

export interface PointLedgerEntry {
  id: string
  studentId: string
  programStudyId: string
  sourceType: 'PORTFOLIO' | 'CASE' | 'ADJUSTMENT'
  sourceId: string
  points: number
  reason: string
  createdAt: string
  createdBy: string
  immutable: true
}

export interface PointLedgerView {
  studentId: string
  totalPoints: number
  entries: PointLedgerEntry[]
}

export interface CaseNote {
  id: string
  body: string
  createdAt: string
  createdBy: string
}

export interface StudentViolationCase {
  id: string
  studentId: string
  programStudyId: string
  title: string
  allegation: string
  severity: CaseSeverity
  status: CaseStatus
  occurredAt: string
  reportedAt: string
  responseDueAt: string
  evidence: EvidenceFileReference[]
  studentResponse?: string
  studentRespondedAt?: string
  staffNotes: CaseNote[]
  resolution?: {
    outcome: string
    summary: string
    pointAdjustment: number
    resolvedAt: string
    resolvedBy: string
  }
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface ScholarshipChecklistItem {
  id: string
  label: string
  kind: 'ACTIVE_STATUS' | 'MIN_GPA' | 'MIN_CREDITS' | 'VERIFIED_DOCUMENT' | 'NO_OPEN_MAJOR_CASE'
  documentType?: string
}

export interface ScholarshipProgram {
  id: string
  name: string
  description: string
  periodId: string
  programStudyIds: string[]
  status: ScholarshipProgramStatus
  applicationOpensAt: string
  applicationClosesAt: string
  minGpa: number
  minCredits: number
  quota: number
  awardedCount: number
  checklist: ScholarshipChecklistItem[]
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface EligibilityCheckResult {
  id: string
  label: string
  passed: boolean
  detail: string
}

export interface ScholarshipEligibilitySnapshot {
  evaluatedAt: string
  profileVersion: string
  gpa: number
  earnedCredits: number
  enrollmentStatus: StudentAffairsProfile['enrollmentStatus']
  checks: EligibilityCheckResult[]
  eligible: boolean
}

export interface ScholarshipApplication {
  id: string
  programId: string
  studentId: string
  programStudyId: string
  status: ScholarshipApplicationStatus
  statement: string
  eligibilitySnapshot: ScholarshipEligibilitySnapshot
  submittedDocumentIds: string[]
  decisionReason?: string
  internalReviewNotes?: string
  version: number
  submittedAt: string
  updatedAt: string
  updatedBy: string
}

export interface StudentRequirementDocument {
  id: string
  studentId: string
  programStudyId: string
  documentType: string
  label: string
  file: EvidenceFileReference
  status: RequirementDocumentStatus
  rejectionReason?: string
  expiresAt?: string
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface ActiveStudentEligibilitySnapshot {
  evaluatedAt: string
  enrollmentStatus: StudentAffairsProfile['enrollmentStatus']
  currentPeriodId: string
  financialHold: boolean
  unresolvedMajorCaseCount: number
  eligible: boolean
  reasons: string[]
}

export interface ActiveStudentLetterRequest {
  id: string
  studentId: string
  programStudyId: string
  purpose: string
  status: LetterRequestStatus
  eligibilitySnapshot: ActiveStudentEligibilitySnapshot
  rejectionReason?: string
  version: number
  submittedAt: string
  verifiedAt?: string
  verifiedBy?: string
  issuedAt?: string
  issuanceId?: string
  updatedAt: string
  updatedBy: string
}

export interface ActiveStudentLetterIssuance {
  id: string
  requestId: string
  studentId: string
  programStudyId: string
  verificationNumber: string
  eligibilitySnapshot: ActiveStudentEligibilitySnapshot
  purpose: string
  file: EvidenceFileReference
  recordHash: string
  issuedAt: string
  issuedBy: string
  immutable: true
}

export interface PaginatedResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}
