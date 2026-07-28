import * as Sentry from '@sentry/node'
import { sanitizeSentryEvent, sanitizeSentryText } from '../../shared/observability/sentry'
import { trustedRequestId } from '../utils/security'
import { sentryEnabled } from '../utils/capabilities'

export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig()
  const dsn = process.env.SENTRY_DSN || config.sentryDsn
  if (!sentryEnabled() || !dsn) return

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || config.sentryEnvironment || config.public.appEnvironment,
    release: process.env.SENTRY_RELEASE || config.sentryRelease || undefined,
    sendDefaultPii: false,
    tracesSampleRate: config.public.appEnvironment === 'production' ? 0.05 : 0,
    beforeSend(event) { return sanitizeSentryEvent(event) },
  })

  nitroApp.hooks.hook('error', (error, context) => {
    const statusCode = (error as Error & { statusCode?: number }).statusCode
    if (typeof statusCode === 'number' && statusCode < 500) return
    Sentry.withScope(scope => {
      const requestId = context.event ? trustedRequestId(context.event) : undefined
      if (requestId) scope.setTag('request_id', sanitizeSentryText(requestId))
      if (context.event) scope.setTag('request_method', context.event.method)
      Sentry.captureException(error)
    })
  })

  nitroApp.hooks.hook('close', () => Sentry.close(2_000))
})
