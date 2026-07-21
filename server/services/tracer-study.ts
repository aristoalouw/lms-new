import { createHash, randomBytes } from 'node:crypto'
import { FieldValue } from 'firebase-admin/firestore'
import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { IssuedGraduationDocument } from '../types/graduation'
import {
  TRACER_EMPLOYMENT_STATUSES,
  TRACER_INCOME_RANGES,
  TRACER_QUESTION_TYPES,
  type IssuedSkpiReference,
  type TracerAccessView,
  type TracerAlumniProfile,
  type TracerAnswer,
  type TracerAnswerValue,
  type TracerCareerData,
  type TracerConsentRecord,
  type TracerDistributionPeriod,
  type TracerOpaqueTokenRecord,
  type TracerOwnAssignment,
  type TracerQuestionDefinition,
  type TracerQuestionnaire,
  type TracerQuestionnaireVersion,
  type TracerRecipient,
  type TracerRespondentMonitorItem,
  type TracerResponse,
  type TracerSubmissionReceipt,
} from '../types/tracer-study'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { graduationModuleState } from './graduation-state'
import { tracerStudyMockState } from './tracer-study-mock'

export interface CreateTracerQuestionnaireInput {
  name: string
  description?: string
  programStudyId: string
  questions: TracerQuestionDefinition[]
}

export interface UpdateTracerQuestionnaireInput extends CreateTracerQuestionnaireInput {
  expectedVersion: number
  status?: TracerQuestionnaire['status']
}

export interface CreateTracerPeriodInput {
  name: string
  questionnaireId: string
  questionnaireVersion: number
  programStudyIds: string[]
  graduationYearFrom: number
  graduationYearTo: number
  opensAt: string
  closesAt: string
  accessTokenTtlHours: number
  minimumCellSize: number
  consentVersion: string
  consentNotice: string
}

export interface UpdateTracerPeriodInput extends Omit<CreateTracerPeriodInput, 'questionnaireId' | 'questionnaireVersion'> {
  expectedVersion: number
  status: TracerDistributionPeriod['status']
}

export interface SubmitTracerResponseInput {
  accessToken?: string
  recipientId?: string
  consentAccepted: boolean
  consentVersion: string
  career: TracerCareerData
  answers: TracerAnswer[]
}

export interface WithdrawTracerConsentInput {
  withdrawalToken?: string
  responseId?: string
  expectedConsentVersion: number
}

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,79}$/
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
const publicActor = (now = Date.now()): AuthContext => ({
  uid: 'tracer-public-access', displayName: 'Tracer public access', roles: [],
  scope: { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] },
  provider: 'demo', issuedAt: now, expiresAt: now + 60_000,
})

function cleanText(value: string, label: string, maximum: number): string {
  if (typeof value !== 'string') invalidInput(`${label} harus berupa teks.`)
  const text = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text || text.length > maximum || /[<>]/.test(text)) invalidInput(`${label} tidak valid.`)
  return text
}

function cleanOptionalText(value: string | undefined, label: string, maximum: number): string | undefined {
  if (!value?.trim()) return undefined
  return cleanText(value, label, maximum)
}

function cleanId(value: string, label: string): string {
  const id = cleanText(value, label, 80)
  if (!ID_PATTERN.test(id)) invalidInput(`${label} tidak valid.`)
  return id
}

function isoInstant(value: string, label: string): string {
  if (typeof value !== 'string' || value.length > 48 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) invalidInput(`${label} tidak valid.`)
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) invalidInput(`${label} tidak valid.`)
  return parsed.toISOString()
}

function requireInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) invalidInput(`${label} harus berupa bilangan bulat ${minimum}-${maximum}.`)
  return value
}

function uniqueIds(values: string[], label: string): string[] {
  if (!Array.isArray(values) || !values.length || values.length > 30) invalidInput(`${label} harus berisi 1-30 item.`)
  return [...new Set(values.map(value => cleanId(value, label)))]
}

function requireTracerManager(context: AuthContext, programStudyIds: string[]): void {
  if (hasRole(context, 'administrator')) return
  if (!hasRole(context, 'student_affairs_staff') || !programStudyIds.length
    || programStudyIds.some(id => !context.scope.programStudyIds.includes(id))) {
    forbidden('Tracer study berada di luar lingkup program studi Anda.')
  }
}

function requireAggregateReader(context: AuthContext): void {
  if (!hasRole(context, 'student_affairs_staff', 'leader', 'administrator')) forbidden('Laporan tracer study tidak tersedia untuk role Anda.')
}

function validateQuestion(question: TracerQuestionDefinition, index: number): TracerQuestionDefinition {
  if (!question || typeof question !== 'object') invalidInput(`Pertanyaan ${index + 1} tidak valid.`)
  const id = cleanId(question.id, `ID pertanyaan ${index + 1}`)
  if (!TRACER_QUESTION_TYPES.includes(question.type)) invalidInput(`Tipe pertanyaan ${id} tidak valid.`)
  const normalized: TracerQuestionDefinition = {
    id, label: cleanText(question.label, `Label pertanyaan ${id}`, 500), type: question.type, required: Boolean(question.required),
  }
  const helpText = cleanOptionalText(question.helpText, `Bantuan pertanyaan ${id}`, 500)
  if (helpText) normalized.helpText = helpText
  if (question.type === 'SINGLE_CHOICE' || question.type === 'MULTI_CHOICE') {
    if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 30) invalidInput(`Pilihan pertanyaan ${id} harus berisi 2-30 item.`)
    const values = new Set<string>()
    normalized.options = question.options.map((option) => {
      const value = cleanId(option.value, `Nilai pilihan ${id}`)
      if (values.has(value)) invalidInput(`Nilai pilihan pertanyaan ${id} harus unik.`)
      values.add(value)
      return { value, label: cleanText(option.label, `Label pilihan ${id}`, 160) }
    })
  } else if (question.options?.length) invalidInput(`Pertanyaan ${id} tidak menerima daftar pilihan.`)
  if (question.type === 'NUMBER') {
    const minimum = question.minimum ?? 0
    const maximum = question.maximum ?? 1_000_000
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum) invalidInput(`Rentang angka pertanyaan ${id} tidak valid.`)
    normalized.minimum = minimum
    normalized.maximum = maximum
  }
  return normalized
}

function validateQuestions(value: TracerQuestionDefinition[]): TracerQuestionDefinition[] {
  if (!Array.isArray(value) || !value.length || value.length > 50) invalidInput('Kuesioner harus berisi 1-50 pertanyaan.')
  const questions = value.map(validateQuestion)
  if (new Set(questions.map(item => item.id)).size !== questions.length) invalidInput('ID pertanyaan harus unik.')
  return questions
}

