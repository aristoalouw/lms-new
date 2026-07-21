export type UserRole =
  | 'applicant'
  | 'administrator'
  | 'leader'
  | 'academic_staff'
  | 'finance_staff'
  | 'admissions_staff'
  | 'student_affairs_staff'
  | 'lecturer'
  | 'advisor'
  | 'student'
  | 'guardian'

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
  permissions: string[]
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
