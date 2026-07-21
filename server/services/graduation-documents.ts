import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  DocumentVerificationResult,
  GraduationApplication,
  GraduationDocumentTemplate,
  GraduationDocumentType,
  GraduationPeriod,
  GraduationRenderPayload,
  GraduationTemplateSource,
  IssuedGraduationDocument,
} from '../types/graduation'
import { GRADUATION_DOCUMENT_TYPES } from '../types/graduation'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { graduationModuleState } from './graduation-state'

export interface GraduationTemplateLayoutInput {
  title: string
  subtitle?: string
  fields: Array<{ key: string; label: string; source: GraduationTemplateSource }>
  footerText: string
}

export interface PublishGraduationTemplateInput {
  expectedVersion: number
  name: string
  layout: GraduationTemplateLayoutInput
}

export interface IssueGraduationDocumentInput {
  applicationId: string
  type: GraduationDocumentType
}

export interface RevokeGraduationDocumentInput {
  expectedVersion: number
  reason: string
}

export interface ReissueGraduationDocumentInput {
  expectedVersion: number
  reason: string
}

const TEMPLATE_SOURCES = new Set<GraduationTemplateSource>([
  'studentName', 'studentNumber', 'programStudyName', 'periodName', 'yudisiumDate', 'graduationDate',
  'gpa', 'earnedCredits', 'documentNumber', 'verificationCode', 'issuedAt',
])

const NUMBER_PREFIX: Record<GraduationDocumentType, string> = {
  DECREE: 'SK-YUD',
  DIPLOMA: 'IJZ',
  TRANSCRIPT: 'TRN',
  SKPI: 'SKPI',
}

function isDocumentStaff(context: AuthContext): boolean {
  return hasRole(context, 'academic_staff', 'administrator')
}

function isProgramScoped(context: AuthContext, programStudyId: string): boolean {
  return hasRole(context, 'administrator') || context.scope.programStudyIds.includes(programStudyId)
}

function requireDocumentIssuer(context: AuthContext, programStudyId: string): void {
  if (!isDocumentStaff(context) || !isProgramScoped(context, programStudyId)) {
    forbidden('Penerbitan dokumen berada di luar lingkup program studi Anda.')
  }
}

function canReadDocument(context: AuthContext, document: IssuedGraduationDocument): boolean {
  return document.studentUid === context.uid
    || hasRole(context, 'administrator', 'leader')
    || (hasRole(context, 'academic_staff') && isProgramScoped(context, document.programStudyId))
}

function requireDocumentRead(context: AuthContext, document: IssuedGraduationDocument): void {
  if (!canReadDocument(context, document)) forbidden('Dokumen kelulusan bukan milik Anda.')
}

function validateDocumentType(type: string): asserts type is GraduationDocumentType {
  if (!GRADUATION_DOCUMENT_TYPES.includes(type as GraduationDocumentType)) invalidInput('Jenis dokumen kelulusan tidak valid.')
}

function cleanText(value: string, label: string, maximum: number): string {
  const text = value.trim()
  if (!text || text.length > maximum || /[<>]/.test(text)) invalidInput(`${label} tidak valid.`)
  return text
}

function validateTemplateLayout(layout: GraduationTemplateLayoutInput): GraduationTemplateLayoutInput {
  if (!Array.isArray(layout.fields) || !layout.fields.length || layout.fields.length > 30) invalidInput('Kolom template harus berisi 1-30 item.')
  const keys = new Set<string>()
  const fields = layout.fields.map((field) => {
    const key = cleanText(field.key, 'Kunci kolom', 60)
    if (!/^[a-z][a-z0-9_]*$/.test(key) || keys.has(key)) invalidInput('Kunci kolom template harus unik dan menggunakan snake_case.')
    keys.add(key)
    if (!TEMPLATE_SOURCES.has(field.source)) invalidInput('Sumber kolom template tidak didukung.')
    return { key, label: cleanText(field.label, 'Label kolom', 120), source: field.source }
  })
  return {
    title: cleanText(layout.title, 'Judul template', 180),
    ...(layout.subtitle?.trim() ? { subtitle: cleanText(layout.subtitle, 'Subjudul template', 180) } : {}),
    fields,
    footerText: cleanText(layout.footerText, 'Teks kaki template', 500),
  }
}

