import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  deleteCookie,
  getCookie,
  getHeader,
  setCookie,
  type H3Event,
} from 'h3'
import { DEMO_PROFILES } from '../data/mock-data'
import type { AccessScope, AuthContext, PublicSession, UserRole } from '../types/auth'
import { CampusError, forbidden, serviceUnavailable } from './errors'
import { authAdmin, firestoreAdmin } from './firebase-admin'
import {
  LMS_MVP_USER_ROLES,
  permissionsForLmsMvpRole,
  permissionsForLmsMvpRoles,
  permissionsForRole,
} from '../../shared/auth'
import { CANONICAL_SCOPE_ID_PATTERN } from '../../shared/auth/scope-identifiers'
import { serverFeatureProfile } from './feature-profile'
import { normalizeRoles, permissionsFor } from './rbac'

export const SESSION_COOKIE_NAME = 'campus_session'
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000
const AUTH_UPSTREAM_TIMEOUT_MS = 10_000

interface FirebaseAppSessionPayload {
  uid: string
  accountVersion: number
  issuedAt: number
  expiresAt: number
}

interface FirebaseSessionAccount {
  uid: string
  email?: string
  displayName: string
  roles: UserRole[]
  scope: AccessScope
  version: number
  sessionValidAfter: number
}

class AuthUpstreamTimeoutError extends Error {}

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

function invalidAccountAuthorization(): never {
  throw new CampusError(
    403,
    'ACCOUNT_AUTHORIZATION_INVALID',
    'Konfigurasi role atau lingkup akun tidak valid. Hubungi administrator.',
  )
}

function strictScopeStringList(value: unknown): string[] {
  if (
    !Array.isArray(value)
    || value.length > 20
    || value.some(item => typeof item !== 'string' || !CANONICAL_SCOPE_ID_PATTERN.test(item))
  ) {
    invalidAccountAuthorization()
  }
  const values = value as string[]
  if (new Set(values).size !== values.length) invalidAccountAuthorization()
  return [...values]
}

function strictScopeCohortYears(value: unknown): number[] {
  if (
    !Array.isArray(value)
    || value.length > 20
    || value.some(item => !Number.isInteger(item) || Number(item) < 1900 || Number(item) > 2200)
  ) {
    invalidAccountAuthorization()
  }
  const values = value as number[]
  if (new Set(values).size !== values.length) invalidAccountAuthorization()
  return [...values]
}

function strictLmsAccountScope(value: unknown): AccessScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidAccountAuthorization()
  const scope = value as Record<string, unknown>
  const allowedKeys = new Set(['unitIds', 'programStudyIds', 'cohortYears', 'studentIds'])
  if (Object.keys(scope).some(key => !allowedKeys.has(key))) invalidAccountAuthorization()
  return {
    unitIds: strictScopeStringList(scope.unitIds),
    programStudyIds: strictScopeStringList(scope.programStudyIds),
    cohortYears: strictScopeCohortYears(scope.cohortYears),
    studentIds: strictScopeStringList(scope.studentIds),
  }
}

function lmsMvpFirebaseAccountScope(data: Record<string, unknown>, roles: UserRole[]): AccessScope {
  const storedRoles = data.roles
  const allowedRoles = new Set<UserRole>(LMS_MVP_USER_ROLES)
  if (
    !Array.isArray(storedRoles)
    || storedRoles.length !== 1
    || roles.length !== 1
    || storedRoles[0] !== roles[0]
    || !allowedRoles.has(roles[0]!)
  ) {
    invalidAccountAuthorization()
  }

  const scope = strictLmsAccountScope(data.scope)
  const role = roles[0]!
  if (role === 'student') {
    if (scope.unitIds.length || scope.programStudyIds.length !== 1 || scope.studentIds.length !== 1) {
      invalidAccountAuthorization()
    }
  } else if (role === 'lecturer') {
    if (scope.unitIds.length || scope.cohortYears.length || scope.studentIds.length) {
      invalidAccountAuthorization()
    }
  } else if (
    scope.unitIds.length
    || scope.programStudyIds.length
    || scope.cohortYears.length
    || scope.studentIds.length
  ) {
    invalidAccountAuthorization()
  }
  return scope
}

