import type { QueryDocumentSnapshot } from 'firebase-admin/firestore'
import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { AcademicClassRecord, ClassEnrollment } from '../types/academic-classes'
import type {
  AnonymousEvaluationResponse,
  EvaluationAnswer,
  EvaluationAssignment,
  EvaluationEnrollment,
  EvaluationFormRecord,
  EvaluationFormVersion,
  EvaluationPeriodRecord,
  EvaluationQuestionDefinition,
  EvaluationSubmissionReceipt,
} from '../types/evaluations'
import { appendAudit } from '../utils/audit'
import { CampusError, conflict, forbidden, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { opaqueId, requestHash } from '../utils/security'
import {
  cloneEvaluationValue,
  evaluationMockState,
} from './evaluations-mock'
import {
  assertEvaluationPeriodOpen,
  normalizeEvaluationAnswers,
  normalizeEvaluationId,
  normalizeEvaluationQuestions,
  normalizeEvaluationText,
  normalizeMinimumResponses,
  normalizeOptionalEvaluationText,
  normalizePeriodWindow,
  requireEvaluationConfigurationAccess,
  requireStudentEvaluationAccess,
} from './evaluations-validation'

export interface CreateEvaluationFormInput {
  name: string
  description?: string
  programStudyId: string
  questions: EvaluationQuestionDefinition[]
}

export interface UpdateEvaluationFormInput {
  expectedVersion: number
  name: string
  description?: string
  questions: EvaluationQuestionDefinition[]
}

export interface EvaluationFormResult {
  form: EvaluationFormRecord
  definition: EvaluationFormVersion
  replayed?: boolean
  auditId?: string
}

export interface CreateEvaluationPeriodInput {
  name: string
  academicPeriodId: string
  programStudyId: string
  formId: string
  formVersion: number
  opensAt: string
  closesAt: string
  minimumResponses: number
}

export interface UpdateEvaluationPeriodInput {
  expectedVersion: number
  name: string
  opensAt: string
  closesAt: string
  minimumResponses: number
}

export interface EvaluationPeriodResult {
  period: EvaluationPeriodRecord
  replayed?: boolean
  auditId?: string
}

export interface SubmitEvaluationInput {
  evaluationPeriodId: string
  enrollmentId: string
  answers: EvaluationAnswer[]
}

function formVersionId(formId: string, version: number): string {
  return `${formId}_v${version}`
}

function validateExpectedVersion(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 1_000_000) throw new CampusError(400, 'INVALID_INPUT', 'expectedVersion tidak valid.')
  return value
}

function normalizeFormInput(input: CreateEvaluationFormInput): CreateEvaluationFormInput {
  return {
    name: normalizeEvaluationText(input.name, 'name', 3, 160),
    ...(normalizeOptionalEvaluationText(input.description, 'description', 1000)
      ? { description: normalizeOptionalEvaluationText(input.description, 'description', 1000) }
      : {}),
    programStudyId: normalizeEvaluationId(input.programStudyId, 'programStudyId'),
    questions: normalizeEvaluationQuestions(input.questions),
  }
}

function normalizePeriodInput(input: CreateEvaluationPeriodInput): CreateEvaluationPeriodInput {
  const window = normalizePeriodWindow(input.opensAt, input.closesAt)
  return {
    name: normalizeEvaluationText(input.name, 'name', 3, 160),
    academicPeriodId: normalizeEvaluationId(input.academicPeriodId, 'academicPeriodId'),
    programStudyId: normalizeEvaluationId(input.programStudyId, 'programStudyId'),
    formId: normalizeEvaluationId(input.formId, 'formId', /^evalform_[a-f0-9]{24}$/),
    formVersion: validateExpectedVersion(input.formVersion),
    opensAt: window.opensAt,
    closesAt: window.closesAt,
    minimumResponses: normalizeMinimumResponses(input.minimumResponses),
  }
}

