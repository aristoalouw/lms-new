import { createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  GatewayReconciliationResult,
  GatewayReconciliationResultRow,
  GatewayReconciliationRow,
  PaymentGatewayEventRecord,
  PaymentGatewayPayload,
  VerifiedGatewayEvent,
} from '../types/payment-gateway'
import { PAYMENT_GATEWAY_EVENT_TYPES } from '../types/payment-gateway'
import { findPaymentByExternalReference, recordPayment, reversePayment } from './payments'
import { CampusError, conflict, forbidden, invalidInput, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { cloneValue, mockState } from '../utils/mock-store'
import { filterProgramScope, hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { normalizeIsoInstant, requirePositiveNumber, requireRecord, requireString } from '../utils/validation'

const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000
const MAX_WEBHOOK_BYTES = 64 * 1024
const GATEWAY_CHANNELS: PaymentGatewayPayload['channel'][] = ['bank_transfer', 'virtual_account', 'card', 'ewallet']

function configuredProvider(): string {
  const provider = process.env.PAYMENT_GATEWAY_PROVIDER_ID?.trim() || (process.env.NODE_ENV === 'production' ? '' : 'campus-bank')
  if (!provider || !/^[a-z][a-z0-9_-]{2,39}$/.test(provider)) serviceUnavailable('Payment gateway belum dikonfigurasi.')
  return provider
}

export function configuredPaymentGateway(): { provider: string; signatureAlgorithm: 'HMAC-SHA256' } {
  return { provider: configuredProvider(), signatureAlgorithm: 'HMAC-SHA256' }
}

function webhookSecret(): string {
  const secret = process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET || ''
  if (secret.length < 32) serviceUnavailable('Secret webhook payment gateway belum dikonfigurasi dengan aman.')
  return secret
}

function safeSignature(value: string): Buffer | null {
  const normalized = value.trim().replace(/^sha256=/i, '')
  return /^[a-f0-9]{64}$/i.test(normalized) ? Buffer.from(normalized, 'hex') : null
}

function parsePayload(rawBody: string): PaymentGatewayPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    invalidInput('Payload webhook bukan JSON yang valid.')
  }
  const body = requireRecord(parsed, 'payload')
  const eventType = requireString(body.eventType, 'eventType', { max: 40 }) as PaymentGatewayPayload['eventType']
  if (!PAYMENT_GATEWAY_EVENT_TYPES.includes(eventType)) invalidInput('Jenis event payment gateway tidak didukung.')
  const channel = requireString(body.channel, 'channel', { max: 30 }) as PaymentGatewayPayload['channel']
  if (!GATEWAY_CHANNELS.includes(channel)) invalidInput('Channel payment gateway tidak didukung.')
  const amount = requirePositiveNumber(body.amount, 'amount', 10_000_000_000)
  if (!Number.isInteger(amount)) invalidInput('amount harus berupa rupiah bulat.')
  const currency = requireString(body.currency, 'currency', { min: 3, max: 3 })
  if (currency !== 'IDR') invalidInput('Payment gateway hanya menerima currency IDR.')
  const payload: PaymentGatewayPayload = {
    eventId: requireString(body.eventId, 'eventId', { max: 100, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]+$/ }),
    eventType,
    transactionId: requireString(body.transactionId, 'transactionId', { max: 120, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]+$/ }),
    invoiceId: requireString(body.invoiceId, 'invoiceId', { max: 100, pattern: /^[A-Za-z0-9_-]+$/ }),
    amount,
    currency: 'IDR',
    channel,
    occurredAt: normalizeIsoInstant(body.occurredAt, 'occurredAt', { maxFutureMs: 5 * 60 * 1000 }),
    ...(body.originalExternalReference !== undefined
      ? { originalExternalReference: requireString(body.originalExternalReference, 'originalExternalReference', { max: 120, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]+$/ }) }
      : {}),
    ...(body.reason !== undefined ? { reason: requireString(body.reason, 'reason', { min: 5, max: 500 }) } : {}),
  }
  if (payload.eventType === 'payment.reversed' && (!payload.originalExternalReference || !payload.reason)) {
    invalidInput('Event reversal wajib memiliki originalExternalReference dan reason.')
  }
  return payload
}

