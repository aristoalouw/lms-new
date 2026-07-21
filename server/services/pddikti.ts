import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { PddiktiEntityType, PddiktiJobStatus, PddiktiSyncJob } from '../types/domain'
import { PDDIKTI_ENTITY_TYPES } from '../types/domain'
import type {
  PddiktiAdapterContract,
  PddiktiBatchResultHistory,
  PddiktiContractRecord,
  PddiktiEntityMapping,
  PddiktiJobPayloadSnapshot,
  PddiktiMappingDefinition,
  PddiktiReadinessSummary,
  PddiktiSourceRecord,
  PddiktiWorkerJob,
} from '../types/pddikti'
import { appendAudit } from '../utils/audit'
import { conflict, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { cloneValue, mockState } from '../utils/mock-store'
import { filterProgramScope, requirePermission } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { mockPddiktiContract, pddiktiContractFromEnvironment } from './pddikti-adapter'
import { pddiktiModuleState, sourceRecordKey } from './pddikti-state'

export interface QueuePddiktiInput {
  entityType: PddiktiEntityType
  entityIds: string[]
  programStudyId: string
  periodId: string
}

export interface QueuePddiktiResult {
  job: PddiktiWorkerJob
  replayed: boolean
  auditId?: string
}

export interface QueuePddiktiOptions {
  contract?: PddiktiAdapterContract
  now?: Date
}

function activeContract(options?: QueuePddiktiOptions): PddiktiAdapterContract {
  if (options?.contract) return options.contract
  return dataMode() === 'mock' ? mockPddiktiContract() : pddiktiContractFromEnvironment()
}

function eventId(jobId: string, type: string, occurredAt: string, seed = ''): string {
  return opaqueId('pddikti_event', `${jobId}:${type}:${occurredAt}:${seed}`)
}

export function hydratePddiktiJob(job: PddiktiSyncJob): PddiktiWorkerJob {
  const stored = job as PddiktiSyncJob & Partial<PddiktiWorkerJob>
  return {
    ...job,
    contractVersion: stored.contractVersion ?? 'legacy-unpinned',
    mappingVersion: stored.mappingVersion ?? 'legacy-unmapped',
    payloadFingerprint: stored.payloadFingerprint ?? requestHash({ entityType: job.entityType, entityIds: job.entityIds, programStudyId: job.programStudyId, periodId: job.periodId }),
    recordCount: stored.recordCount ?? job.entityIds.length,
    leaseRecoveries: stored.leaseRecoveries ?? 0,
    acceptedCount: stored.acceptedCount ?? (job.status === 'SUCCEEDED' ? job.entityIds.length : 0),
    rejectedCount: stored.rejectedCount ?? 0,
    history: stored.history ? structuredClone(stored.history) : [],
    ...(stored.leaseOwner ? { leaseOwner: stored.leaseOwner } : {}),
    ...(stored.leaseToken ? { leaseToken: stored.leaseToken } : {}),
    ...(stored.leaseExpiresAt ? { leaseExpiresAt: stored.leaseExpiresAt } : {}),
    ...(stored.claimedAt ? { claimedAt: stored.claimedAt } : {}),
    ...(stored.completedAt ? { completedAt: stored.completedAt } : {}),
  }
}

export function transitionPddiktiFailure(
  job: PddiktiSyncJob,
  error: { code: string; message: string },
  now = new Date(),
): PddiktiSyncJob {
  const attempts = job.attempts + 1
  const exhausted = attempts >= job.maxAttempts
  const delayMs = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1))
  return {
    ...job,
    attempts,
    status: exhausted ? 'DEAD_LETTER' : 'QUEUED',
    updatedAt: now.toISOString(),
    nextAttemptAt: new Date(now.getTime() + (exhausted ? 0 : delayMs)).toISOString(),
    lastError: { code: error.code.slice(0, 80), message: error.message.slice(0, 500), occurredAt: now.toISOString() },
  }
}

function validateEntityIds(entityIds: string[]): string[] {
  if (!Array.isArray(entityIds) || entityIds.length < 1 || entityIds.length > 500) invalidInput('entityIds harus berisi 1-500 identifier.')
  const normalized = [...new Set(entityIds.map(id => typeof id === 'string' ? id.trim() : ''))]
  if (normalized.some(id => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id))) invalidInput('Format identifier entitas PDDIKTI tidak valid.')
  return normalized
}

