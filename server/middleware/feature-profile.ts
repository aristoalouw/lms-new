import { createError, getRequestURL, sendRedirect } from 'h3'
import {
  featureForApiPath,
  isFeatureEnabled,
  isMvpApiAllowed,
  isMvpPageAllowed,
  MVP_PAGE_REDIRECTS,
} from '../../shared/features'
import { isPageRequestPath, serverFeatureProfile } from '../utils/feature-profile'

export default defineEventHandler((event) => {
  const path = getRequestURL(event).pathname
  const profile = serverFeatureProfile()

  if (path.startsWith('/api/')) {
    if (profile === 'lms-mvp' && !isMvpApiAllowed(path, event.method)) {
      throw createError({ statusCode: 404, statusMessage: 'API tidak tersedia pada profil LMS MVP.' })
    }
    const feature = featureForApiPath(path)
    if (feature && !isFeatureEnabled(profile, feature)) {
      throw createError({ statusCode: 404, statusMessage: 'API tidak tersedia pada profil LMS MVP.' })
    }
    return
  }

  if (profile === 'lms-mvp' && isPageRequestPath(path, event.method)) {
    const redirect = MVP_PAGE_REDIRECTS[path as keyof typeof MVP_PAGE_REDIRECTS]
    if (redirect) return sendRedirect(event, redirect, 301)
    if (!isMvpPageAllowed(path)) {
      throw createError({ statusCode: 404, statusMessage: 'Halaman tidak tersedia pada profil LMS MVP.' })
    }
  }
})