export async function getEvaluationFormRecord(formId: string): Promise<EvaluationFormRecord> {
  if (dataMode() === 'mock') {
    const form = evaluationMockState().forms.get(formId)
    if (!form) notFound('Formulir evaluasi')
    return cloneEvaluationValue(form)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
  const snapshot = await db.collection('evaluationForms').doc(formId).get()
  if (!snapshot.exists) notFound('Formulir evaluasi')
  return { ...snapshot.data(), id: snapshot.id } as EvaluationFormRecord
}

export async function getEvaluationFormVersion(formId: string, version: number): Promise<EvaluationFormVersion> {
  const id = formVersionId(formId, version)
  if (dataMode() === 'mock') {
    const definition = evaluationMockState().formVersions.get(id)
    if (!definition) notFound('Versi formulir evaluasi')
    return cloneEvaluationValue(definition)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
  const snapshot = await db.collection('evaluationFormVersions').doc(id).get()
  if (!snapshot.exists) notFound('Versi formulir evaluasi')
  return { ...snapshot.data(), id: snapshot.id } as EvaluationFormVersion
}

export async function getEvaluationPeriodRecord(periodId: string): Promise<EvaluationPeriodRecord> {
  if (dataMode() === 'mock') {
    const period = evaluationMockState().periods.get(periodId)
    if (!period) notFound('Periode evaluasi')
    return cloneEvaluationValue(period)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
  const snapshot = await db.collection('evaluationPeriods').doc(periodId).get()
  if (!snapshot.exists) notFound('Periode evaluasi')
  return { ...snapshot.data(), id: snapshot.id } as EvaluationPeriodRecord
}

export async function createEvaluationForm(
  context: AuthContext,
  rawInput: CreateEvaluationFormInput,
  idempotencyKey: string,
  event?: H3Event,
): Promise<EvaluationFormResult> {
  const input = normalizeFormInput(rawInput)
  requireEvaluationConfigurationAccess(context, input.programStudyId)
  const hash = requestHash(input)
  const namespace = `evaluation-form:${context.uid}:${idempotencyKey}`
  const id = opaqueId('evalform', namespace)
  const idemId = opaqueId('evalidem', namespace)
  const now = new Date().toISOString()
  let result: EvaluationFormResult

  if (dataMode() === 'mock') {
    const previous = evaluationMockState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
      return { ...(cloneEvaluationValue(previous.response) as EvaluationFormResult), replayed: true, auditId: undefined }
    }
    const form: EvaluationFormRecord = {
      id,
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      programStudyId: input.programStudyId,
      currentVersion: 1,
      nextVersion: 2,
      version: 1,
      status: 'ACTIVE',
      createdAt: now,
      createdBy: context.uid,
      updatedAt: now,
      updatedBy: context.uid,
    }
    const definition: EvaluationFormVersion = {
      id: formVersionId(id, 1),
      formId: id,
      version: 1,
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      programStudyId: input.programStudyId,
      questions: input.questions,
      createdAt: now,
      createdBy: context.uid,
    }
    result = { form, definition, replayed: false }
    evaluationMockState().forms.set(id, cloneEvaluationValue(form))
    evaluationMockState().formVersions.set(definition.id, cloneEvaluationValue(definition))
    evaluationMockState().idempotency.set(namespace, { requestHash: hash, response: cloneEvaluationValue(result), createdAt: now })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
    const formRef = db.collection('evaluationForms').doc(id)
    const versionRef = db.collection('evaluationFormVersions').doc(formVersionId(id, 1))
    const idemRef = db.collection('evaluationIdempotency').doc(idemId)
    result = await db.runTransaction(async (transaction) => {
      const previous = await transaction.get(idemRef)
      if (previous.exists) {
        const stored = previous.data() as { requestHash: string; response: EvaluationFormResult }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...stored.response, replayed: true, auditId: undefined }
      }
      const form: EvaluationFormRecord = {
        id, name: input.name, ...(input.description ? { description: input.description } : {}),
        programStudyId: input.programStudyId, currentVersion: 1, nextVersion: 2, version: 1,
        status: 'ACTIVE', createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid,
      }
      const definition: EvaluationFormVersion = {
        id: versionRef.id, formId: id, version: 1, name: input.name,
        ...(input.description ? { description: input.description } : {}),
        programStudyId: input.programStudyId, questions: input.questions, createdAt: now, createdBy: context.uid,
      }
      const response: EvaluationFormResult = { form, definition, replayed: false }
      transaction.create(formRef, form)
      transaction.create(versionRef, definition)
      transaction.create(idemRef, { namespace, requestHash: hash, response, createdAt: now })
      return response
    })
  }

  if (!result.replayed) {
    const audit = await appendAudit({
      actor: context,
      action: 'EVALUATION_FORM_CREATED',
      resourceType: 'evaluation_form',
      resourceId: result.form.id,
      after: { version: 1, programStudyId: result.form.programStudyId, questionCount: result.definition.questions.length },
      event,
    })
    result.auditId = audit.id
  }
  return result
}

export async function updateEvaluationForm(
  context: AuthContext,
  formId: string,
  rawInput: UpdateEvaluationFormInput,
  event?: H3Event,
): Promise<EvaluationFormResult> {
  const input = normalizeFormInput({
    name: rawInput.name,
    description: rawInput.description,
    programStudyId: 'placeholder',
    questions: rawInput.questions,
  })
  const expectedVersion = validateExpectedVersion(rawInput.expectedVersion)
  const now = new Date().toISOString()
  let before: EvaluationFormRecord
  let result: EvaluationFormResult

  if (dataMode() === 'mock') {
    const form = evaluationMockState().forms.get(formId)
    if (!form) notFound('Formulir evaluasi')
    requireEvaluationConfigurationAccess(context, form.programStudyId)
    if (form.status !== 'ACTIVE') conflict('EVALUATION_FORM_ARCHIVED', 'Formulir yang diarsipkan tidak dapat diubah.')
    if (form.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Formulir telah berubah. Muat ulang sebelum menyimpan.', { currentVersion: form.version })
    before = cloneEvaluationValue(form)
    const definitionVersion = form.nextVersion
    const { description: _previousDescription, ...formWithoutDescription } = form
    const updated: EvaluationFormRecord = {
      ...formWithoutDescription,
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      currentVersion: definitionVersion,
      nextVersion: definitionVersion + 1,
      version: form.version + 1,
      updatedAt: now,
      updatedBy: context.uid,
    }
    const definition: EvaluationFormVersion = {
      id: formVersionId(formId, definitionVersion), formId, version: definitionVersion,
      name: input.name, ...(input.description ? { description: input.description } : {}),
      programStudyId: form.programStudyId, questions: input.questions, createdAt: now, createdBy: context.uid,
    }
    evaluationMockState().forms.set(formId, cloneEvaluationValue(updated))
    evaluationMockState().formVersions.set(definition.id, cloneEvaluationValue(definition))
    result = { form: updated, definition }
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
    const formRef = db.collection('evaluationForms').doc(formId)
    const transactionResult = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(formRef)
      if (!snapshot.exists) notFound('Formulir evaluasi')
      const form = { ...snapshot.data(), id: snapshot.id } as EvaluationFormRecord
      requireEvaluationConfigurationAccess(context, form.programStudyId)
      if (form.status !== 'ACTIVE') conflict('EVALUATION_FORM_ARCHIVED', 'Formulir yang diarsipkan tidak dapat diubah.')
      if (form.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Formulir telah berubah. Muat ulang sebelum menyimpan.', { currentVersion: form.version })
      const definitionVersion = form.nextVersion
      const definitionRef = db.collection('evaluationFormVersions').doc(formVersionId(formId, definitionVersion))
      const { description: _previousDescription, ...formWithoutDescription } = form
      const updated = {
        ...formWithoutDescription,
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        currentVersion: definitionVersion,
        nextVersion: definitionVersion + 1,
        version: form.version + 1,
        updatedAt: now,
        updatedBy: context.uid,
      } as EvaluationFormRecord
      const definition: EvaluationFormVersion = {
        id: definitionRef.id, formId, version: definitionVersion, name: input.name,
        ...(input.description ? { description: input.description } : {}),
        programStudyId: form.programStudyId, questions: input.questions, createdAt: now, createdBy: context.uid,
      }
      transaction.set(formRef, updated)
      transaction.create(definitionRef, definition)
      return { before: form, updated, definition }
    })
    before = transactionResult.before
    result = { form: transactionResult.updated, definition: transactionResult.definition }
  }

  const audit = await appendAudit({
    actor: context,
    action: 'EVALUATION_FORM_VERSION_CREATED',
    resourceType: 'evaluation_form',
    resourceId: formId,
    before: { revision: before.version, definitionVersion: before.currentVersion },
    after: { revision: result.form.version, definitionVersion: result.form.currentVersion, questionCount: result.definition.questions.length },
    event,
  })
  result.auditId = audit.id
  return result
}

export async function listEvaluationForms(context: AuthContext, programStudyId?: string): Promise<EvaluationFormRecord[]> {
  const requestedProgram = programStudyId ? normalizeEvaluationId(programStudyId, 'programStudyId') : undefined
  if (!context.roles.includes('administrator') && !requestedProgram) {
    if (context.roles.includes('academic_staff') && context.scope.programStudyIds.length === 1) {
      return listEvaluationForms(context, context.scope.programStudyIds[0])
    }
    forbidden('programStudyId wajib dipilih.')
  }
  if (requestedProgram) requireEvaluationConfigurationAccess(context, requestedProgram)
  else if (!context.roles.includes('administrator')) forbidden()
  if (dataMode() === 'mock') {
    return [...evaluationMockState().forms.values()]
      .filter(form => !requestedProgram || form.programStudyId === requestedProgram)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(cloneEvaluationValue)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
  let query: FirebaseFirestore.Query = db.collection('evaluationForms')
  if (requestedProgram) query = query.where('programStudyId', '==', requestedProgram)
  const snapshot = await query.orderBy('updatedAt', 'desc').limit(100).get()
  return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as EvaluationFormRecord))
}

