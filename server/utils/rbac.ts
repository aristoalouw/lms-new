import type { AuthContext, Permission, UserRole } from '../types/auth'
import type { InvoiceRecord, KrsRecord } from '../types/domain'
import { USER_ROLES } from '../types/auth'
import { forbidden, invalidInput } from './errors'

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  applicant: ['dashboard:view'],
  student: ['dashboard:view'],
  lecturer: ['dashboard:view', 'dashboard:view_academic'],
  advisor: ['dashboard:view', 'dashboard:view_academic', 'krs:approve'],
  academic_staff: [
    'dashboard:view',
    'dashboard:view_academic',
    'dashboard:view_pddikti',
    'krs:approve',
    'pddikti:queue',
    'pddikti:retry',
    'pddikti:view',
  ],
  finance_staff: ['dashboard:view', 'dashboard:view_finance', 'payments:record'],
  student_affairs_staff: ['dashboard:view', 'dashboard:view_academic', 'dashboard:view_outcomes'],
  admissions_staff: ['dashboard:view', 'dashboard:view_admissions'],
  leader: [
    'dashboard:view',
    'dashboard:view_academic',
    'dashboard:view_finance',
    'dashboard:view_admissions',
    'dashboard:view_pddikti',
    'dashboard:view_outcomes',
    'dashboard:view_accreditation',
    'pddikti:view',
    'audit:view',
  ],
  administrator: [
    'dashboard:view',
    'dashboard:view_academic',
    'dashboard:view_finance',
    'dashboard:view_admissions',
    'dashboard:view_pddikti',
    'dashboard:view_outcomes',
    'dashboard:view_accreditation',
    'krs:approve',
    'payments:record',
    'pddikti:queue',
    'pddikti:retry',
    'pddikti:view',
    'audit:view',
  ],
  guardian: ['dashboard:view'],
}

export function normalizeRoles(value: unknown): UserRole[] {
  const candidates = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const allowed = new Set<string>(USER_ROLES)
  return [...new Set(candidates.filter((role): role is UserRole => typeof role === 'string' && allowed.has(role)))]
}

export function permissionsFor(roles: readonly UserRole[]): Permission[] {
  return [...new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]))]
}

export function hasRole(context: AuthContext, ...roles: UserRole[]): boolean {
  return roles.some((role) => context.roles.includes(role))
}

export function can(context: AuthContext, permission: Permission): boolean {
  return context.roles.some((role) => ROLE_PERMISSIONS[role].includes(permission))
}

export function requirePermission(context: AuthContext, permission: Permission): void {
  if (!can(context, permission)) forbidden()
}

function hasProgramScope(context: AuthContext, programStudyId: string): boolean {
  if (hasRole(context, 'administrator')) return true
  return context.scope.programStudyIds.length > 0 && context.scope.programStudyIds.includes(programStudyId)
}

export function requireKrsApprovalScope(context: AuthContext, record: KrsRecord): void {
  requirePermission(context, 'krs:approve')
  if (hasRole(context, 'administrator')) return
  if (hasRole(context, 'advisor') && record.advisorId === context.uid) return
  if (hasRole(context, 'academic_staff') && hasProgramScope(context, record.programStudyId)) return
  forbidden('KRS berada di luar lingkup perwalian atau program studi Anda.')
}

export function requirePaymentScope(context: AuthContext, invoice: InvoiceRecord): void {
  requirePermission(context, 'payments:record')
  if (hasRole(context, 'administrator')) return
  if (hasRole(context, 'finance_staff') && hasProgramScope(context, invoice.programStudyId)) return
  forbidden('Tagihan berada di luar lingkup program studi Anda.')
}

export function filterProgramScope(context: AuthContext, requestedProgramStudyId?: string): string | undefined {
  if (hasRole(context, 'administrator', 'leader')) return requestedProgramStudyId
  if (!requestedProgramStudyId) {
    if (context.scope.programStudyIds.length === 1) return context.scope.programStudyIds[0]
    if (context.scope.programStudyIds.length > 1) invalidInput('programStudyId wajib dipilih untuk akun dengan beberapa lingkup program studi.')
    return undefined
  }
  if (!context.scope.programStudyIds.includes(requestedProgramStudyId)) forbidden('Program studi berada di luar lingkup akses Anda.')
  return requestedProgramStudyId
}
