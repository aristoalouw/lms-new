import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addInvoiceAdjustment,
  applyStudentDeposit,
  createInstallmentPlan,
  createTariffPlanVersion,
  creditStudentDeposit,
  getBillingDashboard,
  getBillingInvoice,
  issueInvoiceBatch,
  redeemBillingVoucher,
  resetBillingStateForTests,
  reviewPaymentProof,
  submitPaymentProof,
} from '../../server/services/billing'
import { createFileUploadSession, finalizeFileUpload, resetFileServiceForTests, storeMockUploadContent } from '../../server/services/files'
import { configureMalwareScanner, DevelopmentSignatureScanner } from '../../server/services/files-scanner'
import { resetFileStorageForTests } from '../../server/services/files-storage'
import { krsModuleState, resetKrsModuleState } from '../../server/services/krs-state'
import { CampusError } from '../../server/utils/errors'
import { resetMockState } from '../../server/utils/mock-store'
import { recordPayment, reversePayment } from '../../server/services/payments'
import { billingModuleState } from '../../server/services/billing-state'
import { authContext } from './fixtures'

const finance = () => authContext('finance-001', ['finance_staff'], ['management-s1'])
const student = (id = 'student-001') => authContext(id, ['student'], ['management-s1'])
const clock = new Date('2026-07-22T03:00:00.000Z')

