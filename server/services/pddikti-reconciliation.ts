import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { PddiktiEntityType } from '../types/domain'
import type {
  PddiktiAdapterContract,
  PddiktiFeederAdapter,
  PddiktiReconciliation,
  PddiktiReconciliationRow,
  PddiktiRemoteRecord,
  PddiktiWorkerJob,
} from '../types/pddikti'
import { appendAudit } from '../utils/audit'
import { conflict, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { filterProgramScope, requirePermission } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { mockPddiktiContract, pddiktiAdapterFromEnvironment, pddiktiContractFromEnvironment, sanitizePddiktiError } from './pddikti-adapter'
import {
  listPddiktiSourceRecordsForScope,
  loadActivePddiktiMapping,
  mapPddiktiSourceRecord,
  queuePddiktiSync,
} from './pddikti'
import { pddiktiModuleState, remoteSnapshotKey } from './pddikti-state'

export interface ComparePddiktiInput {
  entityType: PddiktiEntityType
  programStudyId: string
  periodId: string
}

export interface DecidePddiktiReconciliationInput {
  expectedVersion: number
  rowKeys: string[]
  decision: 'QUEUE_INTERNAL' | 'ACKNOWLEDGE_REMOTE'
}

function activeContract(contract?: PddiktiAdapterContract): PddiktiAdapterContract {
  if (contract) return contract
  return dataMode() === 'mock' ? mockPddiktiContract() : pddiktiContractFromEnvironment()
}

async function timeoutCall<T>(timeoutMs: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Adapter timeout')), timeoutMs)
  try { return await task(controller.signal) } finally { clearTimeout(timeout) }
}

async function remoteRecords(
  input: ComparePddiktiInput,
  contract: PddiktiAdapterContract,
  adapter?: PddiktiFeederAdapter,
): Promise<PddiktiRemoteRecord[]> {
  const operationKey = contract.operationKeys[input.entityType]
  if (!operationKey) conflict('PDDIKTI_OPERATION_UNCONFIGURED', 'Operation key terverifikasi belum dikonfigurasi untuk rekonsiliasi.')
  if (!adapter && dataMode() === 'mock') {
    return structuredClone(pddiktiModuleState().remoteSnapshots.get(remoteSnapshotKey(input.entityType, input.programStudyId, input.periodId)) ?? [])
  }
  const selected = adapter ?? pddiktiAdapterFromEnvironment(contract)
  if (!selected) serviceUnavailable('Gateway adapter PDDIKTI belum dikonfigurasi.')
  if (selected.contractVersion !== contract.version) conflict('PDDIKTI_CONTRACT_VERSION_MISMATCH', 'Versi adapter rekonsiliasi tidak sesuai kontrak.')
  try {
    return await timeoutCall(contract.timeoutMs, signal => selected.fetchSnapshot({
      contractVersion: contract.version,
      operationKey,
      entityType: input.entityType,
      programStudyId: input.programStudyId,
      periodId: input.periodId,
    }, signal))
  } catch (error) {
    const sanitized = sanitizePddiktiError(error)
    throw Object.assign(new Error(sanitized.message), { code: sanitized.code })
  }
}

function differingFields(internal: Record<string, unknown>, remote: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(internal), ...Object.keys(remote)])]
    .filter(key => requestHash(internal[key] ?? null) !== requestHash(remote[key] ?? null))
    .sort()
}

async function existingCompareReplay(namespace: string, hash: string): Promise<PddiktiReconciliation | undefined> {
  if (dataMode() === 'mock') {
    const previous = pddiktiModuleState().idempotency.get(namespace)
    if (!previous) return undefined
    if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
    return structuredClone((previous.response as { reconciliation: PddiktiReconciliation }).reconciliation)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan rekonsiliasi tidak tersedia.')
  const snapshot = await db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)).get()
  if (!snapshot.exists) return undefined
  const data = snapshot.data() as { requestHash: string; response: { reconciliation: PddiktiReconciliation } }
  if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
  return data.response.reconciliation
}

