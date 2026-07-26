import type { H3Event } from 'h3'
import type { AccessScope, AuthContext, UserRole } from '../types/auth'
import { USER_ROLES } from '../types/auth'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { authAdmin, dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { firestorePurgeAfter } from '../utils/firestore-ttl'
import { cloneValue, mockState } from '../utils/mock-store'
import { hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { requireInteger, requireRecord, requireString } from '../utils/validation'
import { LMS_MVP_USER_ROLES } from '../../shared/auth'
import { normalizeFeatureProfile } from '../../shared/features'

export const ACCOUNT_STATUSES = ['active', 'disabled', 'blocked'] as const
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number]

export interface AccountRecord {
  id: string
  email: string
  displayName: string
  roles: UserRole[]
  scope: AccessScope
  status: AccountStatus
  guardianStudentIds: string[]
  version: number
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}

export interface AccountListQuery {
  page: number
  pageSize: number
  search?: string
  status?: AccountStatus
  role?: UserRole
  programStudyId?: string
}

export interface AccountListResult {
  items: AccountRecord[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface AccountWriteResult {
  account: AccountRecord
  replayed: boolean
  auditId?: string
}

interface AccountCreateInput {
  email: string
  displayName: string
  roles: UserRole[]
  scope: AccessScope
  status: AccountStatus
  guardianStudentIds: string[]
}

interface AccountUpdateInput {
  email?: string
  displayName?: string
  roles?: UserRole[]
  scope?: AccessScope
  status?: AccountStatus
  guardianStudentIds?: string[]
  expectedVersion: number
  explicitScope: boolean
}

interface IdentitySnapshot {
  uid: string
  email: string
  displayName: string
  disabled: boolean
  claims: Record<string, unknown>
}

interface AccountIdentityGateway {
  ensureAccount(account: AccountRecord): Promise<void>
  synchronizeAccount(account: AccountRecord, revokeSessions: boolean): Promise<void>
}

const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i
const DIRECT_IDENTITY_ROLES = new Set<UserRole>(['applicant', 'student', 'guardian'])
const SCOPED_STAFF_ROLES = new Set<UserRole>([
  'advisor',
  'academic_staff',
  'finance_staff',
  'student_affairs_staff',
  'admissions_staff',
])
const ACCOUNT_COLLECTION_LIMIT = 5_000
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

const EMPTY_SCOPE = (): AccessScope => ({ unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] })

const SEEDED_ACCOUNTS: AccountRecord[] = [
  {
    id: 'admin-001',
    email: 'andi.pratama@example.test',
    displayName: 'Andi Pratama',
    roles: ['administrator'],
    scope: EMPTY_SCOPE(),
    status: 'active',
    guardianStudentIds: [],
    version: 1,
    createdAt: '2026-01-02T02:00:00.000Z',
    createdBy: 'system',
    updatedAt: '2026-07-18T04:20:00.000Z',
    updatedBy: 'system',
  },
  {
    id: 'student-001',
    email: 'nabila.putri@example.test',
    displayName: 'Nabila Putri',
    roles: ['student'],
    scope: { unitIds: ['faculty-economics'], programStudyIds: ['management-s1'], cohortYears: [2023], studentIds: ['student-001'] },
    status: 'active',
    guardianStudentIds: [],
    version: 2,
    createdAt: '2023-08-01T02:00:00.000Z',
    createdBy: 'system',
    updatedAt: '2026-07-20T02:15:00.000Z',
    updatedBy: 'academic-001',
  },
  {
    id: 'student-002',
    email: 'rafi.ramadhan@example.test',
    displayName: 'Rafi Ramadhan',
    roles: ['student'],
    scope: { unitIds: ['faculty-economics'], programStudyIds: ['management-s1'], cohortYears: [2023], studentIds: ['student-002'] },
    status: 'active',
    guardianStudentIds: [],
    version: 1,
    createdAt: '2023-08-01T02:05:00.000Z',
    createdBy: 'system',
    updatedAt: '2026-07-19T06:10:00.000Z',
    updatedBy: 'system',
  },
  {
    id: 'guardian-001',
    email: 'dewi.putri@example.test',
    displayName: 'Dewi Putri',
    roles: ['guardian'],
    scope: { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: ['student-001'] },
    status: 'active',
    guardianStudentIds: ['student-001'],
    version: 1,
    createdAt: '2023-08-03T02:00:00.000Z',
    createdBy: 'system',
    updatedAt: '2026-07-17T08:30:00.000Z',
    updatedBy: 'system',
  },
  {
    id: 'academic-001',
    email: 'rina.wijaya@example.test',
    displayName: 'Rina Wijaya',
    roles: ['academic_staff'],
    scope: { unitIds: ['faculty-economics'], programStudyIds: ['management-s1'], cohortYears: [], studentIds: [] },
    status: 'active',
    guardianStudentIds: [],
    version: 3,
    createdAt: '2024-01-05T02:00:00.000Z',
    createdBy: 'admin-001',
    updatedAt: '2026-07-20T05:00:00.000Z',
    updatedBy: 'admin-001',
  },
  {
    id: 'advisor-001',
    email: 'budi.santoso@example.test',
    displayName: 'Dr. Budi Santoso',
    roles: ['lecturer', 'advisor'],
    scope: { unitIds: ['faculty-economics'], programStudyIds: ['management-s1'], cohortYears: [2022, 2023, 2024], studentIds: [] },
    status: 'active',
    guardianStudentIds: [],
    version: 1,
    createdAt: '2022-02-10T04:00:00.000Z',
    createdBy: 'system',
    updatedAt: '2026-07-20T05:00:00.000Z',
    updatedBy: 'system',
  },
  {
    id: 'finance-001',
    email: 'ahmad.fauzi@example.test',
    displayName: 'Ahmad Fauzi',
    roles: ['finance_staff'],
    scope: { unitIds: ['faculty-economics'], programStudyIds: ['management-s1'], cohortYears: [], studentIds: [] },
    status: 'active',
    guardianStudentIds: [],
    version: 2,
    createdAt: '2024-01-05T02:10:00.000Z',
    createdBy: 'admin-001',
    updatedAt: '2026-07-16T03:45:00.000Z',
    updatedBy: 'admin-001',
  },
  {
    id: 'applicant-001',
    email: 'anisa.candidate@example.test',
    displayName: 'Anisa Rahma',
    roles: ['applicant'],
    scope: { unitIds: ['admissions'], programStudyIds: ['management-s1'], cohortYears: [2026], studentIds: [] },
    status: 'disabled',
    guardianStudentIds: [],
    version: 2,
    createdAt: '2026-05-12T07:12:00.000Z',
    createdBy: 'admissions-001',
    updatedAt: '2026-07-12T07:12:00.000Z',
    updatedBy: 'admin-001',
  },
  {
    id: 'lecturer-002',
    email: 'surya.hidayat@example.test',
    displayName: 'Dr. Surya Hidayat',
    roles: ['lecturer', 'advisor'],
    scope: { unitIds: ['faculty-engineering'], programStudyIds: ['informatics-s1'], cohortYears: [2022, 2023, 2024], studentIds: [] },
    status: 'blocked',
    guardianStudentIds: [],
    version: 4,
    createdAt: '2022-02-10T04:00:00.000Z',
    createdBy: 'system',
    updatedAt: '2026-07-15T09:00:00.000Z',
    updatedBy: 'admin-001',
  },
]

let mockAccounts = new Map(SEEDED_ACCOUNTS.map((account) => [account.id, cloneValue(account)]))
const mockIdentity = new Map<string, IdentitySnapshot>()
const revokedSessionUids = new Set<string>()

function requireAdministrator(context: AuthContext): void {
  if (!hasRole(context, 'administrator')) forbidden('Hanya administrator yang dapat mengelola akun pengguna.')
}

function rejectUnknownFields(body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key))
  if (unknown.length) invalidInput(`Field tidak didukung: ${unknown.join(', ')}.`)
}

