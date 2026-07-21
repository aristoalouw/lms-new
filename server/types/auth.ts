import type { AccessScope, Permission, UserRole } from '../../shared/auth'

export { PERMISSIONS, USER_ROLES } from '../../shared/auth'
export type { AccessScope, Permission, UserRole } from '../../shared/auth'

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
  rolePermissions: Partial<Record<UserRole, Permission[]>>
}
