import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { AdmissionApplicationRecord } from '../types/admissions'
import type {
  AdmissionLetterOfAcceptance,
  AdmissionLetterVerification,
  AdmissionScoreComponent,
  AdmissionSelectionAssignment,
  AdmissionSelectionKind,
  AdmissionSelectionScore,
  AdmissionSelectionSession,
  AdmissionSelectionWriteResult,
} from '../types/admissions-selection'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { requireInteger, requireString } from '../utils/validation'
import { ADMISSION_PROGRAMS, ADMISSION_WAVES } from './admissions'
import { admissionModuleState } from './admissions-state'
import { admissionSelectionModuleState } from './admissions-selection-state'

export interface CreateSelectionSessionInput {
  name: string
  kind: AdmissionSelectionKind
  waveId: string
  programStudyId: string
  location: string
  startsAt: string
  endsAt: string
  capacity: number
  examinerIds: string[]
}

export interface FinalizeSelectionScoreInput {
  components: AdmissionScoreComponent[]
  recommendation: AdmissionSelectionScore['recommendation']
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SESSION_KINDS: AdmissionSelectionKind[] = ['WRITTEN_EXAM', 'INTERVIEW', 'PORTFOLIO_REVIEW']
const RECOMMENDATIONS: AdmissionSelectionScore['recommendation'][] = ['ACCEPT', 'REJECT', 'WAITLIST']
const IDEMPOTENCY_TTL_MS = 7 * 86_400_000
const QUERY_LIMIT = 1_000

function safeId(value: string, label: string): string {
  return requireString(value, label, { max: 128, pattern: SAFE_ID })
}

function cleanText(value: string, label: string, max: number): string {
  return requireString(value, label, { min: 2, max }).normalize('NFKC')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function staffProgramScope(context: AuthContext, programStudyId: string): boolean {
  return hasRole(context, 'administrator')
    || (hasRole(context, 'admissions_staff') && context.scope.programStudyIds.includes(programStudyId))
}

function requireStaffProgramScope(context: AuthContext, programStudyId: string): void {
  if (!staffProgramScope(context, programStudyId)) forbidden('Seleksi PMB berada di luar lingkup program studi Anda.')
}

function canReadProgram(context: AuthContext, programStudyId: string): boolean {
  return hasRole(context, 'administrator', 'leader')
    || (hasRole(context, 'admissions_staff') && context.scope.programStudyIds.includes(programStudyId))
}

function overlap(left: { startsAt: string; endsAt: string }, right: { startsAt: string; endsAt: string }): boolean {
  return Date.parse(left.startsAt) < Date.parse(right.endsAt) && Date.parse(right.startsAt) < Date.parse(left.endsAt)
}

function normalizedSessionInput(input: CreateSelectionSessionInput): CreateSelectionSessionInput {
  const kind = requireString(input.kind, 'kind', { max: 30 }) as AdmissionSelectionKind
  if (!SESSION_KINDS.includes(kind)) invalidInput('Jenis sesi seleksi tidak valid.')
  const waveId = safeId(input.waveId, 'waveId')
  const programStudyId = safeId(input.programStudyId, 'programStudyId')
  const wave = ADMISSION_WAVES.find(item => item.id === waveId && item.active)
  if (!wave) invalidInput('Gelombang PMB tidak aktif.')
  if (!ADMISSION_PROGRAMS.some(item => item.id === programStudyId && item.active)) invalidInput('Program studi PMB tidak aktif.')
  const startsRaw = requireString(input.startsAt, 'startsAt', { max: 48 })
  const endsRaw = requireString(input.endsAt, 'endsAt', { max: 48 })
  const starts = Date.parse(startsRaw)
  const ends = Date.parse(endsRaw)
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts || ends - starts > 8 * 60 * 60 * 1000) {
    invalidInput('Rentang waktu seleksi tidak valid atau lebih dari delapan jam.')
  }
  const startsAt = new Date(starts).toISOString()
  const endsAt = new Date(ends).toISOString()
  if (starts < Date.parse(wave.opensAt) || starts > Date.parse(wave.closesAt) + 30 * 86_400_000) {
    invalidInput('Jadwal seleksi berada di luar rentang gelombang yang diizinkan.')
  }
  if (!Array.isArray(input.examinerIds) || !input.examinerIds.length || input.examinerIds.length > 20) {
    invalidInput('Sesi seleksi harus memiliki 1-20 penguji.')
  }
  const examinerIds = [...new Set(input.examinerIds.map(id => safeId(id, 'examinerId')))]
  if (examinerIds.length !== input.examinerIds.length) invalidInput('Daftar penguji mengandung duplikasi.')
  return {
    name: cleanText(input.name, 'name', 160),
    kind,
    waveId,
    programStudyId,
    location: cleanText(input.location, 'location', 200),
    startsAt,
    endsAt,
    capacity: requireInteger(input.capacity, 'capacity', 1, 1_000),
    examinerIds,
  }
}

function validateScore(input: FinalizeSelectionScoreInput): { components: AdmissionScoreComponent[]; totalScore: number; recommendation: AdmissionSelectionScore['recommendation'] } {
  if (!Array.isArray(input.components) || !input.components.length || input.components.length > 20) {
    invalidInput('Komponen penilaian harus berisi 1-20 item.')
  }
  const components = input.components.map((component, index) => {
    const key = safeId(component.key, `components[${index}].key`)
    const label = cleanText(component.label, `components[${index}].label`, 100)
    const maximumScore = requireInteger(component.maximumScore, `components[${index}].maximumScore`, 1, 1_000)
    const score = requireInteger(component.score, `components[${index}].score`, 0, maximumScore)
    return { key, label, score, maximumScore }
  })
  if (new Set(components.map(component => component.key)).size !== components.length) invalidInput('Kunci komponen nilai harus unik.')
  const recommendation = requireString(input.recommendation, 'recommendation', { max: 20 }) as AdmissionSelectionScore['recommendation']
  if (!RECOMMENDATIONS.includes(recommendation)) invalidInput('Rekomendasi seleksi tidak valid.')
  const achieved = components.reduce((sum, component) => sum + component.score, 0)
  const maximum = components.reduce((sum, component) => sum + component.maximumScore, 0)
  return { components, recommendation, totalScore: Math.round((achieved / maximum) * 10_000) / 100 }
}

async function loadApplication(applicationId: string): Promise<AdmissionApplicationRecord> {
  if (dataMode() === 'mock') {
    const record = admissionModuleState().applications.get(applicationId)
    if (!record) notFound('Pendaftaran PMB')
    return structuredClone(record)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan PMB tidak tersedia.')
  const snapshot = await db.collection('admissionApplications').doc(applicationId).get()
  if (!snapshot.exists) notFound('Pendaftaran PMB')
  return { id: snapshot.id, ...snapshot.data() } as AdmissionApplicationRecord
}

async function loadSession(sessionId: string): Promise<AdmissionSelectionSession> {
  if (dataMode() === 'mock') {
    const record = admissionSelectionModuleState().sessions.get(sessionId)
    if (!record) notFound('Sesi seleksi')
    return structuredClone(record)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan seleksi PMB tidak tersedia.')
  const snapshot = await db.collection('admissionSelectionSessions').doc(sessionId).get()
  if (!snapshot.exists) notFound('Sesi seleksi')
  return { id: snapshot.id, ...snapshot.data() } as AdmissionSelectionSession
}

async function loadAssignment(assignmentId: string): Promise<AdmissionSelectionAssignment> {
  if (dataMode() === 'mock') {
    const record = admissionSelectionModuleState().assignments.get(assignmentId)
    if (!record) notFound('Penempatan peserta')
    return structuredClone(record)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan seleksi PMB tidak tersedia.')
  const snapshot = await db.collection('admissionSelectionAssignments').doc(assignmentId).get()
  if (!snapshot.exists) notFound('Penempatan peserta')
  return { id: snapshot.id, ...snapshot.data() } as AdmissionSelectionAssignment
}

export async function createAdmissionSelectionSession(
  context: AuthContext,
  inputValue: CreateSelectionSessionInput,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AdmissionSelectionWriteResult<AdmissionSelectionSession>> {
  const input = normalizedSessionInput(inputValue)
  requireStaffProgramScope(context, input.programStudyId)
  const hash = requestHash(input)
  const namespace = `admission-selection-session:${context.uid}:${idempotencyKey}`
  const id = opaqueId('admission_session', idempotencyKey)
  const now = clock.toISOString()
  const session: AdmissionSelectionSession = {
    id, ...input, assignedCount: 0, status: 'SCHEDULED', version: 1,
    createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid,
  }
  let result: AdmissionSelectionWriteResult<AdmissionSelectionSession>
  if (dataMode() === 'mock') {
    const prior = admissionSelectionModuleState().idempotency.get(namespace)
    if (prior) {
      if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk sesi berbeda.')
      return { ...(structuredClone(prior.response) as AdmissionSelectionWriteResult<AdmissionSelectionSession>), replayed: true, auditId: undefined }
    }
    admissionSelectionModuleState().sessions.set(id, structuredClone(session))
    result = { value: session, replayed: false }
    admissionSelectionModuleState().idempotency.set(namespace, { requestHash: hash, response: structuredClone(result), createdAt: now })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan seleksi PMB tidak tersedia.')
    const reference = db.collection('admissionSelectionSessions').doc(id)
    const idemRef = db.collection('admissionSelectionIdempotency').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const prior = await transaction.get(idemRef)
      if (prior.exists) {
        const stored = prior.data() as { requestHash: string; response: AdmissionSelectionWriteResult<AdmissionSelectionSession> }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk sesi berbeda.')
        return { ...stored.response, replayed: true, auditId: undefined }
      }
      const response: AdmissionSelectionWriteResult<AdmissionSelectionSession> = { value: session, replayed: false }
      transaction.create(reference, session)
      transaction.create(idemRef, { requestHash: hash, response, createdAt: now, expiresAt: new Date(clock.getTime() + IDEMPOTENCY_TTL_MS).toISOString() })
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'ADMISSION_SELECTION_SESSION_CREATED', resourceType: 'admission_selection_session', resourceId: id, after: { kind: session.kind, programStudyId: session.programStudyId, waveId: session.waveId, startsAt: session.startsAt, capacity: session.capacity }, event })
  result.auditId = audit.id
  return result
}

function assignmentFrom(session: AdmissionSelectionSession, application: AdmissionApplicationRecord, now: string): AdmissionSelectionAssignment {
  return {
    id: opaqueId('admission_assignment', `${session.id}:${application.id}`),
    sessionId: session.id,
    applicationId: application.id,
    ...(application.applicantUid ? { applicantUid: application.applicantUid } : {}),
    registrationNumber: application.registrationNumber,
    applicantName: application.fullName,
    applicantEmail: application.email,
    waveId: application.waveId,
    programStudyId: application.programStudyId,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    location: session.location,
    status: 'SCHEDULED',
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
}

function requireAssignable(session: AdmissionSelectionSession, application: AdmissionApplicationRecord): void {
  if (session.status !== 'SCHEDULED') conflict('SELECTION_SESSION_NOT_OPEN', 'Sesi seleksi tidak menerima peserta.')
  if (session.assignedCount >= session.capacity) conflict('SELECTION_SESSION_FULL', 'Kapasitas sesi seleksi telah penuh.')
  if (application.status !== 'DOCUMENTS_VERIFIED') conflict('APPLICATION_NOT_SELECTION_READY', 'Berkas pendaftar belum siap untuk seleksi.')
  if (application.registrationFeeStatus !== 'PAID' && application.registrationFeeStatus !== 'WAIVED') {
    conflict('ADMISSION_FEE_NOT_FINAL', 'Biaya pendaftaran belum tervalidasi.')
  }
  if (application.waveId !== session.waveId || application.programStudyId !== session.programStudyId) {
    conflict('APPLICATION_SESSION_SCOPE_MISMATCH', 'Pendaftar tidak cocok dengan gelombang/program sesi.')
  }
}

export async function assignApplicantToSelectionSession(
  context: AuthContext,
  sessionIdValue: string,
  applicationIdValue: string,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AdmissionSelectionWriteResult<AdmissionSelectionAssignment>> {
  const sessionId = safeId(sessionIdValue, 'sessionId')
  const applicationId = safeId(applicationIdValue, 'applicationId')
  const hash = requestHash({ sessionId, applicationId })
  const namespace = `admission-selection-assignment:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let result: AdmissionSelectionWriteResult<AdmissionSelectionAssignment>
  if (dataMode() === 'mock') {
    const state = admissionSelectionModuleState()
    const prior = state.idempotency.get(namespace)
    if (prior) {
      if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk penempatan berbeda.')
      return { ...(structuredClone(prior.response) as AdmissionSelectionWriteResult<AdmissionSelectionAssignment>), replayed: true, auditId: undefined }
    }
    const session = await loadSession(sessionId)
    requireStaffProgramScope(context, session.programStudyId)
    const application = await loadApplication(applicationId)
    requireAssignable(session, application)
    const assignment = assignmentFrom(session, application, now)
    if (state.assignments.has(assignment.id)) conflict('SELECTION_ASSIGNMENT_EXISTS', 'Pendaftar sudah ditempatkan pada sesi ini.')
    const schedule = state.applicantSchedules.get(applicationId) ?? { applicationId, sessions: [], version: 0 }
    if (schedule.sessions.some(item => overlap(item, session))) conflict('SELECTION_SCHEDULE_CONFLICT', 'Jadwal seleksi pendaftar bertabrakan.')
    if (schedule.sessions.length >= 20) conflict('SELECTION_SCHEDULE_LIMIT', 'Terlalu banyak sesi seleksi untuk satu pendaftar.')
    state.sessions.set(session.id, { ...session, assignedCount: session.assignedCount + 1, version: session.version + 1, updatedAt: now, updatedBy: context.uid })
    state.assignments.set(assignment.id, structuredClone(assignment))
    state.applicantSchedules.set(applicationId, { applicationId, sessions: [...schedule.sessions, { sessionId, startsAt: session.startsAt, endsAt: session.endsAt }], version: schedule.version + 1 })
    result = { value: assignment, replayed: false }
    state.idempotency.set(namespace, { requestHash: hash, response: structuredClone(result), createdAt: now })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan seleksi PMB tidak tersedia.')
    const sessionRef = db.collection('admissionSelectionSessions').doc(sessionId)
    const applicationRef = db.collection('admissionApplications').doc(applicationId)
    const assignmentRef = db.collection('admissionSelectionAssignments').doc(opaqueId('admission_assignment', `${sessionId}:${applicationId}`))
    const scheduleRef = db.collection('admissionApplicationSchedules').doc(applicationId)
    const idemRef = db.collection('admissionSelectionIdempotency').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [prior, sessionSnapshot, applicationSnapshot, assignmentSnapshot, scheduleSnapshot] = await Promise.all([
        transaction.get(idemRef), transaction.get(sessionRef), transaction.get(applicationRef), transaction.get(assignmentRef), transaction.get(scheduleRef),
      ])
      if (prior.exists) {
        const stored = prior.data() as { requestHash: string; response: AdmissionSelectionWriteResult<AdmissionSelectionAssignment> }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk penempatan berbeda.')
        return { ...stored.response, replayed: true, auditId: undefined }
      }
      if (!sessionSnapshot.exists) notFound('Sesi seleksi')
      if (!applicationSnapshot.exists) notFound('Pendaftaran PMB')
      if (assignmentSnapshot.exists) conflict('SELECTION_ASSIGNMENT_EXISTS', 'Pendaftar sudah ditempatkan pada sesi ini.')
      const session = { id: sessionSnapshot.id, ...sessionSnapshot.data() } as AdmissionSelectionSession
      const application = { id: applicationSnapshot.id, ...applicationSnapshot.data() } as AdmissionApplicationRecord
      requireStaffProgramScope(context, session.programStudyId)
      requireAssignable(session, application)
      const schedule = scheduleSnapshot.exists
        ? scheduleSnapshot.data() as { applicationId: string; sessions: Array<{ sessionId: string; startsAt: string; endsAt: string }>; version: number }
        : { applicationId, sessions: [], version: 0 }
      if (schedule.sessions.some(item => overlap(item, session))) conflict('SELECTION_SCHEDULE_CONFLICT', 'Jadwal seleksi pendaftar bertabrakan.')
      if (schedule.sessions.length >= 20) conflict('SELECTION_SCHEDULE_LIMIT', 'Terlalu banyak sesi seleksi untuk satu pendaftar.')
      const assignment = assignmentFrom(session, application, now)
      const response: AdmissionSelectionWriteResult<AdmissionSelectionAssignment> = { value: assignment, replayed: false }
      transaction.update(sessionRef, { assignedCount: session.assignedCount + 1, version: session.version + 1, updatedAt: now, updatedBy: context.uid })
      transaction.create(assignmentRef, assignment)
      transaction.set(scheduleRef, { applicationId, sessions: [...schedule.sessions, { sessionId, startsAt: session.startsAt, endsAt: session.endsAt }], version: schedule.version + 1 })
      transaction.create(idemRef, { requestHash: hash, response, createdAt: now, expiresAt: new Date(clock.getTime() + IDEMPOTENCY_TTL_MS).toISOString() })
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'ADMISSION_SELECTION_APPLICANT_ASSIGNED', resourceType: 'admission_selection_assignment', resourceId: result.value.id, after: { sessionId, applicationId, programStudyId: result.value.programStudyId }, event })
  result.auditId = audit.id
  return result
}

function canScore(context: AuthContext, session: AdmissionSelectionSession): boolean {
  return staffProgramScope(context, session.programStudyId)
    || (hasRole(context, 'lecturer', 'advisor') && session.examinerIds.includes(context.uid))
}

export async function finalizeAdmissionSelectionScore(
  context: AuthContext,
  assignmentIdValue: string,
  inputValue: FinalizeSelectionScoreInput,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AdmissionSelectionWriteResult<AdmissionSelectionScore>> {
  const assignmentId = safeId(assignmentIdValue, 'assignmentId')
  const input = validateScore(inputValue)
  const hash = requestHash({ assignmentId, ...input })
  const namespace = `admission-selection-score:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let result: AdmissionSelectionWriteResult<AdmissionSelectionScore>
  const build = (assignment: AdmissionSelectionAssignment, session: AdmissionSelectionSession): AdmissionSelectionScore => {
    if (!canScore(context, session)) forbidden('Anda bukan penguji atau panitia berwenang untuk sesi ini.')
    if (clock.getTime() < Date.parse(session.startsAt)) conflict('SELECTION_NOT_STARTED', 'Nilai tidak dapat difinalkan sebelum sesi dimulai.')
    if (assignment.status !== 'SCHEDULED' && assignment.status !== 'ATTENDED') conflict('ASSIGNMENT_NOT_SCORABLE', 'Penempatan peserta tidak dapat dinilai.')
    const base = {
      id: opaqueId('admission_score', assignment.id), assignmentId: assignment.id, sessionId: assignment.sessionId,
      applicationId: assignment.applicationId, programStudyId: assignment.programStudyId,
      components: input.components, totalScore: input.totalScore, recommendation: input.recommendation,
      finalizedAt: now, finalizedBy: context.uid, immutable: true as const,
    }
    return { ...base, contentHash: requestHash(base) }
  }
  if (dataMode() === 'mock') {
    const state = admissionSelectionModuleState()
    const prior = state.idempotency.get(namespace)
    if (prior) {
      if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk nilai berbeda.')
      return { ...(structuredClone(prior.response) as AdmissionSelectionWriteResult<AdmissionSelectionScore>), replayed: true, auditId: undefined }
    }
    const assignment = await loadAssignment(assignmentId)
    const session = await loadSession(assignment.sessionId)
    const scoreId = opaqueId('admission_score', assignment.id)
    if (state.scores.has(scoreId)) conflict('SELECTION_SCORE_FINAL', 'Nilai seleksi telah difinalkan dan tidak dapat ditimpa.')
    const score = build(assignment, session)
    state.scores.set(score.id, structuredClone(score))
    state.assignments.set(assignment.id, { ...assignment, status: 'SCORED', version: assignment.version + 1, updatedAt: now })
    result = { value: score, replayed: false }
    state.idempotency.set(namespace, { requestHash: hash, response: structuredClone(result), createdAt: now })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan seleksi PMB tidak tersedia.')
    const assignmentRef = db.collection('admissionSelectionAssignments').doc(assignmentId)
    const scoreRef = db.collection('admissionSelectionScores').doc(opaqueId('admission_score', assignmentId))
    const idemRef = db.collection('admissionSelectionIdempotency').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [prior, assignmentSnapshot, scoreSnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(assignmentRef), transaction.get(scoreRef)])
      if (prior.exists) {
        const stored = prior.data() as { requestHash: string; response: AdmissionSelectionWriteResult<AdmissionSelectionScore> }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk nilai berbeda.')
        return { ...stored.response, replayed: true, auditId: undefined }
      }
      if (!assignmentSnapshot.exists) notFound('Penempatan peserta')
      if (scoreSnapshot.exists) conflict('SELECTION_SCORE_FINAL', 'Nilai seleksi telah difinalkan dan tidak dapat ditimpa.')
      const assignment = { id: assignmentSnapshot.id, ...assignmentSnapshot.data() } as AdmissionSelectionAssignment
      const sessionRef = db.collection('admissionSelectionSessions').doc(assignment.sessionId)
      const sessionSnapshot = await transaction.get(sessionRef)
      if (!sessionSnapshot.exists) notFound('Sesi seleksi')
      const session = { id: sessionSnapshot.id, ...sessionSnapshot.data() } as AdmissionSelectionSession
      const score = build(assignment, session)
      const response: AdmissionSelectionWriteResult<AdmissionSelectionScore> = { value: score, replayed: false }
      transaction.create(scoreRef, score)
      transaction.update(assignmentRef, { status: 'SCORED', version: assignment.version + 1, updatedAt: now })
      transaction.create(idemRef, { requestHash: hash, response, createdAt: now, expiresAt: new Date(clock.getTime() + IDEMPOTENCY_TTL_MS).toISOString() })
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'ADMISSION_SELECTION_SCORE_FINALIZED', resourceType: 'admission_selection_score', resourceId: result.value.id, after: { assignmentId, totalScore: result.value.totalScore, recommendation: result.value.recommendation, contentHash: result.value.contentHash }, event })
  result.auditId = audit.id
  return result
}

function programName(programStudyId: string): string {
  return ADMISSION_PROGRAMS.find(program => program.id === programStudyId)?.name || programStudyId
}

function buildLetter(application: AdmissionApplicationRecord, sequence: number, verificationCode: string, context: AuthContext, now: string): AdmissionLetterOfAcceptance {
  const year = new Date(now).getUTCFullYear()
  const id = opaqueId('admission_loa', application.id)
  const base = {
    id,
    applicationId: application.id,
    applicantUid: application.applicantUid!,
    registrationNumber: application.registrationNumber,
    applicantName: application.fullName,
    programStudyId: application.programStudyId,
    programStudyName: programName(application.programStudyId),
    academicYear: application.academicYear,
    documentNumber: `LOA/${application.programStudyId.toUpperCase()}/${year}/${String(sequence).padStart(5, '0')}`,
    verificationCode,
    status: 'ISSUED' as const,
    issuedAt: now,
    issuedBy: context.uid,
    version: 1,
  }
  return { ...base, contentHash: requestHash(base) }
}

function requireLetterEligible(context: AuthContext, application: AdmissionApplicationRecord, expectedVersion: number): void {
  requireStaffProgramScope(context, application.programStudyId)
  if (application.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Pendaftaran telah berubah.', { currentVersion: application.version })
  if (application.status !== 'ACCEPTED') conflict('APPLICATION_NOT_ACCEPTED', 'Letter of Acceptance hanya dapat diterbitkan bagi pendaftar diterima.')
  if (application.registrationFeeStatus !== 'PAID' && application.registrationFeeStatus !== 'WAIVED') conflict('ADMISSION_FEE_NOT_FINAL', 'Biaya pendaftaran belum tervalidasi.')
  if (!application.applicantUid) conflict('APPLICATION_NOT_CLAIMED', 'Pendaftar harus menautkan akun sebelum Letter of Acceptance diterbitkan.')
}

export async function issueAdmissionLetterOfAcceptance(
  context: AuthContext,
  applicationIdValue: string,
  expectedVersion: number,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AdmissionSelectionWriteResult<AdmissionLetterOfAcceptance>> {
  const applicationId = safeId(applicationIdValue, 'applicationId')
  const version = requireInteger(expectedVersion, 'expectedVersion', 1)
  const hash = requestHash({ applicationId, expectedVersion: version })
  const namespace = `admission-loa:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  const verificationCode = randomBytes(16).toString('hex').toUpperCase()
  let result: AdmissionSelectionWriteResult<AdmissionLetterOfAcceptance>
  if (dataMode() === 'mock') {
    const state = admissionSelectionModuleState()
    const prior = state.idempotency.get(namespace)
    if (prior) {
      if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk LoA berbeda.')
      return { ...(structuredClone(prior.response) as AdmissionSelectionWriteResult<AdmissionLetterOfAcceptance>), replayed: true, auditId: undefined }
    }
    const application = await loadApplication(applicationId)
    requireLetterEligible(context, application, version)
    const existingId = state.letterAssignments.get(application.id)
    if (existingId) conflict('LOA_ALREADY_ISSUED', 'Letter of Acceptance telah diterbitkan untuk pendaftar ini.')
    const counterKey = `${new Date(now).getUTCFullYear()}:${application.programStudyId}`
    const sequence = (state.letterCounters.get(counterKey) || 0) + 1
    const letter = buildLetter(application, sequence, verificationCode, context, now)
    state.letterCounters.set(counterKey, sequence)
    state.letters.set(letter.id, structuredClone(letter))
    state.letterAssignments.set(application.id, letter.id)
    result = { value: letter, replayed: false }
    state.idempotency.set(namespace, { requestHash: hash, response: structuredClone(result), createdAt: now })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan LoA tidak tersedia.')
    const applicationRef = db.collection('admissionApplications').doc(applicationId)
    const letterId = opaqueId('admission_loa', applicationId)
    const letterRef = db.collection('admissionLetters').doc(letterId)
    const assignmentRef = db.collection('admissionLetterAssignments').doc(applicationId)
    const idemRef = db.collection('admissionSelectionIdempotency').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [prior, applicationSnapshot, assignmentSnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(applicationRef), transaction.get(assignmentRef)])
      if (prior.exists) {
        const stored = prior.data() as { requestHash: string; response: AdmissionSelectionWriteResult<AdmissionLetterOfAcceptance> }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk LoA berbeda.')
        return { ...stored.response, replayed: true, auditId: undefined }
      }
      if (!applicationSnapshot.exists) notFound('Pendaftaran PMB')
      if (assignmentSnapshot.exists) conflict('LOA_ALREADY_ISSUED', 'Letter of Acceptance telah diterbitkan untuk pendaftar ini.')
      const application = { id: applicationSnapshot.id, ...applicationSnapshot.data() } as AdmissionApplicationRecord
      requireLetterEligible(context, application, version)
      const counterKey = `${new Date(now).getUTCFullYear()}:${application.programStudyId}`
      const counterRef = db.collection('admissionLetterCounters').doc(counterKey)
      const counterSnapshot = await transaction.get(counterRef)
      const previous = Number(counterSnapshot.data()?.lastSequence || 0)
      if (!Number.isSafeInteger(previous) || previous < 0) serviceUnavailable('Counter LoA tidak valid.')
      const sequence = previous + 1
      const letter = buildLetter(application, sequence, verificationCode, context, now)
      const response: AdmissionSelectionWriteResult<AdmissionLetterOfAcceptance> = { value: letter, replayed: false }
      transaction.set(counterRef, { lastSequence: sequence, programStudyId: application.programStudyId, year: new Date(now).getUTCFullYear(), updatedAt: now })
      transaction.create(letterRef, letter)
      transaction.create(assignmentRef, { applicationId, letterId, documentNumber: letter.documentNumber, createdAt: now })
      transaction.create(idemRef, { requestHash: hash, response, createdAt: now, expiresAt: new Date(clock.getTime() + IDEMPOTENCY_TTL_MS).toISOString() })
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'ADMISSION_LOA_ISSUED', resourceType: 'admission_letter', resourceId: result.value.id, after: { applicationId, documentNumber: result.value.documentNumber, contentHash: result.value.contentHash }, event })
  result.auditId = audit.id
  return result
}

export async function listAdmissionSelectionSessions(context: AuthContext): Promise<AdmissionSelectionSession[]> {
  let records: AdmissionSelectionSession[]
  if (dataMode() === 'mock') records = [...admissionSelectionModuleState().sessions.values()].map(record => structuredClone(record))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan seleksi PMB tidak tersedia.')
    const snapshot = await db.collection('admissionSelectionSessions').limit(QUERY_LIMIT).get()
    records = snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as AdmissionSelectionSession)
  }
  return records.filter(record => canReadProgram(context, record.programStudyId) || record.examinerIds.includes(context.uid)).sort((left, right) => left.startsAt.localeCompare(right.startsAt))
}

export async function listAdmissionSelectionAssignments(context: AuthContext): Promise<AdmissionSelectionAssignment[]> {
  let records: AdmissionSelectionAssignment[]
  let examinerSessionIds = new Set<string>()
  if (dataMode() === 'mock') records = [...admissionSelectionModuleState().assignments.values()].map(record => structuredClone(record))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan seleksi PMB tidak tersedia.')
    const [snapshot, examinerSessions] = await Promise.all([
      hasRole(context, 'applicant')
        ? db.collection('admissionSelectionAssignments').where('applicantUid', '==', context.uid).limit(100).get()
        : db.collection('admissionSelectionAssignments').limit(QUERY_LIMIT).get(),
      hasRole(context, 'lecturer', 'advisor')
        ? db.collection('admissionSelectionSessions').where('examinerIds', 'array-contains', context.uid).limit(100).get()
        : Promise.resolve(undefined),
    ])
    examinerSessionIds = new Set(examinerSessions?.docs.map(document => document.id) || [])
    records = snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as AdmissionSelectionAssignment)
  }
  const sessions = dataMode() === 'mock' ? admissionSelectionModuleState().sessions : undefined
  return records.filter(record => record.applicantUid === context.uid
    || canReadProgram(context, record.programStudyId)
    || examinerSessionIds.has(record.sessionId)
    || Boolean(sessions?.get(record.sessionId)?.examinerIds.includes(context.uid)))
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
}

export async function listAdmissionLetters(context: AuthContext): Promise<AdmissionLetterOfAcceptance[]> {
  let records: AdmissionLetterOfAcceptance[]
  if (dataMode() === 'mock') records = [...admissionSelectionModuleState().letters.values()].map(record => structuredClone(record))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan LoA tidak tersedia.')
    const snapshot = hasRole(context, 'applicant', 'student')
      ? await db.collection('admissionLetters').where('applicantUid', '==', context.uid).limit(20).get()
      : await db.collection('admissionLetters').limit(QUERY_LIMIT).get()
    records = snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as AdmissionLetterOfAcceptance)
  }
  return records.filter(record => record.applicantUid === context.uid || canReadProgram(context, record.programStudyId)).sort((left, right) => right.issuedAt.localeCompare(left.issuedAt))
}

export async function verifyAdmissionLetter(codeValue: string): Promise<AdmissionLetterVerification> {
  const code = requireString(codeValue, 'verificationCode', { min: 32, max: 32, pattern: /^[A-F0-9]{32}$/ })
  let letter: AdmissionLetterOfAcceptance | undefined
  if (dataMode() === 'mock') letter = [...admissionSelectionModuleState().letters.values()].find(record => record.verificationCode === code)
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan LoA tidak tersedia.')
    const snapshot = await db.collection('admissionLetters').where('verificationCode', '==', code).limit(2).get()
    if (snapshot.size > 1) serviceUnavailable('Kode verifikasi LoA tidak unik.')
    const document = snapshot.docs[0]
    if (document) letter = { id: document.id, ...document.data() } as AdmissionLetterOfAcceptance
  }
  if (!letter) return { valid: false }
  return {
    valid: letter.status === 'ISSUED',
    documentNumber: letter.documentNumber,
    registrationNumber: letter.registrationNumber,
    applicantName: letter.applicantName,
    programStudyName: letter.programStudyName,
    academicYear: letter.academicYear,
    issuedAt: letter.issuedAt,
    status: letter.status,
    contentHash: letter.contentHash,
  }
}