export async function comparePddiktiSnapshots(
  context: AuthContext,
  input: ComparePddiktiInput,
  idempotencyKey: string,
  event?: H3Event,
  dependencies: { contract?: PddiktiAdapterContract; adapter?: PddiktiFeederAdapter; now?: Date } = {},
): Promise<{ reconciliation: PddiktiReconciliation; replayed: boolean; auditId?: string }> {
  requirePermission(context, 'pddikti:queue')
  const programStudyId = filterProgramScope(context, input.programStudyId)
  if (!programStudyId) invalidInput('programStudyId wajib ditentukan.')
  const normalized = { ...input, programStudyId }
  const hash = requestHash(normalized)
  const namespace = `pddikti-reconcile:${idempotencyKey}`
  const replay = await existingCompareReplay(namespace, hash)
  if (replay) return { reconciliation: replay, replayed: true }
  const contract = activeContract(dependencies.contract)
  const [mapping, sources, remote] = await Promise.all([
    loadActivePddiktiMapping(input.entityType, contract.version),
    listPddiktiSourceRecordsForScope(programStudyId, input.periodId),
    remoteRecords(normalized, contract, dependencies.adapter),
  ])
  const internal = sources.filter(source => source.entityType === input.entityType && source.eligible && !source.blockers.length)
    .map(source => mapPddiktiSourceRecord(source, mapping))
  const remoteByInternal = new Map(remote.flatMap(record => record.internalId ? [[record.internalId, record] as const] : []))
  const consumedRemote = new Set<string>()
  const rows: PddiktiReconciliationRow[] = internal.map((record) => {
    const counterpart = remoteByInternal.get(record.internalId)
    if (!counterpart) {
      return {
        key: opaqueId('recon_row', `${input.entityType}:${record.internalId}:missing-remote`),
        internalId: record.internalId,
        state: 'MISSING_REMOTE',
        differingFields: [],
        internalFingerprint: requestHash(record.fields),
      }
    }
    consumedRemote.add(counterpart.remoteId)
    const differences = differingFields(record.fields, counterpart.fields)
    return {
      key: opaqueId('recon_row', `${input.entityType}:${record.internalId}:${counterpart.remoteId}`),
      internalId: record.internalId,
      remoteId: counterpart.remoteId,
      state: differences.length ? 'DIFFERENT' : 'MATCH',
      differingFields: differences,
      internalFingerprint: requestHash(record.fields),
      remoteFingerprint: requestHash(counterpart.fields),
    }
  })
  for (const record of remote.filter(item => !consumedRemote.has(item.remoteId))) {
    rows.push({
      key: opaqueId('recon_row', `${input.entityType}:missing-internal:${record.remoteId}`),
      ...(record.internalId ? { internalId: record.internalId } : {}),
      remoteId: record.remoteId,
      state: 'MISSING_INTERNAL',
      differingFields: [],
      remoteFingerprint: requestHash(record.fields),
    })
  }
  const now = dependencies.now ?? new Date()
  const timestamp = now.toISOString()
  const reconciliation: PddiktiReconciliation = {
    id: opaqueId('pddikti_reconciliation', namespace),
    entityType: input.entityType,
    programStudyId,
    periodId: input.periodId,
    contractVersion: contract.version,
    mappingVersion: mapping.version,
    status: rows.every(row => row.state === 'MATCH') ? 'REVIEWED' : 'OPEN',
    version: 1,
    createdAt: timestamp,
    createdBy: context.uid,
    updatedAt: timestamp,
    summary: {
      MATCH: rows.filter(row => row.state === 'MATCH').length,
      DIFFERENT: rows.filter(row => row.state === 'DIFFERENT').length,
      MISSING_REMOTE: rows.filter(row => row.state === 'MISSING_REMOTE').length,
      MISSING_INTERNAL: rows.filter(row => row.state === 'MISSING_INTERNAL').length,
    },
    rows,
  }

  if (dataMode() === 'mock') {
    pddiktiModuleState().reconciliations.set(reconciliation.id, structuredClone(reconciliation))
    pddiktiModuleState().idempotency.set(namespace, { requestHash: hash, response: { reconciliation } })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan rekonsiliasi tidak tersedia.')
    const reference = db.collection('pddiktiReconciliations').doc(reconciliation.id)
    const idemReference = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async (transaction) => {
      const previous = await transaction.get(idemReference)
      if (previous.exists) {
        const data = previous.data() as { requestHash: string; response: { reconciliation: PddiktiReconciliation } }
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return { reconciliation: data.response.reconciliation, replayed: true }
      }
      transaction.create(reference, reconciliation)
      transaction.create(idemReference, { requestHash: hash, response: { reconciliation }, createdAt: timestamp })
      return { reconciliation, replayed: false }
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'PDDIKTI_RECONCILIATION_CREATED', resourceType: 'pddikti_reconciliation', resourceId: reconciliation.id, after: { ...reconciliation.summary, entityType: reconciliation.entityType, programStudyId, contractVersion: contract.version, mappingVersion: mapping.version }, event })
  return { reconciliation, replayed: false, auditId: audit.id }
}