function normalizeEmail(value: unknown): string {
  return requireString(value, 'email', { max: 254, pattern: EMAIL_PATTERN }).toLocaleLowerCase('en-US')
}

function parseStatus(value: unknown, fallback?: AccountStatus): AccountStatus {
  if (value === undefined && fallback) return fallback
  const status = requireString(value, 'status', { max: 20 }) as AccountStatus
  if (!ACCOUNT_STATUSES.includes(status)) invalidInput('status harus active, disabled, atau blocked.')
  return status
}

function parseRoles(value: unknown): UserRole[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) invalidInput('roles harus berisi 1-5 role.')
  const allowed = new Set<string>(USER_ROLES)
  const roles = value.map((role, index) => {
    const normalized = requireString(role, `roles[${index}]`, { max: 40 })
    if (!allowed.has(normalized)) invalidInput(`Role ${normalized} tidak dikenal.`)
    return normalized as UserRole
  })
  if (new Set(roles).size !== roles.length) invalidInput('roles tidak boleh berisi nilai duplikat.')
  if (normalizeFeatureProfile(process.env.APP_FEATURE_PROFILE) === 'lms-mvp') {
    const mvpRoles = new Set<UserRole>(LMS_MVP_USER_ROLES)
    if (roles.some(role => !mvpRoles.has(role))) invalidInput('Profil LMS MVP hanya menerima role student, lecturer, atau administrator.')
  }
  return roles
}

function parseStringList(value: unknown, label: string, maxItems = 20): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > maxItems) invalidInput(`${label} harus berupa array dengan maksimal ${maxItems} item.`)
  const values = value.map((item, index) => requireString(item, `${label}[${index}]`, {
    max: 80,
    pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
  }))
  if (new Set(values).size !== values.length) invalidInput(`${label} tidak boleh berisi nilai duplikat.`)
  return values
}

