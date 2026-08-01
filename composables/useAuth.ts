import type { CampusUser, UserRole } from '~/types/domain'
import type { Permission } from '~/shared/auth'
import { signInWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth'

type ServerSession = {
  uid: string
  email?: string
  displayName: string
  roles: UserRole[]
  permissions: Permission[]
  rolePermissions: Partial<Record<UserRole, Permission[]>>
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
    permissions: session.rolePermissions[activeRole] || [],
    rolePermissions: session.rolePermissions,
  }
}

export const useAuth = () => {
  const config = useRuntimeConfig()
  const user = useState<CampusUser | null>('auth.user', () => null)
  const pending = useState<boolean>('auth.pending', () => false)
  const authError = useState<string | null>('auth.error', () => null)
  const restored = useState<boolean>('auth.restored', () => false)
  const requestFetch = useRequestFetch()

  const isAuthenticated = computed(() => Boolean(user.value))

  const can = (permission?: string) => {
    if (!permission) return true
    return Boolean(user.value?.permissions.includes(permission as Permission))
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
      const { data } = await $api.post<{ session: ServerSession }>('/auth/session', { idToken }, {
        timeout: 45_000,
      })
      user.value = userFromSession(data.session)
      restored.value = true
      return user.value
    } catch (error) {
      const failure = error as {
        code?: string
        message?: string
        response?: { data?: { statusMessage?: string; message?: string } }
      }
      authError.value = failure.response?.data?.statusMessage
        || failure.response?.data?.message
        || (failure.code === 'ECONNABORTED'
          ? 'Server membutuhkan waktu terlalu lama untuk membuat sesi. Silakan coba lagi.'
          : failure.message || 'Login gagal. Periksa kembali akun Anda.')
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
    if (restored.value) return user.value
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
      permissions: user.value.rolePermissions[role] || [],
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
