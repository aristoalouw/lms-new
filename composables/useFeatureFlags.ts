import type { Feature } from '~/shared/features'
import { isFeatureEnabled, normalizeFeatureProfile } from '~/shared/features'

export const useFeatureFlags = () => {
  const config = useRuntimeConfig()
  const profile = computed(() => normalizeFeatureProfile(config.public.featureProfile))
  const enabled = (feature: Feature) => isFeatureEnabled(profile.value, feature)

  return {
    profile: readonly(profile),
    enabled,
    isLmsMvp: computed(() => profile.value === 'lms-mvp'),
  }
}