function questionnaireVersionId(questionnaireId: string, version: number): string {
  return `${questionnaireId}_v${version}`
}

function normalizeQuestionnaire(input: CreateTracerQuestionnaireInput): CreateTracerQuestionnaireInput {
  return {
    name: cleanText(input.name, 'Nama kuesioner', 160),
    description: cleanOptionalText(input.description, 'Deskripsi kuesioner', 1_000),
    programStudyId: cleanId(input.programStudyId, 'Program studi'),
    questions: validateQuestions(input.questions),
  }
}

function normalizePeriod(input: CreateTracerPeriodInput): CreateTracerPeriodInput {
  const opensAt = isoInstant(input.opensAt, 'Waktu buka')
  const closesAt = isoInstant(input.closesAt, 'Waktu tutup')
  if (Date.parse(opensAt) >= Date.parse(closesAt)) invalidInput('Waktu tutup harus setelah waktu buka.')
  const graduationYearFrom = requireInteger(input.graduationYearFrom, 'Tahun lulus awal', 1990, 2200)
  const graduationYearTo = requireInteger(input.graduationYearTo, 'Tahun lulus akhir', 1990, 2200)
  if (graduationYearFrom > graduationYearTo) invalidInput('Rentang tahun lulus tidak valid.')
  return {
    name: cleanText(input.name, 'Nama periode', 160),
    questionnaireId: cleanId(input.questionnaireId, 'Kuesioner'),
    questionnaireVersion: requireInteger(input.questionnaireVersion, 'Versi kuesioner', 1, 10_000),
    programStudyIds: uniqueIds(input.programStudyIds, 'Program studi'),
    graduationYearFrom, graduationYearTo, opensAt, closesAt,
    accessTokenTtlHours: requireInteger(input.accessTokenTtlHours, 'TTL token', 1, 720),
    minimumCellSize: requireInteger(input.minimumCellSize, 'Batas minimum sel', 3, 50),
    consentVersion: cleanText(input.consentVersion, 'Versi persetujuan', 80),
    consentNotice: cleanText(input.consentNotice, 'Pemberitahuan persetujuan', 2_000),
  }
}

