import type { FeatureProfile } from '../../shared/features'
import { normalizeFeatureProfile } from '../../shared/features'

export function serverFeatureProfile(): FeatureProfile {
  const fallback = process.env.NODE_ENV === 'production' ? 'lms-mvp' : 'full-campus'
  return normalizeFeatureProfile(process.env.APP_FEATURE_PROFILE, fallback)
}

export function isPageRequestPath(path: string, method: string): boolean {
  if (!['GET', 'HEAD'].includes(method.toUpperCase())) return false
  if (path.startsWith('/api/') || path.startsWith('/_') || path.startsWith('/vendor/') || path.startsWith('/.well-known/')) {
    return false
  }
  return true
}
