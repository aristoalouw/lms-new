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
import type { BillingAcademicHold } from '../types/billing'

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
  replayed: boolean
  auditId?: string
}

function applyPayment(invoice: InvoiceRecord, amount: number): InvoiceRecord {
  if (invoice.status === 'VOID') conflict('INVOICE_VOID', 'Tagihan telah dibatalkan.')
  if (invoice.status === 'PAID') conflict('INVOICE_ALREADY_PAID', 'Tagihan telah lunas.')
  const remaining = invoice.totalAmount - invoice.paidAmount
  if (amount > remaining) {
    conflict('PAYMENT_EXCEEDS_BALANCE', 'Nominal pembayaran melebihi sisa tagihan.', { remainingAmount: remaining })
  }
  const paidAmount = invoice.paidAmount + amount
  return {
    ...invoice,
    paidAmount,
    status: paidAmount === invoice.totalAmount ? 'PAID' : 'PARTIALLY_PAID',
    version: invoice.version + 1,
  }
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
    const invoice = applyPayment(storedInvoice, input.amount)
    const payment = paymentRecord(paymentId, context, input, now)
    result = { payment, invoice, replayed: false }
    mockState().invoices.set(invoice.id, cloneValue(invoice))
    synchronizeMockBilling(invoice, now)
    mockState().payments.set(payment.id, cloneValue(payment))
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
      const invoice = applyPayment(current, input.amount)
      const payment = paymentRecord(paymentId, context, input, now)
      const response: RecordPaymentResult = { payment, invoice, replayed: false }
      await synchronizeFirebaseHold(transaction, db, invoice, now)
      transaction.update(invoiceRef, invoice)
      transaction.create(paymentRef, payment)
      transaction.create(externalRef, { paymentId, externalReference: input.externalReference, createdAt: now })
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
  if (invoice.paidAmount < payment.amount) {
    conflict('INVOICE_BALANCE_INCONSISTENT', 'Saldo tagihan lebih kecil dari pembayaran yang akan dibalik.')
  }
  const paidAmount = invoice.paidAmount - payment.amount
  return {
    ...invoice,
    paidAmount,
    status: paidAmount === 0 ? 'UNPAID' : 'PARTIALLY_PAID',
    version: invoice.version + 1,
  }
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
    mockState().payments.set(paymentId, cloneValue(result.payment))
    mockState().invoices.set(invoice.id, cloneValue(result.invoice))
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
      const response = transition(payment, invoice)
      await synchronizeFirebaseHold(transaction, db, response.invoice, now)
      transaction.update(paymentRef, response.payment)
      transaction.update(invoiceRef, response.invoice)
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
      before: { status: 'SETTLED', invoicePaidAmount: result.invoice.paidAmount + result.payment.amount },
      after: {
        status: result.payment.status,
        invoiceId: result.invoice.id,
        amount: result.payment.amount,
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