async function getQuestionnaireVersion(questionnaireId: string, version: number): Promise<TracerQuestionnaireVersion> {
  const id = questionnaireVersionId(questionnaireId, version)
  if (dataMode() === 'mock') {
    const definition = tracerStudyMockState().questionnaireVersions.get(id)
    if (!definition) notFound('Versi kuesioner tracer study')
    return structuredClone(definition)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
  const snapshot = await db.collection('tracerQuestionnaireVersions').doc(id).get()
  if (!snapshot.exists) notFound('Versi kuesioner tracer study')
  return { id: snapshot.id, ...snapshot.data() } as TracerQuestionnaireVersion
}

export async function loadTracerPeriod(id: string): Promise<TracerDistributionPeriod> {
  if (dataMode() === 'mock') {
    const period = tracerStudyMockState().periods.get(id)
    if (!period) notFound('Periode tracer study')
    return structuredClone(period)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
  const snapshot = await db.collection('tracerDistributionPeriods').doc(id).get()
  if (!snapshot.exists) notFound('Periode tracer study')
  return { id: snapshot.id, ...snapshot.data() } as TracerDistributionPeriod
}

async function loadRecipient(id: string): Promise<TracerRecipient> {
  if (dataMode() === 'mock') {
    const recipient = tracerStudyMockState().recipients.get(id)
    if (!recipient) notFound('Penerima tracer study')
    return structuredClone(recipient)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
  const snapshot = await db.collection('tracerRecipients').doc(id).get()
  if (!snapshot.exists) notFound('Penerima tracer study')
  return { id: snapshot.id, ...snapshot.data() } as TracerRecipient
}

async function loadAlumniProfile(id: string): Promise<TracerAlumniProfile> {
  if (dataMode() === 'mock') {
    const profile = tracerStudyMockState().alumniProfiles.get(id)
    if (!profile) notFound('Profil alumni')
    return structuredClone(profile)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
  const snapshot = await db.collection('tracerAlumniProfiles').doc(id).get()
  if (!snapshot.exists) notFound('Profil alumni')
  return { id: snapshot.id, ...snapshot.data() } as TracerAlumniProfile
}

export function hashTracerAccessToken(token: string): string {
  if (typeof token !== 'string' || !OPAQUE_TOKEN_PATTERN.test(token)) invalidInput('Token tracer study tidak valid.')
  return createHash('sha256').update(`tracer-study:v1:${token}`).digest('hex')
}

export function generateTracerOpaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

export function tracerTokenRecordId(tokenHash: string): string {
  return opaqueId('tracer_token', tokenHash)
}

export function isTracerPeriodOpen(period: TracerDistributionPeriod, now = Date.now()): boolean {
  return period.status === 'ACTIVE' && now >= Date.parse(period.opensAt) && now < Date.parse(period.closesAt)
}

export async function listTracerQuestionnaires(context: AuthContext): Promise<TracerQuestionnaire[]> {
  if (!hasRole(context, 'student_affairs_staff', 'administrator')) forbidden('Konfigurasi tracer study tidak tersedia untuk role Anda.')
  let records: TracerQuestionnaire[]
  if (dataMode() === 'mock') records = [...tracerStudyMockState().questionnaires.values()].map(item => structuredClone(item))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
    if (hasRole(context, 'administrator')) {
      const snapshot = await db.collection('tracerQuestionnaires').limit(200).get()
      records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as TracerQuestionnaire)
    } else {
      const scopes = context.scope.programStudyIds
      if (!scopes.length) return []
      const chunks = Array.from({ length: Math.ceil(scopes.length / 30) }, (_, index) => scopes.slice(index * 30, index * 30 + 30))
      const snapshots = await Promise.all(chunks.map(chunk => db.collection('tracerQuestionnaires').where('programStudyId', 'in', chunk).limit(200).get()))
      records = snapshots.flatMap(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as TracerQuestionnaire))
    }
  }
  return records.filter(item => hasRole(context, 'administrator') || context.scope.programStudyIds.includes(item.programStudyId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function createTracerQuestionnaire(
  context: AuthContext,
  input: CreateTracerQuestionnaireInput,
  idempotencyKey: string,
  event?: H3Event,
): Promise<{ questionnaire: TracerQuestionnaire; definition: TracerQuestionnaireVersion; replayed: boolean; auditId?: string }> {
  const normalized = normalizeQuestionnaire(input)
  requireTracerManager(context, [normalized.programStudyId])
  const hash = requestHash(normalized)
  const namespace = `questionnaire:create:${idempotencyKey}`
  const id = opaqueId('tracer_questionnaire', `${context.uid}:${idempotencyKey}`)
  const now = new Date().toISOString()
  const questionnaire: TracerQuestionnaire = {
    id, name: normalized.name, description: normalized.description, programStudyId: normalized.programStudyId,
    currentVersion: 1, version: 1, status: 'ACTIVE', createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid,
  }
  const definition: TracerQuestionnaireVersion = {
    id: questionnaireVersionId(id, 1), questionnaireId: id, version: 1, name: normalized.name,
    description: normalized.description, questions: normalized.questions, createdAt: now, createdBy: context.uid,
  }
  const response = { questionnaire, definition, replayed: false }
  if (dataMode() === 'mock') {
    const previous = tracerStudyMockState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { ...(structuredClone(previous.response) as typeof response), replayed: true }
    }
    tracerStudyMockState().questionnaires.set(id, structuredClone(questionnaire))
    tracerStudyMockState().questionnaireVersions.set(definition.id, structuredClone(definition))
    tracerStudyMockState().idempotency.set(namespace, { requestHash: hash, response: structuredClone(response) })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
    const idem = db.collection('tracerStudyIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async (transaction) => {
      const prior = await transaction.get(idem)
      if (prior.exists) {
        const stored = prior.data() as { requestHash: string; response: typeof response }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return { ...stored.response, replayed: true }
      }
      transaction.create(db.collection('tracerQuestionnaires').doc(id), questionnaire)
      transaction.create(db.collection('tracerQuestionnaireVersions').doc(definition.id), definition)
      transaction.create(idem, { requestHash: hash, response, createdAt: now })
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'TRACER_QUESTIONNAIRE_CREATED', resourceType: 'tracer_questionnaire', resourceId: id, after: { programStudyId: questionnaire.programStudyId, version: 1 }, event })
  return { ...response, auditId: audit.id }
}

export async function updateTracerQuestionnaire(
  context: AuthContext,
  id: string,
  input: UpdateTracerQuestionnaireInput,
  event?: H3Event,
): Promise<{ questionnaire: TracerQuestionnaire; definition: TracerQuestionnaireVersion; auditId: string }> {
  const normalized = normalizeQuestionnaire(input)
  requireTracerManager(context, [normalized.programStudyId])
  const expectedVersion = requireInteger(input.expectedVersion, 'Versi yang diharapkan', 1, 10_000)
  const status = input.status ?? 'ACTIVE'
  if (!['ACTIVE', 'ARCHIVED'].includes(status)) invalidInput('Status kuesioner tidak valid.')
  const now = new Date().toISOString()
  let questionnaire: TracerQuestionnaire
  let definition: TracerQuestionnaireVersion
  if (dataMode() === 'mock') {
    const current = tracerStudyMockState().questionnaires.get(id)
    if (!current) notFound('Kuesioner tracer study')
    requireTracerManager(context, [current.programStudyId])
    if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Kuesioner telah berubah.', { currentVersion: current.version })
    const nextVersion = current.currentVersion + 1
    questionnaire = { ...current, name: normalized.name, description: normalized.description, programStudyId: normalized.programStudyId, currentVersion: nextVersion, version: current.version + 1, status, updatedAt: now, updatedBy: context.uid }
    definition = { id: questionnaireVersionId(id, nextVersion), questionnaireId: id, version: nextVersion, name: normalized.name, description: normalized.description, questions: normalized.questions, createdAt: now, createdBy: context.uid }
    tracerStudyMockState().questionnaires.set(id, structuredClone(questionnaire))
    tracerStudyMockState().questionnaireVersions.set(definition.id, structuredClone(definition))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
    const reference = db.collection('tracerQuestionnaires').doc(id)
    ;({ questionnaire, definition } = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) notFound('Kuesioner tracer study')
      const current = { id: snapshot.id, ...snapshot.data() } as TracerQuestionnaire
      requireTracerManager(context, [current.programStudyId])
      if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Kuesioner telah berubah.', { currentVersion: current.version })
      const nextVersion = current.currentVersion + 1
      const next: TracerQuestionnaire = { ...current, name: normalized.name, description: normalized.description, programStudyId: normalized.programStudyId, currentVersion: nextVersion, version: current.version + 1, status, updatedAt: now, updatedBy: context.uid }
      const nextDefinition: TracerQuestionnaireVersion = { id: questionnaireVersionId(id, nextVersion), questionnaireId: id, version: nextVersion, name: normalized.name, description: normalized.description, questions: normalized.questions, createdAt: now, createdBy: context.uid }
      transaction.set(reference, next)
      transaction.create(db.collection('tracerQuestionnaireVersions').doc(nextDefinition.id), nextDefinition)
      return { questionnaire: next, definition: nextDefinition }
    }))
  }
  const audit = await appendAudit({ actor: context, action: 'TRACER_QUESTIONNAIRE_UPDATED', resourceType: 'tracer_questionnaire', resourceId: id, before: { version: expectedVersion }, after: { version: questionnaire.version, definitionVersion: questionnaire.currentVersion, status }, event })
  return { questionnaire, definition, auditId: audit.id }
}

export async function listTracerPeriods(context: AuthContext): Promise<TracerDistributionPeriod[]> {
  requireAggregateReader(context)
  let periods: TracerDistributionPeriod[]
  if (dataMode() === 'mock') periods = [...tracerStudyMockState().periods.values()].map(item => structuredClone(item))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
    const snapshot = await db.collection('tracerDistributionPeriods').limit(200).get()
    periods = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as TracerDistributionPeriod)
  }
  return periods.filter(period => hasRole(context, 'administrator', 'leader') || period.programStudyIds.some(id => context.scope.programStudyIds.includes(id)))
    .sort((left, right) => right.opensAt.localeCompare(left.opensAt))
}

