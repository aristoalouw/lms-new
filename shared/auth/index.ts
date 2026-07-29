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

export const LMS_MVP_USER_ROLES = ['student', 'lecturer', 'administrator'] as const satisfies readonly UserRole[]

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
  'accounts:manage',
  'classes:manage',
  'enrollments:manage',
  'system:view_status',
  'learning:read',
  'learning:manage_content',
  'learning:manage_assignments',
  'learning:submit',
  'learning:grade',
  'learning:manage_announcements',
  'learning:participate_forum',
  'learning:moderate_forum',
  'learning:check_in',
  'learning:manage_attendance',
  'files:read',
  'files:write',
  'notifications:read',
  'notifications:manage',
  'dashboard.read',
  'pmb.read',
  'pmb.write',
  'academic.read',
  'academic.write',
  'academic.approve',
  'learning.read',
  'learning.write',
  'finance.read',
  'finance.write',
  'pddikti.read',
  'evaluation.read',
  'graduation.read',
  'tracer.read',
  'student_affairs.read',
  'student_affairs.write',
  'service.read',
  'file.read',
  'notification.read',
  'settings.read',
  'audit.read',
] as const

export type Permission = (typeof PERMISSIONS)[number]

export interface AccessScope {
  unitIds: string[]
  programStudyIds: string[]
  cohortYears: number[]
  studentIds: string[]
}

export type LmsMvpUserRole = (typeof LMS_MVP_USER_ROLES)[number]

const dashboard = ['dashboard:view', 'dashboard.read'] as const

export const LMS_MVP_ROLE_PERMISSIONS: Readonly<Record<LmsMvpUserRole, readonly Permission[]>> = {
  student: [
    ...dashboard,
    'learning.read', 'learning:read', 'learning:submit',
    'learning:participate_forum', 'learning:check_in',
    'file.read', 'files:read', 'files:write',
    'notification.read', 'notifications:read',
  ],
  lecturer: [
    ...dashboard,
    'learning.read', 'learning.write', 'learning:read',
    'learning:manage_content', 'learning:manage_assignments', 'learning:grade',
    'learning:manage_announcements', 'learning:participate_forum',
    'learning:moderate_forum', 'learning:manage_attendance',
    'file.read', 'files:read', 'files:write',
    'notification.read', 'notifications:read',
  ],
  administrator: [
    ...dashboard,
    'accounts:manage', 'classes:manage', 'enrollments:manage',
    'system:view_status', 'learning:read',
    'file.read', 'files:read', 'files:write',
    'notification.read', 'notifications:read', 'notifications:manage',
    'audit.read', 'audit:view',
  ],
}

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  applicant: [...dashboard, 'pmb.read', 'finance.read', 'file.read', 'notification.read'],
  student: [
    ...dashboard,
    'academic.read', 'learning.read', 'learning:read', 'learning:submit',
    'learning:participate_forum', 'learning:check_in', 'finance.read',
    'student_affairs.read', 'evaluation.read', 'graduation.read', 'tracer.read',
    'service.read', 'file.read', 'files:read', 'files:write',
    'notification.read', 'notifications:read',
  ],
  lecturer: [
    ...dashboard,
    'dashboard:view_academic', 'academic.read', 'learning.read', 'learning.write',
    'learning:read', 'learning:manage_content', 'learning:manage_assignments',
    'learning:grade', 'learning:manage_announcements', 'learning:participate_forum',
    'learning:moderate_forum', 'learning:manage_attendance', 'evaluation.read',
    'file.read', 'files:read', 'files:write', 'notification.read', 'notifications:read',
  ],
  advisor: [
    ...dashboard,
    'dashboard:view_academic', 'academic.read', 'academic.approve', 'krs:approve',
    'learning.read', 'learning:read', 'student_affairs.read', 'notification.read',
    'notifications:read',
  ],
  academic_staff: [
    ...dashboard,
    'dashboard:view_academic', 'dashboard:view_pddikti', 'academic.read',
    'academic.write', 'learning.read', 'learning:read', 'pddikti.read',
    'pddikti:view', 'pddikti:queue', 'pddikti:retry', 'krs:approve',
    'evaluation.read', 'graduation.read', 'student_affairs.read', 'service.read',
    'file.read', 'files:read', 'files:write', 'notification.read', 'notifications:read',
  ],
  finance_staff: [
    ...dashboard,
    'dashboard:view_finance', 'payments:record', 'finance.read', 'finance.write',
    'pmb.read', 'service.read', 'file.read', 'files:read', 'notification.read',
    'notifications:read',
  ],
  student_affairs_staff: [
    ...dashboard,
    'dashboard:view_academic', 'dashboard:view_outcomes', 'academic.read',
    'student_affairs.read', 'student_affairs.write', 'tracer.read', 'service.read',
    'file.read', 'files:read', 'files:write', 'notification.read', 'notifications:read',
  ],
  admissions_staff: [
    ...dashboard,
    'dashboard:view_admissions', 'pmb.read', 'pmb.write', 'finance.read',
    'file.read', 'files:read', 'files:write', 'notification.read', 'notifications:read',
  ],
  leader: [
    ...dashboard,
    'dashboard:view_academic', 'dashboard:view_finance', 'dashboard:view_admissions',
    'dashboard:view_pddikti', 'dashboard:view_outcomes', 'dashboard:view_accreditation',
    'academic.read', 'finance.read', 'pmb.read', 'pddikti.read', 'pddikti:view',
    'evaluation.read', 'graduation.read', 'tracer.read', 'audit.read', 'audit:view',
    'notification.read', 'notifications:read',
  ],
  administrator: [
    ...dashboard,
    'dashboard:view_academic', 'dashboard:view_finance', 'dashboard:view_admissions',
    'dashboard:view_pddikti', 'dashboard:view_outcomes', 'dashboard:view_accreditation',
    'krs:approve', 'payments:record', 'pddikti:queue', 'pddikti:retry', 'pddikti:view',
    'audit:view', 'accounts:manage', 'classes:manage', 'enrollments:manage',
    'system:view_status', 'learning:read', 'files:read', 'files:write',
    'notifications:read', 'notifications:manage', 'academic.read', 'academic.write',
    'finance.read', 'finance.write', 'pmb.read', 'pmb.write', 'pddikti.read',
    'evaluation.read', 'graduation.read', 'tracer.read', 'student_affairs.read',
    'student_affairs.write', 'service.read', 'file.read', 'notification.read',
    'settings.read', 'audit.read',
  ],
  guardian: [...dashboard, 'academic.read', 'finance.read', 'notification.read', 'notifications:read'],
}

export function normalizeUserRoles(value: unknown): UserRole[] {
  const candidates = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const allowed = new Set<string>(USER_ROLES)
  return [...new Set(candidates.filter((role): role is UserRole => typeof role === 'string' && allowed.has(role)))]
}

export function permissionsForRole(role: UserRole): Permission[] {
  return [...ROLE_PERMISSIONS[role]]
}

export function permissionsForRoles(roles: readonly UserRole[]): Permission[] {
  return [...new Set(roles.flatMap(role => ROLE_PERMISSIONS[role]))]
}

export function permissionsForLmsMvpRole(role: UserRole): Permission[] {
  return LMS_MVP_USER_ROLES.includes(role as LmsMvpUserRole)
    ? [...LMS_MVP_ROLE_PERMISSIONS[role as LmsMvpUserRole]]
    : []
}

export function permissionsForLmsMvpRoles(roles: readonly UserRole[]): Permission[] {
  return [...new Set(roles.flatMap(permissionsForLmsMvpRole))]
}