function parseScope(value: unknown): AccessScope {
  const scope = requireRecord(value, 'scope')
  rejectUnknownFields(scope, ['unitIds', 'programStudyIds', 'cohortYears', 'studentIds'])
  const cohortValue = scope.cohortYears
  if (cohortValue !== undefined && (!Array.isArray(cohortValue) || cohortValue.length > 20)) {
    invalidInput('scope.cohortYears harus berupa array dengan maksimal 20 item.')
  }
  const cohortItems: unknown[] = Array.isArray(cohortValue) ? cohortValue : []
  const cohortYears = cohortItems.map((year, index) => requireInteger(year, `scope.cohortYears[${index}]`, 1900, 2200))
  if (new Set(cohortYears).size !== cohortYears.length) invalidInput('scope.cohortYears tidak boleh berisi nilai duplikat.')
  return {
    unitIds: parseStringList(scope.unitIds, 'scope.unitIds'),
    programStudyIds: parseStringList(scope.programStudyIds, 'scope.programStudyIds'),
    cohortYears,
    studentIds: parseStringList(scope.studentIds, 'scope.studentIds'),
  }
}

function parseGuardianLinks(value: unknown): string[] {
  return parseStringList(value, 'guardianStudentIds', 20)
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index])
}

function validateClaimsSize(roles: UserRole[], scope: AccessScope): void {
  const claims = { roles, scope, accountStatus: 'active' }
  if (Buffer.byteLength(JSON.stringify(claims), 'utf8') > 900) {
    invalidInput('Gabungan role dan scope terlalu besar untuk token akses.')
  }
}

function validateRoleScope(
  roles: UserRole[],
  sourceScope: AccessScope,
  guardianStudentIds: string[],
  explicitScope: boolean,
): AccessScope {
  const directRoles = roles.filter((role) => DIRECT_IDENTITY_ROLES.has(role))
  if (directRoles.length && roles.length !== 1) {
    invalidInput('Role applicant, student, dan guardian tidak dapat digabung dengan role lain.')
  }
  if (roles.includes('advisor') && !roles.includes('lecturer')) {
    invalidInput('Role advisor harus dipasangkan dengan role lecturer.')
  }

  if (roles.includes('guardian')) {
    if (!guardianStudentIds.length) invalidInput('Akun guardian wajib ditautkan ke minimal satu mahasiswa.')
    if (sourceScope.unitIds.length || sourceScope.programStudyIds.length || sourceScope.cohortYears.length) {
      invalidInput('Scope guardian hanya boleh memuat mahasiswa yang ditautkan.')
    }
    if (explicitScope && sourceScope.studentIds.length && !sameStrings(sourceScope.studentIds, guardianStudentIds)) {
      invalidInput('scope.studentIds guardian harus sama dengan guardianStudentIds.')
    }
    const guardianScope = { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [...guardianStudentIds] }
    validateClaimsSize(roles, guardianScope)
    return guardianScope
  }

  if (guardianStudentIds.length) invalidInput('guardianStudentIds hanya boleh diisi untuk role guardian.')
  if (roles.includes('student')) {
    if (sourceScope.studentIds.length !== 1 || sourceScope.programStudyIds.length !== 1) {
      invalidInput('Akun mahasiswa wajib memiliki tepat satu studentId dan satu program studi.')
    }
  }
  if (roles.includes('applicant') && sourceScope.studentIds.length) {
    invalidInput('Akun pendaftar belum boleh memiliki studentId.')
  }

  const needsOrganizationalScope = roles.some((role) => SCOPED_STAFF_ROLES.has(role))
    && !roles.includes('administrator')
    && !roles.includes('leader')
  if (needsOrganizationalScope && !sourceScope.unitIds.length && !sourceScope.programStudyIds.length) {
    invalidInput('Role staf terlingkup wajib memiliki unit atau program studi.')
  }

  validateClaimsSize(roles, sourceScope)
  return cloneValue(sourceScope)
}

function parseCreateInput(value: unknown): AccountCreateInput {
  const body = requireRecord(value)
  rejectUnknownFields(body, ['email', 'displayName', 'roles', 'scope', 'status', 'guardianStudentIds'])
  const roles = parseRoles(body.roles)
  const guardianStudentIds = parseGuardianLinks(body.guardianStudentIds)
  const rawScope = body.scope === undefined ? EMPTY_SCOPE() : parseScope(body.scope)
  return {
    email: normalizeEmail(body.email),
    displayName: requireString(body.displayName, 'displayName', { min: 2, max: 150 }),
    roles,
    scope: validateRoleScope(roles, rawScope, guardianStudentIds, body.scope !== undefined),
    status: parseStatus(body.status, 'active'),
    guardianStudentIds,
  }
}

