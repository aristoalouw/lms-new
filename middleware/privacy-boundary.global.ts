const publicAnalyticsRoutes = new Set(['/pmb/informasi'])

export default defineNuxtRouteMiddleware((to) => {
  if (!import.meta.client) return

  const config = useRuntimeConfig()
  if (config.public.analyticsPrivateEnabled || publicAnalyticsRoutes.has(to.path)) return
  if (sessionStorage.getItem('campus-public-analytics-active') !== '1') return

  // A hard navigation destroys third-party observers before a private view is rendered.
  sessionStorage.removeItem('campus-public-analytics-active')
  return navigateTo(to.fullPath, { external: true, replace: true })
})
