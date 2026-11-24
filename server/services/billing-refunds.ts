import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  BillingRefundRequest,
  BillingStudentProfile,
  BillingWriteResult,
  DepositAccount,
  DepositTransaction,
} from '../types/billing'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { hasProgramAccess, hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { requireInteger, requireRecord, requireString } from '../utils/validation'
import { billingIdempotencyRecord, billingModuleState, saveBillingReplay } from './billing-state'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/
const IDEMPOTENCY_TTL_MS = 7 * 86_400_000

function clone<T>(value: T): T {
  return structuredClone(value)
}

function requireFinanceScope(context: AuthContext, programStudyId: string): void {
  if (!hasRole(context, 'finance_staff')) forbidden('Tindakan refund hanya tersedia untuk pengelola keuangan.')
  if (!hasProgramAccess(context, programStudyId)) forbidden('Refund berada di luar lingkup program studi Anda.')
}

function safeId(value: unknown, label: string): string {
  return requireString(value, label, { max: 128, pattern: SAFE_ID })
}

function rejectUnknown(body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body).filter(key => !allowed.includes(key))
  if (unknown.length) invalidInput(`Field tidak didukung: ${unknown.join(', ')}.`)
}

async function billingProfile(studentId: string): Promise<BillingStudentProfile> {
  if (dataMode() === 'mock') {
    const profile = billingModuleState().profiles.get(studentId)
    if (!profile) notFound('Profil billing mahasiswa')
    return clone(profile)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan profil billing tidak tersedia.')
  const snapshot = await db.collection('billingStudentProfiles').doc(studentId).get()
  if (!snapshot.exists) notFound('Profil billing mahasiswa')
  return { studentId: snapshot.id, ...snapshot.data() } as BillingStudentProfile
}

export async function getDepositAccount(context: AuthContext, studentIdValue: string): Promise<DepositAccount> {
  const studentId = safeId(studentIdValue, 'studentId')
  const profile = await billingProfile(studentId)
  const ownsProfile = hasRole(context, 'student')
    && (profile.studentUid === context.uid || context.scope.studentIds.includes(studentId))
  const managesProfile = hasRole(context, 'finance_staff')
    && context.scope.programStudyIds.includes(profile.programStudyId)
  if (!ownsProfile && !managesProfile) forbidden('Saldo deposit berada di luar lingkup akses Anda.')

  if (dataMode() === 'mock') {
    const account = billingModuleState().depositAccounts.get(studentId)
    return account
      ? clone(account)
      : { studentId, programStudyId: profile.programStudyId, balanceIdr: 0, reservedRefundAmountIdr: 0, version: 0, updatedAt: '', updatedBy: '' }
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan saldo deposit tidak tersedia.')
  const snapshot = await db.collection('billingDepositAccounts').doc(studentId).get()
  return snapshot.exists
    ? ({ studentId: snapshot.id, ...snapshot.data() } as DepositAccount)
    : { studentId, programStudyId: profile.programStudyId, balanceIdr: 0, reservedRefundAmountIdr: 0, version: 0, updatedAt: '', updatedBy: '' }
}

function parseRequest(value: unknown): { studentId: string; amountIdr: number; reason: string; expectedDepositVersion: number } {
  const body = requireRecord(value)
  rejectUnknown(body, ['studentId', 'amountIdr', 'reason', 'expectedDepositVersion'])
  return {
    studentId: safeId(body.studentId, 'studentId'),
    amountIdr: requireInteger(body.amountIdr, 'amountIdr', 1, 100_000_000_000_000),
    reason: requireString(body.reason, 'reason', { min: 10, max: 500 }),
    expectedDepositVersion: requireInteger(body.expectedDepositVersion, 'expectedDepositVersion', 1, 1_000_000),
  }
}

export async function requestDepositRefund(
  context: AuthContext,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<BillingWriteResult<{ refund: BillingRefundRequest; account: DepositAccount }>> {
  if (!hasRole(context, 'finance_staff')) forbidden('Tindakan refund hanya tersedia untuk pengelola keuangan.')
  const input = parseRequest(value)
  const profile = await billingProfile(input.studentId)
  requireFinanceScope(context, profile.programStudyId)
  const now = clock.toISOString()
  const hash = requestHash(input)
  const namespace = `billing:refund-request:${context.uid}:${idempotencyKey}`
  const refundId = opaqueId('billing_refund', `${context.uid}:${idempotencyKey}`)
  let result: BillingWriteResult<{ refund: BillingRefundRequest; account: DepositAccount }>

  const transition = (account: DepositAccount) => {
    if (account.version !== input.expectedDepositVersion) conflict('VERSION_CONFLICT', 'Saldo deposit telah berubah.', { currentVersion: account.version })
    const reserved = account.reservedRefundAmountIdr || 0
    if (input.amountIdr > account.balanceIdr - reserved) conflict('REFUND_EXCEEDS_AVAILABLE', 'Nominal refund melebihi saldo deposit yang tersedia.')
    const refund: BillingRefundRequest = {
      id: refundId,
      studentId: input.studentId,
      programStudyId: profile.programStudyId,
      amountIdr: input.amountIdr,
      reason: input.reason,
      status: 'PENDING',
      version: 1,
      requestedAt: now,
      requestedBy: context.uid,
    }
    const nextAccount: DepositAccount = {
      ...account,
      reservedRefundAmountIdr: reserved + input.amountIdr,
      version: account.version + 1,
      updatedAt: now,
      updatedBy: context.uid,
    }
    return { refund, account: nextAccount }
  }

  if (dataMode() === 'mock') {
    const prior = billingIdempotencyRecord(namespace)
    if (prior) {
      if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk refund berbeda.')
      return { ...(clone(prior.response) as typeof result), replayed: true, auditId: undefined }
    }
    const account = billingModuleState().depositAccounts.get(input.studentId)
    if (!account) conflict('DEPOSIT_UNAVAILABLE', 'Mahasiswa belum memiliki saldo deposit.')
    const next = transition(clone(account))
    billingModuleState().depositAccounts.set(input.studentId, clone(next.account))
    billingModuleState().refunds.set(refundId, clone(next.refund))
    result = { value: next, replayed: false }
    saveBillingReplay(namespace, hash, result, now)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan refund tidak tersedia.')
    const accountRef = db.collection('billingDepositAccounts').doc(input.studentId)
    const refundRef = db.collection('billingRefundRequests').doc(refundId)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [prior, accountSnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(accountRef)])
      if (prior.exists) {
        const stored = prior.data() as { requestHash: string; response: typeof result }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk refund berbeda.')
        return { ...stored.response, replayed: true, auditId: undefined }
      }
      if (!accountSnapshot.exists) conflict('DEPOSIT_UNAVAILABLE', 'Mahasiswa belum memiliki saldo deposit.')
      const next = transition({ studentId: accountSnapshot.id, ...accountSnapshot.data() } as DepositAccount)
      const response = { value: next, replayed: false } satisfies typeof result
      transaction.update(accountRef, next.account)
      transaction.create(refundRef, next.refund)
      transaction.create(idemRef, { requestHash: hash, response, createdAt: now, expiresAt: new Date(clock.getTime() + IDEMPOTENCY_TTL_MS).toISOString() })
      return response
    })
    if (result.replayed) return result
  }

  const audit = await appendAudit({
    actor: context,
    action: 'BILLING_REFUND_REQUESTED',
    resourceType: 'billing_refund',
    resourceId: result.value.refund.id,
    after: { studentId: input.studentId, amountIdr: input.amountIdr, status: 'PENDING' },
    event,
  })
  result.auditId = audit.id
  return result
}