export function signGatewayWebhook(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')
}

export function verifyGatewayWebhook(input: {
  provider: string
  rawBody: string
  signature?: string
  timestamp?: string
  eventIdHeader?: string
  now?: number
}): VerifiedGatewayEvent {
  if (input.provider !== configuredProvider()) throw new CampusError(404, 'GATEWAY_NOT_FOUND', 'Payment gateway tidak dikenali.')
  if (Buffer.byteLength(input.rawBody, 'utf8') > MAX_WEBHOOK_BYTES) throw new CampusError(413, 'PAYLOAD_TOO_LARGE', 'Payload webhook terlalu besar.')
  if (!input.signature || !input.timestamp || !/^\d{10}$/.test(input.timestamp)) {
    throw new CampusError(401, 'INVALID_GATEWAY_SIGNATURE', 'Signature payment gateway tidak valid.')
  }
  const signedAt = Number(input.timestamp) * 1000
  const now = input.now ?? Date.now()
  if (!Number.isSafeInteger(signedAt) || Math.abs(now - signedAt) > SIGNATURE_TOLERANCE_MS) {
    throw new CampusError(401, 'STALE_GATEWAY_SIGNATURE', 'Timestamp signature payment gateway berada di luar batas toleransi.')
  }
  const provided = safeSignature(input.signature)
  const expected = Buffer.from(signGatewayWebhook(webhookSecret(), input.timestamp, input.rawBody), 'hex')
  if (!provided || provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new CampusError(401, 'INVALID_GATEWAY_SIGNATURE', 'Signature payment gateway tidak valid.')
  }
  const payload = parsePayload(input.rawBody)
  if (input.eventIdHeader && input.eventIdHeader !== payload.eventId) {
    throw new CampusError(401, 'GATEWAY_EVENT_ID_MISMATCH', 'Identitas event pada header dan payload tidak sesuai.')
  }
  return {
    provider: input.provider,
    payload,
    payloadHash: requestHash(payload),
    signatureTimestamp: input.timestamp,
  }
}

function eventStorageId(provider: string, eventId: string): string {
  return opaqueId('gateway', `${provider}:${eventId}`)
}

async function readStoredEvent(provider: string, eventId: string): Promise<PaymentGatewayEventRecord | undefined> {
  const id = eventStorageId(provider, eventId)
  if (dataMode() === 'mock') {
    const record = mockState().paymentGatewayEvents.get(id)
    return record ? cloneValue(record) : undefined
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan event pembayaran tidak tersedia.')
  const snapshot = await db.collection('paymentGatewayEvents').doc(id).get()
  return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as PaymentGatewayEventRecord) : undefined
}

async function storeEvent(record: PaymentGatewayEventRecord): Promise<void> {
  if (dataMode() === 'mock') {
    const previous = mockState().paymentGatewayEvents.get(record.id)
    if (previous && previous.payloadHash !== record.payloadHash) conflict('GATEWAY_EVENT_CHANGED', 'Event ID payment gateway digunakan untuk payload berbeda.')
    mockState().paymentGatewayEvents.set(record.id, cloneValue(record))
    return
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan event pembayaran tidak tersedia.')
  const reference = db.collection('paymentGatewayEvents').doc(record.id)
  await db.runTransaction(async (transaction) => {
    const previous = await transaction.get(reference)
    if (previous.exists && previous.data()?.payloadHash !== record.payloadHash) {
      conflict('GATEWAY_EVENT_CHANGED', 'Event ID payment gateway digunakan untuk payload berbeda.')
    }
    transaction.set(reference, record)
  })
}

function gatewayActor(provider: string): AuthContext {
  const now = Date.now()
  return {
    uid: `system:payment-gateway:${provider}`,
    displayName: `Payment gateway ${provider}`,
    roles: ['administrator'],
    scope: { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] },
    provider: 'firebase',
    issuedAt: now,
    expiresAt: now + 60_000,
  }
}

