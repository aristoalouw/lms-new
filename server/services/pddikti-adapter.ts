import type { PddiktiEntityType } from '../types/domain'
import type {
  PddiktiAdapterContract,
  PddiktiAdapterHealth,
  PddiktiFeederAdapter,
  PddiktiPushBatchRequest,
  PddiktiPushBatchResult,
  PddiktiPushItemResult,
  PddiktiRemoteRecord,
  PddiktiScalar,
} from '../types/pddikti'
import { PDDIKTI_ENTITY_TYPES } from '../types/domain'
import { invalidInput } from '../utils/errors'
import { DEFAULT_PDDIKTI_CONTRACT_VERSION } from './pddikti-state'

const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_BATCH_SIZE = 50

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = raw === undefined || raw === '' ? fallback : Number(raw)
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}

function operationMap(raw: string | undefined): Partial<Record<PddiktiEntityType, string>> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).flatMap(([entityType, value]) => {
      if (!PDDIKTI_ENTITY_TYPES.includes(entityType as PddiktiEntityType) || typeof value !== 'string') return []
      const normalized = value.trim()
      return normalized && normalized.length <= 160 ? [[entityType, normalized]] : []
    })) as Partial<Record<PddiktiEntityType, string>>
  } catch {
    return {}
  }
}

export function pddiktiContractFromEnvironment(env: NodeJS.ProcessEnv = process.env): PddiktiAdapterContract {
  return {
    name: 'campus-pddikti-gateway',
    version: env.PDDIKTI_CONTRACT_VERSION?.trim() || DEFAULT_PDDIKTI_CONTRACT_VERSION,
    operationKeys: operationMap(env.PDDIKTI_OPERATION_MAP_JSON),
    maxBatchSize: boundedInteger(env.PDDIKTI_MAX_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 100),
    timeoutMs: boundedInteger(env.PDDIKTI_ADAPTER_TIMEOUT_MS ?? env.NEO_FEEDER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1_000, 120_000),
  }
}

export function mockPddiktiContract(overrides: Partial<PddiktiAdapterContract> = {}): PddiktiAdapterContract {
  return {
    name: 'campus-pddikti-mock-gateway',
    version: DEFAULT_PDDIKTI_CONTRACT_VERSION,
    operationKeys: Object.fromEntries(PDDIKTI_ENTITY_TYPES.map(entityType => [entityType, `mock-only:${entityType}`])),
    maxBatchSize: 50,
    timeoutMs: 5_000,
    ...overrides,
  }
}

const SECRET_PATTERN = /(bearer\s+)[A-Za-z0-9._~+/=-]+|((?:password|passwd|secret|token|authorization|username)\s*[:=]\s*)[^\s,;]+/gi
const URL_SECRET_PATTERN = /([?&](?:token|key|secret|password)=)[^&\s]+/gi

export function sanitizePddiktiError(error: unknown): { code: string; message: string } {
  const candidate = error as { code?: unknown; message?: unknown; name?: unknown }
  const rawCode = typeof candidate?.code === 'string' ? candidate.code : typeof candidate?.name === 'string' ? candidate.name : 'ADAPTER_ERROR'
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9_.-]/g, '_').slice(0, 80) || 'ADAPTER_ERROR'
  const rawMessage = typeof candidate?.message === 'string' ? candidate.message : 'Adapter PDDIKTI gagal memproses permintaan.'
  const message = rawMessage
    .replace(SECRET_PATTERN, (_match, bearerPrefix: string | undefined, keyPrefix: string | undefined) => `${bearerPrefix || keyPrefix || ''}[REDACTED]`)
    .replace(URL_SECRET_PATTERN, '$1[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500)
  return { code, message }
}

function isScalar(value: unknown): value is PddiktiScalar {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

function scalarRecord(value: unknown, label: string): Record<string, PddiktiScalar> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidInput(`${label} dari adapter tidak valid.`)
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 200 || entries.some(([, item]) => !isScalar(item))) invalidInput(`${label} dari adapter tidak valid.`)
  return Object.fromEntries(entries) as Record<string, PddiktiScalar>
}

function parsePushResult(value: unknown, request: PddiktiPushBatchRequest): PddiktiPushBatchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidInput('Respons batch adapter tidak valid.')
  const body = value as Record<string, unknown>
  if (!Array.isArray(body.items) || body.items.length > request.records.length) invalidInput('Item respons batch adapter tidak valid.')
  const allowedIds = new Set(request.records.map(record => record.internalId))
  const seen = new Set<string>()
  const items: PddiktiPushItemResult[] = body.items.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalidInput('Item respons batch adapter tidak valid.')
    const item = raw as Record<string, unknown>
    const internalId = typeof item.internalId === 'string' ? item.internalId.slice(0, 160) : ''
    const status = item.status === 'ACCEPTED' || item.status === 'REJECTED' ? item.status : undefined
    if (!internalId || !status || !allowedIds.has(internalId) || seen.has(internalId)) invalidInput('Identitas item respons batch adapter tidak valid.')
    seen.add(internalId)
    const sanitized = item.error ? sanitizePddiktiError(item.error) : undefined
    return {
      internalId,
      status,
      ...(typeof item.remoteId === 'string' && item.remoteId.trim() ? { remoteId: item.remoteId.trim().slice(0, 200) } : {}),
      ...(typeof item.remoteVersion === 'string' && item.remoteVersion.trim() ? { remoteVersion: item.remoteVersion.trim().slice(0, 100) } : {}),
      ...(sanitized ? { error: sanitized } : {}),
    }
  })
  if (seen.size !== request.records.length) invalidInput('Adapter harus mengembalikan tepat satu hasil untuk setiap record batch.')
  return { ...(typeof body.requestId === 'string' ? { requestId: body.requestId.slice(0, 160) } : {}), items }
}

