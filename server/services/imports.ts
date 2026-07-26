import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  ImportDataset,
  ImportIssue,
  ImportListResult,
  ImportMutation,
  ImportPreviewResult,
  ImportRun,
  ImportStagedRow,
  ImportStatus,
  ImportTargetRecord,
} from '../types/imports'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { parseImportSource } from '../utils/import-parser'
import { filterProgramScope, hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'

const MAPPING_VERSION = 'campus-import-v1'
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000
const LEASE_MS = 5 * 60 * 1000
const TARGET_COLLECTIONS: Record<ImportDataset, string> = {
  students: 'students',
  courses: 'courses',
  grades: 'grades',
}

interface MemoryIdempotency {
  requestHash: string
  runId: string
  operation: string
  response?: unknown
}

interface MemoryImportState {
  runs: Map<string, ImportRun>
  rows: Map<string, ImportStagedRow[]>
  targets: Record<ImportDataset, Map<string, ImportTargetRecord>>
  mutations: Map<string, ImportMutation[]>
  idempotency: Map<string, MemoryIdempotency>
}

const clone = <T>(value: T): T => structuredClone(value)

function freshMemoryState(): MemoryImportState {
  return {
    runs: new Map(),
    rows: new Map(),
    targets: { students: new Map(), courses: new Map(), grades: new Map() },
    mutations: new Map(),
    idempotency: new Map(),
  }
}

let memory = freshMemoryState()

export function resetImportStateForTests(): void {
  memory = freshMemoryState()
}

export function seedImportTargetForTests(record: ImportTargetRecord): void {
  memory.targets[record.dataset].set(record.id, clone(record))
}

export function importTargetForTests(dataset: ImportDataset, id: string): ImportTargetRecord | undefined {
  const record = memory.targets[dataset].get(id)
  return record ? clone(record) : undefined
}

function assertStorageAvailable(): 'mock' | 'firebase' {
  const mode = dataMode()
  if (mode === 'unavailable') serviceUnavailable('Penyimpanan impor tidak tersedia.')
  return mode
}

function requireOperator(context: AuthContext): void {
  if (!hasRole(context, 'administrator', 'academic_staff')) {
    forbidden('Hanya administrator atau staf akademik yang dapat mengelola impor data.')
  }
}

function requireApprover(context: AuthContext): void {
  if (!hasRole(context, 'administrator')) forbidden('Persetujuan impor memerlukan administrator sistem.')
}

function scopedProgram(context: AuthContext, requested: string): string {
  const normalized = requested.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(normalized)) invalidInput('programStudyId tidak valid.')
  const scoped = filterProgramScope(context, normalized)
  if (!scoped) invalidInput('programStudyId wajib dipilih.')
  return scoped
}

function requireRunScope(context: AuthContext, run: ImportRun): void {
  if (hasRole(context, 'administrator')) return
  if (!context.scope.programStudyIds.includes(run.programStudyId)) forbidden('Impor berada di luar lingkup program studi Anda.')
}

function sanitizeSourceName(value: string, format: 'csv' | 'tsv'): string {
  const name = value.normalize('NFKC').trim().replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '')
  if (!name || name.length > 120 || !/^[\p{L}\p{N}_.() -]+$/u.test(name)) invalidInput('Nama berkas sumber tidak valid.')
  const extension = name.split('.').at(-1)?.toLowerCase()
  if (extension !== format) invalidInput(`Ekstensi berkas harus .${format}.`)
  return name
}

function idempotencyNamespace(context: AuthContext, operation: string, key: string): string {
  return `import:${context.uid}:${operation}:${key}`
}

function importId(context: AuthContext, idempotencyKey: string): string {
  return opaqueId('imp', `${context.uid}:${idempotencyKey}`)
}

function idemDocumentId(namespace: string): string {
  return opaqueId('idem', namespace)
}

function dualApprovalRequired(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.IMPORT_REQUIRE_DUAL_APPROVAL === 'true'
}

