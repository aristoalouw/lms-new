export const sentrySensitiveKey = /password|passcode|secret|token|authorization|cookie|session|email|phone|address|nim|nik|student|grade|nilai|finance|payment|amount|document|file|submission|feedback/i

export const sanitizeSentryText = (value: string) => value
  .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [Disaring]')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[Email disaring]')
  .replace(/\b\d{8,18}\b/g, '[Nomor disaring]')
  .replace(/([?&](?:token|code|email|nim|nik|id)=[^&\s]+)/gi, '[Parameter disaring]')
  .slice(0, 2_000)

export const sanitizeSentryUrl = (value: string) => sanitizeSentryText(value.split(/[?#]/, 1)[0] ?? '')
  .replace(/\/(files?|submissions?|attempts?|grades?|students?|users?|accounts?|enrollments?|attendance)\/[^/]+/gi, '/$1/[ID disaring]')

export function scrubSentryValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[Dibatasi]'
  if (typeof value === 'string') return sanitizeSentryText(value)
  if (Array.isArray(value)) return value.slice(0, 50).map(item => scrubSentryValue(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    sentrySensitiveKey.test(key) ? '[Disaring]' : scrubSentryValue(item, depth + 1),
  ]))
}

export function sanitizeSentryEvent<T extends Record<string, any>>(event: T): T {
  const candidate = event as Record<string, any>
  if (candidate.request) {
    delete candidate.request.cookies
    delete candidate.request.data
    delete candidate.request.env
    delete candidate.request.fragment
    delete candidate.request.headers
    delete candidate.request.query_string
    candidate.request.url = typeof candidate.request.url === 'string' ? sanitizeSentryUrl(candidate.request.url) : candidate.request.url
  }
  delete candidate.user
  candidate.message = typeof candidate.message === 'string' ? sanitizeSentryText(candidate.message) : candidate.message
  candidate.logentry = scrubSentryValue(candidate.logentry)
  candidate.breadcrumbs = Array.isArray(candidate.breadcrumbs)
    ? candidate.breadcrumbs.slice(-50).map((breadcrumb: Record<string, unknown>) => scrubSentryValue(breadcrumb))
    : candidate.breadcrumbs
  candidate.extra = scrubSentryValue(candidate.extra)
  candidate.contexts = scrubSentryValue(candidate.contexts)
  candidate.tags = scrubSentryValue(candidate.tags)
  candidate.transaction = typeof candidate.transaction === 'string' ? sanitizeSentryText(candidate.transaction) : candidate.transaction
  candidate.exception?.values?.forEach((exception: { value?: string }) => {
    if (exception.value) exception.value = sanitizeSentryText(exception.value)
  })
  return candidate as T
}