export async function getEvaluationFormDetail(context: AuthContext, formId: string): Promise<{ form: EvaluationFormRecord; versions: EvaluationFormVersion[] }> {
  const form = await getEvaluationFormRecord(formId)
  requireEvaluationConfigurationAccess(context, form.programStudyId)
  let versions: EvaluationFormVersion[]
  if (dataMode() === 'mock') {
    versions = [...evaluationMockState().formVersions.values()]
      .filter(version => version.formId === formId)
      .sort((left, right) => right.version - left.version)
      .map(cloneEvaluationValue)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
    const snapshot = await db.collection('evaluationFormVersions').where('formId', '==', formId).orderBy('version', 'desc').limit(100).get()
    versions = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as EvaluationFormVersion))
  }
  return { form, versions }
}

export async function createEvaluationPeriod(
  context: AuthContext,
  rawInput: CreateEvaluationPeriodInput,
  idempotencyKey: string,
  event?: H3Event,
): Promise<EvaluationPeriodResult> {
  const input = normalizePeriodInput(rawInput)
  requireEvaluationConfigurationAccess(context, input.programStudyId)
  const form = await getEvaluationFormRecord(input.formId)
  if (form.programStudyId !== input.programStudyId) conflict('FORM_PROGRAM_MISMATCH', 'Formulir dan periode harus berada pada program studi yang sama.')
  if (form.status !== 'ACTIVE') conflict('EVALUATION_FORM_ARCHIVED', 'Formulir yang diarsipkan tidak dapat digunakan pada periode baru.')
  const definition = await getEvaluationFormVersion(input.formId, input.formVersion)
  if (definition.programStudyId !== input.programStudyId) conflict('FORM_PROGRAM_MISMATCH', 'Versi formulir dan periode harus berada pada program studi yang sama.')
  const hash = requestHash(input)
  const namespace = `evaluation-period:${context.uid}:${idempotencyKey}`
  const id = opaqueId('evalperiod', namespace)
  const idemId = opaqueId('evalidem', namespace)
  const now = new Date().toISOString()
  let result: EvaluationPeriodResult

  if (dataMode() === 'mock') {
    const previous = evaluationMockState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
      return { ...(cloneEvaluationValue(previous.response) as EvaluationPeriodResult), replayed: true, auditId: undefined }
    }
    const period: EvaluationPeriodRecord = {
      id, ...input, version: 1, createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid,
    }
    result = { period, replayed: false }
    evaluationMockState().periods.set(id, cloneEvaluationValue(period))
    evaluationMockState().idempotency.set(namespace, { requestHash: hash, response: cloneEvaluationValue(result), createdAt: now })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
    const periodRef = db.collection('evaluationPeriods').doc(id)
    const idemRef = db.collection('evaluationIdempotency').doc(idemId)
    result = await db.runTransaction(async (transaction) => {
      const previous = await transaction.get(idemRef)
      if (previous.exists) {
        const stored = previous.data() as { requestHash: string; response: EvaluationPeriodResult }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...stored.response, replayed: true, auditId: undefined }
      }
      const period: EvaluationPeriodRecord = {
        id, ...input, version: 1, createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid,
      }
      const response: EvaluationPeriodResult = { period, replayed: false }
      transaction.create(periodRef, period)
      transaction.create(idemRef, { namespace, requestHash: hash, response, createdAt: now })
      return response
    })
  }
  if (!result.replayed) {
    const audit = await appendAudit({
      actor: context,
      action: 'EVALUATION_PERIOD_CREATED',
      resourceType: 'evaluation_period',
      resourceId: result.period.id,
      after: { programStudyId: result.period.programStudyId, formId: result.period.formId, formVersion: result.period.formVersion, opensAt: result.period.opensAt, closesAt: result.period.closesAt, minimumResponses: result.period.minimumResponses },
      event,
    })
    result.auditId = audit.id
  }
  return result
}