export async function createTracerPeriod(
  context: AuthContext,
  input: CreateTracerPeriodInput,
  idempotencyKey: string,
  event?: H3Event,
): Promise<{ period: TracerDistributionPeriod; replayed: boolean; auditId?: string }> {
  const normalized = normalizePeriod(input)
  requireTracerManager(context, normalized.programStudyIds)
  const definition = await getQuestionnaireVersion(normalized.questionnaireId, normalized.questionnaireVersion)
  const questionnaireProgram = dataMode() === 'mock'
    ? tracerStudyMockState().questionnaires.get(normalized.questionnaireId)?.programStudyId
    : undefined
  if (questionnaireProgram && !normalized.programStudyIds.includes(questionnaireProgram)) invalidInput('Kuesioner tidak sesuai dengan target program studi.')
  if (definition.questionnaireId !== normalized.questionnaireId) invalidInput('Versi kuesioner tidak valid.')
  const hash = requestHash(normalized)
  const namespace = `period:create:${idempotencyKey}`
  const id = opaqueId('tracer_period', `${context.uid}:${idempotencyKey}`)
  const now = new Date().toISOString()
  const period: TracerDistributionPeriod = { ...normalized, id, status: 'DRAFT', version: 1, createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid }
  const response = { period, replayed: false }
  if (dataMode() === 'mock') {
    const previous = tracerStudyMockState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { ...(structuredClone(previous.response) as typeof response), replayed: true }
    }
    tracerStudyMockState().periods.set(id, structuredClone(period))
    tracerStudyMockState().idempotency.set(namespace, { requestHash: hash, response: structuredClone(response) })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
    const idem = db.collection('tracerStudyIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async (transaction) => {
      const [prior, definitionSnapshot] = await Promise.all([transaction.get(idem), transaction.get(db.collection('tracerQuestionnaireVersions').doc(definition.id))])
      if (prior.exists) {
        const stored = prior.data() as { requestHash: string; response: typeof response }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return { ...stored.response, replayed: true }
      }
      if (!definitionSnapshot.exists) notFound('Versi kuesioner tracer study')
      transaction.create(db.collection('tracerDistributionPeriods').doc(id), period)
      transaction.create(idem, { requestHash: hash, response, createdAt: now })
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'TRACER_PERIOD_CREATED', resourceType: 'tracer_distribution_period', resourceId: id, after: { status: period.status, programStudyIds: period.programStudyIds, questionnaireVersion: period.questionnaireVersion }, event })
  return { ...response, auditId: audit.id }
}

function validPeriodTransition(from: TracerDistributionPeriod['status'], to: TracerDistributionPeriod['status']): boolean {
  return from === to || (from === 'DRAFT' && to === 'ACTIVE') || (from === 'ACTIVE' && to === 'CLOSED') || (from === 'DRAFT' && to === 'CLOSED')
}

export async function updateTracerPeriod(
  context: AuthContext,
  id: string,
  input: UpdateTracerPeriodInput,
  event?: H3Event,
): Promise<{ period: TracerDistributionPeriod; auditId: string }> {
  const normalized = normalizePeriod({ ...input, questionnaireId: 'placeholder', questionnaireVersion: 1 })
  const expectedVersion = requireInteger(input.expectedVersion, 'Versi yang diharapkan', 1, 10_000)
  if (!['DRAFT', 'ACTIVE', 'CLOSED'].includes(input.status)) invalidInput('Status periode tidak valid.')
  requireTracerManager(context, normalized.programStudyIds)
  const now = new Date().toISOString()
  let period: TracerDistributionPeriod
  if (dataMode() === 'mock') {
    const current = tracerStudyMockState().periods.get(id)
    if (!current) notFound('Periode tracer study')
    requireTracerManager(context, current.programStudyIds)
    if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Periode telah berubah.', { currentVersion: current.version })
    if (!validPeriodTransition(current.status, input.status)) conflict('INVALID_STATE_TRANSITION', `Periode tidak dapat berubah dari ${current.status} ke ${input.status}.`)
    period = { ...current, ...normalized, questionnaireId: current.questionnaireId, questionnaireVersion: current.questionnaireVersion, status: input.status, version: current.version + 1, updatedAt: now, updatedBy: context.uid }
    tracerStudyMockState().periods.set(id, structuredClone(period))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
    const reference = db.collection('tracerDistributionPeriods').doc(id)
    period = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) notFound('Periode tracer study')
      const current = { id: snapshot.id, ...snapshot.data() } as TracerDistributionPeriod
      requireTracerManager(context, current.programStudyIds)
      if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Periode telah berubah.', { currentVersion: current.version })
      if (!validPeriodTransition(current.status, input.status)) conflict('INVALID_STATE_TRANSITION', `Periode tidak dapat berubah dari ${current.status} ke ${input.status}.`)
      const next: TracerDistributionPeriod = { ...current, ...normalized, questionnaireId: current.questionnaireId, questionnaireVersion: current.questionnaireVersion, status: input.status, version: current.version + 1, updatedAt: now, updatedBy: context.uid }
      transaction.set(reference, next)
      return next
    })
  }
  const audit = await appendAudit({ actor: context, action: 'TRACER_PERIOD_UPDATED', resourceType: 'tracer_distribution_period', resourceId: id, before: { version: expectedVersion }, after: { version: period.version, status: period.status }, event })
  return { period, auditId: audit.id }
}

async function tokenByRaw(rawToken: string): Promise<TracerOpaqueTokenRecord> {
  const tokenHash = hashTracerAccessToken(rawToken)
  const id = tracerTokenRecordId(tokenHash)
  if (dataMode() === 'mock') {
    const record = tracerStudyMockState().tokens.get(id)
    if (!record || record.tokenHash !== tokenHash) notFound('Akses tracer study')
    return structuredClone(record)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
  const snapshot = await db.collection('tracerOpaqueTokens').doc(id).get()
  if (!snapshot.exists) notFound('Akses tracer study')
  const record = { id: snapshot.id, ...snapshot.data() } as TracerOpaqueTokenRecord
  if (record.tokenHash !== tokenHash) notFound('Akses tracer study')
  return record
}

function requireActiveToken(token: TracerOpaqueTokenRecord, purpose: TracerOpaqueTokenRecord['purpose'], now: number): void {
  if (token.purpose !== purpose) forbidden('Token tidak berlaku untuk tindakan ini.')
  if (token.status !== 'ACTIVE') conflict('TOKEN_REPLAYED', 'Token sudah digunakan atau dicabut.')
  if (now >= Date.parse(token.expiresAt)) conflict('TOKEN_EXPIRED', 'Token tracer study telah kedaluwarsa.')
}

async function issuedSkpiReferences(profile: TracerAlumniProfile, includeHref: boolean): Promise<IssuedSkpiReference[]> {
  let documents: IssuedGraduationDocument[]
  if (dataMode() === 'mock') documents = [...graduationModuleState().documents.values()].map(item => structuredClone(item))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan dokumen kelulusan tidak tersedia.')
    const snapshot = await db.collection('issuedGraduationDocuments').where('studentId', '==', profile.studentId).limit(20).get()
    documents = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as IssuedGraduationDocument)
  }
  return documents.filter(document => document.type === 'SKPI' && document.status === 'ISSUED' && document.studentId === profile.studentId)
    .sort((left, right) => right.issuedAt.localeCompare(left.issuedAt))
    .map(document => ({ documentId: document.id, documentNumber: document.documentNumber, issuedAt: document.issuedAt, ...(includeHref ? { href: `/api/graduation/documents/${encodeURIComponent(document.id)}/render` } : {}) }))
}