async function loadExistingFingerprints(dataset: ImportDataset, ids: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(ids)]
  if (assertStorageAvailable() === 'mock') {
    return new Map(uniqueIds.flatMap((id) => {
      const record = memory.targets[dataset].get(id)
      return record ? [[id, record.fingerprint] as const] : []
    }))
  }

  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan impor tidak tersedia.')
  const result = new Map<string, string>()
  for (let offset = 0; offset < uniqueIds.length; offset += 200) {
    const references = uniqueIds.slice(offset, offset + 200).map(id => db.collection(TARGET_COLLECTIONS[dataset]).doc(id))
    if (!references.length) continue
    const snapshots = await db.getAll(...references)
    snapshots.forEach((snapshot) => {
      const fingerprint = snapshot.data()?.fingerprint
      if (snapshot.exists && typeof fingerprint === 'string') result.set(snapshot.id, fingerprint)
    })
  }
  return result
}

async function storeFirebaseRows(runId: string, rows: ImportStagedRow[]): Promise<void> {
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan staging impor tidak tersedia.')
  for (let offset = 0; offset < rows.length; offset += 400) {
    const batch = db.batch()
    rows.slice(offset, offset + 400).forEach((row) => {
      batch.set(db.collection('importRuns').doc(runId).collection('rows').doc(String(row.rowNumber).padStart(6, '0')), row)
    })
    await batch.commit()
  }
}

async function readRunUnscoped(runId: string): Promise<ImportRun> {
  if (assertStorageAvailable() === 'mock') {
    const run = memory.runs.get(runId)
    if (!run) notFound('Proses impor')
    return clone(run)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan impor tidak tersedia.')
  const snapshot = await db.collection('importRuns').doc(runId).get()
  if (!snapshot.exists) notFound('Proses impor')
  return { id: snapshot.id, ...snapshot.data() } as ImportRun
}

async function readRowsUnscoped(runId: string): Promise<ImportStagedRow[]> {
  if (assertStorageAvailable() === 'mock') return clone(memory.rows.get(runId) || [])
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan staging impor tidak tersedia.')
  const snapshot = await db.collection('importRuns').doc(runId).collection('rows').orderBy('rowNumber', 'asc').get()
  return snapshot.docs.map(doc => doc.data() as ImportStagedRow)
}

function previewArtifacts(run: ImportRun, rows: ImportStagedRow[], replayed: boolean): ImportPreviewResult {
  return {
    run,
    sampleRows: rows.slice(0, 50).map(clone),
    issues: rows.flatMap(row => row.issues).slice(0, 100).map(clone),
    replayed,
  }
}

export async function createImportPreview(
  context: AuthContext,
  input: {
    dataset: ImportDataset
    sourceName: string
    format: 'csv' | 'tsv'
    content: string
    programStudyId: string
  },
  idempotencyKey: string,
  event?: H3Event,
): Promise<ImportPreviewResult> {
  requireOperator(context)
  const programStudyId = scopedProgram(context, input.programStudyId)
  const sourceName = sanitizeSourceName(input.sourceName, input.format)

  const initial = parseImportSource({
    dataset: input.dataset, format: input.format, content: input.content, programStudyId, existingFingerprints: new Map(),
  })
  const existingFingerprints = await loadExistingFingerprints(
    input.dataset,
    initial.rows.flatMap(row => row.stableId ? [row.stableId] : []),
  )
  const parsed = parseImportSource({
    dataset: input.dataset, format: input.format, content: input.content, programStudyId, existingFingerprints,
  })
  const namespace = idempotencyNamespace(context, 'preview', idempotencyKey)
  const payloadHash = requestHash({
    dataset: input.dataset,
    sourceName,
    format: input.format,
    programStudyId,
    checksum: parsed.checksum,
  })
  const now = new Date()
  const runId = importId(context, idempotencyKey)
  const run: ImportRun = {
    id: runId,
    dataset: input.dataset,
    sourceName,
    format: input.format,
    checksum: parsed.checksum,
    mappingVersion: MAPPING_VERSION,
    programStudyId,
    status: 'PREVIEWED',
    counts: parsed.counts,
    version: 1,
    createdAt: now.toISOString(),
    createdBy: context.uid,
    expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS).toISOString(),
  }
  const replayed = false

  if (assertStorageAvailable() === 'mock') {
    const previous = memory.idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== payloadHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk sumber impor berbeda.')
      const previousRun = memory.runs.get(previous.runId)
      if (!previousRun) conflict('IMPORT_STATE_INCOMPLETE', 'Staging impor sebelumnya tidak lengkap.')
      return previewArtifacts(clone(previousRun), memory.rows.get(previous.runId) || [], true)
    }
    memory.runs.set(runId, clone(run))
    memory.rows.set(runId, clone(parsed.rows))
    memory.idempotency.set(namespace, { requestHash: payloadHash, runId, operation: 'preview' })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan impor tidak tersedia.')
    const runRef = db.collection('importRuns').doc(runId)
    const idemRef = db.collection('idempotencyKeys').doc(idemDocumentId(namespace))
    let replayRunId: string | undefined
    await db.runTransaction(async (transaction) => {
      const previous = await transaction.get(idemRef)
      if (previous.exists) {
        const data = previous.data() as { requestHash: string; runId: string }
        if (data.requestHash !== payloadHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk sumber impor berbeda.')
        replayRunId = data.runId
        return
      }
      transaction.create(runRef, { ...run, status: 'STAGING' })
      transaction.create(idemRef, {
        namespace: 'import:preview', requestHash: payloadHash, runId, createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS).toISOString(),
      })
    })
    if (replayRunId) {
      const replayRun = await readRunUnscoped(replayRunId)
      if (replayRun.status === 'STAGING') conflict('IMPORT_STAGING', 'Staging impor sebelumnya masih berlangsung.')
      return previewArtifacts(replayRun, await readRowsUnscoped(replayRunId), true)
    }
    try {
      await storeFirebaseRows(runId, parsed.rows)
      await runRef.update({ status: 'PREVIEWED' })
    } catch {
      await runRef.update({
        status: 'FAILED',
        lastError: { code: 'STAGING_FAILED', message: 'Staging row gagal disimpan.', occurredAt: new Date().toISOString() },
      }).catch(() => undefined)
      serviceUnavailable('Staging impor gagal disimpan secara lengkap.')
    }
  }

  const result = previewArtifacts(run, parsed.rows, replayed)
  const audit = await appendAudit({
    actor: context,
    action: 'IMPORT_PREVIEW_CREATED',
    resourceType: 'import_run',
    resourceId: run.id,
    after: { dataset: run.dataset, programStudyId, checksum: run.checksum, counts: run.counts, mappingVersion: run.mappingVersion },
    event,
  })
  result.auditId = audit.id
  return result
}