export async function updateEvaluationPeriod(
  context: AuthContext,
  periodId: string,
  rawInput: UpdateEvaluationPeriodInput,
  event?: H3Event,
): Promise<EvaluationPeriodResult> {
  const expectedVersion = validateExpectedVersion(rawInput.expectedVersion)
  const name = normalizeEvaluationText(rawInput.name, 'name', 3, 160)
  const window = normalizePeriodWindow(rawInput.opensAt, rawInput.closesAt)
  const minimumResponses = normalizeMinimumResponses(rawInput.minimumResponses)
  const now = new Date().toISOString()
  let before: EvaluationPeriodRecord
  let after: EvaluationPeriodRecord

  const updatedPeriod = (period: EvaluationPeriodRecord): EvaluationPeriodRecord => {
    requireEvaluationConfigurationAccess(context, period.programStudyId)
    if (period.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Periode telah berubah. Muat ulang sebelum menyimpan.', { currentVersion: period.version })
    if (Date.now() >= Date.parse(period.opensAt)) {
      if (Date.now() >= Date.parse(period.closesAt)) conflict('EVALUATION_CLOSED', 'Periode yang telah ditutup tidak dapat dibuka kembali.')
      if (window.opensAt !== period.opensAt || minimumResponses !== period.minimumResponses) {
        conflict('PERIOD_ALREADY_OPEN', 'Waktu buka dan ambang kerahasiaan tidak dapat diubah setelah periode dimulai.')
      }
    }
    return { ...period, name, ...window, minimumResponses, version: period.version + 1, updatedAt: now, updatedBy: context.uid }
  }

  if (dataMode() === 'mock') {
    const period = evaluationMockState().periods.get(periodId)
    if (!period) notFound('Periode evaluasi')
    before = cloneEvaluationValue(period)
    after = updatedPeriod(period)
    evaluationMockState().periods.set(periodId, cloneEvaluationValue(after))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
    const ref = db.collection('evaluationPeriods').doc(periodId)
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) notFound('Periode evaluasi')
      const period = { ...snapshot.data(), id: snapshot.id } as EvaluationPeriodRecord
      const updated = updatedPeriod(period)
      transaction.set(ref, updated)
      return { period, updated }
    })
    before = result.period
    after = result.updated
  }
  const audit = await appendAudit({
    actor: context,
    action: 'EVALUATION_PERIOD_UPDATED',
    resourceType: 'evaluation_period',
    resourceId: periodId,
    before: { version: before.version, name: before.name, opensAt: before.opensAt, closesAt: before.closesAt, minimumResponses: before.minimumResponses },
    after: { version: after.version, name: after.name, opensAt: after.opensAt, closesAt: after.closesAt, minimumResponses: after.minimumResponses },
    event,
  })
  return { period: after, auditId: audit.id }
}

