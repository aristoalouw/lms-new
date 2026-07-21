import { createHash, timingSafeEqual } from 'node:crypto'
import { getHeader, type H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { PddiktiSyncJob } from '../types/domain'
import type {
  PddiktiAdapterContract,
  PddiktiBatchResultHistory,
  PddiktiContractRecord,
  PddiktiEntityMapping,
  PddiktiFeederAdapter,
  PddiktiJobEvent,
  PddiktiPushBatchResult,
  PddiktiPushItemResult,
  PddiktiWorkerJob,
  PddiktiWorkerRun,
  PddiktiWorkerStatus,
} from '../types/pddikti'
import { forbidden, conflict, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { cloneValue, mockState } from '../utils/mock-store'
import { requirePermission } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import {
  missingAdapterHealth,
  pddiktiAdapterFromEnvironment,
  pddiktiContractFromEnvironment,
  sanitizePddiktiError,
} from './pddikti-adapter'
import { hydratePddiktiJob, listPddiktiJobs, loadPddiktiJobPayload, transitionPddiktiFailure } from './pddikti'
import { pddiktiModuleState } from './pddikti-state'

export interface ClaimPddiktiOptions {
  now?: Date
  limit?: number
  leaseMs?: number
}

export interface RunPddiktiWorkerOptions {
  workerId: string
  maxJobs?: number
  leaseMs?: number
  now?: Date
  contract?: PddiktiAdapterContract
  adapter?: PddiktiFeederAdapter
}

const STATUS_KEYS = ['QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER'] as const

function safeWorkerId(value: string): string {
  const normalized = value.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,99}$/.test(normalized)) invalidInput('workerId tidak valid.')
  return normalized
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  return Number.isInteger(value) && value! >= min && value! <= max ? value! : fallback
}

function jobEvent(
  job: PddiktiWorkerJob,
  type: PddiktiJobEvent['type'],
  occurredAt: string,
  actor: string,
  details: Partial<Omit<PddiktiJobEvent, 'id' | 'type' | 'occurredAt' | 'actor' | 'attempt'>> = {},
): PddiktiJobEvent {
  return {
    id: opaqueId('pddikti_event', `${job.id}:${type}:${occurredAt}:${actor}:${job.history.length}`),
    type,
    occurredAt,
    actor,
    attempt: job.attempts + 1,
    ...details,
  }
}

function claimJob(current: PddiktiWorkerJob, workerId: string, now: Date, leaseMs: number): PddiktiWorkerJob {
  const timestamp = now.toISOString()
  const recovering = current.status === 'PROCESSING'
  const leaseToken = opaqueId('lease', `${current.id}:${workerId}:${timestamp}:${current.leaseRecoveries + 1}:${Math.random()}`)
  const recoveryEvent = recovering ? [jobEvent(current, 'LEASE_RECOVERED', timestamp, workerId, {
    error: { code: 'ABANDONED_LEASE', message: 'Lease worker sebelumnya kedaluwarsa dan diambil alih secara atomik.' },
  })] : []
  const withRecovery: PddiktiWorkerJob = recovering
    ? { ...current, leaseRecoveries: current.leaseRecoveries + 1, history: [...current.history, ...recoveryEvent] }
    : current
  return {
    ...withRecovery,
    status: 'PROCESSING',
    leaseOwner: workerId,
    leaseToken,
    leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    claimedAt: timestamp,
    updatedAt: timestamp,
    history: [...withRecovery.history, jobEvent(withRecovery, 'CLAIMED', timestamp, workerId)],
  }
}

function isClaimable(job: PddiktiWorkerJob, now: Date): boolean {
  if (job.status === 'QUEUED') return new Date(job.nextAttemptAt).getTime() <= now.getTime()
  return job.status === 'PROCESSING' && Boolean(job.leaseExpiresAt) && new Date(job.leaseExpiresAt!).getTime() <= now.getTime()
}

