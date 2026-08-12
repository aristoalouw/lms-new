import type { Permission } from '~/shared/auth'

type PagePermission = Permission | readonly Permission[]

const routePermissions: ReadonlyArray<readonly [string, PagePermission]> = [
  ['/admin/pengguna', 'accounts:manage'], ['/pengguna', 'accounts:manage'],
  ['/admin/kelas', 'classes:manage'], ['/akademik/mahasiswa', 'academic.write'],
  ['/akademik/master', ['academic.write', 'academic.configure']], ['/akademik/krs', 'academic.read'],
  ['/akademik', 'academic.read'], ['/pembelajaran', 'learning.read'],
  ['/keuangan/rekonsiliasi', 'finance.write'], ['/keuangan', 'finance.read'],
  ['/pddikti/data-mahasiswa', 'pddikti.read'], ['/pddikti', ['pddikti.read', 'pddikti:view']], ['/kemahasiswaan', 'student_affairs.read'],
  ['/evaluasi', ['evaluation.read', 'evaluation.configure']], ['/kelulusan', ['graduation.read', 'graduation.configure']],
  ['/layanan', 'service.read'], ['/impor', 'academic.write'],
  ['/berkas', 'file.read'], ['/notifikasi', 'notification.read'],
  ['/modul/audit-backup', 'audit.read'], ['/modul/pengaturan', 'settings.read'],
  ['/pmb/pengaturan', 'pmb.configure'], ['/pmb/seleksi', ['pmb.read', 'pmb.write']], ['/pmb/kelola', 'pmb.write'],
  ['/pmb/dokumen', 'pmb.read'], ['/pmb/status', 'pmb.read'], ['/pmb', 'pmb.read'],
]

const publicRoutes = new Set(['/login', '/pmb/informasi', '/pmb/daftar', '/presensi', '/tracer-study'])

export default defineNuxtRouteMiddleware(async to => {
  if (publicRoutes.has(to.path)) return
  const requirement = routePermissions.find(([prefix]) => to.path === prefix || to.path.startsWith(`${prefix}/`))
  if (!requirement) return
  const { can, restoreSession, user } = useAuth()
  await restoreSession()
  if (!user.value) return navigateTo('/login')
  const required = requirement[1]
  const allowed = Array.isArray(required) ? required.some(permission => can(permission)) : can(required as Permission)
  if (!allowed) {
    throw createError({ statusCode: 403, statusMessage: 'Anda tidak memiliki akses ke halaman ini.' })
  }
})