export async function processGatewayEvent(
  verified: VerifiedGatewayEvent,
  event?: H3Event,
): Promise<{ accepted: true; event: PaymentGatewayEventRecord; replayed: boolean }> {
  const { provider, payload, payloadHash } = verified
  const id = eventStorageId(provider, payload.eventId)
  const previous = await readStoredEvent(provider, payload.eventId)
  if (previous) {
    if (previous.payloadHash !== payloadHash) conflict('GATEWAY_EVENT_CHANGED', 'Event ID payment gateway digunakan untuk payload berbeda.')
    if (previous.status === 'PROCESSED') return { accepted: true, event: previous, replayed: true }
  }

  const receivedAt = new Date().toISOString()
  const baseRecord: Omit<PaymentGatewayEventRecord, 'status'> = {
    id,
    provider,
    eventId: payload.eventId,
    eventType: payload.eventType,
    payloadHash,
    transactionId: payload.transactionId,
    invoiceId: payload.invoiceId,
    amount: payload.amount,
    currency: payload.currency,
    occurredAt: payload.occurredAt,
    receivedAt,
  }

  try {
    const actor = gatewayActor(provider)
    const result = payload.eventType === 'payment.settled'
      ? await recordPayment(actor, {
          invoiceId: payload.invoiceId,
          amount: payload.amount,
          channel: payload.channel,
          externalReference: payload.transactionId,
          receivedAt: payload.occurredAt,
        }, `gateway:${provider}:${payload.eventId}`, event)
      : await (async () => {
          const original = await findPaymentByExternalReference(payload.originalExternalReference!)
          if (original.invoiceId !== payload.invoiceId || original.amount !== payload.amount) {
            conflict('REVERSAL_PAYMENT_MISMATCH', 'Invoice atau nominal reversal tidak sesuai pembayaran awal.')
          }
          return reversePayment(actor, original.id, {
            externalReference: payload.transactionId,
            reversedAt: payload.occurredAt,
            reason: payload.reason!,
          }, `gateway-reversal:${provider}:${payload.eventId}`, event)
        })()

    const record: PaymentGatewayEventRecord = {
      ...baseRecord,
      programStudyId: result.invoice.programStudyId,
      status: 'PROCESSED',
      paymentId: result.payment.id,
      replayed: result.replayed,
    }
    await storeEvent(record)
    return { accepted: true, event: record, replayed: result.replayed }
  } catch (error) {
    const failureCode = error instanceof CampusError ? error.code : 'PROCESSING_FAILED'
    await storeEvent({ ...baseRecord, status: 'FAILED', failureCode }).catch(() => undefined)
    throw error
  }
}

function requireReconciliationRole(context: AuthContext): void {
  if (!hasRole(context, 'administrator', 'finance_staff', 'leader')) forbidden('Anda tidak memiliki akses rekonsiliasi pembayaran.')
}

function visibleForContext(context: AuthContext, record: PaymentGatewayEventRecord, programStudyId?: string): boolean {
  if (hasRole(context, 'administrator', 'leader')) return !programStudyId || record.programStudyId === programStudyId
  const scoped = programStudyId || (context.scope.programStudyIds.length === 1 ? context.scope.programStudyIds[0] : undefined)
  return Boolean(scoped && record.programStudyId === scoped && context.scope.programStudyIds.includes(scoped))
}

