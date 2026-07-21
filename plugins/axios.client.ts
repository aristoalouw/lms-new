import axios from 'axios'

const sensitiveKeys = ['password', 'token', 'authorization', 'cookie', 'nim', 'nik', 'nilai', 'amount']

const sanitizePayload = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizePayload)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    sensitiveKeys.some((sensitiveKey) => key.toLowerCase().includes(sensitiveKey)) ? '[Disaring]' : sanitizePayload(item),
  ]))
}

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()
  const requestId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`

  const api = axios.create({
    baseURL: config.public.apiBaseUrl,
    timeout: 20_000,
    withCredentials: true,
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
  })

  api.interceptors.request.use((request) => {
    request.headers.set('X-Request-ID', requestId())
    return request
  })

  api.interceptors.response.use(
    response => response,
    (error) => {
      if (import.meta.dev) {
        console.warn('Permintaan layanan gagal', {
          status: error.response?.status,
          url: error.config?.url,
          data: sanitizePayload(error.response?.data),
        })
      }
      return Promise.reject(error)
    },
  )

  return { provide: { api } }
})
