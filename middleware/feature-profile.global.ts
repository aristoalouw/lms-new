import { featureForPagePath, isFeatureEnabled, normalizeFeatureProfile } from '~/shared/features'

export default defineNuxtRouteMiddleware((to) => {
  const profile = normalizeFeatureProfile(useRuntimeConfig().public.featureProfile)
  if (profile === 'lms-mvp' && to.path === '/pengguna') return navigateTo('/admin/pengguna', { redirectCode: 301 })
  if (profile === 'lms-mvp' && to.path === '/akademik/kelas') return navigateTo('/admin/kelas', { redirectCode: 301 })
  const feature = featureForPagePath(to.path)
  if (feature && !isFeatureEnabled(profile, feature)) {
    throw createError({ statusCode: 404, statusMessage: 'Halaman tidak tersedia pada profil LMS MVP.' })
  }
})