async function accessView(token: TracerOpaqueTokenRecord, markOpened: boolean, now: number): Promise<TracerAccessView> {
  requireActiveToken(token, 'ACCESS', now)
  const [period, recipient] = await Promise.all([loadTracerPeriod(token.periodId), loadRecipient(token.recipientId)])
  if (!isTracerPeriodOpen(period, now)) conflict(now >= Date.parse(period.closesAt) || period.status === 'CLOSED' ? 'TRACER_PERIOD_CLOSED' : 'TRACER_PERIOD_NOT_OPEN', 'Periode tracer study tidak aktif.')
  if (recipient.status === 'RESPONDED' || recipient.status === 'WITHDRAWN') conflict('TRACER_ALREADY_COMPLETED', 'Respons tracer study sudah diselesaikan.')
  const [questionnaire, profile] = await Promise.all([getQuestionnaireVersion(period.questionnaireId, period.questionnaireVersion), loadAlumniProfile(recipient.alumniProfileId)])
  if (markOpened && recipient.status !== 'OPENED') {
    const updated: TracerRecipient = { ...recipient, status: 'OPENED', openedAt: new Date(now).toISOString(), version: recipient.version + 1, updatedAt: new Date(now).toISOString() }
    if (dataMode() === 'mock') tracerStudyMockState().recipients.set(updated.id, structuredClone(updated))
    else {
      const db = firestoreAdmin()
      if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
      await db.collection('tracerRecipients').doc(updated.id).set(updated)
    }
  }
  return {
    period: { id: period.id, name: period.name, opensAt: period.opensAt, closesAt: period.closesAt, consentVersion: period.consentVersion, consentNotice: period.consentNotice },
    questionnaire, recipientStatus: markOpened ? 'OPENED' : recipient.status,
    skpiReferences: await issuedSkpiReferences(profile, false),
  }
}

export async function resolveTracerAccessToken(rawToken: string, options: { markOpened?: boolean; now?: number } = {}): Promise<TracerAccessView> {
  return accessView(await tokenByRaw(rawToken), options.markOpened === true, options.now ?? Date.now())
}

async function profilesByUid(uid: string): Promise<TracerAlumniProfile[]> {
  if (dataMode() === 'mock') return [...tracerStudyMockState().alumniProfiles.values()].filter(item => item.userUid === uid).map(item => structuredClone(item))
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
  const snapshot = await db.collection('tracerAlumniProfiles').where('userUid', '==', uid).limit(10).get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as TracerAlumniProfile)
}

export async function listOwnTracerAssignments(context: AuthContext, now = Date.now()): Promise<TracerOwnAssignment[]> {
  if (!hasRole(context, 'student')) forbidden('Akses alumni hanya tersedia untuk pemilik data.')
  const profiles = await profilesByUid(context.uid)
  if (!profiles.length) return []
  let recipients: TracerRecipient[]
  if (dataMode() === 'mock') recipients = [...tracerStudyMockState().recipients.values()].filter(item => profiles.some(profile => profile.id === item.alumniProfileId)).map(item => structuredClone(item))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
    const snapshots = await Promise.all(profiles.map(profile => db.collection('tracerRecipients').where('alumniProfileId', '==', profile.id).limit(30).get()))
    recipients = snapshots.flatMap(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as TracerRecipient))
  }
  const result: TracerOwnAssignment[] = []
  for (const recipient of recipients) {
    const period = await loadTracerPeriod(recipient.periodId)
    if (period.status === 'DRAFT' || now < Date.parse(period.opensAt)) continue
    const profile = profiles.find(item => item.id === recipient.alumniProfileId)
    if (!profile) continue
    result.push({
      recipientId: recipient.id,
      period: { id: period.id, name: period.name, opensAt: period.opensAt, closesAt: period.closesAt, consentVersion: period.consentVersion, consentNotice: period.consentNotice },
      questionnaire: await getQuestionnaireVersion(period.questionnaireId, period.questionnaireVersion),
      recipientStatus: recipient.status,
      submitted: recipient.status === 'RESPONDED' || recipient.status === 'WITHDRAWN',
      responseId: recipient.responseId,
      skpiReferences: await issuedSkpiReferences(profile, true),
    })
  }
  return result.sort((left, right) => right.period.opensAt.localeCompare(left.period.opensAt))
}

function validateCareer(input: TracerCareerData): TracerCareerData {
  if (!input || typeof input !== 'object' || !TRACER_EMPLOYMENT_STATUSES.includes(input.employmentStatus)) invalidInput('Status pekerjaan wajib dipilih.')
  const result: TracerCareerData = { employmentStatus: input.employmentStatus }
  if (input.waitMonths !== undefined) result.waitMonths = requireInteger(input.waitMonths, 'Masa tunggu kerja', 0, 120)
  if (input.fieldAlignment !== undefined) result.fieldAlignment = requireInteger(input.fieldAlignment, 'Kesesuaian bidang', 1, 5)
  if (input.incomeRange !== undefined) {
    if (!TRACER_INCOME_RANGES.includes(input.incomeRange)) invalidInput('Rentang pendapatan tidak valid.')
    result.incomeRange = input.incomeRange
  }
  for (const key of ['employerSector', 'jobLevel', 'workLocation', 'organizationName', 'furtherStudyInstitution'] as const) {
    const text = cleanOptionalText(input[key], key, 200)
    if (text) result[key] = text
  }
  if (['EMPLOYED', 'ENTREPRENEUR'].includes(result.employmentStatus) && result.waitMonths === undefined) invalidInput('Masa tunggu wajib diisi untuk alumni bekerja atau berwirausaha.')
  return result
}