async function ensurePddiktiLease(
  claimed: PddiktiWorkerJob,
  now: Date,
  minimumRemainingMs: number,
  leaseMs: number,
): Promise<PddiktiWorkerJob> {
  const currentExpiry = claimed.leaseExpiresAt ? new Date(claimed.leaseExpiresAt).getTime() : 0
  if (currentExpiry > now.getTime() + minimumRemainingMs) return claimed
  const extend = (fresh: PddiktiWorkerJob): PddiktiWorkerJob => {
    if (fresh.status !== 'PROCESSING' || fresh.leaseToken !== claimed.leaseToken) conflict('PDDIKTI_LEASE_LOST', 'Lease job tidak lagi dimiliki worker ini.')
    return {
      ...fresh,
      leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      updatedAt: now.toISOString(),
    }
  }

  if (dataMode() === 'mock') {
    const stored = mockState().pddiktiJobs.get(claimed.id)
    if (!stored) notFound('Job sinkronisasi')
    const updated = extend(hydratePddiktiJob(stored))
    mockState().pddiktiJobs.set(updated.id, cloneValue(updated))
    return updated
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Antrean worker PDDIKTI tidak tersedia.')
  const reference = db.collection('pddiktiSyncJobs').doc(claimed.id)
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists) notFound('Job sinkronisasi')
    const updated = extend(hydratePddiktiJob({ id: snapshot.id, ...snapshot.data() } as PddiktiSyncJob))
    transaction.set(reference, updated)
    return updated
  })
}

export async function claimPddiktiJobs(workerIdInput: string, options: ClaimPddiktiOptions = {}): Promise<PddiktiWorkerJob[]> {
  const workerId = safeWorkerId(workerIdInput)
  const now = options.now ?? new Date()
  const limit = bounded(options.limit, 5, 1, 10)
  const leaseMs = bounded(options.leaseMs, 120_000, 30_000, 600_000)

  if (dataMode() === 'mock') {
    const candidates = [...mockState().pddiktiJobs.values()]
      .map(job => hydratePddiktiJob(job))
      .filter(job => isClaimable(job, now))
      .sort((left, right) => left.nextAttemptAt.localeCompare(right.nextAttemptAt) || left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit)
    const claimed = candidates.map((job) => {
      const next = claimJob(job, workerId, now, leaseMs)
      mockState().pddiktiJobs.set(next.id, cloneValue(next))
      return cloneValue(next)
    })
    return claimed
  }

  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Antrean worker PDDIKTI tidak tersedia.')
  const timestamp = now.toISOString()
  const [queuedSnapshot, abandonedSnapshot] = await Promise.all([
    db.collection('pddiktiSyncJobs').where('status', '==', 'QUEUED').where('nextAttemptAt', '<=', timestamp).orderBy('nextAttemptAt', 'asc').limit(limit * 2).get(),
    db.collection('pddiktiSyncJobs').where('status', '==', 'PROCESSING').where('leaseExpiresAt', '<=', timestamp).orderBy('leaseExpiresAt', 'asc').limit(limit * 2).get(),
  ])
  const candidates = [...abandonedSnapshot.docs, ...queuedSnapshot.docs]
    .filter((document, index, all) => all.findIndex(item => item.id === document.id) === index)
    .slice(0, limit * 2)
  const claimed: PddiktiWorkerJob[] = []
  for (const candidate of candidates) {
    if (claimed.length >= limit) break
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(candidate.ref)
      if (!snapshot.exists) return undefined
      const current = hydratePddiktiJob({ id: snapshot.id, ...snapshot.data() } as PddiktiSyncJob)
      if (!isClaimable(current, now)) return undefined
      const next = claimJob(current, workerId, now, leaseMs)
      transaction.set(candidate.ref, next)
      return next
    })
    if (result) claimed.push(result)
  }
  return claimed
}

function resultKey(jobId: string, attempt: number, batchIndex: number): string {
  return `${jobId}:${attempt}:${batchIndex}`
}

