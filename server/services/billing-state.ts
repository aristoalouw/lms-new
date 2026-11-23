import type {
  BillingAcademicHold,
  BillingRefundRequest,
  BillingInvoice,
  BillingStudentProfile,
  BillingVoucher,
  DepositAccount,
  DepositTransaction,
  InstallmentPlan,
  InvoiceAdjustment,
  PaymentProof,
  TariffPlanHead,
  TariffPlanVersion,
  VoucherRedemption,
} from '../types/billing'
import { requestHash } from '../utils/security'

interface BillingIdempotencyRecord {
  requestHash: string
  response: unknown
  createdAt: string
}

export interface BillingMockState {
  profiles: Map<string, BillingStudentProfile>
  tariffPlans: Map<string, TariffPlanVersion>
  tariffHeads: Map<string, TariffPlanHead>
  invoiceSnapshots: Map<string, BillingInvoice>
  adjustments: Map<string, InvoiceAdjustment>
  installmentPlans: Map<string, InstallmentPlan>
  depositAccounts: Map<string, DepositAccount>
  depositTransactions: Map<string, DepositTransaction>
  vouchers: Map<string, BillingVoucher>
  voucherRedemptions: Map<string, VoucherRedemption>
  paymentProofs: Map<string, PaymentProof>
  academicHolds: Map<string, BillingAcademicHold>
  refunds: Map<string, BillingRefundRequest>
  invoiceCounters: Map<number, number>
  idempotency: Map<string, BillingIdempotencyRecord>
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

const profiles: BillingStudentProfile[] = [
  { studentId: 'student-001', studentUid: 'student-001', studentNumber: '23011001', studentName: 'Nabila Putri', programStudyId: 'management-s1', unitId: 'faculty-economics', cohortYear: 2023, currentPeriodId: '2025-2026-2', enrollmentStatus: 'ACTIVE', registeredCredits: 20 },
  { studentId: 'student-002', studentUid: 'student-002', studentNumber: '23011002', studentName: 'Rafi Ramadhan', programStudyId: 'management-s1', unitId: 'faculty-economics', cohortYear: 2023, currentPeriodId: '2025-2026-2', enrollmentStatus: 'ACTIVE', registeredCredits: 20 },
  { studentId: 'student-003', studentUid: 'student-003', studentNumber: '23021001', studentName: 'Sinta Maharani', programStudyId: 'informatics-s1', unitId: 'faculty-engineering', cohortYear: 2023, currentPeriodId: '2025-2026-2', enrollmentStatus: 'ACTIVE', registeredCredits: 20 },
  { studentId: 'student-010', studentUid: 'student-010', studentNumber: '23011010', studentName: 'Mahasiswa Uji KRS', programStudyId: 'management-s1', unitId: 'faculty-economics', cohortYear: 2023, currentPeriodId: '2026-2027-1', enrollmentStatus: 'ACTIVE', registeredCredits: 18 },
]

const tariffPlan: TariffPlanVersion = {
  id: 'ukt-standard_v1',
  logicalId: 'ukt-standard',
  name: 'Tarif UKT Reguler',
  version: 1,
  status: 'ACTIVE',
  currency: 'IDR',
  applicability: {
    programStudyIds: ['management-s1'],
    cohortYearFrom: 2022,
    cohortYearTo: 2026,
    periodIds: ['2025-2026-2', '2026-2027-1'],
  },
  components: [
    { id: 'ukt-base', code: 'UKT_BASE', label: 'UKT wajib semester', kind: 'MANDATORY', unitAmountIdr: 6_000_000 },
    { id: 'credit-fee', code: 'CREDIT_FEE', label: 'Biaya per SKS', kind: 'PER_CREDIT', unitAmountIdr: 75_000 },
  ],
  createdAt: '2026-06-01T00:00:00.000Z',
  createdBy: 'finance-001',
  immutable: true,
}

const legacyInvoices: BillingInvoice[] = [
  {
    id: 'invoice-2026-0001', studentId: 'student-001', studentName: 'Nabila Putri', studentNumber: '23011001', programStudyId: 'management-s1', unitId: 'faculty-economics', cohortYear: 2023,
    invoiceNumber: 'INV/2026/02/0001', periodId: '2025-2026-2', tariffPlanId: tariffPlan.logicalId, tariffPlanVersionId: tariffPlan.id, tariffPlanVersion: 1,
    lineItems: [
      { id: 'invoice-2026-0001_ukt-base', tariffComponentId: 'ukt-base', code: 'UKT_BASE', label: 'UKT wajib semester', kind: 'MANDATORY', quantity: 1, unitAmountIdr: 6_000_000, amountIdr: 6_000_000, tariffPlanVersionId: tariffPlan.id, immutable: true },
      { id: 'invoice-2026-0001_credit-fee', tariffComponentId: 'credit-fee', code: 'CREDIT_FEE', label: 'Biaya per SKS', kind: 'PER_CREDIT', quantity: 20, unitAmountIdr: 75_000, amountIdr: 1_500_000, tariffPlanVersionId: tariffPlan.id, immutable: true },
    ],
    baseAmountIdr: 7_500_000, adjustmentAmountIdr: 0, totalAmount: 7_500_000, paidAmount: 5_000_000, currency: 'IDR', status: 'PARTIALLY_PAID', dueDate: '2026-02-10', version: 2,
    issuedAt: '2026-01-15T00:00:00.000Z', issuedBy: 'finance-001', updatedAt: '2026-02-05T00:00:00.000Z',
  },
  {
    id: 'invoice-2026-0002', studentId: 'student-002', studentName: 'Rafi Ramadhan', studentNumber: '23011002', programStudyId: 'management-s1', unitId: 'faculty-economics', cohortYear: 2023,
    invoiceNumber: 'INV/2026/02/0002', periodId: '2025-2026-2', tariffPlanId: tariffPlan.logicalId, tariffPlanVersionId: tariffPlan.id, tariffPlanVersion: 1,
    lineItems: [
      { id: 'invoice-2026-0002_ukt-base', tariffComponentId: 'ukt-base', code: 'UKT_BASE', label: 'UKT wajib semester', kind: 'MANDATORY', quantity: 1, unitAmountIdr: 6_000_000, amountIdr: 6_000_000, tariffPlanVersionId: tariffPlan.id, immutable: true },
      { id: 'invoice-2026-0002_credit-fee', tariffComponentId: 'credit-fee', code: 'CREDIT_FEE', label: 'Biaya per SKS', kind: 'PER_CREDIT', quantity: 20, unitAmountIdr: 75_000, amountIdr: 1_500_000, tariffPlanVersionId: tariffPlan.id, immutable: true },
    ],
    baseAmountIdr: 7_500_000, adjustmentAmountIdr: 0, totalAmount: 7_500_000, paidAmount: 0, currency: 'IDR', status: 'UNPAID', dueDate: '2026-02-10', version: 1,
    issuedAt: '2026-01-15T00:00:00.000Z', issuedBy: 'finance-001', updatedAt: '2026-01-15T00:00:00.000Z',
  },
]

const voucher: BillingVoucher = {
  id: 'voucher-welcome-2026', codeHash: requestHash('WELCOME2026'), label: 'Voucher registrasi 2026', amountIdr: 500_000,
  programStudyIds: ['management-s1'], periodIds: ['2025-2026-2', '2026-2027-1'], validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2026-12-31T16:59:59.000Z',
  maxRedemptions: 100, redemptionCount: 0, status: 'ACTIVE', version: 1, createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'finance-001', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'finance-001',
}

function initialState(): BillingMockState {
  return {
    profiles: new Map(profiles.map(item => [item.studentId, clone(item)])),
    tariffPlans: new Map([[tariffPlan.id, clone(tariffPlan)]]),
    tariffHeads: new Map([[tariffPlan.logicalId, { logicalId: tariffPlan.logicalId, latestVersion: 1, latestVersionId: tariffPlan.id, activeVersion: 1, activeVersionId: tariffPlan.id, updatedAt: tariffPlan.createdAt, updatedBy: tariffPlan.createdBy }]]),
    invoiceSnapshots: new Map(legacyInvoices.map(item => [item.id, clone(item)])),
    adjustments: new Map(),
    installmentPlans: new Map(),
    depositAccounts: new Map([
      ['student-001', { studentId: 'student-001', programStudyId: 'management-s1', balanceIdr: 250_000, version: 1, updatedAt: '2026-07-01T00:00:00.000Z', updatedBy: 'finance-001' }],
    ]),
    depositTransactions: new Map(),
    vouchers: new Map([[voucher.id, clone(voucher)]]),
    voucherRedemptions: new Map(),
    paymentProofs: new Map(),
    academicHolds: new Map(),
    refunds: new Map(),
    invoiceCounters: new Map([[2026, 2]]),
    idempotency: new Map(),
  }
}

let state = initialState()

export function billingModuleState(): BillingMockState {
  return state
}

export function resetBillingStateForTests(): void {
  state = initialState()
}

export function billingStateForTests(): BillingMockState {
  return clone(state)
}

export function billingReplay<T>(namespace: string, hash: string): T | undefined {
  const previous = state.idempotency.get(namespace)
  if (!previous) return undefined
  if (previous.requestHash !== hash) return undefined
  return clone(previous.response) as T
}

export function billingIdempotencyRecord(namespace: string): { requestHash: string; response: unknown } | undefined {
  const record = state.idempotency.get(namespace)
  return record ? clone(record) : undefined
}

export function saveBillingReplay<T>(namespace: string, hash: string, response: T, now: string): void {
  state.idempotency.set(namespace, { requestHash: hash, response: clone(response), createdAt: now })
}
