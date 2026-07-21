export const USER_ROLES = [
  'applicant',
  'student',
  'lecturer',
  'advisor',
  'academic_staff',
  'finance_staff',
  'student_affairs_staff',
  'admissions_staff',
  'leader',
  'administrator',
  'guardian',
] as const

export type UserRole = (typeof USER_ROLES)[number]

export const PERMISSIONS = [
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
] as const

export type Permission = (typeof PERMISSIONS)[number]

export interface AccessScope {
  unitIds: string[]
  programStudyIds: string[]
  cohortYears: number[]
  studentIds: string[]
}

export interface AuthContext {
  uid: string
  email?: string
  displayName: string
  roles: UserRole[]
  scope: AccessScope
  provider: 'firebase' | 'demo'
  issuedAt: number
  expiresAt: number
}

export interface PublicSession {
  uid: string
  email?: string
  displayName: string
  roles: UserRole[]
  scope: AccessScope
  provider: AuthContext['provider']
  expiresAt: string
  permissions: Permission[]
}