describe('student billing and account receivable', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState(); resetBillingStateForTests(); resetKrsModuleState(); resetFileServiceForTests(); resetFileStorageForTests()
    configureMalwareScanner(new DevelopmentSignatureScanner())
  })

  afterEach(() => { configureMalwareScanner(undefined); resetFileStorageForTests() })

  it('scopes dashboards to the student while finance sees its program', async () => {
    const own = await getBillingDashboard(student(), { page: 1, pageSize: 20 }, clock)
    expect(own.invoices.items).toHaveLength(1)
    expect(own.invoices.items[0]).toMatchObject({ studentId: 'student-001', calculatedStatus: 'OVERDUE', outstandingAmountIdr: 2_500_000 })
    expect(own.summary).toMatchObject({ billedAmountIdr: 7_500_000, paidAmountIdr: 5_000_000, overdueInvoiceCount: 1, depositBalanceIdr: 250_000 })
    const staff = await getBillingDashboard(finance(), { page: 1, pageSize: 20 }, clock)
    expect(staff.invoices.total).toBe(2)
  })

  it('returns an empty student dashboard while billing onboarding is incomplete', async () => {
    billingModuleState().profiles.delete('student-new')
    const dashboard = await getBillingDashboard(student('student-new'), { page: 1, pageSize: 20 }, clock)
    expect(dashboard.invoices).toMatchObject({ items: [], total: 0 })
    expect(dashboard.summary).toMatchObject({
      invoiceCount: 0,
      billedAmountIdr: 0,
      paidAmountIdr: 0,
      outstandingAmountIdr: 0,
      overdueAmountIdr: 0,
      depositBalanceIdr: 0,
    })
  })

  it('creates immutable tariff versions with optimistic concurrency and idempotency', async () => {
    const input = {
      logicalId: 'activity-fee', name: 'Tarif kegiatan', expectedLatestVersion: 0, status: 'ACTIVE',
      applicability: { programStudyIds: ['management-s1'], cohortYearFrom: 2023, cohortYearTo: 2026, periodIds: ['2026-2027-1'] },
      components: [{ id: 'activity', code: 'ACTIVITY', label: 'Kegiatan mahasiswa', kind: 'MANDATORY', unitAmountIdr: 500_000 }],
    }
    const first = await createTariffPlanVersion(finance(), input, 'tariff-version-0001', undefined, clock)
    const replay = await createTariffPlanVersion(finance(), input, 'tariff-version-0001', undefined, clock)
    expect(first.value).toMatchObject({ version: 1, immutable: true, currency: 'IDR' })
    expect(replay.replayed).toBe(true)
    await expect(createTariffPlanVersion(finance(), { ...input, name: 'Berubah' }, 'tariff-version-0001', undefined, clock)).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' } satisfies Partial<CampusError>)
  })

  it('denies administrator access to finance records and mutations', async () => {
    const administrator = authContext('admin-001', ['administrator'], [])
    await expect(getBillingDashboard(administrator, { page: 1, pageSize: 20 }, clock))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
    await expect(createTariffPlanVersion(administrator, {
      logicalId: 'admin-denied', name: 'Tarif tidak sah', expectedLatestVersion: 0, status: 'ACTIVE',
      applicability: { programStudyIds: ['management-s1'], cohortYearFrom: 2023, cohortYearTo: 2026, periodIds: ['2026-2027-1'] },
      components: [{ id: 'admin-denied', code: 'DENIED', label: 'Tidak boleh dibuat admin', kind: 'MANDATORY', unitAmountIdr: 1_000 }],
    }, 'tariff-admin-denied', undefined, clock)).rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
  })

  it('issues a unique invoice batch and creates an academic finance hold', async () => {
    const input = { tariffPlanVersionId: 'ukt-standard_v1', studentIds: ['student-010'], dueDate: '2026-08-31' }
    const issued = await issueInvoiceBatch(finance(), input, 'invoice-batch-0001', undefined, clock)
    expect(issued.invoices).toHaveLength(1)
    expect(issued.invoices[0]).toMatchObject({ studentId: 'student-010', baseAmountIdr: 7_350_000, totalAmount: 7_350_000, status: 'UNPAID' })
    expect(krsModuleState().students.get('student-010')?.holds).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'FINANCE', active: true, outstandingAmountIdr: 7_350_000 })]))
    expect((await issueInvoiceBatch(finance(), input, 'invoice-batch-0001', undefined, clock)).replayed).toBe(true)
  })

  it('releases the KRS finance hold on full settlement and reinstates it on reversal', async () => {
    const issued = await issueInvoiceBatch(finance(), { tariffPlanVersionId: 'ukt-standard_v1', studentIds: ['student-010'], dueDate: '2026-08-31' }, 'invoice-batch-hold-01', undefined, clock)
    const invoice = issued.invoices[0]!
    const settled = await recordPayment(finance(), { invoiceId: invoice.id, amount: invoice.totalAmount, channel: 'virtual_account', externalReference: 'VA/HOLD/0001', receivedAt: '2026-07-21T03:00:00.000Z' }, 'payment-hold-key-01')
    expect(settled.invoice.status).toBe('PAID')
    expect(krsModuleState().students.get('student-010')?.holds.find(item => item.type === 'FINANCE')).toMatchObject({ active: false })
    await reversePayment(finance(), settled.payment.id, { externalReference: 'REV/HOLD/0001', reversedAt: '2026-07-22T02:00:00.000Z', reason: 'Settlement dibatalkan provider.' }, 'reversal-hold-key-01')
    expect(krsModuleState().students.get('student-010')?.holds.find(item => item.type === 'FINANCE')).toMatchObject({ active: true })
  })

  it('records immutable adjustments without reducing total below settled payments', async () => {
    const adjusted = await addInvoiceAdjustment(finance(), 'invoice-2026-0002', { type: 'SCHOLARSHIP', amountIdr: 1_250_000, reason: 'Keputusan beasiswa prestasi', reference: 'SK/001/2026', expectedVersion: 1 }, 'adjustment-0001', undefined, clock)
    expect(adjusted.value.invoice).toMatchObject({ totalAmount: 6_250_000, adjustmentAmountIdr: -1_250_000, version: 2 })
    expect(adjusted.value.adjustment).toMatchObject({ immutable: true, type: 'SCHOLARSHIP' })
    await expect(addInvoiceAdjustment(finance(), 'invoice-2026-0001', { type: 'DISCOUNT', amountIdr: 3_000_000, reason: 'Diskon melampaui saldo', expectedVersion: 2 }, 'adjustment-0002', undefined, clock)).rejects.toMatchObject({ code: 'ADJUSTMENT_EXCEEDS_BALANCE' } satisfies Partial<CampusError>)
  })

  it('requires ordered installments whose total equals the immutable invoice total', async () => {
    const plan = await createInstallmentPlan(finance(), 'invoice-2026-0002', { expectedVersion: 1, schedules: [{ dueDate: '2026-08-31', amountIdr: 3_750_000 }, { dueDate: '2026-09-30', amountIdr: 3_750_000 }] }, 'installment-0001', undefined, clock)
    expect(plan.value.plan).toMatchObject({ status: 'ACTIVE', immutable: true, schedules: [{ sequence: 1 }, { sequence: 2 }] })
    await expect(createInstallmentPlan(finance(), 'invoice-2026-0001', { expectedVersion: 2, schedules: [{ dueDate: '2026-08-31', amountIdr: 1_000_000 }, { dueDate: '2026-09-30', amountIdr: 1_000_000 }] }, 'installment-0002', undefined, clock)).rejects.toMatchObject({ code: 'INSTALLMENT_TOTAL_MISMATCH' } satisfies Partial<CampusError>)
  })

  it('keeps deposit credits and redemptions in a separate immutable ledger', async () => {
    const credited = await creditStudentDeposit(finance(), { studentId: 'student-002', amountIdr: 500_000, sourceReference: 'BANK/DEP/0001', expectedVersion: 0 }, 'deposit-credit-0001', undefined, clock)
    expect(credited.value).toMatchObject({ account: { balanceIdr: 500_000, version: 1 }, transaction: { kind: 'CREDIT', immutable: true } })
    const applied = await applyStudentDeposit(student('student-002'), 'invoice-2026-0002', { amountIdr: 400_000, expectedInvoiceVersion: 1, expectedDepositVersion: 1 }, 'deposit-apply-0001', undefined, clock)
    expect(applied.value).toMatchObject({ invoice: { totalAmount: 7_100_000, version: 2 }, account: { balanceIdr: 100_000, version: 2 }, transaction: { kind: 'REDEMPTION' }, adjustment: { type: 'DEPOSIT' } })
  })

  it('redeems a scoped voucher at most once per invoice', async () => {
    const result = await redeemBillingVoucher(student('student-002'), 'invoice-2026-0002', { code: 'WELCOME2026', expectedInvoiceVersion: 1 }, 'voucher-0001', undefined, clock)
    expect(result.value).toMatchObject({ invoice: { totalAmount: 7_000_000, version: 2 }, redemption: { amountIdr: 500_000, immutable: true }, adjustment: { type: 'VOUCHER' } })
    await expect(redeemBillingVoucher(student('student-002'), 'invoice-2026-0002', { code: 'WELCOME2026', expectedInvoiceVersion: 2 }, 'voucher-0002', undefined, clock)).rejects.toMatchObject({ code: 'VOUCHER_ALREADY_REDEEMED' } satisfies Partial<CampusError>)
  })

  it('references only CLEAN private file versions and separates proof review from payment posting', async () => {
    const owner = student()
    const bytes = Uint8Array.from(Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF', 'latin1'))
    const upload = await createFileUploadSession(owner, { name: 'bukti-bayar.pdf', declaredMimeType: 'application/pdf', sizeBytes: bytes.byteLength })
    await storeMockUploadContent(owner, upload.session.id, bytes, 'application/pdf'); await finalizeFileUpload(owner, upload.session.id)
    const submitted = await submitPaymentProof(owner, 'invoice-2026-0001', { claimedAmountIdr: 2_500_000, paidAt: '2026-07-21T02:30:00.000Z', bankReference: 'BANK/PAY/0001', fileId: upload.file.id }, 'proof-0001', undefined, clock)
    expect(submitted.value).toMatchObject({ status: 'SUBMITTED', file: { fileId: upload.file.id, version: 1, scanStatus: 'CLEAN' } })
    const reviewed = await reviewPaymentProof(finance(), submitted.value.id, { status: 'VERIFIED', reviewNote: 'Referensi dan nominal cocok.', expectedVersion: 1 }, undefined, clock)
    expect(reviewed.value).toMatchObject({ status: 'VERIFIED', version: 2 })
    expect((await getBillingInvoice(owner, 'invoice-2026-0001')).paidAmount).toBe(5_000_000)
  })

  it('blocks finance staff outside the invoice program scope', async () => {
    const outsider = authContext('finance-outside', ['finance_staff'], ['informatics-s1'])
    await expect(getBillingInvoice(outsider, 'invoice-2026-0001')).rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
    await expect(addInvoiceAdjustment(outsider, 'invoice-2026-0001', { type: 'PENALTY', amountIdr: 10_000, reason: 'Penalti administrasi', expectedVersion: 2 }, 'adjustment-outside', undefined, clock)).rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
  })
})
