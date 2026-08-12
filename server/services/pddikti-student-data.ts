import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  PddiktiDiplomaEligibility,
  PddiktiDiplomaEligibilityCheck,
  PddiktiEntityMapping,
  PddiktiReconciliation,
  PddiktiStudentDataChangeItem,
  PddiktiStudentDataChangeRequest,
} from '../types/pddikti'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { filterProgramScope, hasRole, requirePermission } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { requireInteger, requireRecord, requireString } from '../utils/validation'
import { listPddiktiSourceRecordsForScope } from './pddikti'
import { pddiktiModuleState, resetPddiktiModuleState } from './pddikti-state'

export { resetPddiktiModuleState as resetPddiktiStudentDataStateForTests }

const CHANGE_FIELDS: PddiktiStudentDataChangeItem['field'][] = ['name', 'birthPlace', 'birthDate', 'gender', 'identityNumber', 'motherName']
const OPEN_STATUSES: PddiktiStudentDataChangeRequest['status'][] = ['SUBMITTED', 'VALIDATED', 'QUEUED']
const TRANSITIONS: Record<PddiktiStudentDataChangeRequest['status'], PddiktiStudentDataChangeRequest['status'][]> = {
  SUBMITTED: ['VALIDATED', 'REJECTED'], VALIDATED: ['QUEUED', 'REJECTED'], QUEUED: ['COMPLETED', 'REJECTED'], COMPLETED: [], REJECTED: [],
}

function clone<T>(value: T): T { return structuredClone(value) }
function safeId(value: unknown, label: string): string { return requireString(value, label, { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ }) }
function idempotencyKey(value: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(value)) invalidInput('Idempotency key PDM tidak valid.'); return value }
function requirePdmWriter(context: AuthContext): void { requirePermission(context, 'pddikti:queue'); if (!hasRole(context, 'academic_staff')) forbidden('Perubahan Data Mahasiswa hanya dapat dikelola staf akademik.') }
function requirePdmReader(context: AuthContext): void { requirePermission(context, 'pddikti.read'); if (!hasRole(context, 'academic_staff')) forbidden('Data PDM hanya dapat dibaca staf akademik scoped.') }
function scopedProgram(context: AuthContext, requested: unknown): string {
  const value = safeId(requested, 'programStudyId'), scoped = filterProgramScope(context, value)
  if (!scoped) invalidInput('programStudyId wajib.'); return scoped
}
function rejectUnknown(body: Record<string, unknown>, allowed: string[]): void { const extra = Object.keys(body).filter(key => !allowed.includes(key)); if (extra.length) invalidInput(`Field tidak didukung: ${extra.join(', ')}.`) }

function parseChanges(value: unknown): PddiktiStudentDataChangeItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > CHANGE_FIELDS.length) invalidInput('Perubahan PDM harus berisi 1-6 field.')
  const changes = value.map((raw, index) => {
    const item = requireRecord(raw, `changes[${index}]`); rejectUnknown(item, ['field', 'previousValue', 'requestedValue'])
    const field = requireString(item.field, `changes[${index}].field`, { max: 40 }) as PddiktiStudentDataChangeItem['field']
    if (!CHANGE_FIELDS.includes(field)) invalidInput(`Field PDM ${field} tidak didukung.`)
    const previousValue = requireString(item.previousValue, `changes[${index}].previousValue`, { max: 300 })
    const requestedValue = requireString(item.requestedValue, `changes[${index}].requestedValue`, { max: 300 })
    if (previousValue.normalize('NFKC').trim() === requestedValue.normalize('NFKC').trim()) invalidInput(`Nilai baru ${field} harus berbeda.`)
    return { field, previousValue, requestedValue }
  })
  if (new Set(changes.map(item => item.field)).size !== changes.length) invalidInput('Field perubahan PDM harus unik.')
  return changes
}

function parseEvidence(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) invalidInput('PDM memerlukan 1-10 referensi berkas bukti privat.')
  const ids = value.map((item, index) => safeId(item, `evidenceFileIds[${index}]`))
  if (new Set(ids).size !== ids.length) invalidInput('Referensi bukti PDM harus unik.')
  return ids
}

