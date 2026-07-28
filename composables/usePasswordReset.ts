import { FirebaseError } from 'firebase/app'
import { sendPasswordResetEmail } from 'firebase/auth'

const genericMessage = 'Jika alamat terdaftar dan aktif, petunjuk pemulihan telah dikirim.'

export const usePasswordReset = () => {
  const config = useRuntimeConfig()
  const nuxtApp = useNuxtApp()

  const nativeFirebaseAvailable = computed(() => Boolean(
    config.public.firebaseApiKey
    && config.public.firebaseAuthDomain
    && config.public.firebaseProjectId
    && config.public.firebaseAppId,
  ))
  const available = computed(() => config.public.emailDeliveryEnabled || nativeFirebaseAvailable.value)
  const deliveryLabel = computed(() => config.public.emailDeliveryEnabled
    ? 'gateway email aplikasi'
    : 'email pemulihan Firebase')

  const requestPasswordReset = async (email: string, idempotencyKey: string) => {
    const normalizedEmail = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error('Masukkan alamat email yang valid.')
    }

    if (config.public.emailDeliveryEnabled) {
      const { data } = await nuxtApp.$api.post<{ message: string }>('/auth/password-reset/request', {
        email: normalizedEmail,
      }, {
        headers: { 'Idempotency-Key': idempotencyKey },
      })
      return data.message
    }

    if (!nativeFirebaseAvailable.value || !nuxtApp.$firebaseAuth) {
      throw new Error('Layanan pemulihan akun belum dikonfigurasi.')
    }

    try {
      await sendPasswordResetEmail(nuxtApp.$firebaseAuth, normalizedEmail)
    } catch (error) {
      if (!(error instanceof FirebaseError) || ![
        'auth/user-not-found',
        'auth/invalid-email',
      ].includes(error.code)) {
        throw new Error('Permintaan belum dapat diproses. Coba kembali nanti.', { cause: error })
      }
    }
    return genericMessage
  }

  return {
    available: readonly(available),
    deliveryLabel: readonly(deliveryLabel),
    requestPasswordReset,
  }
}