function fullCampusFirebaseAccountScope(data: Record<string, unknown>, roles: UserRole[]): AccessScope {
  const scope = strictLmsAccountScope(data.scope)
  const directIdentityRoles = roles.filter(role => ['applicant', 'student', 'guardian'].includes(role))
  if (directIdentityRoles.length && roles.length !== 1) invalidAccountAuthorization()
  if (roles.includes('advisor') && !roles.includes('lecturer')) invalidAccountAuthorization()

  if (roles.includes('student') && (scope.studentIds.length !== 1 || scope.programStudyIds.length !== 1)) {
    invalidAccountAuthorization()
  }
  if (roles.includes('applicant') && scope.studentIds.length) invalidAccountAuthorization()
  if (roles.includes('guardian')) {
    if (!scope.studentIds.length || scope.unitIds.length || scope.programStudyIds.length || scope.cohortYears.length) {
      invalidAccountAuthorization()
    }
  }

  const scopedStaffRoles: UserRole[] = ['advisor', 'academic_staff', 'finance_staff', 'student_affairs_staff', 'admissions_staff']
  const requiresOrganizationScope = roles.some(role => scopedStaffRoles.includes(role))
    && !roles.includes('administrator')
    && !roles.includes('leader')
  if (requiresOrganizationScope && !scope.unitIds.length && !scope.programStudyIds.length) {
    invalidAccountAuthorization()
  }
  return scope
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

function applicationSessionSecret(): string {
  const configured = process.env.NUXT_SESSION_SECRET
  if (configured && configured.length >= 32) return configured
  if (process.env.NODE_ENV === 'production') serviceUnavailable('Layanan sesi belum dikonfigurasi.')
  return 'campus-app-session-development-only-change-me'
}

function signFirebaseSession(encodedPayload: string): string {
  return createHmac('sha256', applicationSessionSecret())
    .update(`firebase-session\0${encodedPayload}`)
    .digest('base64url')
}

function signedFirebaseSessionToken(payload: FirebaseAppSessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `firebase.${encoded}.${signFirebaseSession(encoded)}`
}

export function verifyFirebaseAppSessionToken(token: string): FirebaseAppSessionPayload | null {
  const [prefix, encoded, signature] = token.split('.')
  if (prefix !== 'firebase' || !encoded || !signature) return null
  const expected = Buffer.from(signFirebaseSession(encoded))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<FirebaseAppSessionPayload>
    if (
      typeof value.uid !== 'string'
      || !value.uid
      || value.uid.length > 128
      || !Number.isInteger(value.accountVersion)
      || Number(value.accountVersion) < 1
      || !Number.isFinite(value.issuedAt)
      || !Number.isFinite(value.expiresAt)
      || Number(value.expiresAt) <= Date.now()
      || Number(value.issuedAt) > Date.now() + 60_000
    ) return null
    return {
      uid: value.uid,
      accountVersion: Number(value.accountVersion),
      issuedAt: Number(value.issuedAt),
      expiresAt: Number(value.expiresAt),
    }
  } catch {
    return null
  }
}

async function withAuthTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AuthUpstreamTimeoutError()), AUTH_UPSTREAM_TIMEOUT_MS)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function signedDemoToken(context: AuthContext): string {
  const encoded = Buffer.from(JSON.stringify(context), 'utf8').toString('base64url')
  return `demo.${encoded}.${sign(encoded)}`
}