function parseReview(value: unknown): {
  status: 'DISBURSED' | 'REJECTED'
  expectedVersion: number
  externalReference?: string
  reviewReason?: string
} {
  const body = requireRecord(value)
  rejectUnknown(body, ['status', 'expectedVersion', 'externalReference', 'reviewReason'])
  const status = requireString(body.status, 'status', { max: 20 }) as 'DISBURSED' | 'REJECTED'
  if (!['DISBURSED', 'REJECTED'].includes(status)) invalidInput('Status review refund tidak didukung.')
  const externalReference = body.externalReference === undefined
    ? undefined
    : requireString(body.externalReference, 'externalReference', { min: 4, max: 160, pattern: REFERENCE })
  const reviewReason = body.reviewReason === undefined
    ? undefined
    : requireString(body.reviewReason, 'reviewReason', { min: 5, max: 500 })
  if (status === 'DISBURSED' && !externalReference) invalidInput('Referensi pencairan wajib diisi.')
  if (status === 'REJECTED' && !reviewReason) invalidInput('Alasan penolakan wajib diisi.')
  return { status, expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1, 1_000_000), ...(externalReference ? { externalReference } : {}), ...(reviewReason ? { reviewReason } : {}) }
}

export async function reviewDepositRefund(
  context: AuthContext,
  refundIdValue: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<BillingWriteResult<{ refund: BillingRefundRequest; account: DepositAccount; transaction?: DepositTransaction }>> {
  if (!hasRole(context, 'finance_staff')) forbidden('Review refund hanya tersedia untuk pengelola keuangan.')
  const refundId = safeId(refundIdValue, 'refundId')
  const input = parseReview(value)
  const now = clock.toISOString()
  const hash = requestHash({ refundId, ...input })
  const namespace = `billing:refund-review:${context.uid}:${idempotencyKey}`
  let result: BillingWriteResult<{ refund: BillingRefundRequest; account: DepositAccount; transaction?: DepositTransaction }>

  const transition = (refund: BillingRefundRequest, account: DepositAccount) => {
    requireFinanceScope(context, refund.programStudyId)
    if (refund.status !== 'PENDING') conflict('REFUND_ALREADY_REVIEWED', 'Refund telah diproses sebelumnya.')
    if (refund.requestedBy === context.uid) forbidden('Pemohon refund tidak boleh menyetujui atau menolak permintaannya sendiri.')
    if (refund.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Permintaan refund telah berubah.', { currentVersion: refund.version })
    if (account.studentId !== refund.studentId || account.programStudyId !== refund.programStudyId) conflict('DEPOSIT_OWNER_MISMATCH', 'Saldo deposit dan refund tidak cocok.')
    const reserved = account.reservedRefundAmountIdr || 0
    if (reserved < refund.amountIdr) conflict('REFUND_RESERVATION_MISSING', 'Cadangan saldo refund tidak konsisten.')
    const disbursed = input.status === 'DISBURSED'
    if (disbursed && account.balanceIdr < refund.amountIdr) conflict('REFUND_BALANCE_INSUFFICIENT', 'Saldo deposit tidak cukup untuk pencairan refund.')
    const nextAccount: DepositAccount = {
      ...account,
      balanceIdr: disbursed ? account.balanceIdr - refund.amountIdr : account.balanceIdr,
      reservedRefundAmountIdr: reserved - refund.amountIdr,
      version: account.version + 1,
      updatedAt: now,
      updatedBy: context.uid,
    }
    const transaction: DepositTransaction | undefined = disbursed ? {
      id: opaqueId('deposit_tx', `refund:${input.externalReference}`),
      studentId: refund.studentId,
      programStudyId: refund.programStudyId,
      amountIdr: refund.amountIdr,
      balanceAfterIdr: nextAccount.balanceIdr,
      kind: 'REFUND',
      sourceReference: input.externalReference!,
      createdAt: now,
      createdBy: context.uid,
      immutable: true,
    } : undefined
    const nextRefund: BillingRefundRequest = {
      ...refund,
      status: input.status,
      version: refund.version + 1,
      reviewedAt: now,
      reviewedBy: context.uid,
      ...(input.reviewReason ? { reviewReason: input.reviewReason } : {}),
      ...(input.externalReference ? { disbursementReference: input.externalReference } : {}),
      ...(transaction ? { depositTransactionId: transaction.id } : {}),
    }
    return { refund: nextRefund, account: nextAccount, ...(transaction ? { transaction } : {}) }
  }

  if (dataMode() === 'mock') {
    const prior = billingIdempotencyRecord(namespace)
    if (prior) {
      if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk review berbeda.')
      return { ...(clone(prior.response) as typeof result), replayed: true, auditId: undefined }
    }
    const refund = billingModuleState().refunds.get(refundId)
    if (!refund) notFound('Permintaan refund')
    const account = billingModuleState().depositAccounts.get(refund.studentId)
    if (!account) conflict('DEPOSIT_UNAVAILABLE', 'Saldo deposit mahasiswa tidak ditemukan.')
    if (input.externalReference && [...billingModuleState().depositTransactions.values()].some(item => item.sourceReference === input.externalReference)) {
      conflict('DUPLICATE_EXTERNAL_REFERENCE', 'Referensi pencairan refund telah digunakan.')
    }
    const next = transition(clone(refund), clone(account))
    billingModuleState().refunds.set(refundId, clone(next.refund))
    billingModuleState().depositAccounts.set(refund.studentId, clone(next.account))
    if (next.transaction) billingModuleState().depositTransactions.set(next.transaction.id, clone(next.transaction))
    result = { value: next, replayed: false }
    saveBillingReplay(namespace, hash, result, now)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan refund tidak tersedia.')
    const refundRef = db.collection('billingRefundRequests').doc(refundId)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [prior, refundSnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(refundRef)])
      if (prior.exists) {
        const stored = prior.data() as { requestHash: string; response: typeof result }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk review berbeda.')
        return { ...stored.response, replayed: true, auditId: undefined }
      }
      if (!refundSnapshot.exists) notFound('Permintaan refund')
      const refund = { id: refundSnapshot.id, ...refundSnapshot.data() } as BillingRefundRequest
      const accountRef = db.collection('billingDepositAccounts').doc(refund.studentId)
      const accountSnapshot = await transaction.get(accountRef)
      if (!accountSnapshot.exists) conflict('DEPOSIT_UNAVAILABLE', 'Saldo deposit mahasiswa tidak ditemukan.')
      let referenceRef: FirebaseFirestore.DocumentReference | undefined
      if (input.externalReference) {
        referenceRef = db.collection('billingRefundReferences').doc(opaqueId('refund_ref', input.externalReference))
        if ((await transaction.get(referenceRef)).exists) conflict('DUPLICATE_EXTERNAL_REFERENCE', 'Referensi pencairan refund telah digunakan.')
      }
      const next = transition(refund, { studentId: accountSnapshot.id, ...accountSnapshot.data() } as DepositAccount)
      const response = { value: next, replayed: false } satisfies typeof result
      transaction.update(refundRef, next.refund)
      transaction.update(accountRef, next.account)
      if (next.transaction) transaction.create(db.collection('billingDepositTransactions').doc(next.transaction.id), next.transaction)
      if (referenceRef && next.transaction) transaction.create(referenceRef, { refundId, transactionId: next.transaction.id, createdAt: now })
      transaction.create(idemRef, { requestHash: hash, response, createdAt: now, expiresAt: new Date(clock.getTime() + IDEMPOTENCY_TTL_MS).toISOString() })
      return response
    })
    if (result.replayed) return result
  }

  const audit = await appendAudit({
    actor: context,
    action: input.status === 'DISBURSED' ? 'BILLING_REFUND_DISBURSED' : 'BILLING_REFUND_REJECTED',
    resourceType: 'billing_refund',
    resourceId: refundId,
    before: { status: 'PENDING', version: input.expectedVersion },
    after: { status: result.value.refund.status, version: result.value.refund.version, amountIdr: result.value.refund.amountIdr },
    event,
  })
  result.auditId = audit.id
  return result
}

