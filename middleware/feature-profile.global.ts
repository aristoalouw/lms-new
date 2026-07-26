import {
  featureForPagePath,
  isFeatureEnabled,
  isMvpPageAllowed,
  MVP_PAGE_REDIRECTS,
  normalizeFeatureProfile,
} from '~/shared/features'

export default defineNuxtRouteMiddleware((to) => {
  const profile = normalizeFeatureProfile(useRuntimeConfig().public.featureProfile)
  if (profile === 'lms-mvp') {
    const redirect = MVP_PAGE_REDIRECTS[to.path as keyof typeof MVP_PAGE_REDIRECTS]
    if (redirect) return navigateTo(redirect, { redirectCode: 301 })
    if (!isMvpPageAllowed(to.path)) {
      throw createError({ statusCode: 404, statusMessage: 'Halaman tidak tersedia pada profil LMS MVP.' })
    }
    return
  }
  const feature = featureForPagePath(to.path)
  if (feature && !isFeatureEnabled(profile, feature)) {
    throw createError({ statusCode: 404, statusMessage: 'Halaman tidak tersedia pada profil LMS MVP.' })
  }
})