export async function getImportRun(
  context: AuthContext,
  runId: string,
): Promise<{ run: ImportRun; sampleRows: ImportStagedRow[]; issues: ImportIssue[] }> {
  requireOperator(context)
  const run = await readRunUnscoped(runId)
  requireRunScope(context, run)
  const rows = await readRowsUnscoped(runId)
  const preview = previewArtifacts(run, rows, false)
  return { run: preview.run, sampleRows: preview.sampleRows, issues: preview.issues }
}

export async function listImportRuns(
  context: AuthContext,
  options: { dataset?: ImportDataset; status?: ImportStatus; programStudyId?: string; limit?: number; cursor?: string } = {},
): Promise<ImportListResult> {
  requireOperator(context)
  const programStudyId = options.programStudyId
    ? scopedProgram(context, options.programStudyId)
    : hasRole(context, 'administrator')
      ? undefined
      : context.scope.programStudyIds.length === 1
        ? context.scope.programStudyIds[0]
        : undefined
  if (!hasRole(context, 'administrator') && !programStudyId) invalidInput('programStudyId wajib dipilih untuk melihat riwayat impor.')
  const limit = Math.min(Math.max(options.limit || 25, 1), 100)

  if (assertStorageAvailable() === 'mock') {
    const items = [...memory.runs.values()]
      .filter(run => !options.dataset || run.dataset === options.dataset)
      .filter(run => !options.status || run.status === options.status)
      .filter(run => !programStudyId || run.programStudyId === programStudyId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    const start = options.cursor ? Math.max(0, items.findIndex(run => run.id === options.cursor) + 1) : 0
    const page = items.slice(start, start + limit)
    return {
      items: page.map(clone),
      ...(start + limit < items.length && page.length ? { nextCursor: page.at(-1)!.id } : {}),
    }
  }

  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan impor tidak tersedia.')
  let query: FirebaseFirestore.Query = db.collection('importRuns').orderBy('createdAt', 'desc')
  if (programStudyId) query = query.where('programStudyId', '==', programStudyId)
  if (options.dataset) query = query.where('dataset', '==', options.dataset)
  if (options.status) query = query.where('status', '==', options.status)
  if (options.cursor) {
    const cursor = await db.collection('importRuns').doc(options.cursor).get()
    if (!cursor.exists) invalidInput('Cursor riwayat impor tidak valid.')
    query = query.startAfter(cursor)
  }
  const snapshot = await query.limit(limit + 1).get()
  const items = snapshot.docs.slice(0, limit).map(doc => ({ id: doc.id, ...doc.data() }) as ImportRun)
  return { items, ...(snapshot.size > limit && items.length ? { nextCursor: items.at(-1)!.id } : {}) }
}

export async function approveImport(
  context: AuthContext,
  runId: string,
  input: { expectedVersion: number; expectedChecksum: string },
  idempotencyKey: string,
  event?: H3Event,
): Promise<{ run: ImportRun; replayed: boolean; auditId?: string }> {
  requireApprover(context)
  const namespace = idempotencyNamespace(context, `approve:${runId}`, idempotencyKey)
  const payloadHash = requestHash(input)
  const now = new Date().toISOString()
  let updated: ImportRun
  let replayed = false

  const transition = (run: ImportRun): ImportRun => {
    requireRunScope(context, run)
    if (run.status !== 'PREVIEWED') conflict('IMPORT_NOT_PREVIEWED', 'Hanya impor berstatus PREVIEWED yang dapat disetujui.')
    if (run.version !== input.expectedVersion) conflict('STALE_IMPORT_VERSION', 'Preview impor telah berubah. Muat ulang sebelum menyetujui.')
    if (run.checksum !== input.expectedChecksum) conflict('IMPORT_CHECKSUM_CHANGED', 'Checksum preview tidak sesuai.')
    if (run.counts.errors > 0) conflict('IMPORT_HAS_ERRORS', 'Perbaiki seluruh error sebelum menyetujui impor.')
    if (Date.parse(run.expiresAt) <= Date.now()) conflict('IMPORT_PREVIEW_EXPIRED', 'Preview impor telah kedaluwarsa dan harus dibuat ulang.')
    if (dualApprovalRequired() && run.createdBy === context.uid) {
      conflict('SECOND_APPROVER_REQUIRED', 'Produksi mewajibkan administrator lain untuk menyetujui impor.')
    }
    return { ...run, status: 'APPROVED', version: run.version + 1, approvedAt: now, approvedBy: context.uid }
  }

  if (assertStorageAvailable() === 'mock') {
    const previous = memory.idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== payloadHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk persetujuan berbeda.')
      const response = clone(previous.response as { run: ImportRun; replayed: boolean })
      return { ...response, replayed: true }
    }
    const run = memory.runs.get(runId)
    if (!run) notFound('Proses impor')
    updated = transition(clone(run))
    memory.runs.set(runId, clone(updated))
    const response = { run: updated, replayed: false }
    memory.idempotency.set(namespace, { requestHash: payloadHash, runId, operation: 'approve', response: clone(response) })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan impor tidak tersedia.')
    const runRef = db.collection('importRuns').doc(runId)
    const idemRef = db.collection('idempotencyKeys').doc(idemDocumentId(namespace))
    const result = await db.runTransaction(async (transaction) => {
      const [previous, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(runRef)])
      if (previous.exists) {
        const data = previous.data() as { requestHash: string; response: { run: ImportRun } }
        if (data.requestHash !== payloadHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk persetujuan berbeda.')
        return { run: data.response.run, replayed: true }
      }
      if (!snapshot.exists) notFound('Proses impor')
      const next = transition({ id: snapshot.id, ...snapshot.data() } as ImportRun)
      transaction.update(runRef, next)
      transaction.create(idemRef, {
        namespace: 'import:approve', requestHash: payloadHash, runId, response: { run: next }, createdAt: now,
        expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
      })
      return { run: next, replayed: false }
    })
    updated = result.run
    replayed = result.replayed
  }

  const result: { run: ImportRun; replayed: boolean; auditId?: string } = { run: clone(updated), replayed }
  if (!replayed) {
    const audit = await appendAudit({
      actor: context,
      action: 'IMPORT_APPROVED',
      resourceType: 'import_run',
      resourceId: runId,
      before: { status: 'PREVIEWED', version: input.expectedVersion },
      after: { status: updated.status, version: updated.version, checksum: updated.checksum },
      event,
    })
    result.auditId = audit.id
  }
  return result
}

