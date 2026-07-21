import { createError, getRequestURL } from 'h3'
import { featureForApiPath, isFeatureEnabled, isMvpApiAllowed, normalizeFeatureProfile } from '../../shared/features'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  if (!path.startsWith('/api/')) return

  const profile = normalizeFeatureProfile(process.env.APP_FEATURE_PROFILE)
  const feature = featureForApiPath(path)
  if ((feature && !isFeatureEnabled(profile, feature)) || (profile === 'lms-mvp' && !isMvpApiAllowed(path, event.method))) {
    throw createError({ statusCode: 404, statusMessage: 'API tidak tersedia pada profil LMS MVP.' })
  }
})