async function loadApplication(id: string): Promise<GraduationApplication> {
  if (dataMode() === 'mock') {
    const application = graduationModuleState().applications.get(id)
    if (!application) notFound('Pengajuan kelulusan')
    return structuredClone(application)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
  const snapshot = await db.collection('graduationApplications').doc(id).get()
  if (!snapshot.exists) notFound('Pengajuan kelulusan')
  return { id: snapshot.id, ...snapshot.data() } as GraduationApplication
}

async function loadPeriod(id: string): Promise<GraduationPeriod> {
  if (dataMode() === 'mock') {
    const period = graduationModuleState().periods.get(id)
    if (!period) notFound('Periode kelulusan')
    return structuredClone(period)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
  const snapshot = await db.collection('graduationPeriods').doc(id).get()
  if (!snapshot.exists) notFound('Periode kelulusan')
  return { id: snapshot.id, ...snapshot.data() } as GraduationPeriod
}

async function loadDocument(id: string): Promise<IssuedGraduationDocument> {
  if (dataMode() === 'mock') {
    const document = graduationModuleState().documents.get(id)
    if (!document) notFound('Dokumen kelulusan')
    return structuredClone(document)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
  const snapshot = await db.collection('issuedGraduationDocuments').doc(id).get()
  if (!snapshot.exists) notFound('Dokumen kelulusan')
  return { id: snapshot.id, ...snapshot.data() } as IssuedGraduationDocument
}

async function loadActiveTemplate(type: GraduationDocumentType, programStudyId: string): Promise<GraduationDocumentTemplate> {
  if (dataMode() === 'mock') {
    const candidates = [...graduationModuleState().templates.values()]
      .filter(template => template.type === type && template.status === 'ACTIVE'
        && (!template.programStudyId || template.programStudyId === programStudyId))
      .sort((left, right) => Number(Boolean(right.programStudyId)) - Number(Boolean(left.programStudyId)) || right.version - left.version)
    if (!candidates[0]) notFound(`Template aktif ${type}`)
    return structuredClone(candidates[0])
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
  const snapshot = await db.collection('graduationDocumentTemplates')
    .where('type', '==', type).where('status', '==', 'ACTIVE').limit(50).get()
  const candidates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as GraduationDocumentTemplate)
    .filter(template => !template.programStudyId || template.programStudyId === programStudyId)
    .sort((left, right) => Number(Boolean(right.programStudyId)) - Number(Boolean(left.programStudyId)) || right.version - left.version)
  if (!candidates[0]) notFound(`Template aktif ${type}`)
  return candidates[0]
}

function fieldValue(
  source: GraduationTemplateSource,
  application: GraduationApplication,
  period: GraduationPeriod,
  documentNumber: string,
  verificationCode: string,
  issuedAt: string,
): string {
  const values: Record<GraduationTemplateSource, string> = {
    studentName: application.studentName,
    studentNumber: application.studentNumber,
    programStudyName: application.programStudyName,
    periodName: period.name,
    yudisiumDate: period.yudisiumDate,
    graduationDate: period.graduationDate ?? '-',
    gpa: application.eligibilitySnapshot.academic.gpa.toFixed(2),
    earnedCredits: String(application.eligibilitySnapshot.academic.earnedCredits),
    documentNumber,
    verificationCode,
    issuedAt,
  }
  return values[source]
}

function renderPayload(
  application: GraduationApplication,
  period: GraduationPeriod,
  template: GraduationDocumentTemplate,
  documentNumber: string,
  verificationCode: string,
  issuedAt: string,
): GraduationRenderPayload {
  return {
    documentType: template.type,
    documentNumber,
    verificationCode,
    issuedAt,
    title: template.layout.title,
    ...(template.layout.subtitle ? { subtitle: template.layout.subtitle } : {}),
    subject: {
      studentName: application.studentName,
      studentNumber: application.studentNumber,
      programStudyName: application.programStudyName,
      periodName: period.name,
    },
    fields: template.layout.fields.map(field => ({
      key: field.key,
      label: field.label,
      value: fieldValue(field.source, application, period, documentNumber, verificationCode, issuedAt),
    })),
    footerText: template.layout.footerText,
    limitation: 'DETERMINISTIC_RENDER_PAYLOAD_ONLY_NO_CREDENTIAL_PDF',
  }
}

export function graduationDocumentContentHash(
  templateSnapshot: GraduationDocumentTemplate,
  payload: GraduationRenderPayload,
): string {
  return requestHash({ templateSnapshot, renderPayload: payload })
}

export function verifyIssuedGraduationDocumentHash(document: IssuedGraduationDocument): boolean {
  return graduationDocumentContentHash(document.templateSnapshot, document.renderPayload) === document.contentHash
}

function issuedYear(issuedAt: string): string {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(issuedAt))
}

function counterKey(type: GraduationDocumentType, programStudyId: string, issuedAt: string): string {
  return `${type}:${issuedYear(issuedAt)}:${programStudyId}`
}

function documentNumber(type: GraduationDocumentType, programStudyId: string, issuedAt: string, sequence: number): string {
  const program = programStudyId.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20)
  return `${NUMBER_PREFIX[type]}/${program}/${issuedYear(issuedAt)}/${String(sequence).padStart(5, '0')}`
}

function buildIssuedDocument(input: {
  id: string
  application: GraduationApplication
  period: GraduationPeriod
  template: GraduationDocumentTemplate
  type: GraduationDocumentType
  number: string
  issuedAt: string
  issuedBy: string
  historyAction: 'ISSUED' | 'REISSUED_FROM'
  reissueOf?: string
  reason?: string
}): IssuedGraduationDocument {
  const verificationCode = requestHash({ id: input.id, documentNumber: input.number }).slice(0, 20).toUpperCase()
  const payload = renderPayload(input.application, input.period, input.template, input.number, verificationCode, input.issuedAt)
  const templateSnapshot = structuredClone(input.template)
  return {
    id: input.id,
    applicationId: input.application.id,
    studentId: input.application.studentId,
    studentUid: input.application.studentUid,
    programStudyId: input.application.programStudyId,
    type: input.type,
    documentNumber: input.number,
    verificationCode,
    status: 'ISSUED',
    version: 1,
    templateSnapshot,
    renderPayload: payload,
    contentHash: graduationDocumentContentHash(templateSnapshot, payload),
    issuedAt: input.issuedAt,
    issuedBy: input.issuedBy,
    ...(input.reissueOf ? { reissueOf: input.reissueOf } : {}),
    history: [{
      action: input.historyAction,
      actorUid: input.issuedBy,
      occurredAt: input.issuedAt,
      ...(input.reissueOf ? { relatedDocumentId: input.reissueOf } : {}),
      ...(input.reason ? { reason: input.reason.slice(0, 500) } : {}),
    }],
  }
}

function ensureIssuable(application: GraduationApplication): void {
  if (!['FINAL_APPROVED', 'GRADUATED'].includes(application.status)) {
    conflict('APPLICATION_NOT_FINAL_APPROVED', 'Dokumen hanya dapat diterbitkan setelah persetujuan final.')
  }
}

export async function listGraduationTemplates(context: AuthContext): Promise<GraduationDocumentTemplate[]> {
  if (!hasRole(context, 'academic_staff', 'leader', 'administrator')) forbidden()
  const visible = (template: GraduationDocumentTemplate) => hasRole(context, 'administrator', 'leader')
    || !template.programStudyId || context.scope.programStudyIds.includes(template.programStudyId)
  if (dataMode() === 'mock') {
    return [...graduationModuleState().templates.values()]
      .map(template => structuredClone(template))
      .filter(visible)
      .sort((left, right) => left.type.localeCompare(right.type) || right.version - left.version)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
  const snapshot = await db.collection('graduationDocumentTemplates').limit(200).get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as GraduationDocumentTemplate)
    .filter(visible)
    .sort((left, right) => left.type.localeCompare(right.type) || right.version - left.version)
}

export async function publishGraduationTemplate(
  context: AuthContext,
  sourceTemplateId: string,
  input: PublishGraduationTemplateInput,
  idempotencyKey: string,
  event?: H3Event,
): Promise<{ template: GraduationDocumentTemplate; replayed: boolean; auditId?: string }> {
  if (!hasRole(context, 'administrator')) forbidden('Hanya administrator yang dapat menerbitkan versi template.')
  const layout = validateTemplateLayout(input.layout)
  const name = cleanText(input.name, 'Nama template', 160)
  const hash = requestHash({ sourceTemplateId, input: { ...input, name, layout } })
  const namespace = `graduation-template:${idempotencyKey}`
  const now = new Date().toISOString()
  const id = opaqueId('grad_template', namespace)

  if (dataMode() === 'mock') {
    const state = graduationModuleState()
    const previous = state.idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { template: structuredClone((previous.response as { template: GraduationDocumentTemplate }).template), replayed: true }
    }
    const source = state.templates.get(sourceTemplateId)
    if (!source) notFound('Template dokumen kelulusan')
    if (source.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Template telah berubah.', { currentVersion: source.version })
    if (source.status !== 'ACTIVE') conflict('TEMPLATE_NOT_ACTIVE', 'Versi sumber template tidak lagi aktif.')
    const retired = { ...source, status: 'RETIRED' as const, updatedAt: now, updatedBy: context.uid }
    const template: GraduationDocumentTemplate = {
      ...source,
      id,
      name,
      version: source.version + 1,
      status: 'ACTIVE',
      layout,
      createdAt: now,
      updatedAt: now,
      updatedBy: context.uid,
    }
    state.templates.set(source.id, structuredClone(retired))
    state.templates.set(template.id, structuredClone(template))
    state.idempotency.set(namespace, { requestHash: hash, response: { template } })
    const audit = await appendAudit({ actor: context, action: 'GRADUATION_TEMPLATE_PUBLISHED', resourceType: 'graduation_document_template', resourceId: id, before: { sourceTemplateId, version: source.version }, after: { version: template.version, type: template.type }, event })
    return { template, replayed: false, auditId: audit.id }
  }

  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
  const sourceReference = db.collection('graduationDocumentTemplates').doc(sourceTemplateId)
  const targetReference = db.collection('graduationDocumentTemplates').doc(id)
  const idemReference = db.collection('graduationIdempotency').doc(opaqueId('idem', namespace))
  const result = await db.runTransaction(async (transaction) => {
    const [previous, sourceSnapshot] = await Promise.all([transaction.get(idemReference), transaction.get(sourceReference)])
    if (previous.exists) {
      const data = previous.data() as { requestHash: string; template: GraduationDocumentTemplate }
      if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { template: data.template, replayed: true }
    }
    if (!sourceSnapshot.exists) notFound('Template dokumen kelulusan')
    const source = { id: sourceSnapshot.id, ...sourceSnapshot.data() } as GraduationDocumentTemplate
    if (source.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Template telah berubah.', { currentVersion: source.version })
    if (source.status !== 'ACTIVE') conflict('TEMPLATE_NOT_ACTIVE', 'Versi sumber template tidak lagi aktif.')
    const template: GraduationDocumentTemplate = {
      ...source, id, name, version: source.version + 1, status: 'ACTIVE', layout,
      createdAt: now, updatedAt: now, updatedBy: context.uid,
    }
    transaction.set(sourceReference, { ...source, status: 'RETIRED', updatedAt: now, updatedBy: context.uid })
    transaction.create(targetReference, template)
    transaction.create(idemReference, { requestHash: hash, template, createdAt: now })
    return { template, replayed: false }
  })
  if (result.replayed) return result
  const audit = await appendAudit({ actor: context, action: 'GRADUATION_TEMPLATE_PUBLISHED', resourceType: 'graduation_document_template', resourceId: id, after: { version: result.template.version, type: result.template.type }, event })
  return { ...result, auditId: audit.id }
}

export async function listGraduationDocuments(
  context: AuthContext,
  filters: { applicationId?: string; type?: GraduationDocumentType } = {},
): Promise<IssuedGraduationDocument[]> {
  if (filters.type) validateDocumentType(filters.type)
  let documents: IssuedGraduationDocument[]
  if (dataMode() === 'mock') {
    documents = [...graduationModuleState().documents.values()].map(document => structuredClone(document))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
    if (!hasRole(context, 'administrator', 'leader', 'academic_staff')) {
      const snapshot = await db.collection('issuedGraduationDocuments').where('studentUid', '==', context.uid).limit(100).get()
      documents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as IssuedGraduationDocument)
    } else if (hasRole(context, 'academic_staff') && !hasRole(context, 'administrator', 'leader')) {
      const scopes = context.scope.programStudyIds
      if (!scopes.length) return []
      const chunks = Array.from({ length: Math.ceil(scopes.length / 30) }, (_, index) => scopes.slice(index * 30, index * 30 + 30))
      const snapshots = await Promise.all(chunks.map(chunk => db.collection('issuedGraduationDocuments').where('programStudyId', 'in', chunk).limit(200).get()))
      documents = snapshots.flatMap(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as IssuedGraduationDocument))
    } else {
      const snapshot = await db.collection('issuedGraduationDocuments').limit(500).get()
      documents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as IssuedGraduationDocument)
    }
  }
  return documents
    .filter(document => canReadDocument(context, document))
    .filter(document => !filters.applicationId || document.applicationId === filters.applicationId)
    .filter(document => !filters.type || document.type === filters.type)
    .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt))
}

