export default defineNuxtRouteMiddleware(async (to) => {
  const { isAuthenticated, restoreSession } = useAuth()
  await restoreSession()
  if (isAuthenticated.value) {
    const redirect = typeof to.query.redirect === 'string' && to.query.redirect.startsWith('/') && !to.query.redirect.startsWith('//')
      ? to.query.redirect
      : '/'
    return navigateTo(redirect)
  }
})
