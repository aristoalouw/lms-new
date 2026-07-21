import * as Sentry from '@sentry/vue'
import { sanitizeSentryEvent, sanitizeSentryText, scrubSentryValue } from '~/shared/observability/sentry'

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig()
  if (!config.public.sentryDsn) return

  Sentry.init({
    app: nuxtApp.vueApp,
    dsn: config.public.sentryDsn,
    environment: config.public.appEnvironment,
    release: config.public.sentryRelease || undefined,
    sendDefaultPii: false,
    tracesSampleRate: config.public.appEnvironment === 'production' ? 0.05 : 0,
    beforeBreadcrumb(breadcrumb) {
      breadcrumb.message = breadcrumb.message ? sanitizeSentryText(breadcrumb.message) : breadcrumb.message
      breadcrumb.data = scrubSentryValue(breadcrumb.data) as Record<string, unknown> | undefined
      return breadcrumb
    },
    beforeSend(event) {
      return sanitizeSentryEvent(event)
    },
  })
})