export async function getGraduationDocument(context: AuthContext, id: string): Promise<IssuedGraduationDocument> {
  const document = await loadDocument(id)
  requireDocumentRead(context, document)
  return document
}

export async function issueGraduationDocument(
  context: AuthContext,
  input: IssueGraduationDocumentInput,
  idempotencyKey: string,
  event?: H3Event,
): Promise<{ document: IssuedGraduationDocument; replayed: boolean; auditId?: string }> {
  validateDocumentType(input.type)
  const application = await loadApplication(input.applicationId)
  requireDocumentIssuer(context, application.programStudyId)
  const hash = requestHash(input)
  const namespace = `graduation-document-issue:${idempotencyKey}`
  const now = new Date().toISOString()
  const id = opaqueId('grad_document', namespace)

  if (dataMode() === 'mock') {
    const state = graduationModuleState()
    const previous = state.idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { document: structuredClone((previous.response as { document: IssuedGraduationDocument }).document), replayed: true }
    }
    ensureIssuable(application)
    const [period, template] = await Promise.all([loadPeriod(application.periodId), loadActiveTemplate(input.type, application.programStudyId)])
    const assignmentKey = `${application.id}:${input.type}`
    if (state.assignments.has(assignmentKey)) conflict('DOCUMENT_ALREADY_ASSIGNED', 'Jenis dokumen ini sudah diterbitkan untuk pengajuan tersebut.')
    const key = counterKey(input.type, application.programStudyId, now)
    const sequence = (state.counters.get(key) ?? 0) + 1
    const number = documentNumber(input.type, application.programStudyId, now, sequence)
    const document = buildIssuedDocument({ id, application, period, template, type: input.type, number, issuedAt: now, issuedBy: context.uid, historyAction: 'ISSUED' })
    state.counters.set(key, sequence)
    state.assignments.set(assignmentKey, id)
    state.documents.set(id, structuredClone(document))
    state.idempotency.set(namespace, { requestHash: hash, response: { document } })
    const audit = await appendAudit({ actor: context, action: 'GRADUATION_DOCUMENT_ISSUED', resourceType: 'issued_graduation_document', resourceId: id, after: { applicationId: application.id, type: input.type, documentNumber: number, contentHash: document.contentHash }, event })
    return { document, replayed: false, auditId: audit.id }
  }

  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
  const idemReference = db.collection('graduationIdempotency').doc(opaqueId('idem', namespace))
  const earlyReplay = await idemReference.get()
  if (earlyReplay.exists) {
    const data = earlyReplay.data() as { requestHash: string; document: IssuedGraduationDocument }
    if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
    return { document: data.document, replayed: true }
  }
  ensureIssuable(application)
  const [period, template] = await Promise.all([loadPeriod(application.periodId), loadActiveTemplate(input.type, application.programStudyId)])
  const key = counterKey(input.type, application.programStudyId, now)
  const counterReference = db.collection('graduationDocumentCounters').doc(opaqueId('counter', key))
  const assignmentKey = `${application.id}:${input.type}`
  const assignmentReference = db.collection('graduationDocumentAssignments').doc(opaqueId('assignment', assignmentKey))
  const applicationReference = db.collection('graduationApplications').doc(application.id)
  const documentReference = db.collection('issuedGraduationDocuments').doc(id)
  const result = await db.runTransaction(async (transaction) => {
    const [previous, currentApplicationSnapshot, counterSnapshot, assignmentSnapshot] = await Promise.all([
      transaction.get(idemReference), transaction.get(applicationReference), transaction.get(counterReference), transaction.get(assignmentReference),
    ])
    if (previous.exists) {
      const data = previous.data() as { requestHash: string; document: IssuedGraduationDocument }
      if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { document: data.document, replayed: true }
    }
    if (!currentApplicationSnapshot.exists) notFound('Pengajuan kelulusan')
    const currentApplication = { id: currentApplicationSnapshot.id, ...currentApplicationSnapshot.data() } as GraduationApplication
    requireDocumentIssuer(context, currentApplication.programStudyId)
    ensureIssuable(currentApplication)
    if (assignmentSnapshot.exists) conflict('DOCUMENT_ALREADY_ASSIGNED', 'Jenis dokumen ini sudah diterbitkan untuk pengajuan tersebut.')
    const sequence = Number(counterSnapshot.data()?.value ?? 0) + 1
    const number = documentNumber(input.type, currentApplication.programStudyId, now, sequence)
    const document = buildIssuedDocument({ id, application: currentApplication, period, template, type: input.type, number, issuedAt: now, issuedBy: context.uid, historyAction: 'ISSUED' })
    transaction.set(counterReference, { key, value: sequence, updatedAt: now })
    transaction.create(assignmentReference, { applicationId: currentApplication.id, type: input.type, documentId: id, createdAt: now, updatedAt: now })
    transaction.create(documentReference, document)
    transaction.create(idemReference, { requestHash: hash, document, createdAt: now })
    return { document, replayed: false }
  })
  if (result.replayed) return result
  const audit = await appendAudit({ actor: context, action: 'GRADUATION_DOCUMENT_ISSUED', resourceType: 'issued_graduation_document', resourceId: id, after: { applicationId: application.id, type: input.type, documentNumber: result.document.documentNumber, contentHash: result.document.contentHash }, event })
  return { ...result, auditId: audit.id }
}

