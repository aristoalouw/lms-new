export default defineNuxtRouteMiddleware(async to => {
  const { can, restoreSession } = useAuth()
  await restoreSession()
  const permission = to.path.startsWith('/admin/pengguna') ? 'accounts:manage' : 'classes:manage'
  if (!can(permission)) throw createError({ statusCode: 403, statusMessage: 'Anda tidak memiliki akses ke halaman administrasi ini.' })
})