export async function loadActivePddiktiMapping(
  entityType: PddiktiEntityType,
  contractVersion: string,
): Promise<PddiktiMappingDefinition> {
  if (dataMode() === 'mock') {
    const definition = [...pddiktiModuleState().mappingDefinitions.values()]
      .filter(item => item.entityType === entityType && item.active && item.contractVersion === contractVersion)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    if (!definition) conflict('PDDIKTI_MAPPING_UNAVAILABLE', 'Mapping aktif tidak tersedia untuk versi kontrak ini.', { entityType, contractVersion })
    return structuredClone(definition)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Konfigurasi mapping PDDIKTI tidak tersedia.')
  const pointer = await db.collection('pddiktiMappingPointers').doc(entityType).get()
  if (!pointer.exists) conflict('PDDIKTI_MAPPING_UNAVAILABLE', 'Pointer mapping aktif belum dikonfigurasi.', { entityType })
  const version = String(pointer.data()?.version ?? '')
  const definitionSnapshot = await db.collection('pddiktiMappingDefinitions').doc(`${entityType}:${version}`).get()
  if (!definitionSnapshot.exists) conflict('PDDIKTI_MAPPING_UNAVAILABLE', 'Definisi mapping aktif tidak ditemukan.', { entityType, version })
  const definition = { ...definitionSnapshot.data(), entityType, version } as PddiktiMappingDefinition
  if (!definition.active || definition.contractVersion !== contractVersion) conflict('PDDIKTI_MAPPING_VERSION_MISMATCH', 'Versi mapping tidak sesuai kontrak worker.', { entityType, mappingVersion: definition.version, contractVersion })
  return definition
}

async function loadSourceRecords(entityType: PddiktiEntityType, entityIds: string[]): Promise<PddiktiSourceRecord[]> {
  if (dataMode() === 'mock') {
    return entityIds.flatMap((id) => {
      const record = pddiktiModuleState().sourceRecords.get(sourceRecordKey(entityType, id))
      return record ? [structuredClone(record)] : []
    })
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Sumber data PDDIKTI tidak tersedia.')
  const snapshots = await Promise.all(entityIds.map(id => db.collection('pddiktiSourceRecords').doc(sourceRecordKey(entityType, id)).get()))
  return snapshots.filter(snapshot => snapshot.exists).map(snapshot => snapshot.data() as PddiktiSourceRecord)
}

export function mapPddiktiSourceRecord(
  source: PddiktiSourceRecord,
  mapping: PddiktiMappingDefinition,
): PddiktiContractRecord {
  if (!source.eligible || source.blockers.length) conflict('PDDIKTI_RECORD_INELIGIBLE', 'Record belum memenuhi syarat pelaporan.', { entityId: source.id, blockerCodes: source.blockers.map(item => item.code) })
  if (source.entityType !== mapping.entityType) conflict('PDDIKTI_MAPPING_ENTITY_MISMATCH', 'Mapping tidak sesuai jenis entitas.')
  const missing = mapping.requiredInternalFields.filter(field => !(field in source.data) || source.data[field] === undefined)
  if (missing.length) conflict('PDDIKTI_REQUIRED_FIELD_MISSING', 'Field wajib untuk mapping belum tersedia.', { entityId: source.id, fields: missing })
  const fields = Object.fromEntries(Object.entries(mapping.fieldMap).map(([internalField, contractField]) => [contractField, source.data[internalField] ?? null]))
  const fingerprint = requestHash({ internalId: source.id, internalVersion: source.version, mappingVersion: mapping.version, fields })
  return { internalId: source.id, internalVersion: source.version, mappingVersion: mapping.version, fingerprint, fields }
}

export async function preparePddiktiPayload(
  input: QueuePddiktiInput,
  contract: PddiktiAdapterContract,
): Promise<{ mapping: PddiktiMappingDefinition; sources: PddiktiSourceRecord[]; records: PddiktiContractRecord[]; fingerprint: string }> {
  if (!PDDIKTI_ENTITY_TYPES.includes(input.entityType)) invalidInput('Jenis entitas PDDIKTI tidak didukung.')
  const entityIds = validateEntityIds(input.entityIds)
  const operationKey = contract.operationKeys[input.entityType]
  if (!operationKey) conflict('PDDIKTI_OPERATION_UNCONFIGURED', 'Operation key yang telah diverifikasi operator belum dikonfigurasi untuk entitas ini.', { entityType: input.entityType, contractVersion: contract.version })
  const [mapping, sources] = await Promise.all([
    loadActivePddiktiMapping(input.entityType, contract.version),
    loadSourceRecords(input.entityType, entityIds),
  ])
  const sourceById = new Map(sources.map(source => [source.id, source]))
  const missingIds = entityIds.filter(id => !sourceById.has(id))
  const scopeMismatch = sources.filter(source => source.programStudyId !== input.programStudyId || source.periodId !== input.periodId).map(source => source.id)
  const blocked = sources.filter(source => !source.eligible || source.blockers.length).map(source => ({ id: source.id, blockerCodes: source.blockers.map(item => item.code) }))
  if (missingIds.length || scopeMismatch.length || blocked.length) {
    conflict('PDDIKTI_PAYLOAD_INELIGIBLE', 'Sebagian record tidak tersedia, di luar lingkup, atau belum layak dilaporkan.', { missingIds, scopeMismatch, blocked })
  }
  const records = entityIds.map(id => mapPddiktiSourceRecord(sourceById.get(id)!, mapping))
  return { mapping, sources, records, fingerprint: requestHash({ contractVersion: contract.version, mappingVersion: mapping.version, records }) }
}

async function existingQueueReplay(namespace: string, requestHashValue: string): Promise<QueuePddiktiResult | undefined> {
  if (dataMode() === 'mock') {
    const previous = mockState().idempotency.get(namespace)
    if (!previous) return undefined
    if (previous.requestHash !== requestHashValue) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
    return { ...(cloneValue(previous.response) as QueuePddiktiResult), replayed: true, auditId: undefined }
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Antrean PDDIKTI tidak tersedia.')
  const snapshot = await db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)).get()
  if (!snapshot.exists) return undefined
  const data = snapshot.data() as { requestHash: string; response: QueuePddiktiResult }
  if (data.requestHash !== requestHashValue) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
  return { ...data.response, replayed: true, auditId: undefined }
}

export async function queuePddiktiSync(
  context: AuthContext,
  input: QueuePddiktiInput,
  idempotencyKey: string,
  event?: H3Event,
  options: QueuePddiktiOptions = {},
): Promise<QueuePddiktiResult> {
  requirePermission(context, 'pddikti:queue')
  const programStudyId = filterProgramScope(context, input.programStudyId)
  if (!programStudyId) conflict('PROGRAM_SCOPE_REQUIRED', 'Lingkup program studi wajib ditentukan.')
  const entityIds = validateEntityIds(input.entityIds)
  const normalizedInput = { entityType: input.entityType, entityIds, programStudyId, periodId: input.periodId }
  const clientHash = requestHash(normalizedInput)
  const namespace = `pddikti:${idempotencyKey}`
  const replay = await existingQueueReplay(namespace, clientHash)
  if (replay) return replay

  const contract = activeContract(options)
  const prepared = await preparePddiktiPayload(normalizedInput, contract)
  const now = options.now ?? new Date()
  const timestamp = now.toISOString()
  const maxAttempts = Math.min(Math.max(Number(process.env.NEO_FEEDER_MAX_ATTEMPTS ?? 5), 1), 10)
  const job: PddiktiWorkerJob = {
    id: opaqueId('sync', idempotencyKey),
    ...normalizedInput,
    status: 'QUEUED',
    attempts: 0,
    maxAttempts,
    createdAt: timestamp,
    createdBy: context.uid,
    updatedAt: timestamp,
    nextAttemptAt: timestamp,
    contractVersion: contract.version,
    mappingVersion: prepared.mapping.version,
    payloadFingerprint: prepared.fingerprint,
    recordCount: prepared.records.length,
    leaseRecoveries: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    history: [{ id: eventId(opaqueId('sync', idempotencyKey), 'QUEUED', timestamp), type: 'QUEUED', occurredAt: timestamp, actor: context.uid, attempt: 0 }],
  }
  const payload: PddiktiJobPayloadSnapshot = {
    jobId: job.id,
    contractVersion: job.contractVersion,
    mappingVersion: job.mappingVersion,
    payloadFingerprint: job.payloadFingerprint,
    records: prepared.records,
    createdAt: timestamp,
  }
  let result: QueuePddiktiResult

  if (dataMode() === 'mock') {
    result = { job, replayed: false }
    mockState().pddiktiJobs.set(job.id, cloneValue(job))
    pddiktiModuleState().jobPayloads.set(job.id, structuredClone(payload))
    mockState().idempotency.set(namespace, { requestHash: clientHash, response: cloneValue(result), createdAt: timestamp })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Antrean PDDIKTI tidak tersedia.')
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    const jobRef = db.collection('pddiktiSyncJobs').doc(job.id)
    const payloadRef = db.collection('pddiktiJobPayloads').doc(job.id)
    result = await db.runTransaction(async (transaction) => {
      const previous = await transaction.get(idemRef)
      if (previous.exists) {
        const data = previous.data() as { requestHash: string; response: QueuePddiktiResult }
        if (data.requestHash !== clientHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      const response: QueuePddiktiResult = { job, replayed: false }
      transaction.create(jobRef, job)
      transaction.create(payloadRef, payload)
      transaction.create(idemRef, { requestHash: clientHash, response, createdAt: timestamp, expiresAt: new Date(now.getTime() + 86_400_000).toISOString() })
      return response
    })
  }

  if (!result.replayed) {
    const audit = await appendAudit({
      actor: context,
      action: 'PDDIKTI_SYNC_QUEUED',
      resourceType: 'pddikti_sync_job',
      resourceId: result.job.id,
      after: {
        entityType: result.job.entityType,
        recordCount: result.job.recordCount,
        programStudyId: result.job.programStudyId,
        periodId: result.job.periodId,
        mappingVersion: result.job.mappingVersion,
        contractVersion: result.job.contractVersion,
        payloadFingerprint: result.job.payloadFingerprint,
      },
      event,
    })
    result.auditId = audit.id
  }
  return result
}

export async function loadPddiktiJobPayload(jobId: string): Promise<PddiktiJobPayloadSnapshot> {
  if (dataMode() === 'mock') {
    const payload = pddiktiModuleState().jobPayloads.get(jobId)
    if (!payload) notFound('Snapshot payload job PDDIKTI')
    return structuredClone(payload)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Payload job PDDIKTI tidak tersedia.')
  const snapshot = await db.collection('pddiktiJobPayloads').doc(jobId).get()
  if (!snapshot.exists) notFound('Snapshot payload job PDDIKTI')
  return snapshot.data() as PddiktiJobPayloadSnapshot
}

async function loadPddiktiJob(jobId: string): Promise<PddiktiWorkerJob> {
  if (dataMode() === 'mock') {
    const stored = mockState().pddiktiJobs.get(jobId)
    if (!stored) notFound('Job sinkronisasi')
    return hydratePddiktiJob(cloneValue(stored))
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Antrean PDDIKTI tidak tersedia.')
  const snapshot = await db.collection('pddiktiSyncJobs').doc(jobId).get()
  if (!snapshot.exists) notFound('Job sinkronisasi')
  return hydratePddiktiJob({ id: snapshot.id, ...snapshot.data() } as PddiktiSyncJob)
}

function requireJobScope(context: AuthContext, job: PddiktiWorkerJob): void {
  requirePermission(context, 'pddikti:view')
  filterProgramScope(context, job.programStudyId)
}

export async function retryPddiktiJob(
  context: AuthContext,
  jobId: string,
  idempotencyKey?: string,
  event?: H3Event,
): Promise<{ job: PddiktiWorkerJob; auditId: string; replayed?: boolean }> {
  requirePermission(context, 'pddikti:retry')
  const currentForScope = await loadPddiktiJob(jobId)
  filterProgramScope(context, currentForScope.programStudyId)
  const namespace = idempotencyKey ? `pddikti-retry:${idempotencyKey}` : undefined
  const hash = requestHash({ jobId })
  if (namespace && dataMode() === 'mock') {
    const previous = pddiktiModuleState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
      return { ...(structuredClone(previous.response) as { job: PddiktiWorkerJob; auditId: string }), replayed: true }
    }
  }
  const now = new Date().toISOString()
  let before: PddiktiWorkerJob
  let after: PddiktiWorkerJob

  const retry = (job: PddiktiWorkerJob): PddiktiWorkerJob => {
    filterProgramScope(context, job.programStudyId)
    if (!['FAILED', 'DEAD_LETTER'].includes(job.status)) conflict('JOB_NOT_RETRYABLE', 'Job hanya dapat diulang setelah gagal.', { currentStatus: job.status })
    const retryable = { ...job }
    delete retryable.leaseOwner
    delete retryable.leaseToken
    delete retryable.leaseExpiresAt
    delete retryable.claimedAt
    delete retryable.lastError
    delete retryable.completedAt
    return {
      ...retryable,
      status: 'QUEUED',
      attempts: job.status === 'DEAD_LETTER' ? 0 : job.attempts,
      updatedAt: now,
      nextAttemptAt: now,
      history: [...job.history, { id: eventId(job.id, 'MANUAL_RETRY', now, context.uid), type: 'MANUAL_RETRY', occurredAt: now, actor: context.uid, attempt: job.attempts }],
    }
  }

  if (dataMode() === 'mock') {
    before = currentForScope
    after = retry(before)
    mockState().pddiktiJobs.set(jobId, cloneValue(after))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Antrean PDDIKTI tidak tersedia.')
    const ref = db.collection('pddiktiSyncJobs').doc(jobId)
    const idemRef = namespace ? db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)) : undefined
    const result = await db.runTransaction(async (transaction) => {
      const snapshots = await Promise.all([transaction.get(ref), ...(idemRef ? [transaction.get(idemRef)] : [])])
      const snapshot = snapshots[0]
      const previous = snapshots[1]
      if (!snapshot?.exists) notFound('Job sinkronisasi')
      const current = hydratePddiktiJob({ id: snapshot.id, ...snapshot.data() } as PddiktiSyncJob)
      filterProgramScope(context, current.programStudyId)
      if (previous?.exists) {
        const data = previous.data() as { requestHash: string; response: { job: PddiktiWorkerJob; auditId: string } }
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { current, updated: data.response.job, replayed: true, auditId: data.response.auditId }
      }
      const updated = retry(current)
      transaction.set(ref, updated)
      return { current, updated, replayed: false }
    })
    if (result.replayed) return { job: result.updated, auditId: result.auditId!, replayed: true }
    before = result.current
    after = result.updated
  }

  const audit = await appendAudit({
    actor: context,
    action: 'PDDIKTI_SYNC_RETRIED',
    resourceType: 'pddikti_sync_job',
    resourceId: jobId,
    before: { status: before.status, attempts: before.attempts },
    after: { status: after.status, nextAttemptAt: after.nextAttemptAt },
    event,
  })
  const response = { job: after, auditId: audit.id }
  if (namespace) {
    if (dataMode() === 'mock') pddiktiModuleState().idempotency.set(namespace, { requestHash: hash, response })
    else {
      const db = firestoreAdmin()
      if (db) await db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)).create({ requestHash: hash, response, createdAt: now })
    }
  }
  return response
}