export async function listGatewayEvents(
  context: AuthContext,
  options: { provider?: string; status?: PaymentGatewayEventRecord['status']; programStudyId?: string; limit?: number } = {},
): Promise<PaymentGatewayEventRecord[]> {
  requireReconciliationRole(context)
  const provider = options.provider || configuredProvider()
  if (provider !== configuredProvider()) invalidInput('Provider payment gateway tidak didukung.')
  const programStudyId = options.programStudyId ? filterProgramScope(context, options.programStudyId) : undefined
  const limit = Math.min(Math.max(options.limit || 50, 1), 2_000)
  if (dataMode() === 'mock') {
    return [...mockState().paymentGatewayEvents.values()]
      .filter(record => record.provider === provider)
      .filter(record => !options.status || record.status === options.status)
      .filter(record => visibleForContext(context, record, programStudyId))
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
      .slice(0, limit)
      .map(cloneValue)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan event pembayaran tidak tersedia.')
  let query: FirebaseFirestore.Query = db.collection('paymentGatewayEvents')
    .where('provider', '==', provider)
    .orderBy('receivedAt', 'desc')
  const effectiveProgram = programStudyId
    || (!hasRole(context, 'administrator', 'leader') && context.scope.programStudyIds.length === 1
      ? context.scope.programStudyIds[0]
      : undefined)
  if (!hasRole(context, 'administrator', 'leader') && !effectiveProgram) invalidInput('programStudyId wajib dipilih untuk akun dengan beberapa lingkup.')
  if (effectiveProgram) query = query.where('programStudyId', '==', effectiveProgram)
  if (options.status) query = query.where('status', '==', options.status)
  const snapshot = await query.limit(limit).get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as PaymentGatewayEventRecord)
}

export async function reconcileGatewayReport(
  context: AuthContext,
  input: {
    provider: string
    periodStart: string
    periodEnd: string
    programStudyId?: string
    rows: GatewayReconciliationRow[]
  },
): Promise<GatewayReconciliationResult> {
  requireReconciliationRole(context)
  if (input.provider !== configuredProvider()) invalidInput('Provider payment gateway tidak didukung.')
  const start = Date.parse(input.periodStart)
  const end = Date.parse(input.periodEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 31 * 86_400_000) {
    invalidInput('Periode rekonsiliasi harus valid dan tidak lebih dari 31 hari.')
  }
  if (!input.rows.length || input.rows.length > 2_000) invalidInput('Laporan gateway harus berisi 1-2.000 baris.')
  const duplicates = new Set<string>()
  const seen = new Set<string>()
  input.rows.forEach((row) => {
    if (seen.has(row.eventId)) duplicates.add(row.eventId)
    seen.add(row.eventId)
  })
  if (duplicates.size) invalidInput('Laporan gateway memiliki eventId duplikat.')

  const internal = (await listGatewayEvents(context, {
    provider: input.provider,
    ...(input.programStudyId ? { programStudyId: input.programStudyId } : {}),
    limit: 2_000,
  })).filter(record => Date.parse(record.occurredAt) >= start && Date.parse(record.occurredAt) <= end)
  const internalByEvent = new Map(internal.map(record => [record.eventId, record]))
  const resultRows: GatewayReconciliationResultRow[] = input.rows.map((row) => {
    const match = internalByEvent.get(row.eventId)
    if (!match) return { ...row, status: 'MISSING_INTERNAL', note: 'Event ada pada laporan provider tetapi belum tercatat internal.' }
    internalByEvent.delete(row.eventId)
    if (match.transactionId !== row.transactionId || match.amount !== row.amount || match.currency !== row.currency || match.status !== 'PROCESSED') {
      return { ...row, status: 'MISMATCH', internalEventId: match.id, note: 'Referensi, nominal, currency, atau status berbeda.' }
    }
    return { ...row, status: 'MATCHED', internalEventId: match.id, note: 'Event cocok.' }
  })
  internalByEvent.forEach((record) => {
    resultRows.push({
      eventId: record.eventId,
      transactionId: record.transactionId,
      amount: record.amount,
      currency: record.currency,
      occurredAt: record.occurredAt,
      status: 'MISSING_PROVIDER',
      internalEventId: record.id,
      note: 'Event internal tidak ditemukan pada laporan provider.',
    })
  })

  return {
    provider: input.provider,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    counts: {
      providerRows: input.rows.length,
      internalRows: internal.length,
      matched: resultRows.filter(row => row.status === 'MATCHED').length,
      missingInternal: resultRows.filter(row => row.status === 'MISSING_INTERNAL').length,
      missingProvider: resultRows.filter(row => row.status === 'MISSING_PROVIDER').length,
      mismatched: resultRows.filter(row => row.status === 'MISMATCH').length,
    },
    rows: resultRows,
  }
}