function parseRemoteRecords(value: unknown): PddiktiRemoteRecord[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidInput('Respons snapshot adapter tidak valid.')
  const body = value as Record<string, unknown>
  if (!Array.isArray(body.records) || body.records.length > 10_000) invalidInput('Daftar snapshot adapter tidak valid.')
  const seen = new Set<string>()
  return body.records.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalidInput('Record snapshot adapter tidak valid.')
    const item = raw as Record<string, unknown>
    const remoteId = typeof item.remoteId === 'string' ? item.remoteId.trim().slice(0, 200) : ''
    if (!remoteId || seen.has(remoteId)) invalidInput('Identitas record snapshot adapter tidak valid.')
    seen.add(remoteId)
    return {
      remoteId,
      ...(typeof item.internalId === 'string' && item.internalId.trim() ? { internalId: item.internalId.trim().slice(0, 160) } : {}),
      ...(typeof item.remoteVersion === 'string' && item.remoteVersion.trim() ? { remoteVersion: item.remoteVersion.trim().slice(0, 100) } : {}),
      fields: scalarRecord(item.fields, 'fields snapshot'),
    }
  })
}

export interface HttpPddiktiAdapterOptions {
  baseUrl: string
  bearerToken: string
  fetchImpl?: typeof fetch
}

export function createHttpPddiktiAdapter(
  contract: PddiktiAdapterContract,
  options: HttpPddiktiAdapterOptions,
): PddiktiFeederAdapter {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl ?? fetch
  if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(baseUrl)) {
    invalidInput('PDDIKTI_ADAPTER_BASE_URL harus HTTPS atau localhost.')
  }
  if (!options.bearerToken.trim()) invalidInput('Token adapter PDDIKTI belum dikonfigurasi.')

  const request = async (path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${options.bearerToken}`,
        'x-pddikti-contract-version': contract.version,
        ...(init.headers ?? {}),
      },
    })
    if (!response.ok) {
      const error = new Error(`Adapter gateway mengembalikan HTTP ${response.status}.`)
      ;(error as Error & { code: string }).code = `ADAPTER_HTTP_${response.status}`
      throw error
    }
    return response.json()
  }

  return {
    contractVersion: contract.version,
    async health(signal) {
      const started = Date.now()
      try {
        await request('/health', { method: 'GET' }, signal)
        return { configured: true, reachable: true, contractVersion: contract.version, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started }
      } catch (error) {
        const sanitized = sanitizePddiktiError(error)
        return { configured: true, reachable: false, contractVersion: contract.version, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, message: sanitized.message }
      }
    },
    async pushBatch(batchRequest, signal) {
      if (batchRequest.contractVersion !== contract.version || batchRequest.records.length < 1 || batchRequest.records.length > contract.maxBatchSize) {
        invalidInput('Batch tidak sesuai versi atau batas kontrak adapter.')
      }
      return parsePushResult(await request('/batches', { method: 'POST', body: JSON.stringify(batchRequest) }, signal), batchRequest)
    },
    async fetchSnapshot(snapshotRequest, signal) {
      if (snapshotRequest.contractVersion !== contract.version) invalidInput('Versi kontrak snapshot tidak sesuai.')
      return parseRemoteRecords(await request('/snapshots', { method: 'POST', body: JSON.stringify(snapshotRequest) }, signal))
    },
  }
}

export function pddiktiAdapterFromEnvironment(
  contract = pddiktiContractFromEnvironment(),
  env: NodeJS.ProcessEnv = process.env,
): PddiktiFeederAdapter | null {
  const baseUrl = env.PDDIKTI_ADAPTER_BASE_URL?.trim()
  const bearerToken = env.PDDIKTI_ADAPTER_BEARER_TOKEN?.trim()
  if (!baseUrl || !bearerToken) return null
  return createHttpPddiktiAdapter(contract, { baseUrl, bearerToken })
}

export function missingAdapterHealth(contract: PddiktiAdapterContract): PddiktiAdapterHealth {
  return {
    configured: false,
    reachable: false,
    contractVersion: contract.version,
    checkedAt: new Date().toISOString(),
    message: 'Gateway adapter belum dikonfigurasi; tidak ada klaim koneksi Neo Feeder yang dibuat.',
  }
}