function parseUpdateInput(value: unknown): AccountUpdateInput {
  const body = requireRecord(value)
  rejectUnknownFields(body, ['email', 'displayName', 'roles', 'scope', 'status', 'guardianStudentIds', 'expectedVersion'])
  const mutableFields = ['email', 'displayName', 'roles', 'scope', 'status', 'guardianStudentIds']
  if (!mutableFields.some((field) => body[field] !== undefined)) invalidInput('Minimal satu perubahan akun wajib dikirim.')
  return {
    ...(body.email !== undefined ? { email: normalizeEmail(body.email) } : {}),
    ...(body.displayName !== undefined ? { displayName: requireString(body.displayName, 'displayName', { min: 2, max: 150 }) } : {}),
    ...(body.roles !== undefined ? { roles: parseRoles(body.roles) } : {}),
    ...(body.scope !== undefined ? { scope: parseScope(body.scope) } : {}),
    ...(body.status !== undefined ? { status: parseStatus(body.status) } : {}),
    ...(body.guardianStudentIds !== undefined ? { guardianStudentIds: parseGuardianLinks(body.guardianStudentIds) } : {}),
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1),
    explicitScope: body.scope !== undefined,
  }
}

function identityClaims(account: AccountRecord): Record<string, unknown> {
  return {
    roles: [...account.roles],
    scope: cloneValue(account.scope),
    accountStatus: account.status,
  }
}

function firebaseErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
}

const firebaseIdentityGateway: AccountIdentityGateway = {
  async ensureAccount(account) {
    const admin = authAdmin()
    if (!admin) serviceUnavailable('Layanan identitas akun tidak tersedia.')
    try {
      const existing = await admin.getUser(account.id)
      if (existing.email?.toLocaleLowerCase('en-US') !== account.email) {
        conflict('IDENTITY_UID_CONFLICT', 'Identitas akun telah digunakan oleh email berbeda.')
      }
      await admin.updateUser(account.id, {
        email: account.email,
        displayName: account.displayName,
        // New identities remain quarantined until the account document commits.
        disabled: true,
        emailVerified: existing.emailVerified,
      })
    } catch (error) {
      if (firebaseErrorCode(error) !== 'auth/user-not-found') {
        if (firebaseErrorCode(error) === 'auth/email-already-exists') conflict('EMAIL_ALREADY_USED', 'Email telah digunakan akun lain.')
        throw error
      }
      try {
        await admin.createUser({
          uid: account.id,
          email: account.email,
          displayName: account.displayName,
          disabled: true,
          emailVerified: false,
        })
      } catch (createError) {
        if (firebaseErrorCode(createError) === 'auth/email-already-exists') conflict('EMAIL_ALREADY_USED', 'Email telah digunakan akun lain.')
        throw createError
      }
    }
    await admin.setCustomUserClaims(account.id, identityClaims(account))
    await admin.revokeRefreshTokens(account.id)
  },

  async synchronizeAccount(account, revokeSessions) {
    const admin = authAdmin()
    if (!admin) serviceUnavailable('Layanan identitas akun tidak tersedia.')
    try {
      await admin.updateUser(account.id, {
        email: account.email,
        displayName: account.displayName,
        disabled: account.status !== 'active',
      })
      await admin.setCustomUserClaims(account.id, identityClaims(account))
      if (revokeSessions || account.status !== 'active') await admin.revokeRefreshTokens(account.id)
    } catch (error) {
      if (firebaseErrorCode(error) === 'auth/email-already-exists') conflict('EMAIL_ALREADY_USED', 'Email telah digunakan akun lain.')
      if (firebaseErrorCode(error) === 'auth/user-not-found') notFound('Identitas akun')
      throw error
    }
  },
}

const mockIdentityGateway: AccountIdentityGateway = {
  async ensureAccount(account) {
    const existingEmail = [...mockIdentity.values()].find((identity) => identity.email === account.email && identity.uid !== account.id)
    if (existingEmail) conflict('EMAIL_ALREADY_USED', 'Email telah digunakan akun lain.')
    mockIdentity.set(account.id, {
      uid: account.id,
      email: account.email,
      displayName: account.displayName,
      disabled: true,
      claims: identityClaims(account),
    })
    revokedSessionUids.add(account.id)
  },

  async synchronizeAccount(account, revokeSessions) {
    mockIdentity.set(account.id, {
      uid: account.id,
      email: account.email,
      displayName: account.displayName,
      disabled: account.status !== 'active',
      claims: identityClaims(account),
    })
    if (revokeSessions || account.status !== 'active') revokedSessionUids.add(account.id)
  },
}

function identityGateway(): AccountIdentityGateway {
  const mode = dataMode()
  if (mode === 'mock') return mockIdentityGateway
  if (mode === 'firebase') return firebaseIdentityGateway
  serviceUnavailable('Layanan akun tidak tersedia.')
}

async function ensureIdentityEmailAvailable(accountId: string, email: string): Promise<void> {
  if (dataMode() !== 'firebase') return
  const admin = authAdmin()
  if (!admin) serviceUnavailable('Layanan identitas akun tidak tersedia.')
  try {
    const owner = await admin.getUserByEmail(email)
    if (owner.uid !== accountId) conflict('EMAIL_ALREADY_USED', 'Email telah digunakan akun lain.')
  } catch (error) {
    if (firebaseErrorCode(error) === 'auth/user-not-found') return
    throw error
  }
}

