import type { AuthContext, Permission, UserRole } from '../types/auth'
import type { InvoiceRecord, KrsRecord } from '../types/domain'
import {
  normalizeUserRoles,
  permissionsForLmsMvpRoles,
  permissionsForRoles,
} from '../../shared/auth'
import { forbidden, invalidInput } from './errors'
import { serverFeatureProfile } from './feature-profile'

export function normalizeRoles(value: unknown): UserRole[] {
  return normalizeUserRoles(value)
}

export function permissionsFor(roles: readonly UserRole[]): Permission[] {
  return serverFeatureProfile() === 'lms-mvp'
    ? permissionsForLmsMvpRoles(roles)
    : permissionsForRoles(roles)
}

export function hasRole(context: AuthContext, ...roles: UserRole[]): boolean {
  return roles.some((role) => context.roles.includes(role))
}

export function can(context: AuthContext, permission: Permission): boolean {
  return permissionsFor(context.roles).includes(permission)
}

export function requirePermission(context: AuthContext, permission: Permission): void {
  if (!can(context, permission)) forbidden()
}

export function hasCampusWideProgramScope(context: AuthContext): boolean {
  return hasRole(context, 'administrator') && context.scope.programStudyIds.length === 0
}

export function hasProgramAccess(context: AuthContext, programStudyId: string): boolean {
  return context.scope.programStudyIds.includes(programStudyId) || hasCampusWideProgramScope(context)
}

function hasProgramScope(context: AuthContext, programStudyId: string): boolean {
  return hasProgramAccess(context, programStudyId)
}

function isPaymentGatewayActor(context: AuthContext): boolean {
  const match = /^system:payment-gateway:([a-z][a-z0-9_-]{2,39})$/.exec(context.uid)
  return Boolean(
    match
    && context.provider === 'firebase'
    && context.roles.length === 1
    && hasRole(context, 'finance_staff')
    && context.scope.unitIds.includes(`integration:payment-gateway:${match[1]}`),
  )
}

export function requireKrsApprovalScope(context: AuthContext, record: KrsRecord): void {
  requirePermission(context, 'krs:approve')
  if (hasRole(context, 'advisor') && record.advisorId === context.uid) return
  if (hasRole(context, 'academic_staff') && hasProgramScope(context, record.programStudyId)) return
  forbidden('KRS berada di luar lingkup perwalian atau program studi Anda.')
}

export function requirePaymentScope(context: AuthContext, invoice: InvoiceRecord): void {
  requirePermission(context, 'payments:record')
  if (isPaymentGatewayActor(context)) return
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