async function loadPersistedBatch(jobId: string, attempt: number, batchIndex: number): Promise<PddiktiBatchResultHistory | undefined> {
  const key = resultKey(jobId, attempt, batchIndex)
  if (dataMode() === 'mock') {
    const result = pddiktiModuleState().batchResults.get(key)
    return result ? structuredClone(result) : undefined
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Riwayat batch PDDIKTI tidak tersedia.')
  const snapshot = await db.collection('pddiktiBatchResults').doc(opaqueId('batch_result', key)).get()
  return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as PddiktiBatchResultHistory) : undefined
}

function normalizeBatchResult(
  requestRecords: PddiktiContractRecord[],
  raw: PddiktiPushBatchResult,
): PddiktiPushItemResult[] {
  const expected = new Set(requestRecords.map(record => record.internalId))
  const seen = new Set<string>()
  if (!Array.isArray(raw.items) || raw.items.length !== requestRecords.length) conflict('PDDIKTI_ADAPTER_CONTRACT_VIOLATION', 'Adapter tidak mengembalikan satu hasil per record.')
  return raw.items.map((item) => {
    if (!expected.has(item.internalId) || seen.has(item.internalId) || !['ACCEPTED', 'REJECTED'].includes(item.status)) {
      conflict('PDDIKTI_ADAPTER_CONTRACT_VIOLATION', 'Identitas atau status hasil adapter tidak valid.')
    }
    seen.add(item.internalId)
    if (item.status === 'ACCEPTED' && !item.remoteId) {
      return { internalId: item.internalId, status: 'REJECTED', error: { code: 'REMOTE_ID_MISSING', message: 'Adapter tidak mengembalikan identifier remote untuk hasil yang diterima.' } }
    }
    return {
      internalId: item.internalId,
      status: item.status,
      ...(item.remoteId ? { remoteId: item.remoteId.slice(0, 200) } : {}),
      ...(item.remoteVersion ? { remoteVersion: item.remoteVersion.slice(0, 100) } : {}),
      ...(item.error ? { error: sanitizePddiktiError(item.error) } : {}),
    }
  })
}

async function callWithTimeout<T>(timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Adapter timeout')), timeoutMs)
  try {
    return await operation(controller.signal)
  } finally {
    clearTimeout(timeout)
  }
}

function mappingFromAccepted(
  job: PddiktiWorkerJob,
  record: PddiktiContractRecord,
  item: PddiktiPushItemResult,
  occurredAt: string,
  existing?: PddiktiEntityMapping,
): PddiktiEntityMapping {
  const remoteId = item.remoteId!
  const historyEntry = {
    occurredAt,
    jobId: job.id,
    internalFingerprint: record.fingerprint,
    remoteId,
    ...(item.remoteVersion ? { remoteVersion: item.remoteVersion } : {}),
  }
  return {
    id: existing?.id ?? opaqueId('pddikti_mapping', `${job.entityType}:${record.internalId}`),
    entityType: job.entityType,
    internalId: record.internalId,
    remoteId,
    programStudyId: job.programStudyId,
    mappingVersion: job.mappingVersion,
    internalFingerprint: record.fingerprint,
    ...(item.remoteVersion ? { remoteVersion: item.remoteVersion } : {}),
    status: 'ACTIVE',
    firstMappedAt: existing?.firstMappedAt ?? occurredAt,
    updatedAt: occurredAt,
    history: [...(existing?.history ?? []), historyEntry],
  }
}

