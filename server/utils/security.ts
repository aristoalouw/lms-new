import { createHash } from 'node:crypto'
import { createError, defineEventHandler, getHeader, setHeader, type EventHandlerRequest, type H3Event } from 'h3'
import { CampusError, forbidden } from './errors'

const SENSITIVE_KEYS = /password|passcode|secret|token|authorization|cookie|credential|private.?key/i

export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[MAX_DEPTH]'
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}...` : value
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeForAudit(item, depth + 1))
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? '[REDACTED]' : sanitizeForAudit(item, depth + 1)]),
    )
  }
  return String(value)
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    )
  }
  return value
}

export function requestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

export function opaqueId(prefix: string, seed: string): string {
  return `${prefix}_${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`
}

export function clientAddress(event: H3Event): string | undefined {
  // Nginx appends the actual peer; choosing the last entry avoids trusting a client-prepended value.
  const chain = getHeader(event, 'x-forwarded-for')?.split(',').map((value) => value.trim()).filter(Boolean)
  const forwarded = chain?.at(-1)
  const direct = event.node.req.socket.remoteAddress
  return (forwarded || direct)?.slice(0, 64)
}

export function requestAuditMetadata(event: H3Event): { requestId?: string; ipAddress?: string; userAgent?: string } {
  const requestId = getHeader(event, 'x-request-id')?.slice(0, 100)
  const ipAddress = clientAddress(event)
  const userAgent = getHeader(event, 'user-agent')?.slice(0, 300)
  return {
    ...(requestId ? { requestId } : {}),
    ...(ipAddress ? { ipAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
  }
}

export function enforceCsrf(event: H3Event): void {
  const fetchSite = getHeader(event, 'sec-fetch-site')
  if (fetchSite === 'cross-site') forbidden('Permintaan lintas situs ditolak.')

  const origin = getHeader(event, 'origin')
  if (!origin) return
  const host = getHeader(event, 'host')
  const encrypted = Boolean((event.node.req.socket as typeof event.node.req.socket & { encrypted?: boolean }).encrypted)
  const protocol = getHeader(event, 'x-forwarded-proto') || (encrypted ? 'https' : 'http')
  if (!host || origin !== `${protocol}://${host}`) forbidden('Origin permintaan tidak valid.')
}

export function markPrivateResponse(event: H3Event): void {
  setHeader(event, 'cache-control', 'private, no-store, max-age=0')
  setHeader(event, 'pragma', 'no-cache')
  setHeader(event, 'vary', 'Cookie, Authorization')
}

export function requireIdempotencyKey(event: H3Event): string {
  const key = getHeader(event, 'idempotency-key')?.trim()
  if (!key || !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(key)) {
    throw new CampusError(400, 'INVALID_IDEMPOTENCY_KEY', 'Header Idempotency-Key wajib berisi 16-128 karakter yang valid.')
  }
  return key
}

export function defineCampusHandler<T>(handler: (event: H3Event<EventHandlerRequest>) => Promise<T> | T) {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    } catch (error) {
      if (error instanceof CampusError) {
        throw createError({
          statusCode: error.statusCode,
          statusMessage: error.message,
          data: { code: error.code, ...(error.details ? { details: error.details } : {}) },
        })
      }
      if (error && typeof error === 'object' && 'statusCode' in error) throw error
      throw createError({
        statusCode: 500,
        statusMessage: 'Terjadi kesalahan internal.',
        data: { code: 'INTERNAL_ERROR' },
      })
    }
  })
}