export function contextForFeatureProfile(context: AuthContext): AuthContext {
  if (serverFeatureProfile() !== 'lms-mvp') return context
  const allowed = new Set<UserRole>(LMS_MVP_USER_ROLES)
  const roles = context.roles.filter(role => allowed.has(role))
  if (!roles.length) forbidden('Akun tidak memiliki role yang tersedia pada profil aplikasi ini.')
  return roles.length === context.roles.length ? context : { ...context, roles }
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
    return contextForFeatureProfile({
      uid: String(value.uid).slice(0, 128),
      email: typeof value.email === 'string' ? value.email.slice(0, 254) : undefined,
      displayName: String(value.displayName).slice(0, 150),
      roles,
      scope: normalizeScope(value.scope),
      provider: 'demo',
      issuedAt: Number(value.issuedAt) || Date.now(),
      expiresAt: Number(value.expiresAt),
    })
  } catch {
    return null
  }
}

export function createDemoSession(profileId: string, now = Date.now()): { context: AuthContext; token: string } {
  if (!isDemoAuthEnabled()) forbidden('Autentikasi demo tidak tersedia.')
  const profile = DEMO_PROFILES.find((item) => item.profileId === profileId)
  if (!profile) throw new CampusError(400, 'UNKNOWN_DEMO_PROFILE', 'Profil demo tidak valid.')
  const context = contextForFeatureProfile({
    uid: profile.uid,
    email: profile.email,
    displayName: profile.displayName,
    roles: [...profile.roles],
    scope: structuredClone(profile.scope),
    provider: 'demo',
    issuedAt: now,
    expiresAt: now + SESSION_DURATION_MS,
  })
  return { context, token: signedDemoToken(context) }
}

async function firebaseSessionAccount(uid: string): Promise<FirebaseSessionAccount | null> {
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan akun tidak tersedia.')
  let snapshot
  try {
    snapshot = await withAuthTimeout(db.collection('accounts').doc(uid).get())
  } catch {
    serviceUnavailable('Penyimpanan akun sementara tidak tersedia.')
  }
  if (!snapshot.exists) return null
  const data = snapshot.data() as Record<string, unknown>
  if (data.status !== 'active') return null
  const roles = normalizeRoles(data.roles)
  const version = Number(data.version)
  if (!roles.length || !Number.isInteger(version) || version < 1) return null
  const scope = serverFeatureProfile() === 'lms-mvp'
    ? lmsMvpFirebaseAccountScope(data, roles)
    : fullCampusFirebaseAccountScope(data, roles)
  return {
    uid,
    email: typeof data.email === 'string' ? data.email.slice(0, 254) : undefined,
    displayName: typeof data.displayName === 'string' ? data.displayName.slice(0, 150) : 'Pengguna Kampus',
    roles,
    scope,
    version,
    sessionValidAfter: Number.isFinite(Number(data.sessionValidAfter)) ? Number(data.sessionValidAfter) : 0,
  }
}

function firebaseAccountContext(
  account: FirebaseSessionAccount,
  timing: { issuedAt: number; expiresAt: number },
): AuthContext {
  return contextForFeatureProfile({
    uid: account.uid,
    email: account.email,
    displayName: account.displayName,
    roles: account.roles,
    scope: account.scope,
    provider: 'firebase',
    issuedAt: timing.issuedAt,
    expiresAt: timing.expiresAt,
  })
}

async function contextForFirebaseAppSession(payload: FirebaseAppSessionPayload): Promise<AuthContext | null> {
  const account = await firebaseSessionAccount(payload.uid)
  if (!account || account.version !== payload.accountVersion) return null
  return firebaseAccountContext(account, payload)
}

async function verifyFirebaseIdToken(idToken: string): Promise<Record<string, unknown>> {
  const admin = authAdmin()
  if (!admin) throw new CampusError(503, 'AUTH_UNAVAILABLE', 'Layanan autentikasi belum dikonfigurasi.')
  try {
    return await withAuthTimeout(admin.verifyIdToken(idToken, false)) as unknown as Record<string, unknown>
  } catch (error) {
    if (error instanceof AuthUpstreamTimeoutError) {
      throw new CampusError(503, 'AUTH_TIMEOUT', 'Layanan autentikasi sementara tidak merespons.')
    }
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
    if ([
      'auth/argument-error',
      'auth/id-token-expired',
      'auth/id-token-revoked',
      'auth/invalid-id-token',
      'auth/user-disabled',
      'auth/user-not-found',
    ].includes(code)) {
      throw new CampusError(401, 'INVALID_ID_TOKEN', 'Token identitas tidak valid.')
    }
    throw new CampusError(503, 'AUTH_UNAVAILABLE', 'Layanan autentikasi sementara tidak tersedia.')
  }
}

