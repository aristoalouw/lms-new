export type AdmissionSelectionKind = 'WRITTEN_EXAM' | 'INTERVIEW' | 'PORTFOLIO_REVIEW'
export type AdmissionSelectionSessionStatus = 'DRAFT' | 'SCHEDULED' | 'COMPLETED' | 'CANCELLED'
export type AdmissionSelectionAssignmentStatus = 'SCHEDULED' | 'ATTENDED' | 'ABSENT' | 'SCORED'

export interface AdmissionSelectionSession {
  id: string
  name: string
  kind: AdmissionSelectionKind
  waveId: string
  programStudyId: string
  location: string
  startsAt: string
  endsAt: string
  capacity: number
  assignedCount: number
  examinerIds: string[]
  status: AdmissionSelectionSessionStatus
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface AdmissionSelectionAssignment {
  id: string
  sessionId: string
  applicationId: string
  applicantUid?: string
  registrationNumber: string
  applicantName: string
  applicantEmail: string
  waveId: string
  programStudyId: string
  startsAt: string
  endsAt: string
  location: string
  status: AdmissionSelectionAssignmentStatus
  version: number
  createdAt: string
  updatedAt: string
}

export interface AdmissionScoreComponent {
  key: string
  label: string
  score: number
  maximumScore: number
}

export interface AdmissionSelectionScore {
  id: string
  assignmentId: string
  sessionId: string
  applicationId: string
  programStudyId: string
  components: AdmissionScoreComponent[]
  totalScore: number
  recommendation: 'ACCEPT' | 'REJECT' | 'WAITLIST'
  finalizedAt: string
  finalizedBy: string
  immutable: true
  contentHash: string
}

export interface AdmissionLetterOfAcceptance {
  id: string
  applicationId: string
  applicantUid: string
  registrationNumber: string
  applicantName: string
  programStudyId: string
  programStudyName: string
  academicYear: string
  documentNumber: string
  verificationCode: string
  status: 'ISSUED' | 'REVOKED'
  issuedAt: string
  issuedBy: string
  contentHash: string
  version: number
  revokedAt?: string
  revokedBy?: string
  revocationReason?: string
}

export interface AdmissionLetterVerification {
  valid: boolean
  documentNumber?: string
  registrationNumber?: string
  applicantName?: string
  programStudyName?: string
  academicYear?: string
  issuedAt?: string
  status?: AdmissionLetterOfAcceptance['status']
  contentHash?: string
}

export interface AdmissionSelectionWriteResult<T> {
  value: T
  replayed: boolean
  auditId?: string
}