export async function listDepositRefunds(
  context: AuthContext,
  options: { programStudyId?: string; status?: BillingRefundRequest['status']; limit?: number } = {},
): Promise<BillingRefundRequest[]> {
  if (!hasRole(context, 'finance_staff')) forbidden('Daftar refund hanya tersedia untuk pengelola keuangan.')
  const programStudyId = options.programStudyId
    || (context.scope.programStudyIds.length === 1 ? context.scope.programStudyIds[0] : undefined)
  if (!programStudyId) invalidInput('programStudyId wajib dipilih untuk akun dengan beberapa lingkup.')
  requireFinanceScope(context, programStudyId)
  const limit = Math.min(Math.max(options.limit || 50, 1), 100)
  if (dataMode() === 'mock') {
    return [...billingModuleState().refunds.values()]
      .filter(item => item.programStudyId === programStudyId && (!options.status || item.status === options.status))
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
      .slice(0, limit)
      .map(clone)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan refund tidak tersedia.')
  let query: FirebaseFirestore.Query = db.collection('billingRefundRequests')
    .where('programStudyId', '==', programStudyId)
    .orderBy('requestedAt', 'desc')
  if (options.status) query = query.where('status', '==', options.status)
  const snapshot = await query.limit(limit).get()
  return snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as BillingRefundRequest)
}
