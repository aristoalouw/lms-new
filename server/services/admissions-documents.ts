import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import {
  ADMISSION_DOCUMENT_TYPES,
  type AdmissionApplicationRecord,
  type AdmissionApplicationView,
  type AdmissionDocumentChecklistItem,
  type AdmissionDocumentRecord,
  type AdmissionDocumentType,
  type AdmissionDocumentWorkspace,
  type AdmissionPathId,
} from '../types/admissions'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { requireInteger, requireRecord, requireString } from '../utils/validation'
import { admissionModuleState } from './admissions-state'
import { getPrivateFileDetail } from './files'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const REQUIREMENTS: Record<AdmissionPathId, AdmissionDocumentType[]> = {
  regular: ['IDENTITY', 'DIPLOMA'],
  'kip-college': ['IDENTITY', 'DIPLOMA', 'KIP_CARD'],
  transfer: ['IDENTITY', 'DIPLOMA', 'TRANSCRIPT'],
  rpl: ['IDENTITY', 'DIPLOMA', 'RPL_PORTFOLIO'],
}
const LABELS: Record<AdmissionDocumentType, string> = { IDENTITY: 'Identitas resmi', DIPLOMA: 'Ijazah/Surat Keterangan Lulus', TRANSCRIPT: 'Transkrip institusi asal', KIP_CARD: 'Bukti KIP Kuliah', RPL_PORTFOLIO: 'Portofolio RPL', OTHER: 'Dokumen lain' }

function clone<T>(value: T): T { return structuredClone(value) }
function safeId(value: unknown, label: string): string { return requireString(value, label, { max: 128, pattern: SAFE_ID }) }
function cleanNote(value: unknown, label: string, min = 5): string { return requireString(value, label, { min, max: 1_000 }).normalize('NFKC').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }
function idempotencyKey(value: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(value)) invalidInput('Idempotency key dokumen PMB tidak valid.'); return value }
function view(record: AdmissionApplicationRecord): AdmissionApplicationView { const { identityFingerprint: _private, ...safe } = record; return clone(safe) }

async function loadApplication(id: string): Promise<AdmissionApplicationRecord> {
  const applicationId = safeId(id, 'applicationId')
  if (dataMode() === 'mock') { const record = admissionModuleState().applications.get(applicationId); if (!record) notFound('Pendaftaran PMB'); return clone(record) }
  const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan PMB tidak tersedia.'); const snapshot = await db.collection('admissionApplications').doc(applicationId).get(); if (!snapshot.exists) notFound('Pendaftaran PMB')
  return { id: snapshot.id, ...snapshot.data() } as AdmissionApplicationRecord
}

function canRead(context: AuthContext, application: AdmissionApplicationRecord): boolean {
  if (application.applicantUid === context.uid || (hasRole(context, 'applicant') && context.email?.toLowerCase() === application.email)) return true
  return hasRole(context, 'administrator', 'leader') || (hasRole(context, 'admissions_staff') && context.scope.programStudyIds.includes(application.programStudyId))
}
function requireApplicant(context: AuthContext, application: AdmissionApplicationRecord): void {
  if (!hasRole(context, 'applicant') || application.applicantUid !== context.uid) forbidden('Dokumen hanya dapat dikirim oleh akun applicant yang tertaut.')
  if (['ENROLLMENT_PENDING_IDENTITY', 'ENROLLED'].includes(application.status)) conflict('APPLICATION_DOCUMENTS_CLOSED', 'Dokumen pendaftaran sudah ditutup setelah konversi mahasiswa.')
}
function requireReviewer(context: AuthContext, application: AdmissionApplicationRecord): void {
  if (hasRole(context, 'administrator')) return
  if (!hasRole(context, 'admissions_staff') || !context.scope.programStudyIds.includes(application.programStudyId)) forbidden('Dokumen berada di luar lingkup verifikasi PMB Anda.')
}

async function documentsFor(applicationId: string): Promise<AdmissionDocumentRecord[]> {
  if (dataMode() === 'mock') return [...admissionModuleState().documents.values()].filter(item => item.applicationId === applicationId).map(clone)
  const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan dokumen PMB tidak tersedia.'); const snapshot = await db.collection('admissionDocuments').where('applicationId', '==', applicationId).limit(100).get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as AdmissionDocumentRecord)
}