function requireReconciliationScope(context: AuthContext, reconciliation: PddiktiReconciliation): void {
  requirePermission(context, 'pddikti:view')
  filterProgramScope(context, reconciliation.programStudyId)
}

async function loadReconciliation(id: string): Promise<PddiktiReconciliation> {
  if (dataMode() === 'mock') {
    const value = pddiktiModuleState().reconciliations.get(id)
    if (!value) notFound('Rekonsiliasi PDDIKTI')
    return structuredClone(value)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan rekonsiliasi tidak tersedia.')
  const snapshot = await db.collection('pddiktiReconciliations').doc(id).get()
  if (!snapshot.exists) notFound('Rekonsiliasi PDDIKTI')
  return { id: snapshot.id, ...snapshot.data() } as PddiktiReconciliation
}

export async function getPddiktiReconciliation(context: AuthContext, id: string): Promise<PddiktiReconciliation> {
  const reconciliation = await loadReconciliation(id)
  requireReconciliationScope(context, reconciliation)
  return reconciliation
}

export async function listPddiktiReconciliations(
  context: AuthContext,
  options: { programStudyId?: string; limit?: number } = {},
): Promise<PddiktiReconciliation[]> {
  requirePermission(context, 'pddikti:view')
  const programStudyId = filterProgramScope(context, options.programStudyId)
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)
  if (dataMode() === 'mock') {
    return [...pddiktiModuleState().reconciliations.values()]
      .filter(item => !programStudyId || item.programStudyId === programStudyId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit).map(item => structuredClone(item))
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan rekonsiliasi tidak tersedia.')
  let query: FirebaseFirestore.Query = db.collection('pddiktiReconciliations').orderBy('updatedAt', 'desc')
  if (programStudyId) query = query.where('programStudyId', '==', programStudyId)
  const snapshot = await query.limit(limit).get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as PddiktiReconciliation)
}

