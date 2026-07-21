import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import { appendAudit } from '../utils/audit'
import { invalidInput } from '../utils/errors'
import { authAdmin, dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { mockState } from '../utils/mock-store'
import { opaqueId, requestHash } from '../utils/security'
import { requireRecord, requireString } from '../utils/validation'
import { findActiveAccountByEmail } from './accounts'
import { enqueuePasswordResetEmail } from './notifications'

export interface PasswordResetDeliveryMessage {
  recipientUid: string
  recipient: string
  resetLink: string
  requestId: string
  expiresInMinutes: number
}

export interface PasswordResetDelivery {
  deliver(message: PasswordResetDeliveryMessage): Promise<void>
}

export interface PasswordResetAcceptedResponse {
  accepted: true
  message: string
}

const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i
const RESET_RESPONSE: PasswordResetAcceptedResponse = {
  accepted: true,
  message: 'Jika akun memenuhi syarat, petunjuk pengaturan ulang kata sandi akan dikirim.',
}
const RESET_IDEMPOTENCY_TTL_MS = 60 * 60 * 1000

let configuredDelivery: PasswordResetDelivery | null = null
const mockDeliveries: PasswordResetDeliveryMessage[] = []

const mockDelivery: PasswordResetDelivery = {
  async deliver(message) {
    mockDeliveries.push(structuredClone(message))
  },
}

function normalizeEmail(value: unknown): string {
  return requireString(value, 'email', { max: 254, pattern: EMAIL_PATTERN }).toLocaleLowerCase('en-US')
}

function anonymousActor(now = Date.now()): AuthContext {
  return {
    uid: 'anonymous-password-reset',
    displayName: 'Permintaan reset kata sandi',
    roles: [],
    scope: { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] },
    provider: 'demo',
    issuedAt: now,
    expiresAt: now,
  }
}

async function reserveRequest(idempotencyKey: string, emailHash: string): Promise<boolean> {
  const namespace = `password-reset:${idempotencyKey}`
  const now = new Date().toISOString()
  if (dataMode() === 'mock') {
    if (mockState().idempotency.has(namespace)) return false
    mockState().idempotency.set(namespace, {
      requestHash: emailHash,
      response: RESET_RESPONSE,
      createdAt: now,
    })
    return true
  }

  const db = firestoreAdmin()
  if (!db) return false
  const reference = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference)
    if (existing.exists) return false
    transaction.create(reference, {
      requestHash: emailHash,
      response: RESET_RESPONSE,
      createdAt: now,
      expiresAt: new Date(Date.now() + RESET_IDEMPOTENCY_TTL_MS).toISOString(),
      purpose: 'PASSWORD_RESET_REQUEST',
    })
    return true
  })
}

async function generateResetLink(email: string, requestId: string): Promise<string> {
  if (dataMode() === 'mock') return `https://example.test/reset-password?operation=${opaqueId('reset', `${requestId}:${email}`)}`
  const admin = authAdmin()
  if (!admin) throw new Error('Firebase Admin Auth is unavailable.')
  const continueUrl = process.env.PASSWORD_RESET_CONTINUE_URL
  return admin.generatePasswordResetLink(email, continueUrl
    ? { url: continueUrl, handleCodeInApp: false }
    : undefined)
}

function directDeliveryProvider(): PasswordResetDelivery | null {
  if (configuredDelivery) return configuredDelivery
  if (process.env.NODE_ENV !== 'production' && dataMode() === 'mock') return mockDelivery
  return null
}

export function parsePasswordResetRequest(value: unknown): { email: string } {
  const body = requireRecord(value)
  const unknown = Object.keys(body).filter((key) => key !== 'email')
  if (unknown.length) invalidInput(`Field tidak didukung: ${unknown.join(', ')}.`)
  return { email: normalizeEmail(body.email) }
}

export async function requestPasswordReset(
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
): Promise<PasswordResetAcceptedResponse> {
  const { email } = parsePasswordResetRequest(value)
  const emailHash = requestHash({ email })
  const freshRequest = await reserveRequest(idempotencyKey, emailHash)
  if (!freshRequest) return { ...RESET_RESPONSE }

  const requestId = opaqueId('pwdreset', `${idempotencyKey}:${emailHash}`)
  let operationalResult: 'DELIVERED' | 'QUEUED' | 'NO_ELIGIBLE_ACCOUNT' | 'DELIVERY_FAILED' = 'NO_ELIGIBLE_ACCOUNT'

  try {
    const account = await findActiveAccountByEmail(email)
    const delivery = directDeliveryProvider()
    if (account) {
      if (delivery) {
        const resetLink = await generateResetLink(email, requestId)
        await delivery.deliver({ recipientUid: account.id, recipient: email, resetLink, requestId, expiresInMinutes: 60 })
        operationalResult = 'DELIVERED'
      } else {
        await enqueuePasswordResetEmail({
          recipientUid: account.id,
          recipientEmail: email,
          continuePath: '/login',
        }, `password-reset-email:${requestId}`)
        operationalResult = 'QUEUED'
      }
    }
  } catch {
    // Delivery and account lookup failures intentionally do not alter the public response.
    operationalResult = 'DELIVERY_FAILED'
  }

  try {
    await appendAudit({
      actor: anonymousActor(),
      action: 'PASSWORD_RESET_REQUEST_ACCEPTED',
      resourceType: 'account-recovery',
      resourceId: requestId,
      outcome: operationalResult === 'DELIVERY_FAILED' ? 'FAILURE' : 'SUCCESS',
      metadata: { operationalResult },
      event,
    })
  } catch {
    // Audit availability must not turn the endpoint into an account-enumeration oracle.
  }

  return { ...RESET_RESPONSE }
}

/** Inject the real email provider from the deployment composition root. */
export function configurePasswordResetDelivery(delivery: PasswordResetDelivery | null): void {
  configuredDelivery = delivery
}

export function resetPasswordResetStateForTests(): void {
  configuredDelivery = null
  mockDeliveries.splice(0, mockDeliveries.length)
}

export function passwordResetDeliveriesForTests(): PasswordResetDeliveryMessage[] {
  return structuredClone(mockDeliveries)
}
