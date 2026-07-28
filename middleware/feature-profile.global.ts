import {
  featureForPagePath,
  isFeatureEnabled,
  isMvpPageAllowed,
  MVP_PAGE_REDIRECTS,
} from '~/shared/features'

export default defineNuxtRouteMiddleware((to) => {
  const { profile } = useFeatureFlags()
  if (profile.value === 'lms-mvp') {
    const redirect = MVP_PAGE_REDIRECTS[to.path as keyof typeof MVP_PAGE_REDIRECTS]
    if (redirect) return navigateTo(redirect, { redirectCode: 301 })
    if (!isMvpPageAllowed(to.path)) {
      throw createError({ statusCode: 404, statusMessage: 'Halaman tidak tersedia pada profil LMS MVP.' })
    }
    return
  }
  const feature = featureForPagePath(to.path)
  if (feature && !isFeatureEnabled(profile.value, feature)) {
    throw createError({ statusCode: 404, statusMessage: 'Halaman tidak tersedia pada profil LMS MVP.' })
  }
})