function buildAccount(id: string, actor: AuthContext, input: AccountCreateInput, now: string): AccountRecord {
  return {
    id,
    ...cloneValue(input),
    version: 1,
    createdAt: now,
    createdBy: actor.uid,
    updatedAt: now,
    updatedBy: actor.uid,
  }
}

function buildUpdatedAccount(current: AccountRecord, actor: AuthContext, input: AccountUpdateInput, now: string): AccountRecord {
  if (current.version !== input.expectedVersion) {
    conflict('VERSION_CONFLICT', 'Akun telah berubah. Muat ulang data sebelum menyimpan.', { currentVersion: current.version })
  }
  const roles = input.roles ?? current.roles
  const guardianStudentIds = input.guardianStudentIds ?? current.guardianStudentIds
  const sourceScope = input.scope ?? current.scope
  const scope = validateRoleScope(roles, sourceScope, guardianStudentIds, input.explicitScope)
  const account: AccountRecord = {
    ...cloneValue(current),
    ...(input.email !== undefined ? { email: input.email } : {}),
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
    roles: [...roles],
    scope,
    status: input.status ?? current.status,
    guardianStudentIds: [...guardianStudentIds],
    version: current.version + 1,
    updatedAt: now,
    updatedBy: actor.uid,
  }
  if (current.id === actor.uid && account.status !== 'active') {
    conflict('SELF_LOCKOUT', 'Administrator tidak dapat menonaktifkan atau memblokir akunnya sendiri.')
  }
  if (current.id === actor.uid && !account.roles.includes('administrator')) {
    conflict('SELF_ADMIN_REQUIRED', 'Administrator tidak dapat menghapus role administrator dari akunnya sendiri.')
  }
  return account
}

async function accountsByIds(ids: string[]): Promise<AccountRecord[]> {
  if (!ids.length) return []
  if (dataMode() === 'mock') return ids.map((id) => mockAccounts.get(id)).filter((value): value is AccountRecord => Boolean(value)).map(cloneValue)
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan akun tidak tersedia.')
  const snapshots = await db.getAll(...ids.map((id) => db.collection('accounts').doc(id)))
  return snapshots.filter((snapshot) => snapshot.exists).map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }) as AccountRecord)
}

export async function listActiveAccountsByIds(ids: string[]): Promise<AccountRecord[]> {
  if (!Array.isArray(ids) || ids.length > 500) invalidInput('Daftar akun penerima tidak valid.')
  const safeIds = [...new Set(ids.map(id =>
    requireString(id, 'accountId', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })))]
  return (await accountsByIds(safeIds)).filter(account => account.status === 'active')
}

async function validateGuardianTargets(accountId: string, roles: UserRole[], guardianStudentIds: string[]): Promise<void> {
  if (!roles.includes('guardian')) return
  if (guardianStudentIds.includes(accountId)) invalidInput('Akun guardian tidak dapat ditautkan ke dirinya sendiri.')
  const targets = await accountsByIds(guardianStudentIds)
  if (targets.length !== guardianStudentIds.length) invalidInput('Satu atau lebih mahasiswa tertaut tidak ditemukan.')
  const invalidTargets = targets.filter((target) => !target.roles.includes('student'))
  if (invalidTargets.length) invalidInput('Guardian hanya dapat ditautkan ke akun dengan role student.')
}

function rolesOrScopeChanged(before: AccountRecord, after: AccountRecord): boolean {
  return requestHash({ roles: before.roles, scope: before.scope }) !== requestHash({ roles: after.roles, scope: after.scope })
}

function accountAuditView(account: AccountRecord): Record<string, unknown> {
  return {
    status: account.status,
    roles: account.roles,
    scope: account.scope,
    guardianStudentIds: account.guardianStudentIds,
    version: account.version,
  }
}

function mockReplay(namespace: string, hash: string): AccountWriteResult | undefined {
  const previous = mockState().idempotency.get(namespace)
  if (!previous) return undefined
  if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
  return { ...(cloneValue(previous.response) as AccountWriteResult), replayed: true, auditId: undefined }
}

function saveMockReplay(namespace: string, hash: string, response: AccountWriteResult, now: string): void {
  mockState().idempotency.set(namespace, { requestHash: hash, response: cloneValue(response), createdAt: now })
}

async function firebaseReplay(namespace: string, hash: string): Promise<AccountWriteResult | undefined> {
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan akun tidak tersedia.')
  const snapshot = await db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)).get()
  if (!snapshot.exists) return undefined
  const data = snapshot.data() as { requestHash: string; response: AccountWriteResult }
  if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
  return { ...data.response, replayed: true, auditId: undefined }
}

