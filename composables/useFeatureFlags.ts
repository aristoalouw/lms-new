import type { Feature, FeatureProfile } from '~/shared/features'
import {
  isFeatureEnabled,
  isMvpPageAllowed,
  MVP_PAGE_REDIRECTS,
  normalizeFeatureProfile,
} from '~/shared/features'

export const useFeatureFlags = () => {
  const config = useRuntimeConfig()
  const profileFallback: FeatureProfile = 'full-campus'
  const profile = computed(() => normalizeFeatureProfile(config.public.featureProfile, profileFallback))
  const enabled = (feature: Feature) => isFeatureEnabled(profile.value, feature)
  const pageEnabled = (path: string) => profile.value !== 'lms-mvp'
    || isMvpPageAllowed(path)
    || path in MVP_PAGE_REDIRECTS

  return {
    profile: readonly(profile),
    enabled,
    pageEnabled,
    isLmsMvp: computed(() => profile.value === 'lms-mvp'),
  }
}