export async function listPddiktiJobs(
  context: AuthContext,
  options: { status?: PddiktiJobStatus; limit?: number; programStudyId?: string } = {},
): Promise<PddiktiWorkerJob[]> {
  requirePermission(context, 'pddikti:view')
  const programStudyId = filterProgramScope(context, options.programStudyId)
  const limit = Math.min(Math.max(options.limit ?? 25, 1), 100)
  if (dataMode() === 'mock') {
    return [...mockState().pddiktiJobs.values()]
      .map(job => hydratePddiktiJob(job))
      .filter(job => !options.status || job.status === options.status)
      .filter(job => !programStudyId || job.programStudyId === programStudyId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit)
      .map(cloneValue)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Antrean PDDIKTI tidak tersedia.')
  let query: FirebaseFirestore.Query = db.collection('pddiktiSyncJobs').orderBy('updatedAt', 'desc')
  if (programStudyId) query = query.where('programStudyId', '==', programStudyId)
  if (options.status) query = query.where('status', '==', options.status)
  const snapshot = await query.limit(limit).get()
  return snapshot.docs.map(doc => hydratePddiktiJob({ id: doc.id, ...doc.data() } as PddiktiSyncJob))
}

export async function getPddiktiJobDetail(
  context: AuthContext,
  jobId: string,
): Promise<{ job: PddiktiWorkerJob; results: PddiktiBatchResultHistory[]; mappings: PddiktiEntityMapping[] }> {
  const job = await loadPddiktiJob(jobId)
  requireJobScope(context, job)
  if (dataMode() === 'mock') {
    return {
      job,
      results: [...pddiktiModuleState().batchResults.values()].filter(result => result.jobId === jobId).map(item => structuredClone(item)).sort((left, right) => left.batchIndex - right.batchIndex),
      mappings: [...pddiktiModuleState().entityMappings.values()].filter(mapping => mapping.entityType === job.entityType && job.entityIds.includes(mapping.internalId)).map(item => structuredClone(item)),
    }
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Riwayat PDDIKTI tidak tersedia.')
  const [resultsSnapshot, mappingsSnapshot] = await Promise.all([
    db.collection('pddiktiBatchResults').where('jobId', '==', jobId).limit(200).get(),
    db.collection('pddiktiEntityMappings').where('entityType', '==', job.entityType).where('programStudyId', '==', job.programStudyId).limit(500).get(),
  ])
  return {
    job,
    results: resultsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as PddiktiBatchResultHistory).sort((left, right) => left.batchIndex - right.batchIndex),
    mappings: mappingsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as PddiktiEntityMapping).filter(mapping => job.entityIds.includes(mapping.internalId)),
  }
}