export async function revokeGraduationDocument(
  context: AuthContext,
  id: string,
  input: RevokeGraduationDocumentInput,
  idempotencyKey: string,
  event?: H3Event,
): Promise<{ document: IssuedGraduationDocument; replayed: boolean; auditId?: string }> {
  const current = await loadDocument(id)
  requireDocumentIssuer(context, current.programStudyId)
  const reason = cleanText(input.reason, 'Alasan pencabutan', 500)
  const hash = requestHash({ id, expectedVersion: input.expectedVersion, reason })
  const namespace = `graduation-document-revoke:${idempotencyKey}`
  const now = new Date().toISOString()

  const revoke = (document: IssuedGraduationDocument): IssuedGraduationDocument => {
    if (document.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Dokumen telah berubah.', { currentVersion: document.version })
    if (document.status !== 'ISSUED') conflict('DOCUMENT_NOT_ISSUED', 'Hanya dokumen aktif yang dapat dicabut.')
    return {
      ...document,
      status: 'REVOKED',
      version: document.version + 1,
      revokedAt: now,
      revokedBy: context.uid,
      revocationReason: reason,
      history: [...document.history, { action: 'REVOKED', actorUid: context.uid, occurredAt: now, reason }],
    }
  }

  let document: IssuedGraduationDocument
  if (dataMode() === 'mock') {
    const state = graduationModuleState()
    const previous = state.idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { document: structuredClone((previous.response as { document: IssuedGraduationDocument }).document), replayed: true }
    }
    document = revoke(current)
    state.documents.set(id, structuredClone(document))
    state.idempotency.set(namespace, { requestHash: hash, response: { document } })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
    const reference = db.collection('issuedGraduationDocuments').doc(id)
    const idemReference = db.collection('graduationIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async (transaction) => {
      const [previous, snapshot] = await Promise.all([transaction.get(idemReference), transaction.get(reference)])
      if (previous.exists) {
        const data = previous.data() as { requestHash: string; document: IssuedGraduationDocument }
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return { document: data.document, replayed: true }
      }
      if (!snapshot.exists) notFound('Dokumen kelulusan')
      const fresh = { id: snapshot.id, ...snapshot.data() } as IssuedGraduationDocument
      requireDocumentIssuer(context, fresh.programStudyId)
      const document = revoke(fresh)
      transaction.set(reference, document)
      transaction.create(idemReference, { requestHash: hash, document, createdAt: now })
      return { document, replayed: false }
    })
    if (result.replayed) return result
    document = result.document
  }
  const audit = await appendAudit({ actor: context, action: 'GRADUATION_DOCUMENT_REVOKED', resourceType: 'issued_graduation_document', resourceId: id, before: { status: current.status, version: current.version }, after: { status: document.status, version: document.version, reason }, event })
  return { document, replayed: false, auditId: audit.id }
}

