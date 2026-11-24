import type { CampusUser, UserRole } from '~/types/domain'
import type { Permission } from '~/shared/auth'
import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth'

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

const REMEMBERED_EMAIL_STORAGE_KEY = 'campus.rememberedEmail'
const FIREBASE_LOGIN_TIMEOUT_MS = 20_000
const SESSION_COLD_START_TIMEOUT_MS = 60_000

const withLoginTimeout = async <T>(operation: Promise<T>, timeoutMs = FIREBASE_LOGIN_TIMEOUT_MS): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Layanan autentikasi tidak merespons.'), { code: 'AUTH_CLIENT_TIMEOUT' })), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

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
  const activeRoleCookie = useCookie<UserRole | null>('campus_active_role', { sameSite: 'strict', path: '/' })
  const requestFetch = useRequestFetch()
  const sessionFetch = requestFetch as unknown as (path: string) => Promise<{ session: ServerSession }>

  const isAuthenticated = computed(() => Boolean(user.value))

  const can = (permission?: string) => {
    if (!permission) return true
    return Boolean(user.value?.permissions.includes(permission as Permission))
  }

  const login = async (email: string, password: string, remember = false) => {
    pending.value = true
    authError.value = null
    let firebaseSignedIn = false

    try {
      const { $api } = useNuxtApp()
      if (config.public.demoMode) {
        if (!email || !password) throw new Error('Email dan kata sandi wajib diisi.')
        const { data } = await $api.post<{ session: ServerSession }>('/auth/demo-login', { profileId: 'admin' })
        user.value = userFromSession(data.session)
        restored.value = true
        return user.value
      }

      const firebaseAuth = useNuxtApp().$firebaseAuth
      if (!firebaseAuth) throw new Error('Layanan autentikasi belum dikonfigurasi.')
      await setPersistence(firebaseAuth, remember ? browserLocalPersistence : browserSessionPersistence)
      const credential = await withLoginTimeout(signInWithEmailAndPassword(firebaseAuth, email, password))
      firebaseSignedIn = true
      const idToken = await withLoginTimeout(credential.user.getIdToken(), 10_000)
      const { data } = await $api.post<{ session: ServerSession }>('/auth/session', { idToken, remember }, {
        // Hostinger can cold-start the managed Node process after an idle period.
        timeout: SESSION_COLD_START_TIMEOUT_MS,
      })
      if (import.meta.client) {
        try {
          if (remember) window.localStorage.setItem(REMEMBERED_EMAIL_STORAGE_KEY, email.trim())
          else window.localStorage.removeItem(REMEMBERED_EMAIL_STORAGE_KEY)
        } catch {
          // Ignore storage quota or private-mode restrictions.
        }
      }
      user.value = userFromSession(data.session, activeRoleCookie.value || undefined)
      activeRoleCookie.value = user.value.activeRole
      restored.value = true
      return user.value
    } catch (error) {
      if (firebaseSignedIn && !config.public.demoMode && useNuxtApp().$firebaseAuth) {
        await firebaseSignOut(useNuxtApp().$firebaseAuth!).catch(() => undefined)
      }
      const failure = error as {
        code?: string
        message?: string
        response?: { data?: { statusMessage?: string; message?: string } }
      }
      authError.value = failure.response?.data?.statusMessage
        || failure.response?.data?.message
        || (failure.code === 'ECONNABORTED' || failure.code === 'AUTH_CLIENT_TIMEOUT'
          ? 'Server membutuhkan waktu terlalu lama untuk membuat sesi. Silakan coba lagi.'
          : failure.message || 'Login gagal. Periksa kembali akun Anda.')
      throw error
    } finally {
      pending.value = false
    }
  }

  const logout = async () => {
    try {
      const operations: Promise<unknown>[] = [useNuxtApp().$api.post('/auth/logout')]
      if (!config.public.demoMode && useNuxtApp().$firebaseAuth) {
        operations.push(firebaseSignOut(useNuxtApp().$firebaseAuth!))
      }
      await Promise.allSettled(operations)
    } finally {
      user.value = null
      activeRoleCookie.value = null
      restored.value = true
      await navigateTo('/login')
    }
  }

  const restoreSession = async () => {
    if (restored.value) return user.value
    pending.value = true
    try {
      const response = await sessionFetch('/api/auth/session')
      user.value = userFromSession(response.session, user.value?.activeRole || activeRoleCookie.value || undefined)
      if (user.value) activeRoleCookie.value = user.value.activeRole
    } catch {
      user.value = null
    } finally {
      restored.value = true
      pending.value = false
    }
    return user.value
  }

  const switchRole = async (role: UserRole) => {
    if (!user.value?.roles.includes(role)) return
    activeRoleCookie.value = role
    user.value = {
      ...user.value,
      activeRole: role,
      permissions: user.value.rolePermissions[role] || [],
    }
    const shell = useAppShell()
    shell.closeSidebar()
    shell.commandOpen.value = false
    shell.notificationsOpen.value = false
    const route = useRoute()
    if (route.path !== '/' || Object.keys(route.query).length > 0) {
      await navigateTo('/', { replace: true })
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
