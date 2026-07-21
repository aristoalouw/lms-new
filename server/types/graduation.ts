export type GraduationPeriodStatus = 'DRAFT' | 'OPEN' | 'REVIEW' | 'FINALIZED' | 'CLOSED'

export interface GraduationRequirements {
  version: number
  academic: {
    minimumCredits: number
    minimumGpa: number
    maximumGradeD: number
    requireNoGradeE: boolean
    requireThesisPassed: boolean
  }
  finance: { maximumOutstandingAmount: number }
  library: { requireClearance: boolean; maximumUnreturnedItems: number }
  studentAffairs: { minimumPoints: number; maximumActiveSanctions: number }
  effectiveAt: string
  updatedBy: string
}

export interface GraduationPeriod {
  id: string
  code: string
  name: string
  programStudyIds: string[]
  status: GraduationPeriodStatus
  registrationOpensAt: string
  registrationClosesAt: string
  yudisiumDate: string
  graduationDate?: string
  version: number
  currentRequirements: GraduationRequirements
  requirementHistory: GraduationRequirements[]
  createdAt: string
  updatedAt: string
}

export interface GraduationEligibilitySnapshot {
  id: string
  studentId: string
  programStudyId: string
  capturedAt: string
  sourceVersions: { academic: number; finance: number; library: number; studentAffairs: number }
  academic: {
    earnedCredits: number
    gpa: number
    gradeDCount: number
    gradeECount: number
    thesisPassed: boolean
  }
  finance: { outstandingAmount: number }
  library: { cleared: boolean; unreturnedItems: number }
  studentAffairs: { points: number; activeSanctions: number }
}

export type EligibilityArea = 'ACADEMIC' | 'FINANCE' | 'LIBRARY' | 'STUDENT_AFFAIRS'

export interface EligibilityCheck {
  code: string
  area: EligibilityArea
  label: string
  passed: boolean
  actual: string | number | boolean
  required: string | number | boolean
}

export interface GraduationEligibilityEvaluation {
  eligible: boolean
  requirementsVersion: number
  evaluatedAt: string
  snapshotId: string
  checks: EligibilityCheck[]
  blockerCodes: string[]
}

export type GraduationApplicationStatus =
  | 'BLOCKED'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'FIRST_APPROVED'
  | 'FINAL_APPROVED'
  | 'REJECTED'
  | 'GRADUATED'
  | 'CANCELLED'

export interface GraduationStatusEvent {
  id: string
  from?: GraduationApplicationStatus
  to: GraduationApplicationStatus
  actorUid: string
  actorName: string
  occurredAt: string
  reason?: string
}

export interface GraduationApplication {
  id: string
  periodId: string
  studentId: string
  studentUid: string
  studentName: string
  studentNumber: string
  programStudyId: string
  programStudyName: string
  status: GraduationApplicationStatus
  eligibilitySnapshot: GraduationEligibilitySnapshot
  eligibilityEvaluation: GraduationEligibilityEvaluation
  firstApprovedBy?: string
  firstApprovedAt?: string
  finalApprovedBy?: string
  finalApprovedAt?: string
  version: number
  submittedAt: string
  updatedAt: string
  history: GraduationStatusEvent[]
}

export type GraduationParticipantStatus = 'YUDISIUM_APPROVED' | 'GRADUATED' | 'WITHDRAWN'

export interface GraduationParticipant {
  id: string
  applicationId: string
  periodId: string
  studentId: string
  studentUid: string
  programStudyId: string
  status: GraduationParticipantStatus
  version: number
  createdAt: string
  updatedAt: string
  history: Array<{
    from?: GraduationParticipantStatus
    to: GraduationParticipantStatus
    actorUid: string
    occurredAt: string
    reason?: string
  }>
}

export const GRADUATION_DOCUMENT_TYPES = ['DECREE', 'DIPLOMA', 'TRANSCRIPT', 'SKPI'] as const
export type GraduationDocumentType = (typeof GRADUATION_DOCUMENT_TYPES)[number]

export type GraduationTemplateSource =
  | 'studentName'
  | 'studentNumber'
  | 'programStudyName'
  | 'periodName'
  | 'yudisiumDate'
  | 'graduationDate'
  | 'gpa'
  | 'earnedCredits'
  | 'documentNumber'
  | 'verificationCode'
  | 'issuedAt'

export interface GraduationDocumentTemplate {
  id: string
  type: GraduationDocumentType
  name: string
  programStudyId?: string
  version: number
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED'
  layout: {
    title: string
    subtitle?: string
    fields: Array<{ key: string; label: string; source: GraduationTemplateSource }>
    footerText: string
  }
  createdAt: string
  updatedAt: string
  updatedBy: string
}

export interface GraduationRenderPayload {
  documentType: GraduationDocumentType
  documentNumber: string
  verificationCode: string
  issuedAt: string
  title: string
  subtitle?: string
  subject: {
    studentName: string
    studentNumber: string
    programStudyName: string
    periodName: string
  }
  fields: Array<{ key: string; label: string; value: string }>
  footerText: string
  limitation: 'DETERMINISTIC_RENDER_PAYLOAD_ONLY_NO_CREDENTIAL_PDF'
}

export type IssuedDocumentStatus = 'ISSUED' | 'REVOKED'

export interface IssuedGraduationDocument {
  id: string
  applicationId: string
  studentId: string
  studentUid: string
  programStudyId: string
  type: GraduationDocumentType
  documentNumber: string
  verificationCode: string
  status: IssuedDocumentStatus
  version: number
  templateSnapshot: GraduationDocumentTemplate
  renderPayload: GraduationRenderPayload
  contentHash: string
  issuedAt: string
  issuedBy: string
  reissueOf?: string
  revokedAt?: string
  revokedBy?: string
  revocationReason?: string
  history: Array<{
    action: 'ISSUED' | 'REVOKED' | 'REISSUED_AS' | 'REISSUED_FROM'
    actorUid: string
    occurredAt: string
    relatedDocumentId?: string
    reason?: string
  }>
}

export interface DocumentVerificationResult {
  valid: boolean
  verificationCode: string
  status?: IssuedDocumentStatus
  documentType?: GraduationDocumentType
  documentNumber?: string
  issuedAt?: string
  contentHashMatches?: boolean
}