function validateAnswerValue(question: TracerQuestionDefinition, value: TracerAnswerValue): TracerAnswerValue {
  if (question.type === 'TEXT') {
    if (typeof value !== 'string') invalidInput(`Jawaban ${question.id} harus berupa teks.`)
    return cleanText(value, `Jawaban ${question.id}`, 2_000)
  }
  if (question.type === 'BOOLEAN') {
    if (typeof value !== 'boolean') invalidInput(`Jawaban ${question.id} harus berupa boolean.`)
    return value
  }
  if (question.type === 'NUMBER') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < (question.minimum ?? 0) || value > (question.maximum ?? 1_000_000)) invalidInput(`Jawaban ${question.id} berada di luar rentang.`)
    return value
  }
  const allowed = new Set(question.options?.map(option => option.value) ?? [])
  if (question.type === 'SINGLE_CHOICE') {
    if (typeof value !== 'string' || !allowed.has(value)) invalidInput(`Pilihan ${question.id} tidak valid.`)
    return value
  }
  if (!Array.isArray(value) || !value.length || value.length > allowed.size || value.some(item => typeof item !== 'string' || !allowed.has(item)) || new Set(value).size !== value.length) invalidInput(`Pilihan ${question.id} tidak valid.`)
  return [...value]
}

function validateAnswers(questions: TracerQuestionDefinition[], input: TracerAnswer[]): TracerAnswer[] {
  if (!Array.isArray(input) || input.length > questions.length) invalidInput('Daftar jawaban tidak valid.')
  const byId = new Map(questions.map(question => [question.id, question]))
  const seen = new Set<string>()
  const answers = input.map((answer) => {
    if (!answer || typeof answer !== 'object') invalidInput('Jawaban tidak valid.')
    const question = byId.get(answer.questionId)
    if (!question || seen.has(answer.questionId)) invalidInput('Jawaban memuat pertanyaan tidak dikenal atau duplikat.')
    seen.add(answer.questionId)
    return { questionId: question.id, value: validateAnswerValue(question, answer.value) }
  })
  if (questions.some(question => question.required && !seen.has(question.id))) invalidInput('Semua pertanyaan wajib harus dijawab.')
  return answers
}

async function submissionRecipient(context: AuthContext | null, input: SubmitTracerResponseInput, now: number): Promise<{ recipient: TracerRecipient; accessToken?: TracerOpaqueTokenRecord }> {
  if (input.accessToken) {
    const token = await tokenByRaw(input.accessToken)
    requireActiveToken(token, 'ACCESS', now)
    return { recipient: await loadRecipient(token.recipientId), accessToken: token }
  }
  if (!context || !input.recipientId || !hasRole(context, 'student')) forbidden('Token akses atau sesi alumni yang sah diperlukan.')
  const recipient = await loadRecipient(cleanId(input.recipientId, 'Penerima'))
  const profile = await loadAlumniProfile(recipient.alumniProfileId)
  if (profile.userUid !== context.uid) forbidden('Respons tracer study bukan milik Anda.')
  return { recipient }
}

