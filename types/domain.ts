import type { Permission, UserRole } from '../shared/auth'

export type { UserRole } from '../shared/auth'

export type CampusUser = {
  id: string
  name: string
  email: string
  initials: string
  roles: UserRole[]
  activeRole: UserRole
  unitId?: string
  programStudyId?: string
  studentId?: string
  permissions: Permission[]
  rolePermissions: Partial<Record<UserRole, Permission[]>>
}

export type TableColumn = {
  key: string
  label: string
  sortable?: boolean
  align?: 'start' | 'center' | 'end'
  width?: string
}

export type SelectOption = {
  value: string
  label: string
  disabled?: boolean
}

export type AuditContext = {
  action: string
  entity: string
  entityId?: string
  metadata?: Record<string, unknown>
}

declare module '#app' {
  interface NuxtApp {
    $api: import('axios').AxiosInstance
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $api: import('axios').AxiosInstance
  }
}

export {}