export async function listEvaluationPeriods(context: AuthContext, programStudyId?: string): Promise<EvaluationPeriodRecord[]> {
  const requestedProgram = programStudyId ? normalizeEvaluationId(programStudyId, 'programStudyId') : undefined
  const privileged = context.roles.some(role => role === 'administrator' || role === 'leader')
  if (requestedProgram) {
    if (!privileged && !(context.roles.includes('academic_staff') && context.scope.programStudyIds.includes(requestedProgram))) forbidden()
  } else if (!privileged) {
    if (context.roles.includes('academic_staff') && context.scope.programStudyIds.length === 1) return listEvaluationPeriods(context, context.scope.programStudyIds[0])
    if (context.roles.includes('lecturer')) return listEvaluationPeriodsForLecturer(context)
    forbidden('programStudyId wajib dipilih.')
  }
  if (dataMode() === 'mock') {
    return [...evaluationMockState().periods.values()]
      .filter(period => !requestedProgram || period.programStudyId === requestedProgram)
      .sort((left, right) => right.opensAt.localeCompare(left.opensAt))
      .map(cloneEvaluationValue)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
  let query: FirebaseFirestore.Query = db.collection('evaluationPeriods')
  if (requestedProgram) query = query.where('programStudyId', '==', requestedProgram)
  const snapshot = await query.orderBy('opensAt', 'desc').limit(100).get()
  return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as EvaluationPeriodRecord))
}