export async function submitTracerResponse(
  context: AuthContext | null,
  input: SubmitTracerResponseInput,
  idempotencyKey: string,
  event?: H3Event,
  now = Date.now(),
): Promise<TracerSubmissionReceipt> {
  const credentialHash = input.accessToken ? hashTracerAccessToken(input.accessToken) : cleanId(input.recipientId || '', 'Penerima')
  const normalizedHash = requestHash({ credentialHash, consentAccepted: input.consentAccepted, consentVersion: input.consentVersion, career: input.career, answers: input.answers })
  const namespace = `response:submit:${idempotencyKey}`
  if (dataMode() === 'mock') {
    const previous = tracerStudyMockState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== normalizedHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { ...(structuredClone(previous.response) as TracerSubmissionReceipt), replayed: true, withdrawalToken: undefined }
    }
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
    const previous = await db.collection('tracerStudyIdempotency').doc(opaqueId('idem', namespace)).get()
    if (previous.exists) {
      const stored = previous.data() as { requestHash: string; response: TracerSubmissionReceipt }
      if (stored.requestHash !== normalizedHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { ...stored.response, replayed: true, withdrawalToken: undefined }
    }
  }
  const { recipient, accessToken } = await submissionRecipient(context, input, now)
  const period = await loadTracerPeriod(recipient.periodId)
  if (!isTracerPeriodOpen(period, now)) conflict(now >= Date.parse(period.closesAt) || period.status === 'CLOSED' ? 'TRACER_PERIOD_CLOSED' : 'TRACER_PERIOD_NOT_OPEN', 'Periode tracer study tidak aktif.')
  if (!input.consentAccepted || cleanText(input.consentVersion, 'Versi persetujuan', 80) !== period.consentVersion) invalidInput('Persetujuan eksplisit dengan versi yang berlaku wajib diberikan.')
  if (recipient.status === 'RESPONDED' || recipient.responseId) conflict('TRACER_ALREADY_SUBMITTED', 'Respons tracer study sudah pernah dikirim.')
  if (recipient.status === 'WITHDRAWN') conflict('CONSENT_WITHDRAWN', 'Persetujuan tracer study sudah ditarik.')
  const definition = await getQuestionnaireVersion(period.questionnaireId, period.questionnaireVersion)
  const career = validateCareer(input.career)
  const answers = validateAnswers(definition.questions, input.answers)
  const submittedAt = new Date(now).toISOString()
  const responseId = opaqueId('tracer_response', `${period.id}:${recipient.id}`)
  const consentId = opaqueId('tracer_consent', `${period.id}:${recipient.id}`)
  const withdrawalToken = generateTracerOpaqueToken()
  const withdrawalHash = hashTracerAccessToken(withdrawalToken)
  const withdrawalRecord: TracerOpaqueTokenRecord = {
    id: tracerTokenRecordId(withdrawalHash), tokenHash: withdrawalHash, purpose: 'WITHDRAWAL', periodId: period.id,
    recipientId: recipient.id, responseId, status: 'ACTIVE', expiresAt: new Date(Math.max(Date.parse(period.closesAt) + 365 * 86_400_000, now + 365 * 86_400_000)).toISOString(), createdAt: submittedAt,
  }
  const response: TracerResponse = { id: responseId, periodId: period.id, questionnaireId: definition.questionnaireId, questionnaireVersion: definition.version, recipientId: recipient.id, programStudyId: recipient.programStudyId, graduationYear: recipient.graduationYear, status: 'SUBMITTED', career, answers, submittedAt, version: 1 }
  const consent: TracerConsentRecord = { id: consentId, periodId: period.id, recipientId: recipient.id, responseId, consentVersion: period.consentVersion, noticeSnapshot: period.consentNotice, status: 'GRANTED', grantedAt: submittedAt, version: 1 }
  const nextRecipient: TracerRecipient = { ...recipient, status: 'RESPONDED', responseId, respondedAt: submittedAt, version: recipient.version + 1, updatedAt: submittedAt }
  const storedReceipt: TracerSubmissionReceipt = { receiptId: opaqueId('tracer_receipt', responseId), submittedAt, replayed: false }
  if (dataMode() === 'mock') {
    const state = tracerStudyMockState()
    if (accessToken) {
      const current = state.tokens.get(accessToken.id)
      if (!current || current.status !== 'ACTIVE') conflict('TOKEN_REPLAYED', 'Token sudah digunakan atau dicabut.')
      state.tokens.set(accessToken.id, { ...current, status: 'CONSUMED', consumedAt: submittedAt })
    }
    if (state.responses.has(responseId)) conflict('TRACER_ALREADY_SUBMITTED', 'Respons tracer study sudah pernah dikirim.')
    state.responses.set(responseId, structuredClone(response))
    state.consents.set(consentId, structuredClone(consent))
    state.recipients.set(recipient.id, structuredClone(nextRecipient))
    state.tokens.set(withdrawalRecord.id, structuredClone(withdrawalRecord))
    state.idempotency.set(namespace, { requestHash: normalizedHash, response: structuredClone(storedReceipt) })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
    const idem = db.collection('tracerStudyIdempotency').doc(opaqueId('idem', namespace))
    const transactionResult = await db.runTransaction(async (transaction) => {
      const [prior, recipientSnapshot, responseSnapshot] = await Promise.all([
        transaction.get(idem),
        transaction.get(db.collection('tracerRecipients').doc(recipient.id)),
        transaction.get(db.collection('tracerResponses').doc(responseId)),
      ])
      const tokenSnapshot = accessToken
        ? await transaction.get(db.collection('tracerOpaqueTokens').doc(accessToken.id))
        : undefined
      if (prior.exists) {
        const stored = prior.data() as { requestHash: string; response: TracerSubmissionReceipt }
        if (stored.requestHash !== normalizedHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return { receipt: stored.response, replayed: true }
      }
      if (!recipientSnapshot.exists) notFound('Penerima tracer study')
      const freshRecipient = { id: recipientSnapshot.id, ...recipientSnapshot.data() } as TracerRecipient
      if (freshRecipient.responseId || responseSnapshot.exists) conflict('TRACER_ALREADY_SUBMITTED', 'Respons tracer study sudah pernah dikirim.')
      if (accessToken) {
        if (!tokenSnapshot?.exists || tokenSnapshot.data()?.status !== 'ACTIVE') conflict('TOKEN_REPLAYED', 'Token sudah digunakan atau dicabut.')
        transaction.update(db.collection('tracerOpaqueTokens').doc(accessToken.id), { status: 'CONSUMED', consumedAt: submittedAt })
      }
      transaction.create(db.collection('tracerResponses').doc(responseId), response)
      transaction.create(db.collection('tracerConsents').doc(consentId), consent)
      transaction.set(db.collection('tracerRecipients').doc(recipient.id), nextRecipient)
      transaction.create(db.collection('tracerOpaqueTokens').doc(withdrawalRecord.id), withdrawalRecord)
      transaction.create(idem, { requestHash: normalizedHash, response: storedReceipt, createdAt: submittedAt })
      return { receipt: storedReceipt, replayed: false }
    })
    if (transactionResult.replayed) return { ...transactionResult.receipt, replayed: true, withdrawalToken: undefined }
  }
  const audit = await appendAudit({ actor: context ?? publicActor(now), action: 'TRACER_RESPONSE_SUBMITTED', resourceType: 'tracer_distribution_period', resourceId: period.id, after: { consentVersion: period.consentVersion, questionnaireVersion: definition.version }, event })
  return { ...storedReceipt, withdrawalToken, receiptId: storedReceipt.receiptId || audit.id }
}

async function ownResponse(context: AuthContext, responseId: string): Promise<{ response: TracerResponse; recipient: TracerRecipient }> {
  let response: TracerResponse | undefined
  if (dataMode() === 'mock') response = structuredClone(tracerStudyMockState().responses.get(responseId))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
    const snapshot = await db.collection('tracerResponses').doc(responseId).get()
    if (snapshot.exists) response = { id: snapshot.id, ...snapshot.data() } as TracerResponse
  }
  if (!response) notFound('Respons tracer study')
  const recipient = await loadRecipient(response.recipientId)
  const profile = await loadAlumniProfile(recipient.alumniProfileId)
  if (!hasRole(context, 'student') || profile.userUid !== context.uid) forbidden('Respons tracer study bukan milik Anda.')
  return { response, recipient }
}

