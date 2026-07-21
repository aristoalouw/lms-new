export class CampusError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'CampusError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

export function isCampusError(error: unknown): error is CampusError {
  return error instanceof CampusError
}

export function invalidInput(message: string, details?: Record<string, unknown>): never {
  throw new CampusError(400, 'INVALID_INPUT', message, details)
}

export function forbidden(message = 'Anda tidak memiliki izin untuk tindakan ini.'): never {
  throw new CampusError(403, 'FORBIDDEN', message)
}

export function notFound(resource: string): never {
  throw new CampusError(404, 'NOT_FOUND', `${resource} tidak ditemukan.`)
}

export function conflict(code: string, message: string, details?: Record<string, unknown>): never {
  throw new CampusError(409, code, message, details)
}

export function serviceUnavailable(message: string): never {
  throw new CampusError(503, 'SERVICE_UNAVAILABLE', message)
}