async function listEvaluationPeriodsForLecturer(context: AuthContext): Promise<EvaluationPeriodRecord[]> {
  if (!context.roles.includes('lecturer')) forbidden()
  if (dataMode() === 'mock') {
    const programIds = new Set([...evaluationMockState().enrollments.values()].filter(item => item.lecturerId === context.uid).map(item => item.programStudyId))
    return [...evaluationMockState().periods.values()].filter(period => programIds.has(period.programStudyId)).map(cloneEvaluationValue)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
  const classes = await db.collection('academicClasses').where('lecturerIds', 'array-contains', context.uid).limit(500).get()
  const programIds = [...new Set(classes.docs.map(doc => String(doc.data().programStudyId)).filter(Boolean))]
  if (!programIds.length) return []
  const periods = await db.collection('evaluationPeriods').where('programStudyId', 'in', programIds.slice(0, 30)).limit(100).get()
  return periods.docs.map(doc => ({ ...doc.data(), id: doc.id } as EvaluationPeriodRecord)).sort((a, b) => b.opensAt.localeCompare(a.opensAt))
}

function evaluationTargetId(enrollmentId: string, lecturerId: string): string {
  return `evaltarget.${Buffer.from(enrollmentId, 'utf8').toString('base64url')}.${Buffer.from(lecturerId, 'utf8').toString('base64url')}`
}

function parseEvaluationTargetId(value: string): { enrollmentId: string; lecturerId: string } | undefined {
  const match = /^evaltarget\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(value)
  if (!match) return undefined
  try {
    const enrollmentId = normalizeEvaluationId(Buffer.from(match[1]!, 'base64url').toString('utf8'), 'enrollmentId')
    const lecturerId = normalizeEvaluationId(Buffer.from(match[2]!, 'base64url').toString('utf8'), 'lecturerId')
    return { enrollmentId, lecturerId }
  } catch {
    return undefined
  }
}

function canonicalEvaluationEnrollment(
  enrollmentId: string,
  value: Record<string, unknown>,
  classRecord: AcademicClassRecord,
  lecturerId: string,
): EvaluationEnrollment {
  const lecturerIndex = classRecord.lecturerIds.indexOf(lecturerId)
  if (lecturerIndex < 0) notFound('Penugasan dosen')
  return {
    id: evaluationTargetId(enrollmentId, lecturerId),
    sourceEnrollmentId: enrollmentId,
    studentUid: String(value.studentUid || ''),
    studentId: String(value.studentId || ''),
    lecturerId,
    lecturerName: classRecord.lecturerNames[lecturerIndex] || lecturerId,
    courseId: classRecord.courseVersionId || classRecord.courseCode,
    courseCode: classRecord.courseCode,
    courseName: classRecord.courseName,
    classId: classRecord.id,
    className: `${classRecord.courseCode}-${classRecord.section}`,
    programStudyId: classRecord.programStudyId,
    academicPeriodId: classRecord.periodId,
    status: value.status === 'ACTIVE' ? 'ENROLLED' : 'DROPPED',
  }
}

async function canonicalEvaluationTargets(snapshot: FirebaseFirestore.QuerySnapshot): Promise<EvaluationEnrollment[]> {
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan akademik tidak tersedia.')
  const classIds = [...new Set(snapshot.docs.map(document => String(document.data().classId)).filter(Boolean))]
  const classSnapshots = await Promise.all(classIds.map(classId => db.collection('academicClasses').doc(classId).get()))
  const classes = new Map(classSnapshots.filter(item => item.exists).map(item => [item.id, { ...item.data(), id: item.id } as AcademicClassRecord]))
  return snapshot.docs.flatMap(document => {
    const value = document.data() as unknown as ClassEnrollment
    const classRecord = classes.get(value.classId)
    if (!classRecord || classRecord.status !== 'ACTIVE') return []
    return classRecord.lecturerIds.map(lecturerId => canonicalEvaluationEnrollment(document.id, document.data(), classRecord, lecturerId))
  })
}

async function getEnrollment(enrollmentId: string): Promise<EvaluationEnrollment> {
  if (dataMode() === 'mock') {
    const enrollment = evaluationMockState().enrollments.get(enrollmentId)
    if (!enrollment) notFound('Kepesertaan kelas')
    return cloneEvaluationValue(enrollment)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan akademik tidak tersedia.')
  const target = parseEvaluationTargetId(enrollmentId)
  if (!target) notFound('Target evaluasi kelas')
  const snapshot = await db.collection('classEnrollments').doc(target.enrollmentId).get()
  if (!snapshot.exists) notFound('Kepesertaan kelas')
  const classId = String(snapshot.data()?.classId || '')
  const classSnapshot = await db.collection('academicClasses').doc(classId).get()
  if (!classSnapshot.exists) notFound('Kelas akademik')
  const classRecord = { ...classSnapshot.data(), id: classSnapshot.id } as AcademicClassRecord
  return canonicalEvaluationEnrollment(snapshot.id, snapshot.data() || {}, classRecord, target.lecturerId)
}

function respondentIdentityId(periodId: string, enrollment: EvaluationEnrollment): string {
  return opaqueId(
    'evalrespondent',
    `${periodId}:${enrollment.studentUid}:${enrollment.lecturerId}:${enrollment.courseId}:${enrollment.classId}`,
  )
}

async function hasResponded(periodId: string, enrollment: EvaluationEnrollment): Promise<boolean> {
  const id = respondentIdentityId(periodId, enrollment)
  if (dataMode() === 'mock') return evaluationMockState().respondentIdentities.has(id)
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
  return (await db.collection('evaluationRespondentIdentities').doc(id).get()).exists
}

export async function listStudentEvaluationAssignments(
  context: AuthContext,
  now = Date.now(),
): Promise<EvaluationAssignment[]> {
  requireStudentEvaluationAccess(context)
  let enrollments: EvaluationEnrollment[]
  let periods: EvaluationPeriodRecord[]
  if (dataMode() === 'mock') {
    enrollments = [...evaluationMockState().enrollments.values()]
      .filter(item => item.studentUid === context.uid && item.status === 'ENROLLED')
      .map(cloneEvaluationValue)
    periods = [...evaluationMockState().periods.values()].map(cloneEvaluationValue)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
    const enrollmentSnapshot = await db.collection('classEnrollments')
      .where('studentUid', '==', context.uid)
      .where('status', '==', 'ACTIVE')
      .limit(100)
      .get()
    enrollments = await canonicalEvaluationTargets(enrollmentSnapshot)
    if (!enrollments.length) return []
    const academicPeriodIds = [...new Set(enrollments.map(item => item.academicPeriodId))].slice(0, 30)
    const periodSnapshot = await db.collection('evaluationPeriods').where('academicPeriodId', 'in', academicPeriodIds).limit(100).get()
    periods = periodSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as EvaluationPeriodRecord))
  }

  const assignments: EvaluationAssignment[] = []
  for (const enrollment of enrollments) {
    const eligiblePeriods = periods.filter(period => period.academicPeriodId === enrollment.academicPeriodId
      && period.programStudyId === enrollment.programStudyId
      && now >= Date.parse(period.opensAt) && now < Date.parse(period.closesAt))
    for (const period of eligiblePeriods) {
      const [definition, completed] = await Promise.all([
        getEvaluationFormVersion(period.formId, period.formVersion),
        hasResponded(period.id, enrollment),
      ])
      assignments.push({
        id: `${period.id}:${enrollment.id}`,
        evaluationPeriodId: period.id,
        periodName: period.name,
        closesAt: period.closesAt,
        enrollmentId: enrollment.id,
        lecturerId: enrollment.lecturerId,
        lecturerName: enrollment.lecturerName,
        courseId: enrollment.courseId,
        courseCode: enrollment.courseCode,
        courseName: enrollment.courseName,
        classId: enrollment.classId,
        className: enrollment.className,
        programStudyId: enrollment.programStudyId,
        completed,
        questions: definition.questions,
      })
    }
  }
  return assignments.sort((left, right) => left.closesAt.localeCompare(right.closesAt) || left.courseCode.localeCompare(right.courseCode))
}