function checklist(path: AdmissionPathId, documents: AdmissionDocumentRecord[]): AdmissionDocumentChecklistItem[] {
  const required = new Set(REQUIREMENTS[path])
  return ADMISSION_DOCUMENT_TYPES.filter(type => required.has(type)).map(documentType => {
    const latest = documents.filter(item => item.documentType === documentType).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    return { documentType, label: LABELS[documentType], required: true, status: latest?.status || 'MISSING', ...(latest ? { documentId: latest.id } : {}) }
  })
}

export async function getAdmissionDocumentWorkspace(context: AuthContext, applicationId: string): Promise<AdmissionDocumentWorkspace> {
  const application = await loadApplication(applicationId); if (!canRead(context, application)) forbidden('Pendaftaran berada di luar lingkup akses Anda.')
  const documents = (await documentsFor(application.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), items = checklist(application.admissionPathId, documents)
  return { application: view(application), documents, checklist: items, complete: items.every(item => item.status === 'VERIFIED') }
}

export async function requiredAdmissionDocumentsVerified(applicationId: string, path: AdmissionPathId): Promise<boolean> {
  const items = checklist(path, await documentsFor(applicationId))
  return items.length > 0 && items.every(item => item.status === 'VERIFIED')
}

export async function submitAdmissionDocument(context: AuthContext, applicationId: string, value: unknown, key: string, event?: H3Event, clock = new Date()): Promise<{ document: AdmissionDocumentRecord; replayed: boolean; auditId?: string }> {
  idempotencyKey(key); const application = await loadApplication(applicationId); requireApplicant(context, application)
  const body = requireRecord(value), extra = Object.keys(body).filter(field => !['documentType', 'fileId'].includes(field)); if (extra.length) invalidInput(`Field tidak didukung: ${extra.join(', ')}.`)
  const documentType = requireString(body.documentType, 'documentType', { max: 40 }) as AdmissionDocumentType; if (!ADMISSION_DOCUMENT_TYPES.includes(documentType)) invalidInput('Jenis dokumen PMB tidak valid.')
  const fileId = safeId(body.fileId, 'fileId'), detail = await getPrivateFileDetail(context, fileId), file = detail.file
  if (file.ownerUid !== context.uid) forbidden('Berkas PMB harus dimiliki applicant.')
  if (file.status !== 'CLEAN' || file.deleted || file.currentVersion === null) conflict('FILE_NOT_READY', 'Berkas harus lolos karantina dan pemindaian sebelum ditautkan.')
  if (file.access.visibility !== 'SCOPED' || !file.access.allowedRoles.includes('admissions_staff') || !file.access.programStudyIds.includes(application.programStudyId)) invalidInput('Berkas harus dibagikan kepada role admissions_staff pada program studi pendaftaran.')
  const version = detail.versions.find(item => item.version === file.currentVersion); if (!version?.sha256 || !version.sizeBytes) conflict('FILE_NOT_READY', 'Metadata versi berkas belum lengkap.')
  const now = clock.toISOString(), normalized = { applicationId: application.id, applicantUid: context.uid, programStudyId: application.programStudyId, documentType, fileId, fileVersion: file.currentVersion, fileName: file.name, mimeType: file.mimeType, sizeBytes: version.sizeBytes, checksumSha256: version.sha256 }, hash = requestHash(normalized), namespace = `admission-document:${context.uid}:${key}`, id = opaqueId('admission_document', `${application.id}:${documentType}:${key}`)
  const document: AdmissionDocumentRecord = { id, ...normalized, status: 'PENDING', version: 1, submittedAt: now, submittedBy: context.uid, updatedAt: now }
  if (dataMode() === 'mock') {
    const state = admissionModuleState(), prior = state.idempotency.get(namespace)
    if (prior) { if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk dokumen berbeda.'); return { document: clone(prior.response as AdmissionDocumentRecord), replayed: true } }
    if ([...state.documents.values()].some(item => item.applicationId === application.id && item.documentType === documentType && item.status !== 'REJECTED')) conflict('ADMISSION_DOCUMENT_EXISTS', 'Jenis dokumen ini masih menunggu atau sudah terverifikasi.')
    state.documents.set(id, clone(document)); state.idempotency.set(namespace, { requestHash: hash, response: document, createdAt: now })
  } else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan dokumen PMB tidak tersedia.'); const ref = db.collection('admissionDocuments').doc(id), typeRef = db.collection('admissionDocumentKeys').doc(opaqueId('admission_document_key', `${application.id}:${documentType}`)), idemRef = db.collection('admissionIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async transaction => { const [prior, existing] = await Promise.all([transaction.get(idemRef), transaction.get(typeRef)]); if (prior.exists) { const stored = prior.data() as { requestHash: string; response: AdmissionDocumentRecord }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk dokumen berbeda.'); return { document: stored.response, replayed: true } }; if (existing.exists && String(existing.data()?.status) !== 'REJECTED') conflict('ADMISSION_DOCUMENT_EXISTS', 'Jenis dokumen ini masih menunggu atau sudah terverifikasi.'); transaction.create(ref, document); transaction.set(typeRef, { documentId: id, status: 'PENDING', updatedAt: now }); transaction.create(idemRef, { requestHash: hash, response: document, createdAt: now }); return { document, replayed: false } })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'ADMISSION_DOCUMENT_SUBMITTED', resourceType: 'admission_document', resourceId: id, after: { applicationId: application.id, documentType, fileId, fileVersion: file.currentVersion, checksumSha256: version.sha256, status: 'PENDING' }, event })
  return { document, replayed: false, auditId: audit.id }
}

export async function reviewAdmissionDocument(context: AuthContext, applicationId: string, documentId: string, value: unknown, event?: H3Event, clock = new Date()): Promise<{ document: AdmissionDocumentRecord; checklist: AdmissionDocumentChecklistItem[]; complete: boolean; auditId: string }> {
  const application = await loadApplication(applicationId); requireReviewer(context, application); const id = safeId(documentId, 'documentId'), body = requireRecord(value), extra = Object.keys(body).filter(field => !['status', 'reviewNote', 'expectedVersion'].includes(field)); if (extra.length) invalidInput(`Field tidak didukung: ${extra.join(', ')}.`)
  const status = requireString(body.status, 'status', { max: 20 }) as 'VERIFIED' | 'REJECTED'; if (!['VERIFIED', 'REJECTED'].includes(status)) invalidInput('Keputusan dokumen harus VERIFIED atau REJECTED.')
  const reviewNote = cleanNote(body.reviewNote, 'reviewNote'), expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 1), now = clock.toISOString()
  const update = (before: AdmissionDocumentRecord) => { if (before.applicationId !== application.id) notFound('Dokumen PMB'); if (before.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Dokumen PMB telah berubah.', { currentVersion: before.version }); if (before.status !== 'PENDING') conflict('ADMISSION_DOCUMENT_REVIEWED', 'Dokumen PMB sudah ditinjau.'); return { ...before, status, version: before.version + 1, reviewedAt: now, reviewedBy: context.uid, reviewNote, updatedAt: now } }
  let document: AdmissionDocumentRecord
  if (dataMode() === 'mock') { const before = admissionModuleState().documents.get(id); if (!before) notFound('Dokumen PMB'); document = update(clone(before)); admissionModuleState().documents.set(id, clone(document)) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan dokumen PMB tidak tersedia.'); const ref = db.collection('admissionDocuments').doc(id); document = await db.runTransaction(async transaction => { const snapshot = await transaction.get(ref); if (!snapshot.exists) notFound('Dokumen PMB'); const next = update({ id: snapshot.id, ...snapshot.data() } as AdmissionDocumentRecord); transaction.update(ref, next); transaction.set(db.collection('admissionDocumentKeys').doc(opaqueId('admission_document_key', `${application.id}:${next.documentType}`)), { documentId: id, status, updatedAt: now }); return next }) }
  const items = checklist(application.admissionPathId, await documentsFor(application.id)), complete = items.every(item => item.status === 'VERIFIED')
  const audit = await appendAudit({ actor: context, action: `ADMISSION_DOCUMENT_${status}`, resourceType: 'admission_document', resourceId: id, before: { status: 'PENDING', version: expectedVersion }, after: { status, version: document.version, applicationId: application.id, checklistComplete: complete }, event })
  return { document, checklist: items, complete, auditId: audit.id }
}