async function persistBatch(
  job: PddiktiWorkerJob,
  records: PddiktiContractRecord[],
  items: PddiktiPushItemResult[],
  batchIndex: number,
  startedAt: string,
  completedAt: string,
): Promise<PddiktiBatchResultHistory> {
  const attempt = job.attempts + 1
  const key = resultKey(job.id, attempt, batchIndex)
  const accepted = items.filter(item => item.status === 'ACCEPTED')
  const rejected = items.length - accepted.length
  const batchEventType: PddiktiJobEvent['type'] = rejected ? 'BATCH_REJECTED' : 'BATCH_ACCEPTED'
  const firstError = items.find(item => item.status === 'REJECTED')?.error
  const result: PddiktiBatchResultHistory = {
    id: opaqueId('batch_result', key),
    jobId: job.id,
    attempt,
    batchIndex,
    idempotencyKey: `${job.payloadFingerprint}:${batchIndex}`,
    startedAt,
    completedAt,
    accepted: accepted.length,
    rejected,
    itemResults: items,
  }

  if (dataMode() === 'mock') {
    const current = hydratePddiktiJob(mockState().pddiktiJobs.get(job.id) ?? job)
    if (current.status !== 'PROCESSING' || current.leaseToken !== job.leaseToken) conflict('PDDIKTI_LEASE_LOST', 'Lease job tidak lagi dimiliki worker ini.')
    if (pddiktiModuleState().batchResults.has(key)) return structuredClone(pddiktiModuleState().batchResults.get(key)!)
    for (const item of accepted) {
      const record = records.find(candidate => candidate.internalId === item.internalId)!
      const mappingId = opaqueId('pddikti_mapping', `${job.entityType}:${record.internalId}`)
      const existing = pddiktiModuleState().entityMappings.get(mappingId)
      pddiktiModuleState().entityMappings.set(mappingId, mappingFromAccepted(job, record, item, completedAt, existing))
    }
    pddiktiModuleState().batchResults.set(key, structuredClone(result))
    const updated: PddiktiWorkerJob = {
      ...current,
      updatedAt: completedAt,
      history: [...current.history, jobEvent(current, batchEventType, completedAt, current.leaseOwner ?? 'worker', {
        batchIndex,
        accepted: accepted.length,
        rejected,
        ...(firstError ? { error: sanitizePddiktiError(firstError) } : {}),
      })],
    }
    mockState().pddiktiJobs.set(updated.id, cloneValue(updated))
    return result
  }

  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Riwayat batch PDDIKTI tidak tersedia.')
  const jobRef = db.collection('pddiktiSyncJobs').doc(job.id)
  const resultRef = db.collection('pddiktiBatchResults').doc(result.id)
  const acceptedData = accepted.map((item) => {
    const record = records.find(candidate => candidate.internalId === item.internalId)!
    return { item, record, ref: db.collection('pddiktiEntityMappings').doc(opaqueId('pddikti_mapping', `${job.entityType}:${record.internalId}`)) }
  })
  return db.runTransaction(async (transaction) => {
    const [currentSnapshot, existingResult, ...mappingSnapshots] = await Promise.all([
      transaction.get(jobRef), transaction.get(resultRef), ...acceptedData.map(data => transaction.get(data.ref)),
    ])
    if (!currentSnapshot.exists) notFound('Job sinkronisasi')
    const current = hydratePddiktiJob({ id: currentSnapshot.id, ...currentSnapshot.data() } as PddiktiSyncJob)
    if (current.status !== 'PROCESSING' || current.leaseToken !== job.leaseToken) conflict('PDDIKTI_LEASE_LOST', 'Lease job tidak lagi dimiliki worker ini.')
    if (existingResult.exists) return { id: existingResult.id, ...existingResult.data() } as PddiktiBatchResultHistory
    acceptedData.forEach((data, index) => {
      const snapshot = mappingSnapshots[index]
      const existing = snapshot?.exists ? ({ id: snapshot.id, ...snapshot.data() } as PddiktiEntityMapping) : undefined
      transaction.set(data.ref, mappingFromAccepted(job, data.record, data.item, completedAt, existing))
    })
    transaction.set(jobRef, {
      ...current,
      updatedAt: completedAt,
      history: [...current.history, jobEvent(current, batchEventType, completedAt, current.leaseOwner ?? 'worker', {
        batchIndex,
        accepted: accepted.length,
        rejected,
        ...(firstError ? { error: sanitizePddiktiError(firstError) } : {}),
      })],
    })
    transaction.create(resultRef, result)
    return result
  })
}

