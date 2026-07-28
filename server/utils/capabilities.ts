function enabledByEnvironment(name: string): boolean {
  const configured = process.env[name]
  if (configured === 'true') return true
  if (configured === 'false') return false
  return process.env.NODE_ENV !== 'production'
}

export function fileUploadsEnabled(): boolean {
  return enabledByEnvironment('FILE_UPLOADS_ENABLED')
}

export function emailDeliveryEnabled(): boolean {
  return enabledByEnvironment('EMAIL_DELIVERY_ENABLED')
}

export function sentryEnabled(): boolean {
  return enabledByEnvironment('SENTRY_ENABLED')
}
