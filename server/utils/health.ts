export function publicHealthPayload(
  now = new Date(),
  version = process.env.APP_VERSION || 'development',
): {
  status: 'ok'
  timestamp: string
  version: string
} {
  return {
    status: 'ok',
    timestamp: now.toISOString(),
    version,
  }
}

export function publicReadinessPayload(ready: boolean, now = new Date()): {
  status: 'ready' | 'not_ready'
  timestamp: string
} {
  return {
    status: ready ? 'ready' : 'not_ready',
    timestamp: now.toISOString(),
  }
}