async function finalizeClaimedJob(
  claimed: PddiktiWorkerJob,
  outcome: { type: 'SUCCESS'; accepted: number; rejected: number } | { type: 'FAILURE'; error: { code: string; message: string }; accepted: number; rejected: number },
  now: Date,
): Promise<PddiktiWorkerJob> {
  const apply = (fresh: PddiktiWorkerJob): PddiktiWorkerJob => {
    if (fresh.status !== 'PROCESSING' || fresh.leaseToken !== claimed.leaseToken) conflict('PDDIKTI_LEASE_LOST', 'Lease job tidak lagi dimiliki worker ini.')
    const timestamp = now.toISOString()
    const withoutLease = { ...fresh }
    delete withoutLease.leaseOwner
    delete withoutLease.leaseToken
    delete withoutLease.leaseExpiresAt
    if (outcome.type === 'SUCCESS') {
      return {
        ...withoutLease,
        status: 'SUCCEEDED',
        attempts: fresh.attempts + 1,
        acceptedCount: outcome.accepted,
        rejectedCount: outcome.rejected,
        updatedAt: timestamp,
        completedAt: timestamp,
        history: [...fresh.history, jobEvent(fresh, 'SUCCEEDED', timestamp, claimed.leaseOwner ?? 'worker', { accepted: outcome.accepted, rejected: outcome.rejected })],
      }
    }
    const sanitized = sanitizePddiktiError(outcome.error)
    const transitioned = transitionPddiktiFailure(withoutLease, sanitized, now)
    const type = transitioned.status === 'DEAD_LETTER' ? 'DEAD_LETTERED' : 'RETRY_SCHEDULED'
    return {
      ...hydratePddiktiJob(transitioned),
      acceptedCount: outcome.accepted,
      rejectedCount: outcome.rejected,
      history: [...fresh.history, jobEvent(fresh, type, timestamp, claimed.leaseOwner ?? 'worker', { accepted: outcome.accepted, rejected: outcome.rejected, error: sanitized })],
    }
  }

  if (dataMode() === 'mock') {
    const stored = mockState().pddiktiJobs.get(claimed.id)
    if (!stored) notFound('Job sinkronisasi')
    const updated = apply(hydratePddiktiJob(stored))
    mockState().pddiktiJobs.set(updated.id, cloneValue(updated))
    return updated
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Antrean worker PDDIKTI tidak tersedia.')
  const reference = db.collection('pddiktiSyncJobs').doc(claimed.id)
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists) notFound('Job sinkronisasi')
    const updated = apply(hydratePddiktiJob({ id: snapshot.id, ...snapshot.data() } as PddiktiSyncJob))
    transaction.set(reference, updated)
    return updated
  })
}

