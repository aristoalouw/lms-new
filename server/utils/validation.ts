import { invalidInput } from './errors'

export function requireRecord(value: unknown, label = 'body'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalidInput(`${label} harus berupa objek.`)
  }
  return value as Record<string, unknown>
}

export function requireString(
  value: unknown,
  label: string,
  options: { min?: number; max?: number; pattern?: RegExp } = {},
): string {
  if (typeof value !== 'string') invalidInput(`${label} harus berupa teks.`)
  const normalized = value.trim()
  const min = options.min ?? 1
  const max = options.max ?? 200
  if (normalized.length < min || normalized.length > max) {
    invalidInput(`${label} harus memiliki panjang ${min}-${max} karakter.`)
  }
  if (options.pattern && !options.pattern.test(normalized)) invalidInput(`${label} memiliki format yang tidak valid.`)
  return normalized
}

export function optionalString(value: unknown, label: string, max = 500): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return requireString(value, label, { max })
}

export function requirePositiveNumber(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) {
    invalidInput(`${label} harus berupa angka positif yang valid.`)
  }
  return value
}

export function requireStringArray(value: unknown, label: string, maxItems = 500): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    invalidInput(`${label} harus berisi 1-${maxItems} item.`)
  }
  const normalized = value.map((item, index) => requireString(item, `${label}[${index}]`, { max: 100 }))
  return [...new Set(normalized)]
}

export function requireInteger(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    invalidInput(`${label} harus berupa bilangan bulat antara ${min} dan ${max}.`)
  }
  return value as number
}

export function normalizeIsoInstant(
  value: unknown,
  label: string,
  options: { now?: number; maxFutureMs?: number } = {},
): string {
  const raw = requireString(value, label, {
    max: 48,
    pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
  })
  const instant = new Date(raw)
  const now = options.now ?? Date.now()
  if (Number.isNaN(instant.getTime()) || instant.getTime() > now + (options.maxFutureMs ?? 0)) {
    invalidInput(`${label} harus berupa waktu ISO yang valid dan tidak berada di masa depan.`)
  }
  return instant.toISOString()
}