export async function authenticate(event: H3Event): Promise<AuthContext | null> {
  const cookie = getCookie(event, SESSION_COOKIE_NAME)
  if (cookie?.startsWith('demo.')) return verifyDemoSessionToken(cookie)
  if (cookie?.startsWith('firebase.')) {
    const payload = verifyFirebaseAppSessionToken(cookie)
    return payload ? contextForFirebaseAppSession(payload) : null
  }

  const authorization = getHeader(event, 'authorization')
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (bearer) {
    try {
      const decoded = await verifyFirebaseIdToken(bearer)
      const uid = String(decoded.uid || decoded.sub).slice(0, 128)
      const account = uid ? await firebaseSessionAccount(uid) : null
      const authTime = Number(decoded.auth_time) * 1000
      if (!account || !authTime || authTime < account.sessionValidAfter) return null
      return firebaseAccountContext(account, {
        issuedAt: Number(decoded.iat) * 1000,
        expiresAt: Number(decoded.exp) * 1000,
      })
    } catch (error) {
      if (error instanceof CampusError && error.statusCode >= 500) throw error
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
  const decoded = await verifyFirebaseIdToken(idToken)
  const uid = String(decoded.uid || decoded.sub).slice(0, 128)
  const account = uid ? await firebaseSessionAccount(uid) : null
  if (!account) forbidden('Akun tidak aktif atau belum terdaftar.')
  const authTime = Number(decoded.auth_time) * 1000
  if (
    !authTime
    || Date.now() - authTime > 5 * 60 * 1000
    || authTime < account.sessionValidAfter
  ) {
    throw new CampusError(401, 'RECENT_LOGIN_REQUIRED', 'Silakan login kembali sebelum membuat sesi.')
  }
  const now = Date.now()
  const context = firebaseAccountContext(account, {
    issuedAt: now,
    expiresAt: now + SESSION_DURATION_MS,
  })
  await options.onVerified?.(context)
  const token = signedFirebaseSessionToken({
    uid: account.uid,
    accountVersion: account.version,
    issuedAt: context.issuedAt,
    expiresAt: context.expiresAt,
  })
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
  const roles = [...contextForFeatureProfile(context).roles]
  const lmsMvp = serverFeatureProfile() === 'lms-mvp'
  return {
    uid: context.uid,
    email: context.email,
    displayName: context.displayName,
    roles,
    scope: structuredClone(context.scope),
    provider: context.provider,
    expiresAt: new Date(context.expiresAt).toISOString(),
    permissions: lmsMvp ? permissionsForLmsMvpRoles(roles) : permissionsFor(roles),
    rolePermissions: Object.fromEntries(roles.map(role => [
      role,
      lmsMvp ? permissionsForLmsMvpRole(role) : permissionsForRole(role),
    ])),
  }
}

export function availableDemoProfiles(): Array<{ id: string; label: string; roles: string[] }> {
  if (!isDemoAuthEnabled()) return []
  const allowed = new Set<UserRole>(LMS_MVP_USER_ROLES)
  return DEMO_PROFILES
    .map(profile => ({ ...profile, roles: serverFeatureProfile() === 'lms-mvp' ? profile.roles.filter(role => allowed.has(role)) : [...profile.roles] }))
    .filter(profile => profile.roles.length > 0)
    .map(profile => ({ id: profile.profileId, label: profile.label, roles: [...profile.roles] }))
}