function targetRecord(run: ImportRun, row: ImportStagedRow, context: AuthContext, previous?: ImportTargetRecord): ImportTargetRecord {
  const now = new Date().toISOString()
  return {
    id: row.stableId!,
    dataset: run.dataset,
    programStudyId: run.programStudyId,
    data: clone(row.data),
    fingerprint: row.fingerprint!,
    version: (previous?.version || 0) + 1,
    importRunId: run.id,
    importedAt: now,
    importedBy: context.uid,
  }
}

async function commitMock(
  context: AuthContext,
  run: ImportRun,
  rows: ImportStagedRow[],
): Promise<ImportRun> {
  const targets = new Map([...memory.targets[run.dataset]].map(([id, record]) => [id, clone(record)]))
  const mutations: ImportMutation[] = []
  for (const row of rows) {
    if (row.action === 'INVALID' || !row.stableId || !row.fingerprint) conflict('IMPORT_ROWS_INVALID', 'Staging masih memiliki baris tidak valid.')
    const previous = targets.get(row.stableId)
    if (previous?.fingerprint !== row.existingFingerprint) {
      conflict('IMPORT_TARGET_CHANGED', 'Data tujuan berubah setelah preview. Buat preview baru.', { rowNumber: row.rowNumber })
    }
    if (row.action === 'SKIP') continue
    const next = targetRecord(run, row, context, previous)
    targets.set(row.stableId, next)
    mutations.push({
      stableId: row.stableId,
      targetCollection: TARGET_COLLECTIONS[run.dataset],
      before: previous ? clone(previous) : null,
      afterFingerprint: next.fingerprint,
      appliedAt: next.importedAt,
    })
  }
  const committed = mutations.length
  const updated: ImportRun = {
    ...run,
    status: 'COMMITTED',
    version: run.version + 1,
    committedAt: new Date().toISOString(),
    committedBy: context.uid,
    counts: { ...run.counts, committed },
  }
  memory.targets[run.dataset] = targets
  memory.mutations.set(run.id, mutations)
  memory.runs.set(run.id, clone(updated))
  return updated
}

