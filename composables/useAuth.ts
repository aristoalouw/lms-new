import type { CampusUser, UserRole } from '~/types/domain'
import { signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth'

const administratorPermissions = ['*']

const rolePermissions: Record<UserRole, string[]> = {
  applicant: ['dashboard.read', 'pmb.read', 'finance.read', 'file.read', 'notification.read'],
  administrator: administratorPermissions,
  leader: ['dashboard.read', 'academic.read', 'finance.read', 'pmb.read', 'pddikti.read', 'evaluation.read', 'graduation.read', 'tracer.read', 'audit.read', 'notification.read'],
  academic_staff: ['dashboard.read', 'academic.read', 'academic.write', 'learning.read', 'pddikti.read', 'evaluation.read', 'graduation.read', 'student_affairs.read', 'service.read', 'file.read', 'notification.read'],
  finance_staff: ['dashboard.read', 'finance.read', 'finance.write', 'pmb.read', 'service.read', 'notification.read', 'file.read'],
  admissions_staff: ['dashboard.read', 'pmb.read', 'pmb.write', 'finance.read', 'notification.read', 'file.read'],
  student_affairs_staff: ['dashboard.read', 'student_affairs.read', 'student_affairs.write', 'tracer.read', 'service.read', 'file.read', 'notification.read'],
  lecturer: ['dashboard.read', 'academic.read', 'learning.read', 'learning.write', 'evaluation.read', 'file.read', 'notification.read'],
  advisor: ['dashboard.read', 'academic.read', 'academic.approve', 'learning.read', 'student_affairs.read', 'notification.read'],
  student: ['dashboard.read', 'academic.read', 'learning.read', 'finance.read', 'pmb.read', 'student_affairs.read', 'evaluation.read', 'graduation.read', 'tracer.read', 'service.read', 'file.read', 'notification.read'],
  guardian: ['dashboard.read', 'academic.read', 'finance.read', 'notification.read'],
}

type ServerSession = {
  uid: string
  email?: string
  displayName: string
  roles: UserRole[]
  permissions: string[]
  scope: {
    unitIds: string[]
    programStudyIds: string[]
    studentIds: string[]
  }
}

const initialsFor = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map(part => part[0]?.toUpperCase())
  .join('') || 'NC'

const userFromSession = (session: ServerSession, preferredRole?: UserRole): CampusUser => {
  const activeRole = preferredRole && session.roles.includes(preferredRole)
    ? preferredRole
    : session.roles[0] || 'student'
  return {
    id: session.uid,
    name: session.displayName,
    email: session.email || '',
    initials: initialsFor(session.displayName),
    roles: session.roles,
    activeRole,
    unitId: session.scope.unitIds[0],
    programStudyId: session.scope.programStudyIds[0],
    studentId: session.scope.studentIds[0],
    // Client permissions only shape navigation. Every operation is authorized again by the server.
    permissions: rolePermissions[activeRole],
  }
}

const demoUser: CampusUser = {
  id: 'usr-demo-admin',
  name: 'Alya Prameswari',
  email: 'alya.prameswari@kampus.ac.id',
  initials: 'AP',
  roles: ['administrator', 'leader', 'academic_staff'],
  activeRole: 'administrator',
  unitId: 'universitas',
  permissions: administratorPermissions,
}

export const useAuth = () => {
  const config = useRuntimeConfig()
  const user = useState<CampusUser | null>('auth.user', () => config.public.demoMode ? demoUser : null)
  const pending = useState<boolean>('auth.pending', () => false)
  const authError = useState<string | null>('auth.error', () => null)
  const restored = useState<boolean>('auth.restored', () => Boolean(config.public.demoMode))
  const requestFetch = useRequestFetch()

  const isAuthenticated = computed(() => Boolean(user.value))

  const can = (permission?: string) => {
    if (!permission) return true
    return Boolean(user.value?.permissions.includes('*') || user.value?.permissions.includes(permission))
  }

  const login = async (email: string, password: string) => {
    pending.value = true
    authError.value = null

    try {
      if (config.public.demoMode) {
        if (!email || !password) throw new Error('Email dan kata sandi wajib diisi.')
        const response = await requestFetch<{ session: ServerSession }>('/api/auth/demo-login', {
          method: 'POST',
          body: { profileId: 'admin' },
        })
        user.value = userFromSession(response.session)
        restored.value = true
        return user.value
      }

      const { $api } = useNuxtApp()
      const firebaseAuth = useNuxtApp().$firebaseAuth
      if (!firebaseAuth) throw new Error('Layanan autentikasi belum dikonfigurasi.')
      const credential = await signInWithEmailAndPassword(firebaseAuth, email, password)
      const idToken = await credential.user.getIdToken()
      const { data } = await $api.post<{ session: ServerSession }>('/auth/session', { idToken })
      user.value = userFromSession(data.session)
      restored.value = true
      return user.value
    } catch (error) {
      authError.value = error instanceof Error ? error.message : 'Login gagal. Periksa kembali akun Anda.'
      throw error
    } finally {
      pending.value = false
    }
  }

  const logout = async () => {
    try {
      await useNuxtApp().$api.post('/auth/logout')
      if (!config.public.demoMode && useNuxtApp().$firebaseAuth) await firebaseSignOut(useNuxtApp().$firebaseAuth!)
    } finally {
      user.value = null
      restored.value = true
      await navigateTo('/login')
    }
  }

  const restoreSession = async () => {
    if (restored.value || config.public.demoMode) return user.value
    pending.value = true
    try {
      const response = await requestFetch<{ session: ServerSession }>('/api/auth/session')
      user.value = userFromSession(response.session, user.value?.activeRole)
    } catch {
      user.value = null
    } finally {
      restored.value = true
      pending.value = false
    }
    return user.value
  }

  const switchRole = (role: UserRole) => {
    if (!user.value?.roles.includes(role)) return
    user.value = {
      ...user.value,
      activeRole: role,
      permissions: rolePermissions[role],
    }
  }

  return {
    user: readonly(user),
    pending: readonly(pending),
    authError: readonly(authError),
    isAuthenticated,
    can,
    login,
    logout,
    restoreSession,
    switchRole,
  }
}