export async function processClaimedPddiktiJob(
  claimed: PddiktiWorkerJob,
  contract: PddiktiAdapterContract,
  adapter: PddiktiFeederAdapter,
  nowFactory: () => Date = () => new Date(),
): Promise<PddiktiWorkerJob> {
  let accepted = 0
  let rejected = 0
  let activeClaim = claimed
  try {
    if (claimed.status !== 'PROCESSING' || !claimed.leaseToken) conflict('PDDIKTI_JOB_NOT_CLAIMED', 'Job harus memiliki lease aktif sebelum diproses.')
    if (adapter.contractVersion !== contract.version || claimed.contractVersion !== contract.version) conflict('PDDIKTI_CONTRACT_VERSION_MISMATCH', 'Versi kontrak job dan adapter tidak sesuai.')
    const operationKey = contract.operationKeys[claimed.entityType]
    if (!operationKey) conflict('PDDIKTI_OPERATION_UNCONFIGURED', 'Operation key terverifikasi belum dikonfigurasi.')
    const payload = await loadPddiktiJobPayload(claimed.id)
    const calculatedFingerprint = requestHash({ contractVersion: payload.contractVersion, mappingVersion: payload.mappingVersion, records: payload.records })
    if (payload.contractVersion !== claimed.contractVersion || payload.mappingVersion !== claimed.mappingVersion
      || payload.payloadFingerprint !== claimed.payloadFingerprint || calculatedFingerprint !== claimed.payloadFingerprint) {
      conflict('PDDIKTI_PAYLOAD_FINGERPRINT_MISMATCH', 'Snapshot payload tidak sesuai fingerprint job.')
    }
    const chunks = Array.from({ length: Math.ceil(payload.records.length / contract.maxBatchSize) }, (_, index) => payload.records.slice(index * contract.maxBatchSize, (index + 1) * contract.maxBatchSize))
    const leaseMs = Math.min(600_000, Math.max(30_000, contract.timeoutMs * 2 + 30_000))
    for (let batchIndex = 0; batchIndex < chunks.length; batchIndex += 1) {
      const records = chunks[batchIndex]!
      activeClaim = await ensurePddiktiLease(activeClaim, nowFactory(), contract.timeoutMs + 10_000, leaseMs)
      const attempt = claimed.attempts + 1
      const persisted = await loadPersistedBatch(claimed.id, attempt, batchIndex)
      if (persisted) {
        accepted += persisted.accepted
        rejected += persisted.rejected
        continue
      }
      const startedAt = nowFactory().toISOString()
      const idempotencyKey = `${claimed.payloadFingerprint}:${batchIndex}`
      const raw = await callWithTimeout(contract.timeoutMs, signal => adapter.pushBatch({
        contractVersion: contract.version,
        operationKey,
        entityType: claimed.entityType,
        programStudyId: claimed.programStudyId,
        periodId: claimed.periodId,
        idempotencyKey,
        records,
      }, signal))
      const items = normalizeBatchResult(records, raw)
      const completedAt = nowFactory().toISOString()
      const result = await persistBatch(activeClaim, records, items, batchIndex, startedAt, completedAt)
      accepted += result.accepted
      rejected += result.rejected
      if (result.rejected) {
        const firstError = result.itemResults.find(item => item.status === 'REJECTED')?.error
        throw Object.assign(new Error(firstError?.message ?? `${result.rejected} record ditolak adapter.`), { code: firstError?.code ?? 'REMOTE_RECORD_REJECTED' })
      }
    }
    return finalizeClaimedJob(activeClaim, { type: 'SUCCESS', accepted, rejected }, nowFactory())
  } catch (error) {
    const sanitized = sanitizePddiktiError(error)
    if (sanitized.code === 'PDDIKTI_LEASE_LOST') throw error
    return finalizeClaimedJob(activeClaim, { type: 'FAILURE', error: sanitized, accepted, rejected }, nowFactory())
  }
}