async function commitFirebase(
  context: AuthContext,
  runId: string,
  expectedVersion: number,
  namespace: string,
  payloadHash: string,
): Promise<{ run: ImportRun; replayed: boolean }> {
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan impor tidak tersedia.')
  const runRef = db.collection('importRuns').doc(runId)
  const idemRef = db.collection('idempotencyKeys').doc(idemDocumentId(namespace))
  const leaseOwner = opaqueId('lease', `${context.uid}:${Date.now()}:${Math.random()}`)
  const leaseExpiresAt = new Date(Date.now() + LEASE_MS).toISOString()
  let replay: ImportRun | undefined

  const started = await db.runTransaction(async (transaction) => {
    const [previous, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(runRef)])
    if (!snapshot.exists) notFound('Proses impor')
    const current = { id: snapshot.id, ...snapshot.data() } as ImportRun & { leaseExpiresAt?: string }
    requireRunScope(context, current)
    if (previous.exists) {
      const idem = previous.data() as { requestHash: string; state: string; response?: { run: ImportRun } }
      if (idem.requestHash !== payloadHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk commit berbeda.')
      if (idem.state === 'COMPLETE' && idem.response) {
        replay = idem.response.run
        return current
      }
      if (current.status === 'COMMITTING' && current.leaseExpiresAt && Date.parse(current.leaseExpiresAt) > Date.now()) {
        conflict('IMPORT_IN_PROGRESS', 'Commit impor masih berjalan.')
      }
    } else {
      if (current.status !== 'APPROVED') conflict('IMPORT_NOT_APPROVED', 'Impor harus disetujui sebelum commit.')
      if (current.version !== expectedVersion) conflict('STALE_IMPORT_VERSION', 'Impor telah berubah. Muat ulang sebelum commit.')
      transaction.create(idemRef, {
        namespace: 'import:commit', requestHash: payloadHash, runId, state: 'PENDING', createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      })
    }
    const nextVersion = current.status === 'APPROVED' ? current.version + 1 : current.version
    transaction.update(runRef, { status: 'COMMITTING', version: nextVersion, leaseOwner, leaseExpiresAt })
    return { ...current, status: 'COMMITTING' as const, version: nextVersion }
  })
  if (replay) return { run: replay, replayed: true }

  const rows = await readRowsUnscoped(runId)
  let committed = 0
  try {
    for (const row of rows) {
      if (row.action === 'INVALID' || !row.stableId || !row.fingerprint) conflict('IMPORT_ROWS_INVALID', 'Staging masih memiliki baris tidak valid.')
      const targetRef = db.collection(TARGET_COLLECTIONS[started.dataset]).doc(row.stableId)
      const mutationRef = runRef.collection('mutations').doc(row.stableId)
      const applied = await db.runTransaction(async (transaction) => {
        const [existingMutation, targetSnapshot] = await Promise.all([
          transaction.get(mutationRef), transaction.get(targetRef),
        ])
        if (existingMutation.exists) return false
        const previous = targetSnapshot.exists
          ? ({ id: targetSnapshot.id, ...targetSnapshot.data() } as ImportTargetRecord)
          : undefined
        if (previous?.fingerprint !== row.existingFingerprint) {
          conflict('IMPORT_TARGET_CHANGED', 'Data tujuan berubah setelah preview. Buat preview baru.', { rowNumber: row.rowNumber })
        }
        if (row.action === 'SKIP') return false
        const next = targetRecord(started, row, context, previous)
        const mutation: ImportMutation = {
          stableId: row.stableId!, targetCollection: TARGET_COLLECTIONS[started.dataset],
          before: previous || null, afterFingerprint: next.fingerprint, appliedAt: next.importedAt,
        }
        transaction.set(targetRef, next)
        transaction.create(mutationRef, mutation)
        return true
      })
      if (applied) committed += 1
    }
  } catch (error) {
    let partialCount = committed
    try {
      const aggregate = await runRef.collection('mutations').count().get()
      partialCount = aggregate.data().count
    } catch {
      // The failure state remains authoritative even if the aggregate count is temporarily unavailable.
    }
    await runRef.update({
      status: 'FAILED', leaseOwner: null, leaseExpiresAt: null,
      'counts.committed': partialCount,
      lastError: { code: 'COMMIT_FAILED', message: 'Commit terhenti dan dapat dilanjutkan dengan idempotency key yang sama.', occurredAt: new Date().toISOString() },
    }).catch(() => undefined)
    throw error
  }

  const finalRun = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(runRef)
    if (!snapshot.exists) notFound('Proses impor')
    const current = { id: snapshot.id, ...snapshot.data() } as ImportRun
    const next: ImportRun = {
      ...current,
      status: 'COMMITTED',
      committedAt: new Date().toISOString(),
      committedBy: context.uid,
      counts: { ...current.counts, committed: current.counts.committed + committed },
    }
    transaction.update(runRef, { ...next, leaseOwner: null, leaseExpiresAt: null })
    transaction.update(idemRef, { state: 'COMPLETE', response: { run: next }, completedAt: new Date().toISOString() })
    return next
  })
  return { run: finalRun, replayed: false }
}