export function parseAccountListQuery(value: Record<string, unknown>): AccountListQuery {
  const scalar = (item: unknown, label: string): string | undefined => {
    if (item === undefined || item === '') return undefined
    if (Array.isArray(item)) invalidInput(`${label} hanya boleh memiliki satu nilai.`)
    return String(item)
  }
  const page = requireInteger(Number(scalar(value.page, 'page') ?? 1), 'page', 1, 100_000)
  const pageSize = requireInteger(Number(scalar(value.pageSize, 'pageSize') ?? 20), 'pageSize', 1, 50)
  const statusValue = scalar(value.status, 'status')
  const roleValue = scalar(value.role, 'role')
  const searchValue = scalar(value.search, 'search')
  const programValue = scalar(value.programStudyId, 'programStudyId')
  const status = statusValue ? parseStatus(statusValue) : undefined
  const role = roleValue ? parseRoles([roleValue])[0] : undefined
  const search = searchValue ? requireString(searchValue, 'search', { max: 100 }) : undefined
  const programStudyId = programValue
    ? requireString(programValue, 'programStudyId', { max: 80, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
    : undefined
  return { page, pageSize, ...(search ? { search } : {}), ...(status ? { status } : {}), ...(role ? { role } : {}), ...(programStudyId ? { programStudyId } : {}) }
}

export async function listAccounts(context: AuthContext, query: AccountListQuery): Promise<AccountListResult> {
  requireAdministrator(context)
  let records: AccountRecord[]
  if (dataMode() === 'mock') {
    records = [...mockAccounts.values()].map(cloneValue)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan akun tidak tersedia.')
    const snapshot = await db.collection('accounts').orderBy('updatedAt', 'desc').limit(ACCOUNT_COLLECTION_LIMIT).get()
    records = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as AccountRecord)
  }

  const needle = query.search?.toLocaleLowerCase('id-ID')
  records = records.filter((record) => {
    if (query.status && record.status !== query.status) return false
    if (query.role && !record.roles.includes(query.role)) return false
    if (query.programStudyId && !record.scope.programStudyIds.includes(query.programStudyId)) return false
    if (needle && ![record.id, record.email, record.displayName].some((value) => value.toLocaleLowerCase('id-ID').includes(needle))) return false
    return true
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.displayName.localeCompare(right.displayName, 'id'))

  const total = records.length
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize))
  const start = (query.page - 1) * query.pageSize
  return {
    items: records.slice(start, start + query.pageSize).map(cloneValue),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages,
  }
}

export async function createAccount(
  context: AuthContext,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
): Promise<AccountWriteResult> {
  requireAdministrator(context)
  const input = parseCreateInput(value)
  const hash = requestHash(input)
  const namespace = `account:create:${context.uid}:${idempotencyKey}`
  const now = new Date().toISOString()
  const accountId = opaqueId('usr', `${context.uid}:${idempotencyKey}:${input.email}`)
  const account = buildAccount(accountId, context, input, now)
  let result: AccountWriteResult

  if (dataMode() === 'mock') {
    const replay = mockReplay(namespace, hash)
    if (replay) return replay
    if ([...mockAccounts.values()].some((stored) => stored.email === account.email)) conflict('EMAIL_ALREADY_USED', 'Email telah digunakan akun lain.')
    await validateGuardianTargets(account.id, account.roles, account.guardianStudentIds)
    await identityGateway().ensureAccount(account)
    result = { account: cloneValue(account), replayed: false }
    mockAccounts.set(account.id, cloneValue(account))
    saveMockReplay(namespace, hash, result, now)
    await identityGateway().synchronizeAccount(account, account.status !== 'active')
  } else {
    const replay = await firebaseReplay(namespace, hash)
    if (replay) {
      await identityGateway().synchronizeAccount(replay.account, replay.account.status !== 'active')
      return replay
    }
    await validateGuardianTargets(account.id, account.roles, account.guardianStudentIds)
    await identityGateway().ensureAccount(account)
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan akun tidak tersedia.')
    const accountRef = db.collection('accounts').doc(account.id)
    const emailRef = db.collection('accountEmailIndex').doc(opaqueId('email', account.email))
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, existingEmail, existingAccount] = await Promise.all([
        transaction.get(idemRef),
        transaction.get(emailRef),
        transaction.get(accountRef),
      ])
      if (previous.exists) {
        const data = previous.data() as { requestHash: string; response: AccountWriteResult }
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (existingEmail.exists && existingEmail.data()?.accountId !== account.id) conflict('EMAIL_ALREADY_USED', 'Email telah digunakan akun lain.')
      if (existingAccount.exists) conflict('ACCOUNT_ALREADY_EXISTS', 'Akun telah tersedia.')
      const response: AccountWriteResult = { account, replayed: false }
      transaction.create(accountRef, account)
      transaction.set(emailRef, { accountId: account.id, email: account.email, createdAt: now })
      transaction.create(idemRef, {
        requestHash: hash,
        response,
        createdAt: now,
        purgeAfter: firestorePurgeAfter(now, IDEMPOTENCY_TTL_MS),
      })
      return response
    })
    if (result.replayed) {
      await identityGateway().synchronizeAccount(result.account, result.account.status !== 'active')
      return result
    }
    await identityGateway().synchronizeAccount(account, account.status !== 'active')
  }

  const audit = await appendAudit({
    actor: context,
    action: 'ACCOUNT_CREATED',
    resourceType: 'account',
    resourceId: result.account.id,
    after: accountAuditView(result.account),
    event,
  })
  result.auditId = audit.id
  return result
}

