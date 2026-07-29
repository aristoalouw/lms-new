export default defineNuxtRouteMiddleware(async () => {
  const { can, restoreSession } = useAuth()
  await restoreSession()
  if (!can('audit:view')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Anda tidak memiliki akses ke audit dan status operasional.',
    })
  }
})