async function saveWorkerRun(run: PddiktiWorkerRun): Promise<void> {
  if (dataMode() === 'mock') {
    pddiktiModuleState().workerRuns.set(run.id, structuredClone(run))
    return
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Riwayat worker PDDIKTI tidak tersedia.')
  await db.collection('pddiktiWorkerRuns').doc(run.id).create(run)
}

export async function runPddiktiWorker(options: RunPddiktiWorkerOptions): Promise<PddiktiWorkerRun> {
  const workerId = safeWorkerId(options.workerId)
  const contract = options.contract ?? pddiktiContractFromEnvironment()
  const adapter = options.adapter ?? pddiktiAdapterFromEnvironment(contract)
  if (!adapter) serviceUnavailable('Gateway adapter PDDIKTI belum dikonfigurasi.')
  if (adapter.contractVersion !== contract.version) conflict('PDDIKTI_CONTRACT_VERSION_MISMATCH', 'Versi adapter tidak sama dengan versi kontrak worker.')
  const started = options.now ?? new Date()
  const claimed = await claimPddiktiJobs(workerId, {
    now: started,
    limit: bounded(options.maxJobs, 5, 1, 10),
    leaseMs: bounded(options.leaseMs, Math.max(120_000, contract.timeoutMs * 2 + 30_000), 30_000, 600_000),
  })
  const outcomes = await Promise.all(claimed.map(job => processClaimedPddiktiJob(job, contract, adapter)))
  const completedAt = new Date().toISOString()
  const run: PddiktiWorkerRun = {
    id: opaqueId('pddikti_worker_run', `${workerId}:${started.toISOString()}:${Math.random()}`),
    workerId,
    contractVersion: contract.version,
    startedAt: started.toISOString(),
    completedAt,
    claimed: claimed.length,
    succeeded: outcomes.filter(job => job.status === 'SUCCEEDED').length,
    retried: outcomes.filter(job => job.status === 'QUEUED').length,
    deadLettered: outcomes.filter(job => job.status === 'DEAD_LETTER').length,
  }
  await saveWorkerRun(run)
  return run
}

export function verifyPddiktiWorkerSecret(provided: string | undefined, configured: string | undefined): boolean {
  if (!configured || Buffer.byteLength(configured, 'utf8') < 32 || !provided) return false
  const expected = createHash('sha256').update(configured, 'utf8').digest()
  const actual = createHash('sha256').update(provided, 'utf8').digest()
  return timingSafeEqual(expected, actual)
}

export function requirePddiktiWorkerSecret(event: H3Event, configured = process.env.PDDIKTI_WORKER_SECRET): void {
  if (!configured || Buffer.byteLength(configured, 'utf8') < 32) serviceUnavailable('PDDIKTI_WORKER_SECRET harus menggunakan secret independen minimal 32 byte.')
  const direct = getHeader(event, 'x-pddikti-worker-secret')?.trim()
  const authorization = getHeader(event, 'authorization')
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!verifyPddiktiWorkerSecret(direct || bearer, configured)) forbidden('Autentikasi worker PDDIKTI tidak valid.')
}

async function lastWorkerRun(): Promise<PddiktiWorkerRun | undefined> {
  if (dataMode() === 'mock') return [...pddiktiModuleState().workerRuns.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0]
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Status worker PDDIKTI tidak tersedia.')
  const snapshot = await db.collection('pddiktiWorkerRuns').orderBy('startedAt', 'desc').limit(1).get()
  const first = snapshot.docs[0]
  return first ? ({ id: first.id, ...first.data() } as PddiktiWorkerRun) : undefined
}

export async function getPddiktiWorkerStatus(
  context: AuthContext,
  options: { programStudyId?: string; contract?: PddiktiAdapterContract; adapter?: PddiktiFeederAdapter } = {},
): Promise<PddiktiWorkerStatus> {
  requirePermission(context, 'pddikti:view')
  const contract = options.contract ?? pddiktiContractFromEnvironment()
  const adapter = options.adapter ?? pddiktiAdapterFromEnvironment(contract)
  const jobs = await listPddiktiJobs(context, { programStudyId: options.programStudyId, limit: 100 })
  const queue = Object.fromEntries(STATUS_KEYS.map(status => [status, jobs.filter(job => job.status === status).length])) as PddiktiWorkerStatus['queue']
  let health = missingAdapterHealth(contract)
  if (adapter) {
    health = await callWithTimeout(Math.min(contract.timeoutMs, 5_000), signal => adapter.health(signal)).catch(error => ({
      configured: true,
      reachable: false,
      contractVersion: contract.version,
      checkedAt: new Date().toISOString(),
      message: sanitizePddiktiError(error).message,
    }))
  }
  const lastRun = await lastWorkerRun()
  return { contract, adapter: health, queue, ...(lastRun ? { lastRun } : {}) }
}