export async function decidePddiktiReconciliation(
  context: AuthContext,
  reconciliationId: string,
  input: DecidePddiktiReconciliationInput,
  idempotencyKey: string,
  event?: H3Event,
  contract?: PddiktiAdapterContract,
): Promise<{ reconciliation: PddiktiReconciliation; queuedJob?: PddiktiWorkerJob; replayed: boolean; auditId?: string }> {
  requirePermission(context, 'pddikti:queue')
  const current = await loadReconciliation(reconciliationId)
  filterProgramScope(context, current.programStudyId)
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) invalidInput('expectedVersion tidak valid.')
  const rowKeys = [...new Set(input.rowKeys)]
  if (!rowKeys.length || rowKeys.length > 200) invalidInput('Pilih 1-200 baris rekonsiliasi.')
  const selected = current.rows.filter(row => rowKeys.includes(row.key))
  if (selected.length !== rowKeys.length || selected.some(row => row.state === 'MATCH')) invalidInput('Pilihan baris rekonsiliasi tidak valid.')
  if (input.decision === 'QUEUE_INTERNAL' && selected.some(row => !row.internalId || row.state === 'MISSING_INTERNAL')) invalidInput('Baris tanpa sumber internal tidak dapat dimasukkan antrean.')
  const hash = requestHash({ reconciliationId, input: { ...input, rowKeys } })
  const namespace = `pddikti-reconciliation-decision:${idempotencyKey}`
  if (dataMode() === 'mock') {
    const replay = pddiktiModuleState().idempotency.get(namespace)
    if (replay) {
      if (replay.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { ...(structuredClone(replay.response) as { reconciliation: PddiktiReconciliation; queuedJob?: PddiktiWorkerJob }), replayed: true }
    }
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan rekonsiliasi tidak tersedia.')
    const snapshot = await db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)).get()
    if (snapshot.exists) {
      const data = snapshot.data() as { requestHash: string; response: { reconciliation: PddiktiReconciliation; queuedJob?: PddiktiWorkerJob } }
      if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { ...data.response, replayed: true }
    }
  }
  if (current.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Rekonsiliasi telah berubah.', { currentVersion: current.version })

  let queuedJob: PddiktiWorkerJob | undefined
  if (input.decision === 'QUEUE_INTERNAL') {
    const queued = await queuePddiktiSync(context, {
      entityType: current.entityType,
      entityIds: selected.map(row => row.internalId!),
      programStudyId: current.programStudyId,
      periodId: current.periodId,
    }, `${idempotencyKey}:reconcile`, event, { contract: activeContract(contract) })
    queuedJob = queued.job
  }

  const timestamp = new Date().toISOString()
  const update = (fresh: PddiktiReconciliation): PddiktiReconciliation => {
    if (fresh.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Rekonsiliasi telah berubah.', { currentVersion: fresh.version })
    const rows = fresh.rows.map(row => rowKeys.includes(row.key) ? { ...row, decision: input.decision, decidedAt: timestamp, decidedBy: context.uid } : row)
    return {
      ...fresh,
      rows,
      version: fresh.version + 1,
      status: rows.every(row => row.state === 'MATCH' || row.decision) ? 'REVIEWED' : 'OPEN',
      updatedAt: timestamp,
    }
  }

  let reconciliation: PddiktiReconciliation
  if (dataMode() === 'mock') {
    reconciliation = update(current)
    pddiktiModuleState().reconciliations.set(reconciliation.id, structuredClone(reconciliation))
    pddiktiModuleState().idempotency.set(namespace, { requestHash: hash, response: { reconciliation, ...(queuedJob ? { queuedJob } : {}) } })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan rekonsiliasi tidak tersedia.')
    const reference = db.collection('pddiktiReconciliations').doc(reconciliationId)
    const idemReference = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async (transaction) => {
      const [previous, snapshot] = await Promise.all([transaction.get(idemReference), transaction.get(reference)])
      if (previous.exists) {
        const data = previous.data() as { requestHash: string; response: { reconciliation: PddiktiReconciliation; queuedJob?: PddiktiWorkerJob } }
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true }
      }
      if (!snapshot.exists) notFound('Rekonsiliasi PDDIKTI')
      const updated = update({ id: snapshot.id, ...snapshot.data() } as PddiktiReconciliation)
      const response = { reconciliation: updated, ...(queuedJob ? { queuedJob } : {}) }
      transaction.set(reference, updated)
      transaction.create(idemReference, { requestHash: hash, response, createdAt: timestamp })
      return { ...response, replayed: false }
    })
    if (result.replayed) return result
    reconciliation = result.reconciliation
  }
  const audit = await appendAudit({ actor: context, action: `PDDIKTI_RECONCILIATION_${input.decision}`, resourceType: 'pddikti_reconciliation', resourceId: reconciliationId, before: { version: current.version, status: current.status }, after: { version: reconciliation.version, status: reconciliation.status, rowCount: rowKeys.length, queuedJobId: queuedJob?.id }, event })
  return { reconciliation, ...(queuedJob ? { queuedJob } : {}), replayed: false, auditId: audit.id }
}
