export const ADMISSION_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'DOCUMENTS_VERIFIED',
  'ACCEPTED',
  'REJECTED',
  'ENROLLMENT_PENDING_IDENTITY',
  'ENROLLED',
] as const

export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number]

export const ADMISSION_FEE_STATUSES = ['UNPAID', 'PAID', 'WAIVED'] as const
export type AdmissionFeeStatus = (typeof ADMISSION_FEE_STATUSES)[number]

export const ADMISSION_PATH_IDS = ['regular', 'kip-college', 'transfer', 'rpl'] as const
export type AdmissionPathId = (typeof ADMISSION_PATH_IDS)[number]

export const STUDY_MODE_IDS = ['hybrid', 'evening', 'weekend'] as const
export type StudyModeId = (typeof STUDY_MODE_IDS)[number]

export interface AdmissionProgram {
  id: string
  code: string
  name: string
  unitId: string
  active: boolean
  version?: number
}

export interface AdmissionWave {
  id: string
  academicYear: string
  label: string
  opensAt: string
  closesAt: string
  registrationFee: number
  currency: 'IDR'
  active: boolean
  programStudyIds: string[]
  capacity: number
  version: number
  createdAt?: string
  createdBy?: string
  updatedAt?: string
  updatedBy?: string
}

export interface AdmissionWaveInput {
  id: string
  academicYear: string
  label: string
  opensAt: string
  closesAt: string
  registrationFee: number
  active: boolean
  programStudyIds: string[]
  capacity: number
}

export interface AdmissionApplicationRecord {
  id: string
  registrationNumber: string
  applicantUid?: string
  fullName: string
  email: string
  phone: string
  identityFingerprint: string
  identityLast4: string
  programStudyId: string
  unitId: string
  admissionPathId: AdmissionPathId
  studyModeId: StudyModeId
  waveId: string
  academicYear: string
  priorInstitution: string
  graduationYear: number
  sourceInformation?: string
  consentedAt: string
  submittedAt: string
  status: AdmissionStatus
  registrationFeeStatus: AdmissionFeeStatus
  registrationFeeAmount: number
  registrationFeeReference?: string
  reviewedAt?: string
  reviewedBy?: string
  reviewNotes?: string
  selectedAt?: string
  rejectedAt?: string
  studentId?: string
  studentNumber?: string
  enrolledAt?: string
  version: number
  updatedAt: string
  updatedBy: string
}

/** Public and role-authorized representation. The identity fingerprint is never exposed. */
export type AdmissionApplicationView = Omit<AdmissionApplicationRecord, 'identityFingerprint'>

export interface AdmissionStudentRecord {
  id: string
  userUid: string
  studentNumber: string
  fullName: string
  email: string
  programStudyId: string
  unitId: string
  cohortYear: number
  academicYear: string
  status: 'PENDING_IDENTITY' | 'ACTIVE'
  sourceApplicationId: string
  activatedAt: string
  version: number
}

export interface AdmissionSubmissionInput {
  fullName: string
  email: string
  phone: string
  identityNumber: string
  programStudyId: string
  admissionPathId: AdmissionPathId
  studyModeId: StudyModeId
  waveId: string
  priorInstitution: string
  graduationYear: number
  sourceInformation?: string
  consent: true
}

export interface AdmissionListOptions {
  programStudyId?: string
  status?: AdmissionStatus
  waveId?: string
  limit?: number
  cursor?: string
}

export interface AdmissionListResult {
  items: AdmissionApplicationView[]
  nextCursor?: string
}

export interface AdmissionConversionResult {
  application: AdmissionApplicationView
  student: AdmissionStudentRecord
  replayed: boolean
  auditId?: string
}

export const ADMISSION_DOCUMENT_TYPES = ['IDENTITY', 'DIPLOMA', 'TRANSCRIPT', 'KIP_CARD', 'RPL_PORTFOLIO', 'OTHER'] as const
export type AdmissionDocumentType = (typeof ADMISSION_DOCUMENT_TYPES)[number]

export interface AdmissionDocumentRecord {
  id: string
  applicationId: string
  applicantUid: string
  programStudyId: string
  documentType: AdmissionDocumentType
  fileId: string
  fileVersion: number
  fileName: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string
  status: 'PENDING' | 'VERIFIED' | 'REJECTED'
  version: number
  submittedAt: string
  submittedBy: string
  reviewedAt?: string
  reviewedBy?: string
  reviewNote?: string
  updatedAt: string
}

export interface AdmissionDocumentChecklistItem {
  documentType: AdmissionDocumentType
  label: string
  required: boolean
  status: 'MISSING' | AdmissionDocumentRecord['status']
  documentId?: string
}

export interface AdmissionDocumentWorkspace {
  application: AdmissionApplicationView
  documents: AdmissionDocumentRecord[]
  checklist: AdmissionDocumentChecklistItem[]
  complete: boolean
}