export async function listStudentDataChanges(context: AuthContext, input: { programStudyId: string; status?: string; studentId?: string }): Promise<PddiktiStudentDataChangeRequest[]> {
  requirePdmReader(context)
  const programStudyId = scopedProgram(context, input.programStudyId)
  const status = input.status as PddiktiStudentDataChangeRequest['status'] | undefined
  if (status && !Object.keys(TRANSITIONS).includes(status)) invalidInput('Status PDM tidak valid.')
  const studentId = input.studentId ? safeId(input.studentId, 'studentId') : undefined
  let rows: PddiktiStudentDataChangeRequest[]
  if (dataMode() === 'mock') rows = [...pddiktiModuleState().studentDataChanges.values()].map(clone)
  else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan PDM tidak tersedia.')
    const snapshot = await db.collection('pddiktiStudentDataChanges').where('programStudyId', '==', programStudyId).limit(1_000).get()
    rows = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as PddiktiStudentDataChangeRequest)
  }
  return rows.filter(item => item.programStudyId === programStudyId && (!status || item.status === status) && (!studentId || item.studentId === studentId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function submitStudentDataChange(context: AuthContext, value: unknown, key: string, event?: H3Event, clock = new Date()): Promise<{ request: PddiktiStudentDataChangeRequest; replayed: boolean; auditId?: string }> {
  requirePdmWriter(context); idempotencyKey(key)
  const body = requireRecord(value); rejectUnknown(body, ['studentId', 'studentNumber', 'programStudyId', 'periodId', 'reason', 'changes', 'evidenceFileIds'])
  const studentId = safeId(body.studentId, 'studentId'), studentNumber = requireString(body.studentNumber, 'studentNumber', { min: 5, max: 40, pattern: /^[A-Za-z0-9._-]+$/ }), programStudyId = scopedProgram(context, body.programStudyId), periodId = safeId(body.periodId, 'periodId')
  const reason = requireString(body.reason, 'reason', { min: 15, max: 2_000 }), changes = parseChanges(body.changes), evidenceFileIds = parseEvidence(body.evidenceFileIds), now = clock.toISOString()
  const normalized = { studentId, studentNumber, programStudyId, periodId, reason, changes, evidenceFileIds }, hash = requestHash(normalized), namespace = `pddikti:pdm:${context.uid}:${key}`, id = opaqueId('pdm', `${studentId}:${key}`)
  const request: PddiktiStudentDataChangeRequest = { id, ...normalized, status: 'SUBMITTED', version: 1, submittedAt: now, submittedBy: context.uid, updatedAt: now, updatedBy: context.uid }
  let replayed = false
  if (dataMode() === 'mock') {
    const state = pddiktiModuleState(), prior = state.idempotency.get(namespace)
    if (prior) { if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk PDM berbeda.'); return { request: clone(prior.response as PddiktiStudentDataChangeRequest), replayed: true } }
    if ([...state.studentDataChanges.values()].some(item => item.studentId === studentId && OPEN_STATUSES.includes(item.status))) conflict('PDM_OPEN_EXISTS', 'Mahasiswa masih memiliki PDM terbuka.')
    state.studentDataChanges.set(id, clone(request)); state.idempotency.set(namespace, { requestHash: hash, response: request })
  } else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan PDM tidak tersedia.')
    const ref = db.collection('pddiktiStudentDataChanges').doc(id), openRef = db.collection('pddiktiStudentDataChangeKeys').doc(opaqueId('pdm_key', studentId)), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async transaction => {
      const [prior, open] = await Promise.all([transaction.get(idemRef), transaction.get(openRef)])
      if (prior.exists) { const stored = prior.data() as { requestHash: string; response: PddiktiStudentDataChangeRequest }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk PDM berbeda.'); return { request: stored.response, replayed: true } }
      if (open.exists && OPEN_STATUSES.includes(String(open.data()?.status) as PddiktiStudentDataChangeRequest['status'])) conflict('PDM_OPEN_EXISTS', 'Mahasiswa masih memiliki PDM terbuka.')
      transaction.create(ref, request); transaction.set(openRef, { requestId: id, status: 'SUBMITTED', updatedAt: now }); transaction.create(idemRef, { requestHash: hash, response: request, createdAt: now }); return { request, replayed: false }
    })
    if (result.replayed) return result; replayed = result.replayed
  }
  const audit = await appendAudit({ actor: context, action: 'PDDIKTI_PDM_SUBMITTED', resourceType: 'pddikti_student_data_change', resourceId: id, after: { studentId, studentNumber, programStudyId, periodId, changedFields: changes.map(item => item.field), evidenceCount: evidenceFileIds.length, version: 1 }, event })
  return { request, replayed, auditId: audit.id }
}

export async function transitionStudentDataChange(context: AuthContext, requestId: string, value: unknown, event?: H3Event, clock = new Date()): Promise<{ request: PddiktiStudentDataChangeRequest; auditId: string }> {
  requirePdmWriter(context)
  const id = safeId(requestId, 'requestId'), body = requireRecord(value); rejectUnknown(body, ['status', 'reviewNote', 'remoteTicket', 'expectedVersion'])
  const status = requireString(body.status, 'status', { max: 20 }) as PddiktiStudentDataChangeRequest['status']; if (!Object.keys(TRANSITIONS).includes(status)) invalidInput('Status PDM tidak valid.')
  const reviewNote = requireString(body.reviewNote, 'reviewNote', { min: 5, max: 2_000 }), remoteTicket = body.remoteTicket === undefined ? undefined : requireString(body.remoteTicket, 'remoteTicket', { max: 120, pattern: /^[A-Za-z0-9._:/-]+$/ }), expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 1), now = clock.toISOString()
  const change = (before: PddiktiStudentDataChangeRequest) => {
    scopedProgram(context, before.programStudyId)
    if (before.version !== expectedVersion) conflict('VERSION_CONFLICT', 'PDM telah berubah.', { currentVersion: before.version })
    if (!TRANSITIONS[before.status].includes(status)) conflict('INVALID_STATE_TRANSITION', `PDM ${before.status} tidak dapat menjadi ${status}.`)
    if (status === 'COMPLETED' && !remoteTicket) invalidInput('remoteTicket wajib saat PDM diselesaikan.')
    return { ...before, status, reviewNote, ...(remoteTicket ? { remoteTicket } : {}), ...(status === 'COMPLETED' ? { completedAt: now } : {}), version: before.version + 1, updatedAt: now, updatedBy: context.uid }
  }
  let request: PddiktiStudentDataChangeRequest
  if (dataMode() === 'mock') { const before = pddiktiModuleState().studentDataChanges.get(id); if (!before) notFound('PDM'); request = change(clone(before)); pddiktiModuleState().studentDataChanges.set(id, clone(request)) }
  else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan PDM tidak tersedia.'); const ref = db.collection('pddiktiStudentDataChanges').doc(id)
    request = await db.runTransaction(async transaction => { const snapshot = await transaction.get(ref); if (!snapshot.exists) notFound('PDM'); const next = change({ id: snapshot.id, ...snapshot.data() } as PddiktiStudentDataChangeRequest); transaction.update(ref, next); transaction.set(db.collection('pddiktiStudentDataChangeKeys').doc(opaqueId('pdm_key', next.studentId)), { requestId: id, status, updatedAt: now }); return next })
  }
  const audit = await appendAudit({ actor: context, action: `PDDIKTI_PDM_${status}`, resourceType: 'pddikti_student_data_change', resourceId: id, before: { version: expectedVersion }, after: { status, version: request.version, hasRemoteTicket: Boolean(remoteTicket) }, event })
  return { request, auditId: audit.id }
}