export async function reissueGraduationDocument(
  context: AuthContext,
  sourceDocumentId: string,
  input: ReissueGraduationDocumentInput,
  idempotencyKey: string,
  event?: H3Event,
): Promise<{ document: IssuedGraduationDocument; sourceDocument: IssuedGraduationDocument; replayed: boolean; auditId?: string }> {
  const source = await loadDocument(sourceDocumentId)
  requireDocumentIssuer(context, source.programStudyId)
  const reason = cleanText(input.reason, 'Alasan penerbitan ulang', 500)
  const hash = requestHash({ sourceDocumentId, expectedVersion: input.expectedVersion, reason })
  const namespace = `graduation-document-reissue:${idempotencyKey}`
  const now = new Date().toISOString()
  const id = opaqueId('grad_document', namespace)

  if (dataMode() === 'mock') {
    const state = graduationModuleState()
    const previous = state.idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { ...(structuredClone(previous.response) as { document: IssuedGraduationDocument; sourceDocument: IssuedGraduationDocument }), replayed: true }
    }
    if (source.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Dokumen telah berubah.', { currentVersion: source.version })
    if (source.status !== 'REVOKED') conflict('DOCUMENT_NOT_REVOKED', 'Penerbitan ulang hanya dapat dilakukan setelah dokumen dicabut.')
    const application = await loadApplication(source.applicationId)
    ensureIssuable(application)
    const [period, template] = await Promise.all([loadPeriod(application.periodId), loadActiveTemplate(source.type, source.programStudyId)])
    const key = counterKey(source.type, source.programStudyId, now)
    const sequence = (state.counters.get(key) ?? 0) + 1
    const number = documentNumber(source.type, source.programStudyId, now, sequence)
    const document = buildIssuedDocument({ id, application, period, template, type: source.type, number, issuedAt: now, issuedBy: context.uid, historyAction: 'REISSUED_FROM', reissueOf: source.id, reason })
    const updatedSource: IssuedGraduationDocument = {
      ...source,
      version: source.version + 1,
      history: [...source.history, { action: 'REISSUED_AS', actorUid: context.uid, occurredAt: now, relatedDocumentId: id, reason }],
    }
    state.counters.set(key, sequence)
    state.assignments.set(`${source.applicationId}:${source.type}`, id)
    state.documents.set(source.id, structuredClone(updatedSource))
    state.documents.set(id, structuredClone(document))
    state.idempotency.set(namespace, { requestHash: hash, response: { document, sourceDocument: updatedSource } })
    const audit = await appendAudit({ actor: context, action: 'GRADUATION_DOCUMENT_REISSUED', resourceType: 'issued_graduation_document', resourceId: id, before: { sourceDocumentId: source.id, sourceNumber: source.documentNumber }, after: { documentNumber: number, contentHash: document.contentHash }, event })
    return { document, sourceDocument: updatedSource, replayed: false, auditId: audit.id }
  }

  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
  const idemReference = db.collection('graduationIdempotency').doc(opaqueId('idem', namespace))
  const earlyReplay = await idemReference.get()
  if (earlyReplay.exists) {
    const data = earlyReplay.data() as { requestHash: string; document: IssuedGraduationDocument; sourceDocument: IssuedGraduationDocument }
    if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
    return { document: data.document, sourceDocument: data.sourceDocument, replayed: true }
  }
  if (source.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Dokumen telah berubah.', { currentVersion: source.version })
  if (source.status !== 'REVOKED') conflict('DOCUMENT_NOT_REVOKED', 'Penerbitan ulang hanya dapat dilakukan setelah dokumen dicabut.')
  const application = await loadApplication(source.applicationId)
  ensureIssuable(application)
  const [period, template] = await Promise.all([loadPeriod(application.periodId), loadActiveTemplate(source.type, source.programStudyId)])
  const key = counterKey(source.type, source.programStudyId, now)
  const counterReference = db.collection('graduationDocumentCounters').doc(opaqueId('counter', key))
  const assignmentReference = db.collection('graduationDocumentAssignments').doc(opaqueId('assignment', `${source.applicationId}:${source.type}`))
  const sourceReference = db.collection('issuedGraduationDocuments').doc(source.id)
  const targetReference = db.collection('issuedGraduationDocuments').doc(id)
  const applicationReference = db.collection('graduationApplications').doc(source.applicationId)
  const result = await db.runTransaction(async (transaction) => {
    const [previous, sourceSnapshot, currentApplicationSnapshot, counterSnapshot, assignmentSnapshot] = await Promise.all([
      transaction.get(idemReference), transaction.get(sourceReference), transaction.get(applicationReference),
      transaction.get(counterReference), transaction.get(assignmentReference),
    ])
    if (previous.exists) {
      const data = previous.data() as { requestHash: string; document: IssuedGraduationDocument; sourceDocument: IssuedGraduationDocument }
      if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { document: data.document, sourceDocument: data.sourceDocument, replayed: true }
    }
    if (!sourceSnapshot.exists) notFound('Dokumen kelulusan')
    if (!currentApplicationSnapshot.exists) notFound('Pengajuan kelulusan')
    const freshSource = { id: sourceSnapshot.id, ...sourceSnapshot.data() } as IssuedGraduationDocument
    const freshApplication = { id: currentApplicationSnapshot.id, ...currentApplicationSnapshot.data() } as GraduationApplication
    requireDocumentIssuer(context, freshSource.programStudyId)
    if (freshSource.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Dokumen telah berubah.', { currentVersion: freshSource.version })
    if (freshSource.status !== 'REVOKED') conflict('DOCUMENT_NOT_REVOKED', 'Penerbitan ulang hanya dapat dilakukan setelah dokumen dicabut.')
    ensureIssuable(freshApplication)
    if (!assignmentSnapshot.exists || assignmentSnapshot.data()?.documentId !== freshSource.id) conflict('DOCUMENT_ASSIGNMENT_CHANGED', 'Penetapan dokumen telah berubah.')
    const sequence = Number(counterSnapshot.data()?.value ?? 0) + 1
    const number = documentNumber(freshSource.type, freshSource.programStudyId, now, sequence)
    const document = buildIssuedDocument({ id, application: freshApplication, period, template, type: freshSource.type, number, issuedAt: now, issuedBy: context.uid, historyAction: 'REISSUED_FROM', reissueOf: freshSource.id, reason })
    const updatedSource: IssuedGraduationDocument = { ...freshSource, version: freshSource.version + 1, history: [...freshSource.history, { action: 'REISSUED_AS', actorUid: context.uid, occurredAt: now, relatedDocumentId: id, reason }] }
    transaction.set(counterReference, { key, value: sequence, updatedAt: now })
    transaction.set(assignmentReference, { applicationId: freshApplication.id, type: freshSource.type, documentId: id, createdAt: assignmentSnapshot.data()?.createdAt ?? now, updatedAt: now })
    transaction.set(sourceReference, updatedSource)
    transaction.create(targetReference, document)
    transaction.create(idemReference, { requestHash: hash, document, sourceDocument: updatedSource, createdAt: now })
    return { document, sourceDocument: updatedSource, replayed: false }
  })
  if (result.replayed) return result
  const audit = await appendAudit({ actor: context, action: 'GRADUATION_DOCUMENT_REISSUED', resourceType: 'issued_graduation_document', resourceId: id, before: { sourceDocumentId: source.id, sourceNumber: source.documentNumber }, after: { documentNumber: result.document.documentNumber, contentHash: result.document.contentHash }, event })
  return { ...result, auditId: audit.id }
}

export async function verifyGraduationDocument(
  context: AuthContext,
  verificationCode: string,
): Promise<DocumentVerificationResult> {
  const code = cleanText(verificationCode.toUpperCase(), 'Kode verifikasi', 40)
  let document: IssuedGraduationDocument | undefined
  if (dataMode() === 'mock') {
    document = [...graduationModuleState().documents.values()].find(item => item.verificationCode === code)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
    const snapshot = await db.collection('issuedGraduationDocuments').where('verificationCode', '==', code).limit(1).get()
    const first = snapshot.docs[0]
    if (first) document = { id: first.id, ...first.data() } as IssuedGraduationDocument
  }
  if (!document) return { valid: false, verificationCode: code }
  if (!canReadDocument(context, document)) return { valid: false, verificationCode: code }
  const contentHashMatches = verifyIssuedGraduationDocumentHash(document)
  return {
    valid: document.status === 'ISSUED' && contentHashMatches,
    verificationCode: code,
    status: document.status,
    documentType: document.type,
    documentNumber: document.documentNumber,
    issuedAt: document.issuedAt,
    contentHashMatches,
  }
}
