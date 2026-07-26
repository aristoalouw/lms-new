import { Timestamp } from 'firebase-admin/firestore'

const HOUR_MS = 60 * 60 * 1000

export const FIRESTORE_TTL_RETENTION_MS = {
  idempotency: 24 * HOUR_MS,
  communicationKey: 7 * 24 * HOUR_MS,
  expiredUploadSessionGrace: 24 * HOUR_MS,
  expiredRateLimitGrace: 24 * HOUR_MS,
} as const

type FirestoreTimeInput = Date | number | string

function millis(value: FirestoreTimeInput): number {
  const result = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : Date.parse(value)
  if (!Number.isFinite(result)) throw new TypeError('Waktu purge Firestore tidak valid.')
  return result
}

/**
 * Firestore TTL accepts a timestamp field, not an ISO string. Keeping this
 * conversion at the persistence boundary lets domain records continue to use
 * serializable UTC strings while temporary documents receive a real Timestamp.
 */
export function firestorePurgeAfter(
  value: FirestoreTimeInput,
  retentionMs = 0,
): Timestamp {
  if (!Number.isSafeInteger(retentionMs) || retentionMs < 0) {
    throw new TypeError('Retensi purge Firestore tidak valid.')
  }
  return Timestamp.fromMillis(millis(value) + retentionMs)
}

export function withFirestorePurgeAfter<T extends Record<string, unknown>>(
  record: T,
  value: FirestoreTimeInput,
  retentionMs = 0,
): T & { purgeAfter: Timestamp } {
  return {
    ...record,
    purgeAfter: firestorePurgeAfter(value, retentionMs),
  }
}
