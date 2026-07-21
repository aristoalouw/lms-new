import { createHash, createHmac } from 'node:crypto'
import type { Firestore } from 'firebase-admin/firestore'
import { CampusError, serviceUnavailable } from './errors'
import { dataMode, firestoreAdmin } from './firebase-admin'

export interface RateLimitOptions {
  limit: number
  windowMs: number
}

export interface RateLimitConsumption {
  count: number
  resetsAt: number
}

export interface RateLimitStore {
  consume(key: string, options: RateLimitOptions, now: number): Promise<RateLimitConsumption>
}

interface RateBucket extends RateLimitConsumption {}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, RateBucket>()

  async consume(key: string, options: RateLimitOptions, now: number): Promise<RateLimitConsumption> {
    const current = this.buckets.get(key)
    const bucket = !current || current.resetsAt <= now
      ? { count: 1, resetsAt: now + options.windowMs }
      : { count: Math.min(current.count + 1, options.limit + 1), resetsAt: current.resetsAt }
    this.buckets.set(key, bucket)
    return bucket
  }

  clear(): void {
    this.buckets.clear()
  }
}

export class FirestoreRateLimitStore implements RateLimitStore {
  constructor(private readonly db: Firestore) {}

  async consume(key: string, options: RateLimitOptions, now: number): Promise<RateLimitConsumption> {
    // The collection never receives the pseudonymous key itself; only a second digest is persisted.
    const documentId = createHash('sha256').update(key).digest('hex')
    const reference = this.db.collection('rateLimitBuckets').doc(documentId)
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      const stored = snapshot.data() as Partial<RateBucket> | undefined
      const active = snapshot.exists
        && typeof stored?.resetsAt === 'number'
        && stored.resetsAt > now
        && typeof stored.count === 'number'
      const bucket: RateBucket = active
        ? { count: Math.min(stored.count! + 1, options.limit + 1), resetsAt: stored.resetsAt! }
        : { count: 1, resetsAt: now + options.windowMs }
      transaction.set(reference, {
        count: bucket.count,
        resetsAt: bucket.resetsAt,
        updatedAt: new Date(now),
        expiresAt: new Date(bucket.resetsAt + 24 * 60 * 60 * 1000),
      })
      return bucket
    })
  }
}

const memoryStore = new MemoryRateLimitStore()
let configuredStore: RateLimitStore | null = null

/** Allows another shared atomic backend to be injected without changing endpoint code. */
export function configureRateLimitStore(store: RateLimitStore | null): void {
  configuredStore = store
}

function resolveStore(): RateLimitStore {
  if (configuredStore) return configuredStore
  const backend = process.env.RATE_LIMIT_BACKEND
  if (backend === 'memory') return memoryStore
  if (backend === 'firestore' || (!backend && dataMode() === 'firebase')) {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan pembatasan permintaan tidak tersedia.')
    return new FirestoreRateLimitStore(db)
  }
  return memoryStore
}

export function rateLimitSubject(namespace: string, subject: string): string {
  const secret = process.env.RATE_LIMIT_KEY_SECRET || process.env.NUXT_SESSION_SECRET
  const normalizedNamespace = namespace.replace(/[^a-z0-9:_-]/gi, '').slice(0, 60)
  const digest = secret
    ? createHmac('sha256', secret).update(`${normalizedNamespace}\0${subject}`).digest('hex')
    : createHash('sha256').update(`${normalizedNamespace}\0${subject}`).digest('hex')
  return `${normalizedNamespace}:${digest}`
}

export async function enforceRateLimit(
  key: string,
  options: RateLimitOptions,
  now = Date.now(),
): Promise<{ remaining: number; resetsAt: number }> {
  let bucket: RateLimitConsumption
  try {
    bucket = await resolveStore().consume(key, options, now)
  } catch (error) {
    if (error instanceof CampusError) throw error
    serviceUnavailable('Pembatasan permintaan sementara tidak tersedia.')
  }

  if (bucket.count > options.limit) {
    throw new CampusError(429, 'RATE_LIMITED', 'Terlalu banyak permintaan. Silakan coba kembali nanti.', {
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetsAt - now) / 1000)),
    })
  }
  return { remaining: Math.max(0, options.limit - bucket.count), resetsAt: bucket.resetsAt }
}

export function resetRateLimitsForTests(): void {
  configuredStore = null
  memoryStore.clear()
}
