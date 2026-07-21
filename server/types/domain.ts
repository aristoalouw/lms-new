export type KrsStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'

export interface KrsRecord {
  id: string
  studentId: string
  studentUid?: string
  studentName: string
  studentNumber: string
  advisorId: string
  programStudyId: string
  periodId: string
  totalCredits: number
  courseCodes: string[]
  classIds?: string[]
  classSelections?: Array<{
    classId: string
    courseCode: string
    courseName: string
    section: string
    credits: number
  }>
  maximumCredits?: number
  eligibilityVersion?: number
  seatsReserved?: boolean
  status: KrsStatus
  version: number
  submittedAt?: string
  reviewedAt?: string
  reviewedBy?: string
  reviewNotes?: string
}

export interface InvoiceRecord {
  id: string
  studentId: string
  studentName: string
  programStudyId: string
  invoiceNumber: string
  totalAmount: number
  paidAmount: number
  currency: 'IDR'
  status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'VOID'
  dueDate: string
  version: number
}

export interface PaymentRecord {
  id: string
  invoiceId: string
  amount: number
  currency: 'IDR'
  channel: 'bank_transfer' | 'virtual_account' | 'cash' | 'card' | 'ewallet'
  externalReference: string
  receivedAt: string
  recordedAt: string
  recordedBy: string
  status: 'SETTLED' | 'REVERSED'
  reversedAt?: string
  reversedBy?: string
  reversalExternalReference?: string
  reversalReason?: string
}

export const PDDIKTI_ENTITY_TYPES = [
  'student',
  'lecturer',
  'course',
  'class',
  'grade',
  'student_activity',
  'graduation',
] as const

export type PddiktiEntityType = (typeof PDDIKTI_ENTITY_TYPES)[number]
export type PddiktiJobStatus = 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'DEAD_LETTER'

export interface PddiktiSyncJob {
  id: string
  entityType: PddiktiEntityType
  entityIds: string[]
  programStudyId: string
  periodId: string
  status: PddiktiJobStatus
  attempts: number
  maxAttempts: number
  createdAt: string
  createdBy: string
  updatedAt: string
  nextAttemptAt: string
  lastError?: {
    code: string
    message: string
    occurredAt: string
  }
}

export interface AuditEntry {
  id: string
  occurredAt: string
  actor: {
    uid: string
    roles: string[]
  }
  action: string
  resource: {
    type: string
    id: string
  }
  outcome: 'SUCCESS' | 'DENIED' | 'FAILURE'
  request?: {
    requestId?: string
    ipAddress?: string
    userAgent?: string
  }
  before?: unknown
  after?: unknown
  metadata?: Record<string, unknown>
}

export interface DashboardSnapshot {
  periodId: string
  updatedAt: string
  academic: {
    activeStudents: number
    classesRunning: number
    averageAttendancePercent: number
    lecturesRealizedPercent: number
  }
  finance: {
    billedAmount: number
    collectedAmount: number
    overdueInvoices: number
    currency: 'IDR'
  }
  admissions: {
    applicants: number
    verifiedApplicants: number
    admittedApplicants: number
    enrolledApplicants: number
  }
  pddikti: {
    completenessPercent: number
    queuedRecords: number
    failedRecords: number
    lastSuccessfulSyncAt?: string
  }
  outcomes: {
    tracerResponseRatePercent: number
    employedWithinSixMonthsPercent: number
    respondents: number
  }
  accreditation: {
    institutionStatus: string
    programStudyAtRisk: number
    nearestExpiryDate: string
  }
}