export async function withdrawTracerConsent(
  context: AuthContext | null,
  input: WithdrawTracerConsentInput,
  idempotencyKey: string,
  event?: H3Event,
  now = Date.now(),
): Promise<{ responseId: string; status: 'WITHDRAWN'; withdrawnAt: string; replayed: boolean; auditId?: string }> {
  const credentialHash = input.withdrawalToken ? hashTracerAccessToken(input.withdrawalToken) : cleanId(input.responseId || '', 'Respons')
  const hash = requestHash({ credentialHash, expectedConsentVersion: input.expectedConsentVersion })
  const namespace = `consent:withdraw:${idempotencyKey}`
  const state = dataMode() === 'mock' ? tracerStudyMockState() : undefined
  const previous = state?.idempotency.get(namespace)
  if (previous) {
    if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
    return { ...(structuredClone(previous.response) as { responseId: string; status: 'WITHDRAWN'; withdrawnAt: string; replayed: boolean }), replayed: true }
  }
  let response: TracerResponse
  let recipient: TracerRecipient
  let token: TracerOpaqueTokenRecord | undefined
  if (input.withdrawalToken) {
    token = await tokenByRaw(input.withdrawalToken)
    requireActiveToken(token, 'WITHDRAWAL', now)
    if (!token.responseId) invalidInput('Token penarikan tidak memiliki respons.')
    if (dataMode() === 'mock') response = structuredClone(tracerStudyMockState().responses.get(token.responseId)) as TracerResponse
    else {
      const db = firestoreAdmin()
      if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
      const snapshot = await db.collection('tracerResponses').doc(token.responseId).get()
      if (!snapshot.exists) notFound('Respons tracer study')
      response = { id: snapshot.id, ...snapshot.data() } as TracerResponse
    }
    if (!response) notFound('Respons tracer study')
    recipient = await loadRecipient(response.recipientId)
  } else {
    if (!context || !input.responseId) forbidden('Sesi alumni atau token penarikan diperlukan.')
    ;({ response, recipient } = await ownResponse(context, input.responseId))
  }
  const consentId = opaqueId('tracer_consent', `${response.periodId}:${recipient.id}`)
  let consent: TracerConsentRecord | undefined
  if (dataMode() === 'mock') consent = structuredClone(tracerStudyMockState().consents.get(consentId))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
    const snapshot = await db.collection('tracerConsents').doc(consentId).get()
    if (snapshot.exists) consent = { id: snapshot.id, ...snapshot.data() } as TracerConsentRecord
  }
  if (!consent) notFound('Persetujuan tracer study')
  if (consent.status === 'WITHDRAWN') conflict('CONSENT_ALREADY_WITHDRAWN', 'Persetujuan sudah ditarik.')
  if (consent.version !== input.expectedConsentVersion) conflict('VERSION_CONFLICT', 'Persetujuan telah berubah.', { currentVersion: consent.version })
  const withdrawnAt = new Date(now).toISOString()
  const nextConsent: TracerConsentRecord = { ...consent, status: 'WITHDRAWN', withdrawnAt, version: consent.version + 1 }
  const nextResponse: TracerResponse = { ...response, status: 'WITHDRAWN', career: undefined, answers: [], withdrawnAt, version: response.version + 1 }
  const nextRecipient: TracerRecipient = { ...recipient, status: 'WITHDRAWN', withdrawnAt, version: recipient.version + 1, updatedAt: withdrawnAt }
  const result = { responseId: response.id, status: 'WITHDRAWN' as const, withdrawnAt, replayed: false }
  if (dataMode() === 'mock') {
    const mock = tracerStudyMockState()
    mock.consents.set(consentId, structuredClone(nextConsent))
    mock.responses.set(response.id, structuredClone(nextResponse))
    mock.recipients.set(recipient.id, structuredClone(nextRecipient))
    if (token) mock.tokens.set(token.id, { ...token, status: 'CONSUMED', consumedAt: withdrawnAt })
    mock.idempotency.set(namespace, { requestHash: hash, response: structuredClone(result) })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
    const idem = db.collection('tracerStudyIdempotency').doc(opaqueId('idem', namespace))
    const replay = await db.runTransaction(async (transaction) => {
      const [prior, consentSnapshot, responseSnapshot] = await Promise.all([
        transaction.get(idem), transaction.get(db.collection('tracerConsents').doc(consentId)), transaction.get(db.collection('tracerResponses').doc(response.id)),
      ])
      if (prior.exists) {
        const stored = prior.data() as { requestHash: string; response: typeof result }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return { ...stored.response, replayed: true }
      }
      if (!consentSnapshot.exists || !responseSnapshot.exists) notFound('Persetujuan tracer study')
      const freshConsent = { id: consentSnapshot.id, ...consentSnapshot.data() } as TracerConsentRecord
      if (freshConsent.status === 'WITHDRAWN') conflict('CONSENT_ALREADY_WITHDRAWN', 'Persetujuan sudah ditarik.')
      if (freshConsent.version !== input.expectedConsentVersion) conflict('VERSION_CONFLICT', 'Persetujuan telah berubah.', { currentVersion: freshConsent.version })
      transaction.set(db.collection('tracerConsents').doc(consentId), nextConsent)
      transaction.update(db.collection('tracerResponses').doc(response.id), { status: 'WITHDRAWN', career: FieldValue.delete(), answers: [], withdrawnAt, version: response.version + 1 })
      transaction.set(db.collection('tracerRecipients').doc(recipient.id), nextRecipient)
      if (token) transaction.update(db.collection('tracerOpaqueTokens').doc(token.id), { status: 'CONSUMED', consumedAt: withdrawnAt })
      transaction.create(idem, { requestHash: hash, response: result, createdAt: withdrawnAt })
      return result
    })
    if (replay.replayed) return replay
  }
  const audit = await appendAudit({ actor: context ?? publicActor(now), action: 'TRACER_CONSENT_WITHDRAWN', resourceType: 'tracer_distribution_period', resourceId: response.periodId, after: { excludedFromReporting: true }, event })
  return { ...result, auditId: audit.id }
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}${'*'.repeat(Math.max(3, local.length - visible.length))}@${domain}`
}

export async function listTracerRespondents(context: AuthContext, periodId: string): Promise<TracerRespondentMonitorItem[]> {
  if (!hasRole(context, 'student_affairs_staff', 'administrator')) forbidden('Monitoring responden hanya tersedia untuk staf tracer study.')
  const period = await loadTracerPeriod(periodId)
  requireTracerManager(context, period.programStudyIds.filter(id => hasRole(context, 'administrator') || context.scope.programStudyIds.includes(id)))
  let recipients: TracerRecipient[]
  if (dataMode() === 'mock') recipients = [...tracerStudyMockState().recipients.values()].filter(item => item.periodId === period.id).map(item => structuredClone(item))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
    const snapshot = await db.collection('tracerRecipients').where('periodId', '==', period.id).limit(2_500).get()
    recipients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as TracerRecipient)
  }
  const allowed = recipients.filter(recipient => hasRole(context, 'administrator') || context.scope.programStudyIds.includes(recipient.programStudyId))
  const result: TracerRespondentMonitorItem[] = []
  for (const recipient of allowed) {
    const profile = await loadAlumniProfile(recipient.alumniProfileId)
    const consentId = opaqueId('tracer_consent', `${period.id}:${recipient.id}`)
    let consent: TracerConsentRecord | undefined
    if (dataMode() === 'mock') consent = tracerStudyMockState().consents.get(consentId)
    else {
      const db = firestoreAdmin()
      if (!db) serviceUnavailable('Penyimpanan tracer study tidak tersedia.')
      const snapshot = await db.collection('tracerConsents').doc(consentId).get()
      if (snapshot.exists) consent = { id: snapshot.id, ...snapshot.data() } as TracerConsentRecord
    }
    result.push({
      recipientId: recipient.id, studentNumber: profile.studentNumber, displayName: profile.displayName,
      maskedEmail: maskEmail(profile.email), programStudyId: profile.programStudyId, programStudyName: profile.programStudyName,
      graduationYear: profile.graduationYear, status: recipient.status, firstInvitedAt: recipient.firstInvitedAt,
      lastContactAt: recipient.lastContactAt, respondedAt: recipient.respondedAt,
      consentStatus: consent?.status ?? 'NOT_GRANTED', skpiReferences: await issuedSkpiReferences(profile, false),
    })
  }
  return result.sort((left, right) => left.displayName.localeCompare(right.displayName))
}

export { requireAggregateReader, requireTracerManager }
