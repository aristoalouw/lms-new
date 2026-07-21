export type PrivacyPreferences = {
  necessary: true
  analytics: boolean
  experience: boolean
  decided: boolean
}

const defaultPreferences: PrivacyPreferences = {
  necessary: true,
  analytics: false,
  experience: false,
  decided: false,
}

export const usePrivacyConsent = () => {
  const preferences = useState<PrivacyPreferences>('privacy.preferences', () => ({ ...defaultPreferences }))
  const initialized = useState<boolean>('privacy.initialized', () => false)

  if (import.meta.client && !initialized.value) {
    initialized.value = true
    const saved = localStorage.getItem('nusa-campus-privacy')
    if (saved) {
      try {
        preferences.value = { ...defaultPreferences, ...JSON.parse(saved), necessary: true }
      } catch {
        localStorage.removeItem('nusa-campus-privacy')
      }
    }
  }

  const save = (analytics: boolean, experience: boolean) => {
    preferences.value = { necessary: true, analytics, experience, decided: true }
    if (import.meta.client) localStorage.setItem('nusa-campus-privacy', JSON.stringify(preferences.value))
  }

  return {
    preferences: readonly(preferences),
    acceptAll: () => save(true, true),
    rejectOptional: () => save(false, false),
    save,
  }
}