export async function commitImport(
  context: AuthContext,
  runId: string,
  input: { expectedVersion: number },
  idempotencyKey: string,
  event?: H3Event,
): Promise<{ run: ImportRun; replayed: boolean; auditId?: string }> {
  requireApprover(context)
  const namespace = idempotencyNamespace(context, `commit:${runId}`, idempotencyKey)
  const payloadHash = requestHash(input)
  let result: { run: ImportRun; replayed: boolean; auditId?: string }

  if (assertStorageAvailable() === 'mock') {
    const previous = memory.idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== payloadHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk commit berbeda.')
      const response = clone(previous.response as { run: ImportRun; replayed: boolean })
      return { ...response, replayed: true }
    }
    const run = memory.runs.get(runId)
    if (!run) notFound('Proses impor')
    requireRunScope(context, run)
    if (run.status !== 'APPROVED') conflict('IMPORT_NOT_APPROVED', 'Impor harus disetujui sebelum commit.')
    if (run.version !== input.expectedVersion) conflict('STALE_IMPORT_VERSION', 'Impor telah berubah. Muat ulang sebelum commit.')
    const rows = memory.rows.get(runId) || []
    const updated = await commitMock(context, clone(run), clone(rows))
    result = { run: updated, replayed: false }
    memory.idempotency.set(namespace, { requestHash: payloadHash, runId, operation: 'commit', response: clone(result) })
  } else {
    result = await commitFirebase(context, runId, input.expectedVersion, namespace, payloadHash)
  }

  if (!result.replayed) {
    const audit = await appendAudit({
      actor: context,
      action: 'IMPORT_COMMITTED',
      resourceType: 'import_run',
      resourceId: runId,
      after: { dataset: result.run.dataset, programStudyId: result.run.programStudyId, counts: result.run.counts, checksum: result.run.checksum },
      event,
    })
    result.auditId = audit.id
  }
  return result
}

