import { enforceRateLimit, rateLimitSubject } from './rate-limit'

// Intentionally coarse: this protects token verification from floods without treating a campus NAT as one user.
export const AUTH_IP_BURST_LIMIT = { limit: 300, windowMs: 60 * 1000 } as const
export const AUTH_USER_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 } as const

export async function enforceAuthIpBurst(clientIp: string, now = Date.now()): Promise<void> {
  await enforceRateLimit(rateLimitSubject('auth:ip', clientIp), AUTH_IP_BURST_LIMIT, now)
}

export async function enforceAuthUserLimit(provider: 'firebase' | 'demo', uid: string, now = Date.now()): Promise<void> {
  await enforceRateLimit(rateLimitSubject(`auth:${provider}:uid`, uid), AUTH_USER_LIMIT, now)
}
