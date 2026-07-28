import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { describe, expect, it } from 'vitest'
import {
  FIRESTORE_TTL_RETENTION_MS,
  firestorePurgeAfter,
  withFirestorePurgeAfter,
} from '../../server/utils/firestore-ttl'
import { FirestoreRateLimitStore } from '../../server/utils/rate-limit'

interface FieldOverride {
  collectionGroup: string
  fieldPath: string
  ttl?: boolean
  indexes?: unknown[]
}

describe('Firestore TTL safeguards', () => {
  it('creates a real Firestore Timestamp without changing the durable payload', () => {
    const createdAt = '2026-07-27T01:02:03.000Z'
    const record = withFirestorePurgeAfter(
      { requestHash: 'opaque', createdAt },
      createdAt,
      FIRESTORE_TTL_RETENTION_MS.idempotency,
    )

    expect(record.purgeAfter).toBeInstanceOf(Timestamp)
    expect(record.purgeAfter.toMillis()).toBe(
      Date.parse(createdAt) + FIRESTORE_TTL_RETENTION_MS.idempotency,
    )
    expect(record).toMatchObject({ requestHash: 'opaque', createdAt })
    expect(() => firestorePurgeAfter('not-a-date')).toThrow('Waktu purge Firestore tidak valid.')
    expect(() => firestorePurgeAfter(createdAt, -1)).toThrow('Retensi purge Firestore tidak valid.')
  })

  it('enables TTL only for the approved ephemeral LMS collection groups', () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), 'firebase/firestore.indexes.json'), 'utf8'),
    ) as { fieldOverrides: FieldOverride[] }
    const ttlOverrides = config.fieldOverrides.filter(override => override.ttl === true)

    expect(ttlOverrides.map(override => override.collectionGroup).sort()).toEqual([
      'attendanceChallenges',
      'communicationIdempotency',
      'fileUploadSessions',
      'idempotencyKeys',
      'learningIdempotency',
      'rateLimitBuckets',
    ])
    expect(ttlOverrides.every(override => (
      override.fieldPath === 'purgeAfter'
      && Array.isArray(override.indexes)
      && override.indexes.length === 0
    ))).toBe(true)
  })

  it('generates a Spark-safe deployment config without TTL billing policies', () => {
    const outputDirectory = mkdtempSync(resolve(tmpdir(), 'lms-firebase-spark-'))
    try {
      execFileSync(process.execPath, [
        resolve(process.cwd(), 'scripts/prepare-firebase-spark.mjs'),
        `--out=${outputDirectory}`,
      ], { stdio: 'pipe' })
      const source = JSON.parse(
        readFileSync(resolve(process.cwd(), 'firebase/firestore.indexes.json'), 'utf8'),
      ) as { indexes: unknown[]; fieldOverrides: FieldOverride[] }
      const generated = JSON.parse(
        readFileSync(resolve(outputDirectory, 'firestore.indexes.json'), 'utf8'),
      ) as { indexes: unknown[]; fieldOverrides: FieldOverride[] }

      expect(generated.indexes).toEqual(source.indexes)
      expect(generated.fieldOverrides).toHaveLength(source.fieldOverrides.length)
      expect(generated.fieldOverrides.some(override => override.ttl === true)).toBe(false)
      expect(generated.fieldOverrides.filter(override => override.fieldPath === 'purgeAfter'))
        .toHaveLength(6)
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true })
    }
  })

  it('writes rate-limit bucket expiry with a TTL-safe Timestamp and cleanup grace', async () => {
    let written: Record<string, unknown> | undefined
    const reference = { id: 'hashed-rate-limit-key' }
    const db = {
      collection(name: string) {
        expect(name).toBe('rateLimitBuckets')
        return {
          doc(id: string) {
            expect(id).toMatch(/^[a-f0-9]{64}$/)
            return reference
          },
        }
      },
      async runTransaction<T>(callback: (transaction: {
        get: () => Promise<{ exists: boolean; data: () => undefined }>
        set: (_reference: unknown, value: Record<string, unknown>) => void
      }) => Promise<T>): Promise<T> {
        return callback({
          get: async () => ({ exists: false, data: () => undefined }),
          set: (_storedReference, value) => {
            written = value
          },
        })
      },
    } as unknown as Firestore
    const now = Date.parse('2026-07-27T03:00:00.000Z')
    const windowMs = 60_000

    await new FirestoreRateLimitStore(db).consume('opaque:rate-limit-key', { limit: 5, windowMs }, now)

    expect(written).toBeDefined()
    expect(written).not.toHaveProperty('expiresAt')
    expect(written?.purgeAfter).toBeInstanceOf(Timestamp)
    expect((written?.purgeAfter as Timestamp).toMillis()).toBe(
      now + windowMs + FIRESTORE_TTL_RETENTION_MS.expiredRateLimitGrace,
    )
  })
})
