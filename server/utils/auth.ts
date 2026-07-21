import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  deleteCookie,
  getCookie,
  getHeader,
  setCookie,
  type H3Event,
} from 'h3'
import { DEMO_PROFILES } from '../data/mock-data'
import type { AccessScope, AuthContext, PublicSession } from '../types/auth'
import { CampusError, forbidden } from './errors'
import { authAdmin } from './firebase-admin'
import { normalizeRoles, permissionsFor } from './rbac'

export const SESSION_COOKIE_NAME = 'campus_session'
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000

function emptyScope(): AccessScope {
  return { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] }
}

function stringList(value: unknown, max = 100): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 100)))].slice(0, max)
}

function numberList(value: unknown, max = 100): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is number => Number.isInteger(item) && item >= 1900 && item <= 2200))].slice(0, max)
}

export function normalizeScope(value: unknown): AccessScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyScope()
  const scope = value as Record<string, unknown>
  return {
    unitIds: stringList(scope.unitIds),
    programStudyIds: stringList(scope.programStudyIds),
    cohortYears: numberList(scope.cohortYears),
    studentIds: stringList(scope.studentIds),
  }
}

export function isDemoAuthEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEMO_AUTH !== 'false'
}

function demoSecret(): string {
  const configured = process.env.DEMO_SESSION_SECRET
  if (configured && configured.length >= 32) return configured
  if (process.env.NODE_ENV === 'production') forbidden('Autentikasi demo tidak tersedia.')
  return 'campus-demo-session-development-only-change-me'
}

function sign(encodedPayload: string): string {
  return createHmac('sha256', demoSecret()).update(encodedPayload).digest('base64url')
}

function signedDemoToken(context: AuthContext): string {
  const encoded = Buffer.from(JSON.stringify(context), 'utf8').toString('base64url')
  return `demo.${encoded}.${sign(encoded)}`
}

export function verifyDemoSessionToken(token: string): AuthContext | null {
  if (!isDemoAuthEnabled()) return null
  const [prefix, encoded, signature] = token.split('.')
  if (prefix !== 'demo' || !encoded || !signature) return null
  const expected = Buffer.from(sign(encoded))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<AuthContext>
    const roles = normalizeRoles(value.roles)
    if (!value.uid || !value.displayName || value.provider !== 'demo' || !value.expiresAt || value.expiresAt <= Date.now()) return null
    if (!roles.length) return null
    return {
      uid: String(value.uid).slice(0, 128),
      email: typeof value.email === 'string' ? value.email.slice(0, 254) : undefined,
      displayName: String(value.displayName).slice(0, 150),
      roles,
      scope: normalizeScope(value.scope),
      provider: 'demo',
      issuedAt: Number(value.issuedAt) || Date.now(),
      expiresAt: Number(value.expiresAt),
    }
  } catch {
    return null
  }
}

export function createDemoSession(profileId: string, now = Date.now()): { context: AuthContext; token: string } {
  if (!isDemoAuthEnabled()) forbidden('Autentikasi demo tidak tersedia.')
  const profile = DEMO_PROFILES.find((item) => item.profileId === profileId)
  if (!profile) throw new CampusError(400, 'UNKNOWN_DEMO_PROFILE', 'Profil demo tidak valid.')
  const context: AuthContext = {
    uid: profile.uid,
    email: profile.email,
    displayName: profile.displayName,
    roles: [...profile.roles],
    scope: structuredClone(profile.scope),
    provider: 'demo',
    issuedAt: now,
    expiresAt: now + SESSION_DURATION_MS,
  }
  return { context, token: signedDemoToken(context) }
}

function firebaseContext(claims: Record<string, unknown>): AuthContext {
  const roles = normalizeRoles(claims.roles ?? claims.role)
  if (!roles.length) forbidden('Akun belum memiliki role yang valid.')
  return {
    uid: String(claims.uid || claims.sub).slice(0, 128),
    email: typeof claims.email === 'string' ? claims.email.slice(0, 254) : undefined,
    displayName: typeof claims.name === 'string' ? claims.name.slice(0, 150) : 'Pengguna Kampus',
    roles,
    scope: normalizeScope(claims.scope),
    provider: 'firebase',
    issuedAt: Number(claims.iat) * 1000,
    expiresAt: Number(claims.exp) * 1000,
  }
}

export async function authenticate(event: H3Event): Promise<AuthContext | null> {
  const cookie = getCookie(event, SESSION_COOKIE_NAME)
  if (cookie?.startsWith('demo.')) return verifyDemoSessionToken(cookie)

  const admin = authAdmin()
  if (cookie && admin) {
    try {
      return firebaseContext(await admin.verifySessionCookie(cookie, true) as unknown as Record<string, unknown>)
    } catch {
      return null
    }
  }

  const authorization = getHeader(event, 'authorization')
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (bearer && admin) {
    try {
      return firebaseContext(await admin.verifyIdToken(bearer, true) as unknown as Record<string, unknown>)
    } catch {
      return null
    }
  }
  return null
}

export async function requireAuth(event: H3Event): Promise<AuthContext> {
  const context = await authenticate(event)
  if (!context) throw new CampusError(401, 'UNAUTHENTICATED', 'Sesi tidak valid atau telah berakhir.')
  return context
}

export async function createFirebaseSession(
  idToken: string,
  options: { onVerified?: (context: AuthContext) => Promise<void> } = {},
): Promise<{ context: AuthContext; token: string }> {
  const admin = authAdmin()
  if (!admin) throw new CampusError(503, 'AUTH_UNAVAILABLE', 'Layanan autentikasi belum dikonfigurasi.')
  let decoded: Record<string, unknown>
  try {
    decoded = await admin.verifyIdToken(idToken, true) as unknown as Record<string, unknown>
  } catch {
    throw new CampusError(401, 'INVALID_ID_TOKEN', 'Token identitas tidak valid.')
  }
  const context = firebaseContext({ ...decoded, exp: Math.floor((Date.now() + SESSION_DURATION_MS) / 1000) })
  await options.onVerified?.(context)
  const authTime = Number(decoded.auth_time) * 1000
  if (!authTime || Date.now() - authTime > 5 * 60 * 1000) {
    throw new CampusError(401, 'RECENT_LOGIN_REQUIRED', 'Silakan login kembali sebelum membuat sesi.')
  }
  const token = await admin.createSessionCookie(idToken, { expiresIn: SESSION_DURATION_MS })
  return { context, token }
}

export function setSessionCookie(event: H3Event, token: string): void {
  setCookie(event, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_DURATION_MS / 1000,
  })
}

export function clearSessionCookie(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  })
}

export function publicSession(context: AuthContext): PublicSession {
  return {
    uid: context.uid,
    email: context.email,
    displayName: context.displayName,
    roles: [...context.roles],
    scope: structuredClone(context.scope),
    provider: context.provider,
    expiresAt: new Date(context.expiresAt).toISOString(),
    permissions: permissionsFor(context.roles),
  }
}

export function availableDemoProfiles(): Array<{ id: string; label: string; roles: string[] }> {
  if (!isDemoAuthEnabled()) return []
  return DEMO_PROFILES.map((profile) => ({ id: profile.profileId, label: profile.label, roles: [...profile.roles] }))
}
