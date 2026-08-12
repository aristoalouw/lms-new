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
    candidate.request = {
      ...(typeof candidate.request.method === 'string' ? { method: candidate.request.method.slice(0, 12).toUpperCase() } : {}),
      ...(typeof candidate.request.url === 'string' ? { url: sanitizeSentryUrl(candidate.request.url) } : {}),
    }
  }
  delete candidate.user
  delete candidate.message
  delete candidate.logentry
  delete candidate.extra
  delete candidate.contexts
  delete candidate.fingerprint
  candidate.breadcrumbs = Array.isArray(candidate.breadcrumbs)
    ? candidate.breadcrumbs.slice(-50).map((breadcrumb: Record<string, unknown>) => ({
        ...(typeof breadcrumb.category === 'string' ? { category: sanitizeSentryText(breadcrumb.category).slice(0, 80) } : {}),
        ...(typeof breadcrumb.type === 'string' ? { type: breadcrumb.type.slice(0, 40) } : {}),
        ...(typeof breadcrumb.level === 'string' ? { level: breadcrumb.level.slice(0, 20) } : {}),
        ...(typeof breadcrumb.timestamp === 'number' ? { timestamp: breadcrumb.timestamp } : {}),
      }))
    : candidate.breadcrumbs
  const allowedTags = new Set(['request_id', 'request_method', 'error_code', 'feature_profile'])
  candidate.tags = candidate.tags && typeof candidate.tags === 'object'
    ? Object.fromEntries(Object.entries(candidate.tags).filter(([key]) => allowedTags.has(key)).map(([key, value]) => [key, sanitizeSentryText(String(value)).slice(0, 120)]))
    : candidate.tags
  candidate.transaction = typeof candidate.transaction === 'string' ? sanitizeSentryText(candidate.transaction) : candidate.transaction
  candidate.exception?.values?.forEach((exception: { value?: string; stacktrace?: { frames?: Array<Record<string, unknown>> } }) => {
    if (exception.value) exception.value = '[Pesan teknis disaring]'
    if (Array.isArray(exception.stacktrace?.frames)) {
      exception.stacktrace.frames = exception.stacktrace.frames.map(frame => ({
        ...('filename' in frame ? { filename: frame.filename } : {}),
        ...('function' in frame ? { function: frame.function } : {}),
        ...('lineno' in frame ? { lineno: frame.lineno } : {}),
        ...('colno' in frame ? { colno: frame.colno } : {}),
        ...('in_app' in frame ? { in_app: frame.in_app } : {}),
      }))
    }
  })
  return candidate as T
}