export async function listPddiktiSourceRecordsForScope(programStudyId: string, periodId: string): Promise<PddiktiSourceRecord[]> {
  if (dataMode() === 'mock') return [...pddiktiModuleState().sourceRecords.values()].filter(record => record.programStudyId === programStudyId && record.periodId === periodId).map(record => structuredClone(record))
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Sumber data PDDIKTI tidak tersedia.')
  const snapshot = await db.collection('pddiktiSourceRecords').where('programStudyId', '==', programStudyId).where('periodId', '==', periodId).limit(10_000).get()
  return snapshot.docs.map(doc => doc.data() as PddiktiSourceRecord)
}

export async function getPddiktiReadiness(
  context: AuthContext,
  input: { programStudyId?: string; periodId: string },
): Promise<PddiktiReadinessSummary> {
  requirePermission(context, 'pddikti:view')
  const programStudyId = filterProgramScope(context, input.programStudyId)
  if (!programStudyId) invalidInput('programStudyId wajib ditentukan.')
  const records = await listPddiktiSourceRecordsForScope(programStudyId, input.periodId)
  const jobs = await listPddiktiJobs(context, { programStudyId, limit: 100 })
  const queuedIds = new Set(jobs.filter(job => ['QUEUED', 'PROCESSING'].includes(job.status)).flatMap(job => job.entityIds.map(id => `${job.entityType}:${id}`)))
  let mappings: PddiktiEntityMapping[]
  if (dataMode() === 'mock') mappings = [...pddiktiModuleState().entityMappings.values()].filter(mapping => mapping.programStudyId === programStudyId)
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Mapping entitas PDDIKTI tidak tersedia.')
    const snapshot = await db.collection('pddiktiEntityMappings').where('programStudyId', '==', programStudyId).where('status', '==', 'ACTIVE').limit(10_000).get()
    mappings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as PddiktiEntityMapping)
  }
  const syncedIds = new Set(mappings.map(mapping => `${mapping.entityType}:${mapping.internalId}`))
  const contract = activeContract()
  const entities = await Promise.all(PDDIKTI_ENTITY_TYPES.map(async (entityType) => {
    const scoped = records.filter(record => record.entityType === entityType)
    const eligible = scoped.filter(record => record.eligible && !record.blockers.length).length
    const blockerCounts: Record<string, number> = {}
    for (const blocker of scoped.flatMap(record => record.blockers)) blockerCounts[blocker.code] = (blockerCounts[blocker.code] ?? 0) + 1
    let mappingVersion = 'unconfigured'
    try { mappingVersion = (await loadActivePddiktiMapping(entityType, contract.version)).version } catch { /* readiness reports unavailable mapping without hiding other entities */ }
    return {
      entityType,
      total: scoped.length,
      eligible,
      blocked: scoped.length - eligible,
      queued: scoped.filter(record => queuedIds.has(`${entityType}:${record.id}`)).length,
      synced: scoped.filter(record => syncedIds.has(`${entityType}:${record.id}`)).length,
      completenessPercent: scoped.length ? Math.round((eligible / scoped.length) * 10_000) / 100 : 100,
      blockerCounts,
      mappingVersion,
    }
  }))
  const total = records.length
  const eligible = records.filter(record => record.eligible && !record.blockers.length).length
  return {
    programStudyId,
    periodId: input.periodId,
    generatedAt: new Date().toISOString(),
    total,
    eligible,
    blocked: total - eligible,
    completenessPercent: total ? Math.round((eligible / total) * 10_000) / 100 : 100,
    entities,
  }
}
