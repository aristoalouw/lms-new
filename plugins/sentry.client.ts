import * as Sentry from '@sentry/vue'

const sensitiveKey = /password|passcode|secret|token|authorization|cookie|session|email|phone|address|nim|nik|student|grade|nilai|finance|payment|amount|document|file|transcript/i

const sanitizeText = (value: string) => value
  .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [Disaring]')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[Email disaring]')
  .replace(/\b\d{10,18}\b/g, '[Nomor disaring]')
  .replace(/([?&](?:token|code|email|nim|nik|id)=[^&\s]+)/gi, '[Parameter disaring]')

const scrub = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return '[Dibatasi]'
  if (typeof value === 'string') return sanitizeText(value).slice(0, 2_000)
  if (Array.isArray(value)) return value.slice(0, 50).map(item => scrub(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    sensitiveKey.test(key) ? '[Disaring]' : scrub(item, depth + 1),
  ]))
}

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig()
  if (!config.public.sentryDsn) return

  Sentry.init({
    app: nuxtApp.vueApp,
    dsn: config.public.sentryDsn,
    environment: config.public.appEnvironment,
    sendDefaultPii: false,
    tracesSampleRate: config.public.appEnvironment === 'production' ? 0.05 : 0,
    beforeBreadcrumb(breadcrumb) {
      breadcrumb.message = breadcrumb.message ? sanitizeText(breadcrumb.message) : breadcrumb.message
      breadcrumb.data = scrub(breadcrumb.data) as Record<string, unknown> | undefined
      return breadcrumb
    },
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies
        delete event.request.data
        delete event.request.headers
        delete event.request.query_string
        event.request.url = event.request.url?.split('?')[0]
      }
      delete event.user
      event.extra = scrub(event.extra) as typeof event.extra
      event.contexts = scrub(event.contexts) as typeof event.contexts
      event.tags = scrub(event.tags) as typeof event.tags
      event.transaction = event.transaction ? sanitizeText(event.transaction) : event.transaction
      event.exception?.values?.forEach((exception) => {
        if (exception.value) exception.value = sanitizeText(exception.value)
      })
      return event
    },
  })
})