async function compensateMock(
  context: AuthContext,
  run: ImportRun,
  reason: string,
): Promise<ImportRun> {
  const targets = new Map([...memory.targets[run.dataset]].map(([id, record]) => [id, clone(record)]))
  const mutations = clone(memory.mutations.get(run.id) || [])
  let compensated = 0
  let compensationConflicts = 0
  mutations.forEach((mutation) => {
    const current = targets.get(mutation.stableId)
    if (!current || current.fingerprint !== mutation.afterFingerprint) {
      mutation.compensationStatus = 'CONFLICT'
      compensationConflicts += 1
      return
    }
    if (mutation.before) targets.set(mutation.stableId, clone(mutation.before))
    else targets.delete(mutation.stableId)
    mutation.compensationStatus = 'COMPENSATED'
    compensated += 1
  })
  const updated: ImportRun = {
    ...run,
    status: compensationConflicts ? 'PARTIALLY_COMPENSATED' : 'COMPENSATED',
    version: run.version + 1,
    compensatedAt: new Date().toISOString(),
    compensatedBy: context.uid,
    compensationReason: reason,
    counts: { ...run.counts, compensated, compensationConflicts },
  }
  memory.targets[run.dataset] = targets
  memory.mutations.set(run.id, mutations)
  memory.runs.set(run.id, clone(updated))
  return updated
}