async function activeMappings(programStudyId: string): Promise<PddiktiEntityMapping[]> {
  if (dataMode() === 'mock') return [...pddiktiModuleState().entityMappings.values()].filter(item => item.programStudyId === programStudyId && item.status === 'ACTIVE').map(clone)
  const db = firestoreAdmin(); if (!db) serviceUnavailable('Mapping PDDIKTI tidak tersedia.')
  const snapshot = await db.collection('pddiktiEntityMappings').where('programStudyId', '==', programStudyId).where('status', '==', 'ACTIVE').limit(10_000).get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as PddiktiEntityMapping)
}

async function openReconciliations(programStudyId: string, periodId: string): Promise<PddiktiReconciliation[]> {
  if (dataMode() === 'mock') return [...pddiktiModuleState().reconciliations.values()].filter(item => item.programStudyId === programStudyId && item.periodId === periodId && item.status === 'OPEN').map(clone)
  const db = firestoreAdmin(); if (!db) serviceUnavailable('Rekonsiliasi PDDIKTI tidak tersedia.')
  const snapshot = await db.collection('pddiktiReconciliations').where('programStudyId', '==', programStudyId).limit(1_000).get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as PddiktiReconciliation).filter(item => item.periodId === periodId && item.status === 'OPEN')
}

export async function getDiplomaNumberEligibility(context: AuthContext, input: { studentId: string; programStudyId: string; periodId: string }, clock = new Date()): Promise<PddiktiDiplomaEligibility> {
  requirePdmReader(context)
  const studentId = safeId(input.studentId, 'studentId'), programStudyId = scopedProgram(context, input.programStudyId), periodId = safeId(input.periodId, 'periodId')
  const [sources, mappings, pdm, reconciliations] = await Promise.all([listPddiktiSourceRecordsForScope(programStudyId, periodId), activeMappings(programStudyId), listStudentDataChanges(context, { programStudyId, studentId }), openReconciliations(programStudyId, periodId)])
  const student = sources.find(item => item.entityType === 'student' && item.id === studentId), studentNumber = String(student?.data.studentNumber || '')
  const graduation = sources.find(item => item.entityType === 'graduation' && String(item.data.studentNumber || '') === studentNumber)
  const sourceReady = (record: typeof student, fields: string[]) => Boolean(record?.eligible && !record.blockers.length && fields.every(field => record.data[field] !== null && record.data[field] !== undefined && record.data[field] !== ''))
  const mapped = (entityType: string, internalId?: string) => Boolean(internalId && mappings.some(item => item.entityType === entityType && item.internalId === internalId && item.status === 'ACTIVE'))
  const mismatched = reconciliations.some(item => ['student', 'graduation'].includes(item.entityType) && item.rows.some(row => row.state !== 'MATCH' && (row.internalId === student?.id || row.internalId === graduation?.id)))
  const checks: PddiktiDiplomaEligibilityCheck[] = [
    { code: 'STUDENT_SOURCE', passed: sourceReady(student, ['studentNumber', 'name', 'status']), message: student ? 'Data mahasiswa internal lengkap dan eligible.' : 'Sumber data mahasiswa tidak ditemukan.' },
    { code: 'GRADUATION_SOURCE', passed: sourceReady(graduation, ['studentNumber', 'decreeNumber', 'graduationDate']), message: graduation ? 'Data kelulusan internal lengkap dan eligible.' : 'Sumber data kelulusan tidak ditemukan.' },
    { code: 'STUDENT_MAPPING', passed: mapped('student', student?.id), message: mapped('student', student?.id) ? 'Mahasiswa telah terpetakan ke PDDIKTI.' : 'Mahasiswa belum mempunyai mapping aktif.' },
    { code: 'GRADUATION_MAPPING', passed: mapped('graduation', graduation?.id), message: mapped('graduation', graduation?.id) ? 'Kelulusan telah terpetakan ke PDDIKTI.' : 'Kelulusan belum mempunyai mapping aktif.' },
    { code: 'OPEN_PDM', passed: !pdm.some(item => OPEN_STATUSES.includes(item.status)), message: pdm.some(item => OPEN_STATUSES.includes(item.status)) ? 'Masih ada PDM terbuka.' : 'Tidak ada PDM terbuka.' },
    { code: 'OPEN_RECONCILIATION', passed: !mismatched, message: mismatched ? 'Masih ada perbedaan rekonsiliasi mahasiswa/kelulusan.' : 'Tidak ada perbedaan rekonsiliasi terbuka.' },
  ]
  const snapshot = { studentId, studentNumber, programStudyId, periodId, checks }
  return { ...snapshot, eligible: checks.every(item => item.passed), evaluatedAt: clock.toISOString(), snapshotHash: requestHash(snapshot) }
}