export async function submitStudentEvaluation(
  context: AuthContext,
  rawInput: SubmitEvaluationInput,
  idempotencyKey: string,
  event?: H3Event,
  now = Date.now(),
): Promise<EvaluationSubmissionReceipt> {
  requireStudentEvaluationAccess(context)
  const evaluationPeriodId = normalizeEvaluationId(rawInput.evaluationPeriodId, 'evaluationPeriodId', /^evalperiod_[a-f0-9]{24}$/)
  const enrollmentId = normalizeEvaluationId(rawInput.enrollmentId, 'enrollmentId', /^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/)
  const [period, enrollment] = await Promise.all([
    getEvaluationPeriodRecord(evaluationPeriodId),
    getEnrollment(enrollmentId),
  ])
  if (enrollment.studentUid !== context.uid || enrollment.status !== 'ENROLLED') forbidden('Anda tidak terdaftar aktif pada kelas ini.')
  if (period.academicPeriodId !== enrollment.academicPeriodId || period.programStudyId !== enrollment.programStudyId) {
    forbidden('Kelas tidak termasuk dalam periode evaluasi ini.')
  }
  assertEvaluationPeriodOpen(period, now)
  const definition = await getEvaluationFormVersion(period.formId, period.formVersion)
  const answers = normalizeEvaluationAnswers(rawInput.answers, definition.questions)
  const normalized = { evaluationPeriodId, enrollmentId, answers }
  const hash = requestHash(normalized)
  const namespace = `evaluation-submit:${context.uid}:${idempotencyKey}`
  const idemId = opaqueId('evalidem', namespace)
  const identityId = respondentIdentityId(evaluationPeriodId, enrollment)
  const responseId = opaqueId('evalresponse', namespace)
  const receiptId = opaqueId('evalreceipt', identityId)
  const submittedAt = new Date(now).toISOString()
  let receipt: EvaluationSubmissionReceipt

  const response: AnonymousEvaluationResponse = {
    id: responseId,
    evaluationPeriodId,
    academicPeriodId: period.academicPeriodId,
    formId: period.formId,
    formVersion: period.formVersion,
    lecturerId: enrollment.lecturerId,
    lecturerName: enrollment.lecturerName,
    courseId: enrollment.courseId,
    courseCode: enrollment.courseCode,
    courseName: enrollment.courseName,
    classId: enrollment.classId,
    className: enrollment.className,
    programStudyId: enrollment.programStudyId,
    answers,
    submittedAt,
  }

  if (dataMode() === 'mock') {
    const previous = evaluationMockState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk jawaban berbeda.')
      return { ...(cloneEvaluationValue(previous.response) as EvaluationSubmissionReceipt), replayed: true, auditId: undefined }
    }
    if (evaluationMockState().respondentIdentities.has(identityId)) {
      conflict('EVALUATION_ALREADY_SUBMITTED', 'Evaluasi untuk dosen, mata kuliah, kelas, dan periode ini sudah diisi.')
    }
    const identity = { id: identityId, evaluationPeriodId, enrollmentId, studentUid: context.uid, responseId, submittedAt }
    receipt = { receiptId, evaluationPeriodId, submittedAt, replayed: false }
    evaluationMockState().responses.set(responseId, cloneEvaluationValue(response))
    evaluationMockState().respondentIdentities.set(identityId, cloneEvaluationValue(identity))
    evaluationMockState().idempotency.set(namespace, { requestHash: hash, response: cloneEvaluationValue(receipt), createdAt: submittedAt })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
    const identityRef = db.collection('evaluationRespondentIdentities').doc(identityId)
    const responseRef = db.collection('evaluationResponses').doc(responseId)
    const idemRef = db.collection('evaluationIdempotency').doc(idemId)
    const sourceEnrollmentId = enrollment.sourceEnrollmentId
    if (!sourceEnrollmentId) conflict('EVALUATION_CONTEXT_CHANGED', 'Referensi kepesertaan kelas tidak tersedia.')
    const enrollmentRef = db.collection('classEnrollments').doc(sourceEnrollmentId)
    const classRef = db.collection('academicClasses').doc(enrollment.classId)
    const periodRef = db.collection('evaluationPeriods').doc(evaluationPeriodId)
    receipt = await db.runTransaction(async (transaction) => {
      const [previous, identitySnapshot, enrollmentSnapshot, classSnapshot, periodSnapshot] = await Promise.all([
        transaction.get(idemRef), transaction.get(identityRef), transaction.get(enrollmentRef), transaction.get(classRef), transaction.get(periodRef),
      ])
      if (previous.exists) {
        const stored = previous.data() as { requestHash: string; response: EvaluationSubmissionReceipt }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk jawaban berbeda.')
        return { ...stored.response, replayed: true, auditId: undefined }
      }
      if (identitySnapshot.exists) conflict('EVALUATION_ALREADY_SUBMITTED', 'Evaluasi untuk dosen, mata kuliah, kelas, dan periode ini sudah diisi.')
      if (!enrollmentSnapshot.exists || !classSnapshot.exists || !periodSnapshot.exists) conflict('EVALUATION_CONTEXT_CHANGED', 'Data kelas atau periode berubah. Muat ulang evaluasi.')
      const currentClass = { ...classSnapshot.data(), id: classSnapshot.id } as AcademicClassRecord
      const currentEnrollment = canonicalEvaluationEnrollment(enrollmentSnapshot.id, enrollmentSnapshot.data() || {}, currentClass, enrollment.lecturerId)
      const currentPeriod = { ...periodSnapshot.data(), id: periodSnapshot.id } as EvaluationPeriodRecord
      if (currentEnrollment.studentUid !== context.uid || currentEnrollment.status !== 'ENROLLED') forbidden('Anda tidak terdaftar aktif pada kelas ini.')
      if (currentPeriod.academicPeriodId !== currentEnrollment.academicPeriodId || currentPeriod.programStudyId !== currentEnrollment.programStudyId) forbidden('Kelas tidak termasuk dalam periode evaluasi ini.')
      if (currentEnrollment.lecturerId !== enrollment.lecturerId
        || currentEnrollment.courseId !== enrollment.courseId
        || currentEnrollment.classId !== enrollment.classId
        || currentPeriod.formId !== period.formId
        || currentPeriod.formVersion !== period.formVersion) {
        conflict('EVALUATION_CONTEXT_CHANGED', 'Dosen, kelas, mata kuliah, atau formulir berubah. Muat ulang evaluasi.')
      }
      assertEvaluationPeriodOpen(currentPeriod, now)
      const identity = { id: identityId, evaluationPeriodId, enrollmentId, studentUid: context.uid, responseId, submittedAt }
      const result: EvaluationSubmissionReceipt = { receiptId, evaluationPeriodId, submittedAt, replayed: false }
      transaction.create(responseRef, response)
      transaction.create(identityRef, identity)
      transaction.create(idemRef, { namespace, requestHash: hash, response: result, createdAt: submittedAt })
      return result
    })
  }

  if (!receipt.replayed) {
    const audit = await appendAudit({
      actor: context,
      action: 'EVALUATION_SUBMITTED',
      resourceType: 'evaluation_period',
      resourceId: evaluationPeriodId,
      // Deliberately omit responseId and answers so the audit trail cannot join identity to content.
      metadata: { courseId: enrollment.courseId, classId: enrollment.classId, lecturerId: enrollment.lecturerId, submitted: true },
      event,
    })
    receipt.auditId = audit.id
  }
  return receipt
}

export async function listAnonymousEvaluationResponses(periodId: string): Promise<AnonymousEvaluationResponse[]> {
  if (dataMode() === 'mock') {
    return [...evaluationMockState().responses.values()]
      .filter(response => response.evaluationPeriodId === periodId)
      .map(cloneEvaluationValue)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan evaluasi tidak tersedia.')
  const responses: AnonymousEvaluationResponse[] = []
  const stream = db.collection('evaluationResponses').where('evaluationPeriodId', '==', periodId).stream()
  for await (const snapshot of stream as unknown as AsyncIterable<QueryDocumentSnapshot>) {
    responses.push({ ...snapshot.data(), id: snapshot.id } as AnonymousEvaluationResponse)
  }
  return responses
}
