import type { InvoiceRecord, PaymentRecord } from './domain'

export type TariffComponentKind = 'MANDATORY' | 'PER_CREDIT' | 'OTHER'
export type TariffPlanStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED'
export type InvoiceAdjustmentType = 'SCHOLARSHIP' | 'DISCOUNT' | 'PENALTY' | 'DEPOSIT' | 'VOUCHER'
export type CalculatedInvoiceStatus = InvoiceRecord['status'] | 'OVERDUE'
export type InstallmentScheduleStatus = 'PENDING' | 'DUE' | 'OVERDUE' | 'PAID'
export type PaymentProofStatus = 'SUBMITTED' | 'VERIFIED' | 'REJECTED'

export interface BillingStudentProfile {
  studentId: string
  studentUid: string
  studentNumber: string
  studentName: string
  programStudyId: string
  unitId: string
  cohortYear: number
  currentPeriodId: string
  enrollmentStatus: 'ACTIVE' | 'LEAVE' | 'INACTIVE' | 'GRADUATED'
  registeredCredits: number
}

export interface TariffComponent {
  id: string
  code: string
  label: string
  kind: TariffComponentKind
  unitAmountIdr: number
  description?: string
}

export interface TariffApplicability {
  programStudyIds: string[]
  cohortYearFrom: number
  cohortYearTo: number
  periodIds: string[]
}

export interface TariffPlanVersion {
  id: string
  logicalId: string
  name: string
  version: number
  status: TariffPlanStatus
  currency: 'IDR'
  applicability: TariffApplicability
  components: TariffComponent[]
  createdAt: string
  createdBy: string
  immutable: true
}

export interface TariffPlanHead {
  logicalId: string
  latestVersion: number
  latestVersionId: string
  activeVersion?: number
  activeVersionId?: string
  updatedAt: string
  updatedBy: string
}

export interface InvoiceLineItemSnapshot {
  id: string
  tariffComponentId: string
  code: string
  label: string
  kind: TariffComponentKind
  quantity: number
  unitAmountIdr: number
  amountIdr: number
  tariffPlanVersionId: string
  immutable: true
}

export interface BillingInvoice extends InvoiceRecord {
  studentNumber: string
  unitId: string
  cohortYear: number
  periodId: string
  tariffPlanId: string
  tariffPlanVersionId: string
  tariffPlanVersion: number
  lineItems: InvoiceLineItemSnapshot[]
  baseAmountIdr: number
  adjustmentAmountIdr: number
  installmentPlanId?: string
  issuedAt: string
  issuedBy: string
  voidReason?: string
  voidedAt?: string
  voidedBy?: string
  updatedAt: string
}

export interface InvoiceAdjustment {
  id: string
  invoiceId: string
  studentId: string
  programStudyId: string
  type: InvoiceAdjustmentType
  amountIdr: number
  reason: string
  reference?: string
  createdAt: string
  createdBy: string
  immutable: true
}

export interface InstallmentSchedule {
  id: string
  sequence: number
  dueDate: string
  amountIdr: number
}

export interface InstallmentScheduleView extends InstallmentSchedule {
  cumulativeAmountIdr: number
  coveredAmountIdr: number
  status: InstallmentScheduleStatus
}

export interface InstallmentPlan {
  id: string
  invoiceId: string
  studentId: string
  programStudyId: string
  schedules: InstallmentSchedule[]
  version: number
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  createdAt: string
  createdBy: string
  immutable: true
}

export interface DepositAccount {
  studentId: string
  programStudyId: string
  balanceIdr: number
  version: number
  updatedAt: string
  updatedBy: string
}

export interface DepositTransaction {
  id: string
  studentId: string
  programStudyId: string
  amountIdr: number
  balanceAfterIdr: number
  kind: 'CREDIT' | 'REDEMPTION'
  sourceReference: string
  invoiceId?: string
  createdAt: string
  createdBy: string
  immutable: true
}

export interface BillingVoucher {
  id: string
  codeHash: string
  label: string
  amountIdr: number
  programStudyIds: string[]
  periodIds: string[]
  validFrom: string
  validUntil: string
  maxRedemptions: number
  redemptionCount: number
  status: 'ACTIVE' | 'INACTIVE'
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface VoucherRedemption {
  id: string
  voucherId: string
  invoiceId: string
  studentId: string
  amountIdr: number
  adjustmentId: string
  redeemedAt: string
  redeemedBy: string
  immutable: true
}

export interface PaymentProofFileReference {
  fileId: string
  version: number
  fileName: string
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'
  sizeBytes: number
  sha256: string
  scanStatus: 'CLEAN'
}

export interface PaymentProof {
  id: string
  invoiceId: string
  studentId: string
  programStudyId: string
  claimedAmountIdr: number
  paidAt: string
  bankReference: string
  file: PaymentProofFileReference
  status: PaymentProofStatus
  reviewNote?: string
  version: number
  submittedAt: string
  submittedBy: string
  reviewedAt?: string
  reviewedBy?: string
  updatedAt: string
}

export interface BillingAcademicHold {
  id: string
  type: 'FINANCE'
  reason: string
  active: boolean
  source: 'BILLING'
  periodId: string
  outstandingAmountIdr: number
  evaluatedAt: string
}

export interface BillingInvoiceView extends BillingInvoice {
  calculatedStatus: CalculatedInvoiceStatus
  outstandingAmountIdr: number
  overdueAmountIdr: number
  daysOverdue: number
  adjustments: InvoiceAdjustment[]
  installmentPlan?: InstallmentPlan & { schedules: InstallmentScheduleView[] }
  payments: PaymentRecord[]
  proofs: PaymentProof[]
}

export interface BillingSummary {
  currency: 'IDR'
  invoiceCount: number
  billedAmountIdr: number
  paidAmountIdr: number
  outstandingAmountIdr: number
  overdueAmountIdr: number
  overdueInvoiceCount: number
  depositBalanceIdr: number
}

export interface BillingListResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface BillingWriteResult<T> {
  value: T
  replayed: boolean
  auditId?: string
}

export interface BatchInvoiceResult {
  invoices: BillingInvoice[]
  skippedStudentIds: string[]
  replayed: boolean
  auditId?: string
}
