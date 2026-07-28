import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH_IP_BURST_LIMIT,
  AUTH_USER_LIMIT,
  enforceAuthIpBurst,
  enforceAuthUserLimit,
} from '../../server/utils/auth-rate-limit'
import type { RateLimitStore } from '../../server/utils/rate-limit'
import {
  configureRateLimitStore,
  resetRateLimitsForTests,
} from '../../server/utils/rate-limit'

const originalBackend = process.env.RATE_LIMIT_BACKEND
const originalSecret = process.env.RATE_LIMIT_KEY_SECRET

beforeEach(() => {
  process.env.RATE_LIMIT_BACKEND = 'memory'
  process.env.RATE_LIMIT_KEY_SECRET = 'test-rate-limit-secret-with-32-bytes'
  resetRateLimitsForTests()
})

afterEach(() => {
  vi.useRealTimers()
  resetRateLimitsForTests()
  if (originalBackend === undefined) delete process.env.RATE_LIMIT_BACKEND
  else process.env.RATE_LIMIT_BACKEND = originalBackend
  if (originalSecret === undefined) delete process.env.RATE_LIMIT_KEY_SECRET
  else process.env.RATE_LIMIT_KEY_SECRET = originalSecret
})

describe('distributed-ready authentication rate limiting', () => {
  it('uses a coarse NAT-safe IP burst and still bounds invalid-token abuse', async () => {
    const now = Date.parse('2026-07-21T00:00:00.000Z')
    for (let request = 0; request < AUTH_IP_BURST_LIMIT.limit; request += 1) {
      await expect(enforceAuthIpBurst('203.0.113.10', now)).resolves.toBeUndefined()
    }
    await expect(enforceAuthIpBurst('203.0.113.10', now)).rejects.toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
    })
  })

  it('limits a verified UID without locking out other users behind the same NAT', async () => {
    const now = Date.parse('2026-07-21T00:00:00.000Z')
    for (let request = 0; request < AUTH_USER_LIMIT.limit; request += 1) {
      await enforceAuthUserLimit('firebase', 'firebase-uid-one', now)
    }
    await expect(enforceAuthUserLimit('firebase', 'firebase-uid-one', now)).rejects.toMatchObject({ statusCode: 429 })
    await expect(enforceAuthUserLimit('firebase', 'firebase-uid-two', now)).resolves.toBeUndefined()
    await expect(enforceAuthIpBurst('203.0.113.10', now)).resolves.toBeUndefined()
  })

  it('passes only pseudonymous keys to an injected shared backend', async () => {
    const keys: string[] = []
    const counts = new Map<string, number>()
    const sharedStore: RateLimitStore = {
      async consume(key, options, now) {
        keys.push(key)
        const count = (counts.get(key) ?? 0) + 1
        counts.set(key, count)
        return { count, resetsAt: now + options.windowMs }
      },
    }
    configureRateLimitStore(sharedStore)

    await enforceAuthIpBurst('198.51.100.25', 1_000)
    await enforceAuthUserLimit('firebase', 'sensitive-firebase-uid', 1_000)

    expect(keys).toHaveLength(2)
    expect(keys.join(' ')).not.toContain('198.51.100.25')
    expect(keys.join(' ')).not.toContain('sensitive-firebase-uid')
    expect(keys.every((key) => /^[a-z:-]+:[a-f0-9]{64}$/.test(key))).toBe(true)
  })

  it('fails closed within five seconds when the shared limiter stalls', async () => {
    vi.useFakeTimers()
    configureRateLimitStore({
      consume: () => new Promise(() => undefined),
    })

    const assertion = expect(enforceAuthIpBurst('192.0.2.10', 1_000)).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    })
    await vi.advanceTimersByTimeAsync(5_001)
    await assertion
  })
})
