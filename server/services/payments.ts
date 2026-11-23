import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { InvoiceRecord, PaymentRecord } from '../types/domain'
import { appendAudit } from '../utils/audit'
import { conflict, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { cloneValue, mockState } from '../utils/mock-store'
import { requirePaymentScope } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { billingModuleState } from './billing-state'
import { krsModuleState } from './krs-state'
import type { KrsHold, KrsStudentAcademicState } from '../types/krs-enrollment'
import type { BillingAcademicHold, DepositAccount, DepositTransaction } from '../types/billing'

export interface RecordPaymentInput {
  invoiceId: string
  amount: number
  channel: PaymentRecord['channel']
  externalReference: string
  receivedAt: string
}

export interface RecordPaymentResult {
  payment: PaymentRecord
  invoice: InvoiceRecord
  depositAccount?: DepositAccount
  depositTransaction?: DepositTransaction
  replayed: boolean
  auditId?: string
}

export interface ReversePaymentInput {
  externalReference: string
  reversedAt: string
  reason: string
}

export interface ReversePaymentResult {
  payment: PaymentRecord
  invoice: InvoiceRecord
  depositAccount?: DepositAccount
  depositTransaction?: DepositTransaction
  replayed: boolean
  auditId?: string
}

interface PaymentApplication {
  invoice: InvoiceRecord
  appliedAmountIdr: number
  overpaymentAmountIdr: number
}

function applyPayment(invoice: InvoiceRecord, amount: number): PaymentApplication {
  if (invoice.status === 'VOID') conflict('INVOICE_VOID', 'Tagihan telah dibatalkan.')
  const remaining = Math.max(0, invoice.totalAmount - invoice.paidAmount)
  const appliedAmountIdr = Math.min(amount, remaining)
  const overpaymentAmountIdr = amount - appliedAmountIdr
  const paidAmount = invoice.paidAmount + appliedAmountIdr
  return {
    invoice: {
      ...invoice,
      paidAmount,
      status: paidAmount === invoice.totalAmount ? 'PAID' : 'PARTIALLY_PAID',
      version: invoice.version + 1,
    },
    appliedAmountIdr,
    overpaymentAmountIdr,
  }
}

function creditOverpayment(
  current: DepositAccount | undefined,
  invoice: InvoiceRecord,
  amountIdr: number,
  sourceReference: string,
  actor: string,
  now: string,
): { account: DepositAccount; transaction: DepositTransaction } {
  const balanceIdr = (current?.balanceIdr || 0) + amountIdr
  if (!Number.isSafeInteger(balanceIdr)) conflict('DEPOSIT_BALANCE_INVALID', 'Saldo deposit melampaui batas yang didukung.')
  const account: DepositAccount = {
    studentId: invoice.studentId,
    programStudyId: invoice.programStudyId,
    balanceIdr,
    reservedRefundAmountIdr: current?.reservedRefundAmountIdr || 0,
    version: (current?.version || 0) + 1,
    updatedAt: now,
    updatedBy: actor,
  }
  const transaction: DepositTransaction = {
    id: opaqueId('deposit_tx', `overpayment:${sourceReference}`),
    studentId: invoice.studentId,
    programStudyId: invoice.programStudyId,
    amountIdr,
    balanceAfterIdr: balanceIdr,
    kind: 'OVERPAYMENT_CREDIT',
    sourceReference,
    invoiceId: invoice.id,
    createdAt: now,
    createdBy: actor,
    immutable: true,
  }
  return { account, transaction }
}

function financeHoldForInvoice(invoice: InvoiceRecord, now: string): BillingAcademicHold | undefined {
  const periodId = typeof (invoice as InvoiceRecord & { periodId?: unknown }).periodId === 'string'
    ? String((invoice as InvoiceRecord & { periodId: string }).periodId)
    : dataMode() === 'mock' ? billingModuleState().invoiceSnapshots.get(invoice.id)?.periodId : undefined
  if (!periodId) return undefined
  const outstandingAmountIdr = Math.max(0, invoice.totalAmount - invoice.paidAmount)
  return {
    id: `billing-${periodId}`, type: 'FINANCE', active: outstandingAmountIdr > 0, periodId,
    reason: outstandingAmountIdr > 0 ? `Kewajiban UKT periode ${periodId} belum diselesaikan.` : `Kewajiban UKT periode ${periodId} telah diselesaikan.`,
    source: 'BILLING', outstandingAmountIdr, evaluatedAt: now,
  }
}

function mergeFinanceHold(holds: KrsHold[] | undefined, hold: BillingAcademicHold): KrsHold[] {
  return [...(holds || []).filter(item => item.id !== hold.id), structuredClone(hold)]
}

function synchronizeMockBilling(invoice: InvoiceRecord, now: string): void {
  const snapshot = billingModuleState().invoiceSnapshots.get(invoice.id)
  if (snapshot) billingModuleState().invoiceSnapshots.set(invoice.id, { ...snapshot, ...structuredClone(invoice), updatedAt: now })
  const hold = financeHoldForInvoice(invoice, now)
  if (!hold) return
  billingModuleState().academicHolds.set(invoice.studentId, structuredClone(hold))
  const academic = krsModuleState().students.get(invoice.studentId)
  if (academic) krsModuleState().students.set(invoice.studentId, { ...academic, holds: mergeFinanceHold(academic.holds, hold), version: academic.version + 1, updatedAt: now })
}

async function synchronizeFirebaseHold(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  invoice: InvoiceRecord,
  now: string,
): Promise<void> {
  const hold = financeHoldForInvoice(invoice, now)
  if (!hold) return
  const academicRef = db.collection('studentAcademicStates').doc(invoice.studentId)
  const snapshot = await transaction.get(academicRef)
  if (!snapshot.exists) return
  const academic = { id: snapshot.id, ...snapshot.data() } as KrsStudentAcademicState
  transaction.update(academicRef, { holds: mergeFinanceHold(academic.holds, hold), version: academic.version + 1, updatedAt: now })
}

function paymentRecord(
  id: string,
  context: AuthContext,
  input: RecordPaymentInput,
  application: PaymentApplication,
  now: string,
): PaymentRecord {
  return {
    id,
    invoiceId: input.invoiceId,
    amount: input.amount,
    currency: 'IDR',
    channel: input.channel,
    externalReference: input.externalReference,
    receivedAt: input.receivedAt,
    recordedAt: now,
    recordedBy: context.uid,
    status: 'SETTLED',
    appliedAmountIdr: application.appliedAmountIdr,
    overpaymentAmountIdr: application.overpaymentAmountIdr,
    ...(application.overpaymentAmountIdr > 0
      ? { overpaymentDepositTransactionId: opaqueId('deposit_tx', `overpayment:${input.externalReference}`) }
      : {}),
  }
}

export async function recordPayment(
  context: AuthContext,
  input: RecordPaymentInput,
  idempotencyKey: string,
  event?: H3Event,
): Promise<RecordPaymentResult> {
  const hash = requestHash(input)
  const namespace = `payment:${idempotencyKey}`
  const paymentId = opaqueId('pay', idempotencyKey)
  const now = new Date().toISOString()
  let result: RecordPaymentResult

  if (dataMode() === 'mock') {
    const previous = mockState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
      return { ...(cloneValue(previous.response) as RecordPaymentResult), replayed: true, auditId: undefined }
    }
    if ([...mockState().payments.values()].some((payment) => payment.externalReference === input.externalReference)) {
      conflict('DUPLICATE_EXTERNAL_REFERENCE', 'Referensi pembayaran telah tercatat.')
    }
    const storedInvoice = mockState().invoices.get(input.invoiceId)
    if (!storedInvoice) notFound('Tagihan')
    requirePaymentScope(context, storedInvoice)
    const application = applyPayment(storedInvoice, input.amount)
    const invoice = application.invoice
    const payment = paymentRecord(paymentId, context, input, application, now)
    const overpayment = application.overpaymentAmountIdr > 0
      ? creditOverpayment(billingModuleState().depositAccounts.get(invoice.studentId), invoice, application.overpaymentAmountIdr, input.externalReference, context.uid, now)
      : undefined
    result = { payment, invoice, ...(overpayment ? { depositAccount: overpayment.account, depositTransaction: overpayment.transaction } : {}), replayed: false }
    mockState().invoices.set(invoice.id, cloneValue(invoice))
    synchronizeMockBilling(invoice, now)
    mockState().payments.set(payment.id, cloneValue(payment))
    if (overpayment) {
      billingModuleState().depositAccounts.set(invoice.studentId, cloneValue(overpayment.account))
      billingModuleState().depositTransactions.set(overpayment.transaction.id, cloneValue(overpayment.transaction))
    }
    mockState().idempotency.set(namespace, { requestHash: hash, response: cloneValue(result), createdAt: now })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan pembayaran tidak tersedia.')
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    const invoiceRef = db.collection('invoices').doc(input.invoiceId)
    const paymentRef = db.collection('payments').doc(paymentId)
    const externalRef = db.collection('paymentReferences').doc(opaqueId('ref', input.externalReference))

    result = await db.runTransaction(async (transaction) => {
      const previous = await transaction.get(idemRef)
      if (previous.exists) {
        const data = previous.data() as { requestHash: string; response: RecordPaymentResult }
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      const [invoiceSnapshot, referenceSnapshot] = await Promise.all([
        transaction.get(invoiceRef),
        transaction.get(externalRef),
      ])
      if (referenceSnapshot.exists) conflict('DUPLICATE_EXTERNAL_REFERENCE', 'Referensi pembayaran telah tercatat.')
      if (!invoiceSnapshot.exists) notFound('Tagihan')
      const current = { id: invoiceSnapshot.id, ...invoiceSnapshot.data() } as InvoiceRecord
      requirePaymentScope(context, current)
      const application = applyPayment(current, input.amount)
      const invoice = application.invoice
      const payment = paymentRecord(paymentId, context, input, application, now)
      let overpayment: { account: DepositAccount; transaction: DepositTransaction } | undefined
      let depositAccountRef: FirebaseFirestore.DocumentReference | undefined
      if (application.overpaymentAmountIdr > 0) {
        depositAccountRef = db.collection('billingDepositAccounts').doc(invoice.studentId)
        const accountSnapshot = await transaction.get(depositAccountRef)
        const currentAccount = accountSnapshot.exists
          ? ({ studentId: accountSnapshot.id, ...accountSnapshot.data() } as DepositAccount)
          : undefined
        overpayment = creditOverpayment(currentAccount, invoice, application.overpaymentAmountIdr, input.externalReference, context.uid, now)
      }
      const response: RecordPaymentResult = {
        payment,
        invoice,
        ...(overpayment ? { depositAccount: overpayment.account, depositTransaction: overpayment.transaction } : {}),
        replayed: false,
      }
      await synchronizeFirebaseHold(transaction, db, invoice, now)
      transaction.update(invoiceRef, invoice)
      transaction.create(paymentRef, payment)
      transaction.create(externalRef, { paymentId, externalReference: input.externalReference, createdAt: now })
      if (overpayment && depositAccountRef) {
        transaction.set(depositAccountRef, overpayment.account)
        transaction.create(db.collection('billingDepositTransactions').doc(overpayment.transaction.id), overpayment.transaction)
      }
      transaction.create(idemRef, { requestHash: hash, response, createdAt: now, expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
      return response
    })
  }

  if (!result.replayed) {
    const audit = await appendAudit({
      actor: context,
      action: 'PAYMENT_RECORDED',
      resourceType: 'payment',
      resourceId: result.payment.id,
      after: {
        invoiceId: result.invoice.id,
        amount: result.payment.amount,
        appliedAmountIdr: result.payment.appliedAmountIdr,
        overpaymentAmountIdr: result.payment.overpaymentAmountIdr,
        channel: result.payment.channel,
        externalReference: result.payment.externalReference,
        invoiceStatus: result.invoice.status,
      },
      event,
    })
    result.auditId = audit.id
  }
  return result
}

function applyReversal(invoice: InvoiceRecord, payment: PaymentRecord): InvoiceRecord {
  if ((payment.status || 'SETTLED') === 'REVERSED') conflict('PAYMENT_ALREADY_REVERSED', 'Pembayaran telah dibalik sebelumnya.')
  const appliedAmountIdr = payment.appliedAmountIdr ?? payment.amount
  if (invoice.paidAmount < appliedAmountIdr) {
    conflict('INVOICE_BALANCE_INCONSISTENT', 'Saldo tagihan lebih kecil dari pembayaran yang akan dibalik.')
  }
  const paidAmount = invoice.paidAmount - appliedAmountIdr
  return {
    ...invoice,
    paidAmount,
    status: paidAmount === 0 ? 'UNPAID' : 'PARTIALLY_PAID',
    version: invoice.version + 1,
  }
}

function reverseOverpayment(
  current: DepositAccount | undefined,
  invoice: InvoiceRecord,
  payment: PaymentRecord,
  reversalReference: string,
  actor: string,
  now: string,
): { account: DepositAccount; transaction: DepositTransaction } | undefined {
  const amountIdr = payment.overpaymentAmountIdr || 0
  if (amountIdr < 1) return undefined
  if (!current || current.studentId !== invoice.studentId || current.programStudyId !== invoice.programStudyId) {
    conflict('OVERPAYMENT_DEPOSIT_MISSING', 'Saldo kelebihan pembayaran tidak ditemukan.')
  }
  const balanceIdr = current.balanceIdr - amountIdr
  if (balanceIdr < (current.reservedRefundAmountIdr || 0)) {
    conflict('OVERPAYMENT_ALREADY_CONSUMED', 'Kelebihan pembayaran telah digunakan atau dicadangkan untuk refund.')
  }
  const account: DepositAccount = {
    ...current,
    balanceIdr,
    version: current.version + 1,
    updatedAt: now,
    updatedBy: actor,
  }
  const transaction: DepositTransaction = {
    id: opaqueId('deposit_tx', `overpayment-reversal:${reversalReference}`),
    studentId: invoice.studentId,
    programStudyId: invoice.programStudyId,
    amountIdr,
    balanceAfterIdr: balanceIdr,
    kind: 'OVERPAYMENT_REVERSAL',
    sourceReference: reversalReference,
    invoiceId: invoice.id,
    createdAt: now,
    createdBy: actor,
    immutable: true,
  }
  return { account, transaction }
}

export async function findPaymentByExternalReference(externalReference: string): Promise<PaymentRecord> {
  if (dataMode() === 'mock') {
    const payment = [...mockState().payments.values()].find(item => item.externalReference === externalReference)
    if (!payment) notFound('Pembayaran')
    return cloneValue(payment)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan pembayaran tidak tersedia.')
  const reference = await db.collection('paymentReferences').doc(opaqueId('ref', externalReference)).get()
  if (!reference.exists || typeof reference.data()?.paymentId !== 'string') notFound('Pembayaran')
  const payment = await db.collection('payments').doc(String(reference.data()!.paymentId)).get()
  if (!payment.exists) notFound('Pembayaran')
  return { id: payment.id, ...payment.data() } as PaymentRecord
}

export async function reversePayment(
  context: AuthContext,
  paymentId: string,
  input: ReversePaymentInput,
  idempotencyKey: string,
  event?: H3Event,
): Promise<ReversePaymentResult> {
  const normalizedInput = { ...input, reason: input.reason.slice(0, 500) }
  const hash = requestHash({ paymentId, ...normalizedInput })
  const namespace = `payment-reversal:${idempotencyKey}`
  const now = new Date().toISOString()
  let result: ReversePaymentResult

  const transition = (payment: PaymentRecord, invoice: InvoiceRecord): ReversePaymentResult => {
    requirePaymentScope(context, invoice)
    const updatedInvoice = applyReversal(invoice, payment)
    const updatedPayment: PaymentRecord = {
      ...payment,
      status: 'REVERSED',
      reversedAt: normalizedInput.reversedAt,
      reversedBy: context.uid,
      reversalExternalReference: normalizedInput.externalReference,
      reversalReason: normalizedInput.reason,
    }
    return { payment: updatedPayment, invoice: updatedInvoice, replayed: false }
  }

  if (dataMode() === 'mock') {
    const previous = mockState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk reversal berbeda.')
      return { ...(cloneValue(previous.response) as ReversePaymentResult), replayed: true, auditId: undefined }
    }
    if ([...mockState().payments.values()].some(payment => payment.reversalExternalReference === normalizedInput.externalReference)) {
      conflict('DUPLICATE_REVERSAL_REFERENCE', 'Referensi reversal telah digunakan.')
    }
    const payment = mockState().payments.get(paymentId)
    if (!payment) notFound('Pembayaran')
    const invoice = mockState().invoices.get(payment.invoiceId)
    if (!invoice) notFound('Tagihan')
    result = transition(cloneValue(payment), cloneValue(invoice))
    const overpayment = reverseOverpayment(
      billingModuleState().depositAccounts.get(invoice.studentId),
      invoice,
      payment,
      normalizedInput.externalReference,
      context.uid,
      now,
    )
    if (overpayment) result = { ...result, depositAccount: overpayment.account, depositTransaction: overpayment.transaction }
    mockState().payments.set(paymentId, cloneValue(result.payment))
    mockState().invoices.set(invoice.id, cloneValue(result.invoice))
    if (overpayment) {
      billingModuleState().depositAccounts.set(invoice.studentId, cloneValue(overpayment.account))
      billingModuleState().depositTransactions.set(overpayment.transaction.id, cloneValue(overpayment.transaction))
    }
    synchronizeMockBilling(result.invoice, now)
    mockState().idempotency.set(namespace, { requestHash: hash, response: cloneValue(result), createdAt: now })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan pembayaran tidak tersedia.')
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    const paymentRef = db.collection('payments').doc(paymentId)
    const reversalRef = db.collection('paymentReversalReferences').doc(opaqueId('reversal', normalizedInput.externalReference))
    result = await db.runTransaction(async (transaction) => {
      const [previous, paymentSnapshot, reversalSnapshot] = await Promise.all([
        transaction.get(idemRef), transaction.get(paymentRef), transaction.get(reversalRef),
      ])
      if (previous.exists) {
        const data = previous.data() as { requestHash: string; response: ReversePaymentResult }
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk reversal berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (reversalSnapshot.exists) conflict('DUPLICATE_REVERSAL_REFERENCE', 'Referensi reversal telah digunakan.')
      if (!paymentSnapshot.exists) notFound('Pembayaran')
      const payment = { id: paymentSnapshot.id, ...paymentSnapshot.data() } as PaymentRecord
      const invoiceRef = db.collection('invoices').doc(payment.invoiceId)
      const invoiceSnapshot = await transaction.get(invoiceRef)
      if (!invoiceSnapshot.exists) notFound('Tagihan')
      const invoice = { id: invoiceSnapshot.id, ...invoiceSnapshot.data() } as InvoiceRecord
      let overpayment: { account: DepositAccount; transaction: DepositTransaction } | undefined
      let depositAccountRef: FirebaseFirestore.DocumentReference | undefined
      if ((payment.overpaymentAmountIdr || 0) > 0) {
        depositAccountRef = db.collection('billingDepositAccounts').doc(invoice.studentId)
        const accountSnapshot = await transaction.get(depositAccountRef)
        const currentAccount = accountSnapshot.exists
          ? ({ studentId: accountSnapshot.id, ...accountSnapshot.data() } as DepositAccount)
          : undefined
        overpayment = reverseOverpayment(currentAccount, invoice, payment, normalizedInput.externalReference, context.uid, now)
      }
      const baseResponse = transition(payment, invoice)
      const response: ReversePaymentResult = {
        ...baseResponse,
        ...(overpayment ? { depositAccount: overpayment.account, depositTransaction: overpayment.transaction } : {}),
      }
      await synchronizeFirebaseHold(transaction, db, response.invoice, now)
      transaction.update(paymentRef, response.payment)
      transaction.update(invoiceRef, response.invoice)
      if (overpayment && depositAccountRef) {
        transaction.update(depositAccountRef, overpayment.account)
        transaction.create(db.collection('billingDepositTransactions').doc(overpayment.transaction.id), overpayment.transaction)
      }
      transaction.create(reversalRef, {
        paymentId, externalReference: normalizedInput.externalReference, createdAt: now,
      })
      transaction.create(idemRef, {
        requestHash: hash, response, createdAt: now, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      })
      return response
    })
  }

  if (!result.replayed) {
    const audit = await appendAudit({
      actor: context,
      action: 'PAYMENT_REVERSED',
      resourceType: 'payment',
      resourceId: result.payment.id,
      before: { status: 'SETTLED', invoicePaidAmount: result.invoice.paidAmount + (result.payment.appliedAmountIdr ?? result.payment.amount) },
      after: {
        status: result.payment.status,
        invoiceId: result.invoice.id,
        amount: result.payment.amount,
        appliedAmountIdr: result.payment.appliedAmountIdr,
        overpaymentAmountIdr: result.payment.overpaymentAmountIdr,
        invoicePaidAmount: result.invoice.paidAmount,
        reversalExternalReference: result.payment.reversalExternalReference,
        reason: result.payment.reversalReason,
      },
      event,
    })
    result.auditId = audit.id
  }
  return result
}