export async function updateAccount(
  context: AuthContext,
  accountId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
): Promise<AccountWriteResult> {
  requireAdministrator(context)
  const safeId = requireString(accountId, 'accountId', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  const input = parseUpdateInput(value)
  const hash = requestHash({ accountId: safeId, ...input })
  const namespace = `account:update:${context.uid}:${idempotencyKey}`
  const now = new Date().toISOString()
  let before: AccountRecord
  let after: AccountRecord
  let result: AccountWriteResult

  if (dataMode() === 'mock') {
    const replay = mockReplay(namespace, hash)
    if (replay) return replay
    const stored = mockAccounts.get(safeId)
    if (!stored) notFound('Akun')
    before = cloneValue(stored)
    after = buildUpdatedAccount(before, context, input, now)
    if ([...mockAccounts.values()].some((account) => account.id !== safeId && account.email === after.email)) {
      conflict('EMAIL_ALREADY_USED', 'Email telah digunakan akun lain.')
    }
    await validateGuardianTargets(after.id, after.roles, after.guardianStudentIds)
    const revokeSessions = (after.status !== 'active' && before.status !== after.status) || rolesOrScopeChanged(before, after)
    await identityGateway().synchronizeAccount(after, revokeSessions)
    mockAccounts.set(after.id, cloneValue(after))
    result = { account: cloneValue(after), replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay(namespace, hash)
    if (replay) {
      await identityGateway().synchronizeAccount(replay.account, replay.account.status !== 'active')
      return replay
    }
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan akun tidak tersedia.')
    const accountRef = db.collection('accounts').doc(safeId)
    const snapshot = await accountRef.get()
    if (!snapshot.exists) notFound('Akun')
    before = { id: snapshot.id, ...snapshot.data() } as AccountRecord
    after = buildUpdatedAccount(before, context, input, now)
    await validateGuardianTargets(after.id, after.roles, after.guardianStudentIds)
    await ensureIdentityEmailAvailable(after.id, after.email)
    const securitySensitive = before.status !== after.status || rolesOrScopeChanged(before, after)
    if (securitySensitive) {
      await identityGateway().synchronizeAccount({ ...before, status: 'disabled' }, true)
    }
    const oldEmailRef = db.collection('accountEmailIndex').doc(opaqueId('email', before.email))
    const newEmailRef = db.collection('accountEmailIndex').doc(opaqueId('email', after.email))
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    try {
      result = await db.runTransaction(async (transaction) => {
        const [previous, current, emailOwner] = await Promise.all([
          transaction.get(idemRef),
          transaction.get(accountRef),
          transaction.get(newEmailRef),
        ])
        if (previous.exists) {
          const data = previous.data() as { requestHash: string; response: AccountWriteResult }
          if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
          return { ...data.response, replayed: true, auditId: undefined }
        }
        if (!current.exists) notFound('Akun')
        const transactionBefore = { id: current.id, ...current.data() } as AccountRecord
        if (transactionBefore.version !== input.expectedVersion) {
          conflict('VERSION_CONFLICT', 'Akun telah berubah. Muat ulang data sebelum menyimpan.', { currentVersion: transactionBefore.version })
        }
        if (emailOwner.exists && emailOwner.data()?.accountId !== safeId) conflict('EMAIL_ALREADY_USED', 'Email telah digunakan akun lain.')
        const transactionAfter = buildUpdatedAccount(transactionBefore, context, input, now)
        const response: AccountWriteResult = { account: transactionAfter, replayed: false }
        transaction.update(accountRef, transactionAfter)
        if (transactionBefore.email !== transactionAfter.email) transaction.delete(oldEmailRef)
        transaction.set(newEmailRef, { accountId: safeId, email: transactionAfter.email, updatedAt: now })
        transaction.create(idemRef, {
          requestHash: hash,
          response,
          createdAt: now,
          purgeAfter: firestorePurgeAfter(now, IDEMPOTENCY_TTL_MS),
        })
        return response
      })
    } catch (error) {
      if (securitySensitive) {
        try {
          await identityGateway().synchronizeAccount(before, false)
        } catch {
          // A failed restoration deliberately leaves the identity disabled (fail closed).
        }
      }
      throw error
    }
    if (result.replayed) {
      await identityGateway().synchronizeAccount(result.account, result.account.status !== 'active')
      return result
    }
    after = result.account
    await identityGateway().synchronizeAccount(after, securitySensitive || after.status !== 'active')
  }

  const audit = await appendAudit({
    actor: context,
    action: before.status !== after.status ? 'ACCOUNT_STATE_CHANGED' : 'ACCOUNT_UPDATED',
    resourceType: 'account',
    resourceId: after.id,
    before: accountAuditView(before),
    after: accountAuditView(after),
    event,
  })
  result.auditId = audit.id
  return result
}

export async function findActiveAccountByEmail(email: string): Promise<AccountRecord | undefined> {
  const normalized = normalizeEmail(email)
  if (dataMode() === 'mock') {
    const account = [...mockAccounts.values()].find((record) => record.email === normalized && record.status === 'active')
    return account ? cloneValue(account) : undefined
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan akun tidak tersedia.')
  const snapshot = await db.collection('accounts').where('email', '==', normalized).limit(1).get()
  if (snapshot.empty) return undefined
  const document = snapshot.docs[0]!
  const account = { id: document.id, ...document.data() } as AccountRecord
  return account.status === 'active' ? account : undefined
}

/**
 * Complete the identity side of an accepted-applicant enrollment saga.
 * The caller must have already reserved the student record and NIM. Replays
 * are safe when the account already carries the exact student scope.
 */
export async function promoteApplicantAccount(
  actor: AuthContext,
  input: {
    accountId: string
    studentId: string
    programStudyId: string
    unitId: string
    cohortYear: number
  },
  event?: H3Event,
): Promise<AccountRecord> {
  if (!hasRole(actor, 'admissions_staff', 'administrator')) {
    forbidden('Hanya petugas PMB yang dapat mengaktifkan akun mahasiswa baru.')
  }
  if (!hasRole(actor, 'administrator') && !actor.scope.programStudyIds.includes(input.programStudyId)) {
    forbidden('Program studi berada di luar lingkup petugas PMB.')
  }
  for (const [label, value] of Object.entries({
    accountId: input.accountId,
    studentId: input.studentId,
    programStudyId: input.programStudyId,
    unitId: input.unitId,
  })) {
    requireString(value, label, { max: 128, pattern: /^[A-Za-z0-9._:@-]+$/ })
  }
  const cohortYear = requireInteger(input.cohortYear, 'cohortYear', 2000, 2200)
  const now = new Date().toISOString()
  let before: AccountRecord
  let after: AccountRecord

  const buildPromoted = (current: AccountRecord): AccountRecord => {
    const alreadyPromoted = current.roles.length === 1
      && current.roles[0] === 'student'
      && current.scope.studentIds.length === 1
      && current.scope.studentIds[0] === input.studentId
      && current.scope.programStudyIds.includes(input.programStudyId)
    if (alreadyPromoted && current.status === 'active') return cloneValue(current)
    if (!current.roles.includes('applicant')) {
      conflict('ACCOUNT_ROLE_CONFLICT', 'Akun pendaftar tidak lagi memiliki role applicant yang dapat dikonversi.')
    }
    return {
      ...cloneValue(current),
      roles: ['student'],
      scope: {
        unitIds: [input.unitId],
        programStudyIds: [input.programStudyId],
        cohortYears: [cohortYear],
        studentIds: [input.studentId],
      },
      status: 'active',
      guardianStudentIds: [],
      version: current.version + 1,
      updatedAt: now,
      updatedBy: actor.uid,
    }
  }

  if (dataMode() === 'mock') {
    const current = mockAccounts.get(input.accountId)
    if (!current) notFound('Akun pendaftar')
    before = cloneValue(current)
    after = buildPromoted(before)
    mockAccounts.set(after.id, cloneValue(after))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan akun tidak tersedia.')
    const accountRef = db.collection('accounts').doc(input.accountId)
    const promoted = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(accountRef)
      if (!snapshot.exists) notFound('Akun pendaftar')
      const current = { id: snapshot.id, ...snapshot.data() } as AccountRecord
      const next = buildPromoted(current)
      if (next.version !== current.version) transaction.set(accountRef, next)
      return { current, next }
    })
    before = promoted.current
    after = promoted.next
  }

  // A failed identity update does not grant extra access: the old Firebase
  // claim remains applicant-only. The admission stays pending and can retry.
  await identityGateway().synchronizeAccount(after, true)
  if (after.version !== before.version) {
    await appendAudit({
      actor,
      action: 'APPLICANT_ACCOUNT_PROMOTED',
      resourceType: 'account',
      resourceId: after.id,
      before: accountAuditView(before),
      after: accountAuditView(after),
      metadata: { source: 'admission-conversion', studentId: input.studentId },
      event,
    })
  }
  return cloneValue(after)
}

export function resetAccountStateForTests(): void {
  mockAccounts = new Map(SEEDED_ACCOUNTS.map((account) => [account.id, cloneValue(account)]))
  mockIdentity.clear()
  revokedSessionUids.clear()
}

export function accountRuntimeForTests(): {
  accounts: AccountRecord[]
  identities: IdentitySnapshot[]
  revokedSessionUids: string[]
} {
  return {
    accounts: [...mockAccounts.values()].map(cloneValue),
    identities: [...mockIdentity.values()].map(cloneValue),
    revokedSessionUids: [...revokedSessionUids],
  }
}
