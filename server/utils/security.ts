import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { createError, defineEventHandler, getHeader, setHeader, type EventHandlerRequest, type H3Event } from 'h3'
import { CampusError, forbidden } from './errors'

const SENSITIVE_KEYS = /password|passcode|secret|token|authorization|cookie|credential|private.?key|email|phone|address|nim|nik|student.?name|display.?name|subject|(?:text)?body|content|feedback|score|grade|nilai|file.?name/i
const TRUSTED_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,99}$/

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https://www.google-analytics.com https://*.clarity.ms",
  "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://cdn.jsdelivr.net https://www.clarity.ms",
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.google-analytics.com https://*.analytics.google.com https://*.clarity.ms https://*.ingest.sentry.io",
  'frame-src https://*.firebaseapp.com https://www.googletagmanager.com',
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ')

export function applicationSecurityHeaders(production = process.env.NODE_ENV === 'production'): Record<string, string> {
  return {
    'content-security-policy': production
      ? CONTENT_SECURITY_POLICY
      : CONTENT_SECURITY_POLICY.replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'"),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    ...(production ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  }
}

function sanitizeAuditText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .slice(0, 500)
}

export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[MAX_DEPTH]'
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return sanitizeAuditText(value)
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

function trustedProxyHops(): number {
  const configured = process.env.TRUSTED_PROXY_HOPS
  if (configured && /^[0-9]+$/.test(configured)) return Math.min(Number(configured), 10)
  return ['docker', 'hostinger'].includes(process.env.DEPLOYMENT_TARGET || '') ? 1 : 0
}

function normalizedIpAddress(value?: string): string | undefined {
  const candidate = value?.trim().replace(/^\[|\]$/g, '')
  return candidate && isIP(candidate) ? candidate.slice(0, 64) : undefined
}

export function clientAddress(event: H3Event): string | undefined {
  const direct = normalizedIpAddress(event.node.req.socket.remoteAddress)
  const hops = trustedProxyHops()
  if (hops === 0) return direct
  const forwarded = (getHeader(event, 'x-forwarded-for') || '')
    .split(',')
    .map(value => normalizedIpAddress(value))
    .filter((value): value is string => Boolean(value))
    .reverse()
  return [direct, ...forwarded].filter((value): value is string => Boolean(value))[hops] ?? direct
}

export function trustedRequestId(event: H3Event): string {
  const context = event.context as typeof event.context & { campusRequestId?: string }
  if (context.campusRequestId && TRUSTED_REQUEST_ID.test(context.campusRequestId)) return context.campusRequestId

  // The repository-owned Nginx always replaces this header. Hostinger's
  // managed proxy contract is opaque, so client-provided IDs are never trusted.
  const upstream = process.env.DEPLOYMENT_TARGET === 'docker' ? getHeader(event, 'x-request-id')?.trim() : undefined
  context.campusRequestId = upstream && TRUSTED_REQUEST_ID.test(upstream)
    ? upstream
    : `req_${randomUUID().replaceAll('-', '')}`
  return context.campusRequestId
}

export function requestAuditMetadata(event: H3Event): { requestId?: string; ipAddress?: string; userAgent?: string } {
  const requestId = trustedRequestId(event)
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
  const forwardedProtocol = trustedProxyHops() > 0
    ? getHeader(event, 'x-forwarded-proto')?.split(',').at(-1)?.trim().toLowerCase()
    : undefined
  const protocol = ['http', 'https'].includes(forwardedProtocol || '') ? forwardedProtocol : (encrypted ? 'https' : 'http')
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
        cause: error,
      })
    }
  })
}