async function compensateFirebase(
  context: AuthContext,
  runId: string,
  input: { expectedVersion: number; reason: string },
  namespace: string,
  payloadHash: string,
): Promise<{ run: ImportRun; replayed: boolean }> {
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan impor tidak tersedia.')
  const runRef = db.collection('importRuns').doc(runId)
  const idemRef = db.collection('idempotencyKeys').doc(idemDocumentId(namespace))
  let replay: ImportRun | undefined
  const run = await db.runTransaction(async (transaction) => {
    const [previous, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(runRef)])
    if (!snapshot.exists) notFound('Proses impor')
    const current = { id: snapshot.id, ...snapshot.data() } as ImportRun
    requireRunScope(context, current)
    if (previous.exists) {
      const idem = previous.data() as { requestHash: string; response?: { run: ImportRun } }
      if (idem.requestHash !== payloadHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk kompensasi berbeda.')
      if (idem.response) replay = idem.response.run
      return current
    }
    const failedPartialCommit = current.status === 'FAILED'
      && current.lastError?.code === 'COMMIT_FAILED'
      && current.counts.committed > 0
    if (current.status !== 'COMMITTED' && current.status !== 'PARTIALLY_COMPENSATED' && !failedPartialCommit) {
      conflict('IMPORT_NOT_COMPENSATABLE', 'Hanya impor yang telah commit yang dapat dikompensasi.')
    }
    if (current.version !== input.expectedVersion) conflict('STALE_IMPORT_VERSION', 'Impor telah berubah. Muat ulang sebelum kompensasi.')
    transaction.update(runRef, { status: 'COMPENSATING', version: current.version + 1 })
    transaction.create(idemRef, {
      namespace: 'import:compensate', requestHash: payloadHash, runId, state: 'PENDING', createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    })
    return { ...current, status: 'COMPENSATING' as const, version: current.version + 1 }
  })
  if (replay) return { run: replay, replayed: true }

  const mutationSnapshot = await runRef.collection('mutations').get()
  let compensated = 0
  let compensationConflicts = 0
  for (const mutationDocument of mutationSnapshot.docs) {
    const mutationRef = mutationDocument.ref
    const result = await db.runTransaction(async (transaction) => {
      const mutationSnapshotInTransaction = await transaction.get(mutationRef)
      const mutation = mutationSnapshotInTransaction.data() as ImportMutation
      if (mutation.compensationStatus === 'COMPENSATED') return 'COMPENSATED'
      const targetRef = db.collection(mutation.targetCollection).doc(mutation.stableId)
      const targetSnapshot = await transaction.get(targetRef)
      const currentFingerprint = targetSnapshot.data()?.fingerprint
      if (!targetSnapshot.exists || currentFingerprint !== mutation.afterFingerprint) {
        transaction.update(mutationRef, { compensationStatus: 'CONFLICT' })
        return 'CONFLICT'
      }
      if (mutation.before) transaction.set(targetRef, mutation.before)
      else transaction.delete(targetRef)
      transaction.update(mutationRef, { compensationStatus: 'COMPENSATED', compensatedAt: new Date().toISOString() })
      return 'COMPENSATED'
    })
    if (result === 'COMPENSATED') compensated += 1
    else compensationConflicts += 1
  }

  const finalRun: ImportRun = {
    ...run,
    status: compensationConflicts ? 'PARTIALLY_COMPENSATED' : 'COMPENSATED',
    compensatedAt: new Date().toISOString(),
    compensatedBy: context.uid,
    compensationReason: input.reason,
    counts: { ...run.counts, compensated, compensationConflicts },
  }
  await db.runTransaction(async (transaction) => {
    transaction.update(runRef, finalRun)
    transaction.update(idemRef, { state: 'COMPLETE', response: { run: finalRun }, completedAt: new Date().toISOString() })
  })
  return { run: finalRun, replayed: false }
}

export async function compensateImport(
  context: AuthContext,
  runId: string,
  input: { expectedVersion: number; reason: string },
  idempotencyKey: string,
  event?: H3Event,
): Promise<{ run: ImportRun; replayed: boolean; auditId?: string }> {
  requireApprover(context)
  const reason = input.reason.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (reason.length < 10 || reason.length > 500) invalidInput('Alasan kompensasi harus 10-500 karakter.')
  const normalizedInput = { expectedVersion: input.expectedVersion, reason }
  const namespace = idempotencyNamespace(context, `compensate:${runId}`, idempotencyKey)
  const payloadHash = requestHash(normalizedInput)
  let result: { run: ImportRun; replayed: boolean; auditId?: string }

  if (assertStorageAvailable() === 'mock') {
    const previous = memory.idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== payloadHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk kompensasi berbeda.')
      const response = clone(previous.response as { run: ImportRun; replayed: boolean })
      return { ...response, replayed: true }
    }
    const run = memory.runs.get(runId)
    if (!run) notFound('Proses impor')
    requireRunScope(context, run)
    if (run.status !== 'COMMITTED' && run.status !== 'PARTIALLY_COMPENSATED') {
      conflict('IMPORT_NOT_COMPENSATABLE', 'Hanya impor yang telah commit yang dapat dikompensasi.')
    }
    if (run.version !== input.expectedVersion) conflict('STALE_IMPORT_VERSION', 'Impor telah berubah. Muat ulang sebelum kompensasi.')
    result = { run: await compensateMock(context, clone(run), reason), replayed: false }
    memory.idempotency.set(namespace, { requestHash: payloadHash, runId, operation: 'compensate', response: clone(result) })
  } else {
    result = await compensateFirebase(context, runId, normalizedInput, namespace, payloadHash)
  }

  if (!result.replayed) {
    const audit = await appendAudit({
      actor: context,
      action: 'IMPORT_COMPENSATED',
      resourceType: 'import_run',
      resourceId: runId,
      after: {
        status: result.run.status,
        compensated: result.run.counts.compensated,
        conflicts: result.run.counts.compensationConflicts,
        reason,
      },
      event,
    })
    result.auditId = audit.id
  }
  return result
}
