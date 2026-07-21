import { createHmac } from 'node:crypto'
import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import {
  ADMISSION_PATH_IDS,
  ADMISSION_STATUSES,
  STUDY_MODE_IDS,
  type AdmissionApplicationRecord,
  type AdmissionApplicationView,
  type AdmissionConversionResult,
  type AdmissionFeeStatus,
  type AdmissionListOptions,
  type AdmissionListResult,
  type AdmissionProgram,
  type AdmissionStatus,
  type AdmissionStudentRecord,
  type AdmissionSubmissionInput,
  type AdmissionWave,
} from '../types/admissions'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { requireInteger, requireRecord, requireString } from '../utils/validation'
import { promoteApplicantAccount } from './accounts'
import { requiredAdmissionDocumentsVerified } from './admissions-documents'
import { admissionSelectionModuleState } from './admissions-selection-state'
import { admissionModuleState } from './admissions-state'

const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

export const ADMISSION_PROGRAMS: readonly AdmissionProgram[] = [
  { id: 'management-s1', code: 'MGT', name: 'S1 Manajemen', unitId: 'faculty-economics', active: true },
  { id: 'accounting-s1', code: 'ACC', name: 'S1 Akuntansi', unitId: 'faculty-economics', active: true },
  { id: 'informatics-s1', code: 'INF', name: 'S1 Informatika', unitId: 'faculty-engineering', active: true },
  { id: 'information-systems-s1', code: 'INS', name: 'S1 Sistem Informasi', unitId: 'faculty-engineering', active: true },
  { id: 'communication-science-s1', code: 'COM', name: 'S1 Ilmu Komunikasi', unitId: 'faculty-social-sciences', active: true },
] as const

export const ADMISSION_WAVES: readonly AdmissionWave[] = [
  {
    id: '2026-wave-3', academicYear: '2026/2027', label: 'Gelombang 3',
    opensAt: '2026-07-01T00:00:00.000Z', closesAt: '2026-08-31T16:59:59.999Z',
    registrationFee: 500_000, currency: 'IDR', active: true,
  },
] as const

const REVIEW_TRANSITIONS: Record<AdmissionStatus, AdmissionStatus[]> = {
  SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['DOCUMENTS_VERIFIED', 'REJECTED'],
  DOCUMENTS_VERIFIED: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: [],
  ENROLLMENT_PENDING_IDENTITY: [],
  ENROLLED: [],
}

function cleanText(value: unknown, label: string, max: number): string {
  const text = requireString(value, label, { max }).normalize('NFKC')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) invalidInput(`${label} tidak boleh kosong.`)
  return text
}

function normalizeEmail(value: unknown): string {
  return requireString(value, 'email', { max: 254, pattern: EMAIL_PATTERN }).toLocaleLowerCase('en-US')
}

function piiHashSecret(): string {
  const configured = process.env.PMB_PII_HASH_SECRET || process.env.RATE_LIMIT_KEY_SECRET || process.env.NUXT_SESSION_SECRET
  if (configured && configured.length >= 32) return configured
  if (process.env.NODE_ENV === 'production') serviceUnavailable('Kunci proteksi identitas PMB belum dikonfigurasi.')
  return 'pmb-development-pii-fingerprint-key-change-me'
}

function identityFingerprint(identityNumber: string): string {
  return createHmac('sha256', piiHashSecret()).update(`pmb-identity\0${identityNumber}`).digest('hex')
}

function applicationView(record: AdmissionApplicationRecord): AdmissionApplicationView {
  const { identityFingerprint: _privateFingerprint, ...view } = record
  return structuredClone(view)
}

function anonymousActor(now: number): AuthContext {
  return {
    uid: 'anonymous-admission-applicant',
    displayName: 'Pendaftar PMB',
    roles: [],
    scope: { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: [] },
    provider: 'demo',
    issuedAt: now,
    expiresAt: now,
  }
}

function programById(id: string): AdmissionProgram {
  const program = ADMISSION_PROGRAMS.find(item => item.id === id && item.active)
  if (!program) invalidInput('Program studi PMB tidak valid atau tidak aktif.')
  return program
}

function waveById(id: string, now?: number): AdmissionWave {
  const wave = ADMISSION_WAVES.find(item => item.id === id && item.active)
  if (!wave) invalidInput('Gelombang PMB tidak valid atau tidak aktif.')
  if (now !== undefined && (now < Date.parse(wave.opensAt) || now > Date.parse(wave.closesAt))) {
    conflict('ADMISSION_WAVE_CLOSED', 'Gelombang pendaftaran belum dibuka atau telah ditutup.')
  }
  return wave
}

function normalizeSubmission(value: unknown, now: number): AdmissionSubmissionInput & {
  identityNumber: string
  program: AdmissionProgram
  wave: AdmissionWave
} {
  const body = requireRecord(value)
  const allowed = new Set([
    'fullName', 'email', 'phone', 'identityNumber', 'programStudyId', 'admissionPathId',
    'studyModeId', 'waveId', 'priorInstitution', 'graduationYear', 'sourceInformation', 'consent',
  ])
  const unsupported = Object.keys(body).filter(key => !allowed.has(key))
  if (unsupported.length) invalidInput(`Field tidak didukung: ${unsupported.join(', ')}.`)
  if (body.consent !== true) invalidInput('Persetujuan pemrosesan data wajib diberikan.')
  const identityNumber = requireString(body.identityNumber, 'identityNumber', { min: 16, max: 16, pattern: /^\d{16}$/ })
  const phone = requireString(body.phone, 'phone', { min: 8, max: 18, pattern: /^\+?\d+$/ })
  const programStudyId = requireString(body.programStudyId, 'programStudyId', { max: 80, pattern: SAFE_ID })
  const waveId = requireString(body.waveId, 'waveId', { max: 80, pattern: SAFE_ID })
  const admissionPathId = requireString(body.admissionPathId, 'admissionPathId', { max: 40 }) as AdmissionSubmissionInput['admissionPathId']
  const studyModeId = requireString(body.studyModeId, 'studyModeId', { max: 40 }) as AdmissionSubmissionInput['studyModeId']
  if (!ADMISSION_PATH_IDS.includes(admissionPathId)) invalidInput('Jalur pendaftaran tidak valid.')
  if (!STUDY_MODE_IDS.includes(studyModeId)) invalidInput('Sistem perkuliahan tidak valid.')
  const graduationYear = requireInteger(body.graduationYear, 'graduationYear', 1950, new Date(now).getUTCFullYear())
  return {
    fullName: cleanText(body.fullName, 'fullName', 150),
    email: normalizeEmail(body.email),
    phone,
    identityNumber,
    programStudyId,
    admissionPathId,
    studyModeId,
    waveId,
    priorInstitution: cleanText(body.priorInstitution, 'priorInstitution', 180),
    graduationYear,
    ...(body.sourceInformation !== undefined
      ? { sourceInformation: cleanText(body.sourceInformation, 'sourceInformation', 80) }
      : {}),
    consent: true,
    program: programById(programStudyId),
    wave: waveById(waveId, now),
  }
}

function buildApplication(
  normalized: ReturnType<typeof normalizeSubmission>,
  idempotencyKey: string,
  applicant: AuthContext | null,
  now: Date,
): AdmissionApplicationRecord {
  const submittedAt = now.toISOString()
  const hash = requestHash({ idempotencyKey, email: normalized.email, identity: normalized.identityNumber })
  const id = opaqueId('admission', hash)
  const registrationNumber = `PMB-${normalized.wave.academicYear.slice(0, 4)}-${hash.slice(0, 6).toUpperCase()}`
  return {
    id,
    registrationNumber,
    ...(applicant?.roles.includes('applicant') ? { applicantUid: applicant.uid } : {}),
    fullName: normalized.fullName,
    email: normalized.email,
    phone: normalized.phone,
    identityFingerprint: identityFingerprint(normalized.identityNumber),
    identityLast4: normalized.identityNumber.slice(-4),
    programStudyId: normalized.program.id,
    unitId: normalized.program.unitId,
    admissionPathId: normalized.admissionPathId,
    studyModeId: normalized.studyModeId,
    waveId: normalized.wave.id,
    academicYear: normalized.wave.academicYear,
    priorInstitution: normalized.priorInstitution,
    graduationYear: normalized.graduationYear,
    ...(normalized.sourceInformation ? { sourceInformation: normalized.sourceInformation } : {}),
    consentedAt: submittedAt,
    submittedAt,
    status: 'SUBMITTED',
    registrationFeeStatus: 'UNPAID',
    registrationFeeAmount: normalized.wave.registrationFee,
    version: 1,
    updatedAt: submittedAt,
    updatedBy: applicant?.uid || 'self-service',
  }
}

export function admissionCatalog(): {
  programs: AdmissionProgram[]
  waves: AdmissionWave[]
  paths: typeof ADMISSION_PATH_IDS
  studyModes: typeof STUDY_MODE_IDS
} {
  return {
    programs: structuredClone([...ADMISSION_PROGRAMS]),
    waves: structuredClone([...ADMISSION_WAVES]),
    paths: [...ADMISSION_PATH_IDS],
    studyModes: [...STUDY_MODE_IDS],
  }
}

export async function submitAdmissionApplication(
  value: unknown,
  idempotencyKey: string,
  applicant: AuthContext | null,
  event?: H3Event,
  now = new Date(),
): Promise<{ application: AdmissionApplicationView; replayed: boolean; auditId?: string }> {
  if (applicant && !applicant.roles.includes('applicant')) forbidden('Hanya akun applicant yang dapat menautkan pendaftaran mandiri.')
  const normalized = normalizeSubmission(value, now.getTime())
  const candidate = buildApplication(normalized, idempotencyKey, applicant, now)
  const payloadHash = requestHash({
    ...normalized,
    identityNumber: candidate.identityFingerprint,
    program: undefined,
    wave: undefined,
  })
  const namespace = `admission-submit:${idempotencyKey}`
  let application = candidate
  let replayed = false

  if (dataMode() === 'mock') {
    const state = admissionModuleState()
    const prior = state.idempotency.get(namespace)
    if (prior) {
      if (prior.requestHash !== payloadHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk data pendaftaran berbeda.')
      const applicationId = (prior.response as { applicationId: string }).applicationId
      const existing = state.applications.get(applicationId)
      if (!existing) serviceUnavailable('Referensi pendaftaran idempotent tidak konsisten.')
      return { application: applicationView(existing), replayed: true }
    }
    const duplicate = [...state.applications.values()].find(item => item.waveId === candidate.waveId
      && item.identityFingerprint === candidate.identityFingerprint)
    if (duplicate) conflict('APPLICATION_ALREADY_EXISTS', 'Data identitas telah memiliki pendaftaran pada gelombang ini.')
    if (state.registrationNumbers.has(candidate.registrationNumber)) conflict('REGISTRATION_NUMBER_COLLISION', 'Nomor pendaftaran tidak dapat dialokasikan; silakan ulangi.')
    state.applications.set(candidate.id, structuredClone(candidate))
    state.registrationNumbers.add(candidate.registrationNumber)
    state.idempotency.set(namespace, { requestHash: payloadHash, response: { applicationId: candidate.id }, createdAt: now.toISOString() })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan PMB tidak tersedia.')
    const applicationRef = db.collection('admissionApplications').doc(candidate.id)
    const idemRef = db.collection('admissionIdempotency').doc(opaqueId('idem', namespace))
    const numberRef = db.collection('admissionRegistrationNumbers').doc(candidate.registrationNumber)
    const identityRef = db.collection('admissionIdentityIndex').doc(opaqueId('identity', `${candidate.waveId}:${candidate.identityFingerprint}`))
    const transactionResult = await db.runTransaction(async (transaction) => {
      const [prior, duplicateIdentity, duplicateNumber] = await Promise.all([
        transaction.get(idemRef), transaction.get(identityRef), transaction.get(numberRef),
      ])
      if (prior.exists) {
        const data = prior.data() as { requestHash: string; applicationId: string }
        if (data.requestHash !== payloadHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk data pendaftaran berbeda.')
        return { replayed: true, applicationId: data.applicationId }
      }
      if (duplicateIdentity.exists) conflict('APPLICATION_ALREADY_EXISTS', 'Data identitas telah memiliki pendaftaran pada gelombang ini.')
      if (duplicateNumber.exists) conflict('REGISTRATION_NUMBER_COLLISION', 'Nomor pendaftaran tidak dapat dialokasikan; silakan ulangi.')
      transaction.create(applicationRef, candidate)
      transaction.create(identityRef, { applicationId: candidate.id, waveId: candidate.waveId, createdAt: candidate.submittedAt })
      transaction.create(numberRef, { applicationId: candidate.id, createdAt: candidate.submittedAt })
      transaction.create(idemRef, {
        requestHash: payloadHash,
        applicationId: candidate.id,
        createdAt: candidate.submittedAt,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
      })
      return { replayed: false, applicationId: candidate.id }
    })
    replayed = transactionResult.replayed
    if (replayed) {
      const snapshot = await db.collection('admissionApplications').doc(transactionResult.applicationId).get()
      if (!snapshot.exists) serviceUnavailable('Referensi pendaftaran idempotent tidak konsisten.')
      application = { id: snapshot.id, ...snapshot.data() } as AdmissionApplicationRecord
    }
  }

  if (replayed) return { application: applicationView(application), replayed: true }
  const audit = await appendAudit({
    actor: applicant || anonymousActor(now.getTime()),
    action: 'ADMISSION_APPLICATION_SUBMITTED',
    resourceType: 'admission_application',
    resourceId: application.id,
    after: {
      registrationNumber: application.registrationNumber,
      programStudyId: application.programStudyId,
      waveId: application.waveId,
      status: application.status,
      consentedAt: application.consentedAt,
    },
    event,
  })
  return { application: applicationView(application), replayed: false, auditId: audit.id }
}

function staffCanRead(context: AuthContext): boolean {
  return hasRole(context, 'admissions_staff', 'leader', 'administrator')
}

function requireStaffRead(context: AuthContext): void {
  if (!staffCanRead(context)) forbidden('Daftar PMB hanya tersedia bagi petugas berwenang.')
}

function requireProgramScope(context: AuthContext, programStudyId: string): void {
  if (hasRole(context, 'administrator', 'leader')) return
  if (!context.scope.programStudyIds.includes(programStudyId)) forbidden('Pendaftaran berada di luar lingkup program studi Anda.')
}

function normalizeStaffProgram(context: AuthContext, requested?: string): string | undefined {
  if (requested) {
    programById(requested)
    requireProgramScope(context, requested)
    return requested
  }
  if (hasRole(context, 'administrator', 'leader')) return undefined
  if (context.scope.programStudyIds.length === 1) return context.scope.programStudyIds[0]
  if (context.scope.programStudyIds.length > 1) invalidInput('programStudyId wajib dipilih untuk akun dengan beberapa lingkup.')
  forbidden('Akun tidak memiliki lingkup program studi PMB.')
}

function normalizeListOptions(context: AuthContext, options: AdmissionListOptions): Required<Pick<AdmissionListOptions, 'limit'>> & AdmissionListOptions {
  const programStudyId = normalizeStaffProgram(context, options.programStudyId)
  if (options.status && !ADMISSION_STATUSES.includes(options.status)) invalidInput('Status pendaftaran tidak valid.')
  if (options.waveId) waveById(options.waveId)
  if (options.cursor && !SAFE_ID.test(options.cursor)) invalidInput('Cursor pendaftaran tidak valid.')
  return {
    ...options,
    ...(programStudyId ? { programStudyId } : {}),
    limit: Math.min(Math.max(Number(options.limit) || 25, 1), 100),
  }
}

function recordMatchesList(record: AdmissionApplicationRecord, options: AdmissionListOptions): boolean {
  return (!options.programStudyId || record.programStudyId === options.programStudyId)
    && (!options.status || record.status === options.status)
    && (!options.waveId || record.waveId === options.waveId)
}

export async function listAdmissionApplications(
  context: AuthContext,
  rawOptions: AdmissionListOptions = {},
): Promise<AdmissionListResult> {
  requireStaffRead(context)
  const options = normalizeListOptions(context, rawOptions)
  if (dataMode() === 'mock') {
    const records = [...admissionModuleState().applications.values()]
      .filter(record => recordMatchesList(record, options))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
    const start = options.cursor ? Math.max(0, records.findIndex(item => item.id === options.cursor) + 1) : 0
    const page = records.slice(start, start + options.limit + 1)
    const hasMore = page.length > options.limit
    const items = page.slice(0, options.limit)
    return {
      items: items.map(applicationView),
      ...(hasMore && items.length ? { nextCursor: items.at(-1)!.id } : {}),
    }
  }

  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan PMB tidak tersedia.')
  let query: FirebaseFirestore.Query = db.collection('admissionApplications').orderBy('updatedAt', 'desc')
  if (options.programStudyId) query = query.where('programStudyId', '==', options.programStudyId)
  if (options.status) query = query.where('status', '==', options.status)
  if (options.waveId) query = query.where('waveId', '==', options.waveId)
  if (options.cursor) {
    const cursor = await db.collection('admissionApplications').doc(options.cursor).get()
    if (!cursor.exists) invalidInput('Cursor pendaftaran tidak ditemukan.')
    query = query.startAfter(cursor)
  }
  const snapshot = await query.limit(options.limit + 1).get()
  const records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as AdmissionApplicationRecord)
  const hasMore = records.length > options.limit
  const page = records.slice(0, options.limit)
  return {
    items: page.map(applicationView),
    ...(hasMore && page.length ? { nextCursor: page.at(-1)!.id } : {}),
  }
}

async function loadApplication(id: string): Promise<AdmissionApplicationRecord> {
  const safeId = requireString(id, 'applicationId', { max: 128, pattern: SAFE_ID })
  if (dataMode() === 'mock') {
    const record = admissionModuleState().applications.get(safeId)
    if (!record) notFound('Pendaftaran PMB')
    return structuredClone(record)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan PMB tidak tersedia.')
  const snapshot = await db.collection('admissionApplications').doc(safeId).get()
  if (!snapshot.exists) notFound('Pendaftaran PMB')
  return { id: snapshot.id, ...snapshot.data() } as AdmissionApplicationRecord
}

function canViewApplication(context: AuthContext, record: AdmissionApplicationRecord): boolean {
  if (record.applicantUid === context.uid || (context.roles.includes('applicant') && context.email?.toLowerCase() === record.email)) return true
  if (!staffCanRead(context)) return false
  if (hasRole(context, 'administrator', 'leader')) return true
  return context.scope.programStudyIds.includes(record.programStudyId)
}

export async function getAdmissionApplication(context: AuthContext, id: string): Promise<AdmissionApplicationView> {
  const record = await loadApplication(id)
  if (!canViewApplication(context, record)) forbidden('Pendaftaran berada di luar lingkup akses Anda.')
  return applicationView(record)
}

export async function listOwnAdmissionApplications(context: AuthContext): Promise<AdmissionApplicationView[]> {
  if (!hasRole(context, 'applicant', 'student')) forbidden('Riwayat pendaftaran hanya tersedia untuk pendaftar.')
  const email = context.email?.toLowerCase()
  if (dataMode() === 'mock') {
    return [...admissionModuleState().applications.values()]
      .filter(record => record.applicantUid === context.uid || Boolean(email && record.email === email))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(applicationView)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan PMB tidak tersedia.')
  const snapshot = await db.collection('admissionApplications').where('applicantUid', '==', context.uid).limit(20).get()
  return snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }) as AdmissionApplicationRecord)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(applicationView)
}

export async function claimAdmissionApplication(
  context: AuthContext,
  id: string,
  registrationNumber: string,
  expectedVersion: number,
  event?: H3Event,
): Promise<{ application: AdmissionApplicationView; auditId: string }> {
  if (!hasRole(context, 'applicant')) forbidden('Hanya akun applicant yang dapat menautkan pendaftaran.')
  if (!context.email) forbidden('Akun applicant belum memiliki email terverifikasi.')
  const safeNumber = requireString(registrationNumber, 'registrationNumber', { max: 40, pattern: /^[A-Z0-9-]+$/ })
  const version = requireInteger(expectedVersion, 'expectedVersion', 1)
  let before: AdmissionApplicationRecord
  let after: AdmissionApplicationRecord
  const update = (record: AdmissionApplicationRecord): AdmissionApplicationRecord => {
    if (record.registrationNumber !== safeNumber || record.email !== context.email!.toLowerCase()) notFound('Pendaftaran PMB')
    if (record.version !== version) conflict('VERSION_CONFLICT', 'Pendaftaran telah berubah.', { currentVersion: record.version })
    if (record.applicantUid && record.applicantUid !== context.uid) conflict('APPLICATION_ALREADY_CLAIMED', 'Pendaftaran telah ditautkan ke akun lain.')
    if (record.applicantUid === context.uid) return structuredClone(record)
    return { ...structuredClone(record), applicantUid: context.uid, version: record.version + 1, updatedAt: new Date().toISOString(), updatedBy: context.uid }
  }
  if (dataMode() === 'mock') {
    before = await loadApplication(id)
    after = update(before)
    admissionModuleState().applications.set(after.id, structuredClone(after))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan PMB tidak tersedia.')
    const reference = db.collection('admissionApplications').doc(requireString(id, 'applicationId', { max: 128, pattern: SAFE_ID }))
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) notFound('Pendaftaran PMB')
      const current = { id: snapshot.id, ...snapshot.data() } as AdmissionApplicationRecord
      const next = update(current)
      if (next.version !== current.version) transaction.set(reference, next)
      return { current, next }
    })
    before = result.current
    after = result.next
  }
  const audit = await appendAudit({
    actor: context, action: 'ADMISSION_APPLICATION_CLAIMED', resourceType: 'admission_application', resourceId: after.id,
    before: { applicantUid: before.applicantUid, version: before.version },
    after: { applicantUid: after.applicantUid, version: after.version }, event,
  })
  return { application: applicationView(after), auditId: audit.id }
}

export async function claimAdmissionApplicationByNumber(
  context: AuthContext,
  registrationNumber: string,
  event?: H3Event,
): Promise<{ application: AdmissionApplicationView; auditId: string }> {
  const safeNumber = requireString(registrationNumber, 'registrationNumber', { max: 40, pattern: /^[A-Z0-9-]+$/ })
  let record: AdmissionApplicationRecord
  if (dataMode() === 'mock') {
    const found = [...admissionModuleState().applications.values()].find(item => item.registrationNumber === safeNumber)
    if (!found) notFound('Pendaftaran PMB')
    record = structuredClone(found)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan PMB tidak tersedia.')
    const index = await db.collection('admissionRegistrationNumbers').doc(safeNumber).get()
    if (!index.exists || typeof index.data()?.applicationId !== 'string') notFound('Pendaftaran PMB')
    record = await loadApplication(index.data()!.applicationId)
  }
  return claimAdmissionApplication(context, record.id, safeNumber, record.version, event)
}

export async function reviewAdmissionApplication(
  context: AuthContext,
  id: string,
  input: { status: AdmissionStatus; expectedVersion: number; notes?: string },
  idempotencyKey: string,
  event?: H3Event,
): Promise<{ application: AdmissionApplicationView; replayed: boolean; auditId?: string }> {
  if (!hasRole(context, 'admissions_staff', 'administrator')) forbidden('Hanya petugas PMB yang dapat meninjau pendaftaran.')
  if (!ADMISSION_STATUSES.includes(input.status)) invalidInput('Status tinjauan tidak valid.')
  const expectedVersion = requireInteger(input.expectedVersion, 'expectedVersion', 1)
  const notes = input.notes === undefined ? undefined : cleanText(input.notes, 'notes', 1_000)
  const applicationId = requireString(id, 'applicationId', { max: 128, pattern: SAFE_ID })
  const documentsComplete = input.status !== 'DOCUMENTS_VERIFIED'
    || await requiredAdmissionDocumentsVerified(applicationId, (await loadApplication(applicationId)).admissionPathId)
  if ((input.status === 'ACCEPTED' || input.status === 'REJECTED')) {
    let assignedStatuses: string[]
    if (dataMode() === 'mock') {
      assignedStatuses = [...admissionSelectionModuleState().assignments.values()]
        .filter(assignment => assignment.applicationId === applicationId)
        .map(assignment => assignment.status)
    } else {
      const db = firestoreAdmin()
      if (!db) serviceUnavailable('Penyimpanan seleksi PMB tidak tersedia.')
      const assignments = await db.collection('admissionSelectionAssignments')
        .where('applicationId', '==', applicationId)
        .limit(20)
        .get()
      assignedStatuses = assignments.docs.map(document => String(document.data().status || ''))
    }
    if (assignedStatuses.some(status => status !== 'SCORED')) {
      conflict('SELECTION_NOT_FINAL', 'Seluruh sesi seleksi yang dijadwalkan harus difinalkan sebelum keputusan penerimaan.')
    }
  }
  const namespace = `admission-review:${idempotencyKey}`
  const hash = requestHash({ applicationId, status: input.status, expectedVersion, notes })
  let before: AdmissionApplicationRecord
  let after: AdmissionApplicationRecord
  let replayed = false
  const update = (current: AdmissionApplicationRecord): AdmissionApplicationRecord => {
    requireProgramScope(context, current.programStudyId)
    if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Pendaftaran telah berubah.', { currentVersion: current.version })
    if (!REVIEW_TRANSITIONS[current.status].includes(input.status)) {
      conflict('INVALID_STATUS_TRANSITION', `Status ${current.status} tidak dapat diubah menjadi ${input.status}.`)
    }
    if (!documentsComplete) conflict('ADMISSION_DOCUMENTS_INCOMPLETE', 'Seluruh dokumen wajib harus berstatus terverifikasi sebelum verifikasi berkas diselesaikan.')
    const now = new Date().toISOString()
    return {
      ...structuredClone(current), status: input.status, version: current.version + 1,
      reviewedAt: now, reviewedBy: context.uid, ...(notes ? { reviewNotes: notes } : {}),
      ...(input.status === 'ACCEPTED' ? { selectedAt: now } : {}),
      ...(input.status === 'REJECTED' ? { rejectedAt: now } : {}),
      updatedAt: now, updatedBy: context.uid,
    }
  }
  if (dataMode() === 'mock') {
    const state = admissionModuleState()
    const prior = state.idempotency.get(namespace)
    if (prior) {
      if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk tinjauan berbeda.')
      const current = await loadApplication((prior.response as { applicationId: string }).applicationId)
      return { application: applicationView(current), replayed: true }
    }
    before = await loadApplication(applicationId)
    after = update(before)
    state.applications.set(after.id, structuredClone(after))
    state.idempotency.set(namespace, { requestHash: hash, response: { applicationId }, createdAt: new Date().toISOString() })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan PMB tidak tersedia.')
    const reference = db.collection('admissionApplications').doc(applicationId)
    const idemRef = db.collection('admissionIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async (transaction) => {
      const [snapshot, prior] = await Promise.all([transaction.get(reference), transaction.get(idemRef)])
      if (prior.exists) {
        const data = prior.data() as { requestHash: string }
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk tinjauan berbeda.')
        if (!snapshot.exists) notFound('Pendaftaran PMB')
        const current = { id: snapshot.id, ...snapshot.data() } as AdmissionApplicationRecord
        return { current, next: current, replayed: true }
      }
      if (!snapshot.exists) notFound('Pendaftaran PMB')
      const current = { id: snapshot.id, ...snapshot.data() } as AdmissionApplicationRecord
      const next = update(current)
      transaction.set(reference, next)
      transaction.create(idemRef, { requestHash: hash, applicationId, createdAt: next.updatedAt, expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString() })
      return { current, next, replayed: false }
    })
    before = result.current
    after = result.next
    replayed = result.replayed
  }
  if (replayed) return { application: applicationView(after), replayed: true }
  const audit = await appendAudit({
    actor: context, action: 'ADMISSION_STATUS_CHANGED', resourceType: 'admission_application', resourceId: after.id,
    before: { status: before.status, version: before.version },
    after: { status: after.status, version: after.version }, metadata: { notesProvided: Boolean(notes) }, event,
  })
  return { application: applicationView(after), replayed: false, auditId: audit.id }
}

export async function recordAdmissionFeeStatus(
  context: AuthContext,
  id: string,
  input: { status: Exclude<AdmissionFeeStatus, 'UNPAID'>; externalReference: string; expectedVersion: number },
  idempotencyKey: string,
  event?: H3Event,
): Promise<{ application: AdmissionApplicationView; replayed: boolean; auditId?: string }> {
  if (!hasRole(context, 'finance_staff', 'administrator')) forbidden('Hanya petugas keuangan yang dapat memvalidasi biaya pendaftaran.')
  if (input.status !== 'PAID' && input.status !== 'WAIVED') invalidInput('Status biaya pendaftaran tidak valid.')
  const expectedVersion = requireInteger(input.expectedVersion, 'expectedVersion', 1)
  const externalReference = requireString(input.externalReference, 'externalReference', { max: 120, pattern: /^[A-Za-z0-9][A-Za-z0-9._:/-]+$/ })
  const applicationId = requireString(id, 'applicationId', { max: 128, pattern: SAFE_ID })
  const namespace = `admission-fee:${idempotencyKey}`
  const hash = requestHash({ applicationId, status: input.status, externalReference, expectedVersion })
  let before: AdmissionApplicationRecord
  let after: AdmissionApplicationRecord
  let replayed = false
  const update = (current: AdmissionApplicationRecord): AdmissionApplicationRecord => {
    requireProgramScope(context, current.programStudyId)
    if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Pendaftaran telah berubah.', { currentVersion: current.version })
    if (current.registrationFeeStatus !== 'UNPAID') conflict('ADMISSION_FEE_ALREADY_FINAL', 'Status biaya pendaftaran sudah final.')
    const now = new Date().toISOString()
    return {
      ...structuredClone(current), registrationFeeStatus: input.status, registrationFeeReference: externalReference,
      version: current.version + 1, updatedAt: now, updatedBy: context.uid,
    }
  }
  if (dataMode() === 'mock') {
    const state = admissionModuleState()
    const prior = state.idempotency.get(namespace)
    if (prior) {
      if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk pembayaran berbeda.')
      const current = await loadApplication((prior.response as { applicationId: string }).applicationId)
      return { application: applicationView(current), replayed: true }
    }
    const owner = state.feeReferences.get(externalReference)
    if (owner && owner !== applicationId) conflict('PAYMENT_REFERENCE_USED', 'Referensi pembayaran telah digunakan.')
    before = await loadApplication(applicationId)
    after = update(before)
    state.applications.set(after.id, structuredClone(after))
    state.feeReferences.set(externalReference, applicationId)
    state.idempotency.set(namespace, { requestHash: hash, response: { applicationId }, createdAt: new Date().toISOString() })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan PMB tidak tersedia.')
    const reference = db.collection('admissionApplications').doc(applicationId)
    const idemRef = db.collection('admissionIdempotency').doc(opaqueId('idem', namespace))
    const paymentRef = db.collection('admissionPaymentReferences').doc(opaqueId('payment', externalReference))
    const result = await db.runTransaction(async (transaction) => {
      const [snapshot, prior, paymentOwner] = await Promise.all([
        transaction.get(reference), transaction.get(idemRef), transaction.get(paymentRef),
      ])
      if (prior.exists) {
        const data = prior.data() as { requestHash: string }
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk pembayaran berbeda.')
        if (!snapshot.exists) notFound('Pendaftaran PMB')
        const current = { id: snapshot.id, ...snapshot.data() } as AdmissionApplicationRecord
        return { current, next: current, replayed: true }
      }
      if (!snapshot.exists) notFound('Pendaftaran PMB')
      if (paymentOwner.exists && paymentOwner.data()?.applicationId !== applicationId) conflict('PAYMENT_REFERENCE_USED', 'Referensi pembayaran telah digunakan.')
      const current = { id: snapshot.id, ...snapshot.data() } as AdmissionApplicationRecord
      const next = update(current)
      transaction.set(reference, next)
      transaction.create(paymentRef, { applicationId, externalReference, recordedAt: next.updatedAt })
      transaction.create(idemRef, { requestHash: hash, applicationId, createdAt: next.updatedAt, expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString() })
      return { current, next, replayed: false }
    })
    before = result.current
    after = result.next
    replayed = result.replayed
  }
  if (replayed) return { application: applicationView(after), replayed: true }
  const audit = await appendAudit({
    actor: context, action: 'ADMISSION_FEE_STATUS_RECORDED', resourceType: 'admission_application', resourceId: after.id,
    before: { registrationFeeStatus: before.registrationFeeStatus, version: before.version },
    after: { registrationFeeStatus: after.registrationFeeStatus, version: after.version },
    metadata: { externalReferenceHash: requestHash(externalReference) }, event,
  })
  return { application: applicationView(after), replayed: false, auditId: audit.id }
}

function cohortYear(application: AdmissionApplicationRecord): number {
  const year = Number(application.academicYear.slice(0, 4))
  if (!Number.isInteger(year) || year < 2000 || year > 2200) serviceUnavailable('Tahun angkatan PMB tidak valid.')
  return year
}

function studentNumberFor(application: AdmissionApplicationRecord, sequence: number): string {
  const program = programById(application.programStudyId)
  return `${String(cohortYear(application)).slice(-2)}${program.code}${String(sequence).padStart(5, '0')}`
}

async function loadStudent(id: string): Promise<AdmissionStudentRecord> {
  if (dataMode() === 'mock') {
    const student = admissionModuleState().students.get(id)
    if (!student) notFound('Mahasiswa hasil konversi')
    return structuredClone(student)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan akademik tidak tersedia.')
  const snapshot = await db.collection('students').doc(id).get()
  if (!snapshot.exists) notFound('Mahasiswa hasil konversi')
  return { id: snapshot.id, ...snapshot.data() } as AdmissionStudentRecord
}

export async function convertAcceptedApplicant(
  context: AuthContext,
  id: string,
  input: { expectedVersion: number },
  idempotencyKey: string,
  event?: H3Event,
): Promise<AdmissionConversionResult> {
  if (!hasRole(context, 'admissions_staff', 'administrator')) forbidden('Hanya petugas PMB yang dapat mengonversi pendaftar.')
  const applicationId = requireString(id, 'applicationId', { max: 128, pattern: SAFE_ID })
  const expectedVersion = requireInteger(input.expectedVersion, 'expectedVersion', 1)
  const namespace = `admission-convert:${idempotencyKey}`
  const hash = requestHash({ applicationId, expectedVersion })
  let application: AdmissionApplicationRecord
  let student: AdmissionStudentRecord
  let replayed = false

  const validateFresh = (current: AdmissionApplicationRecord): void => {
    requireProgramScope(context, current.programStudyId)
    if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Pendaftaran telah berubah.', { currentVersion: current.version })
    if (current.status !== 'ACCEPTED') conflict('APPLICATION_NOT_ACCEPTED', 'Hanya pendaftar berstatus diterima yang dapat dikonversi.')
    if (current.registrationFeeStatus === 'UNPAID') conflict('ADMISSION_FEE_UNPAID', 'Biaya pendaftaran belum dibayar atau dibebaskan.')
    if (!current.applicantUid) conflict('APPLICANT_ACCOUNT_REQUIRED', 'Pendaftaran harus ditautkan ke akun applicant sebelum konversi.')
  }

  if (dataMode() === 'mock') {
    const state = admissionModuleState()
    const prior = state.idempotency.get(namespace)
    if (prior) {
      if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk konversi berbeda.')
      application = await loadApplication((prior.response as { applicationId: string }).applicationId)
      if (!application.studentId) serviceUnavailable('Konversi idempotent tidak memiliki mahasiswa tujuan.')
      student = await loadStudent(application.studentId)
      replayed = application.status === 'ENROLLED' && student.status === 'ACTIVE'
    } else {
      const current = await loadApplication(applicationId)
      validateFresh(current)
      const sequenceKey = `${current.programStudyId}:${cohortYear(current)}`
      const sequence = (state.studentSequences.get(sequenceKey) ?? 0) + 1
      state.studentSequences.set(sequenceKey, sequence)
      const now = new Date().toISOString()
      const studentId = opaqueId('student', current.id)
      student = {
        id: studentId,
        userUid: current.applicantUid!,
        studentNumber: studentNumberFor(current, sequence),
        fullName: current.fullName,
        email: current.email,
        programStudyId: current.programStudyId,
        unitId: current.unitId,
        cohortYear: cohortYear(current),
        academicYear: current.academicYear,
        status: 'PENDING_IDENTITY',
        sourceApplicationId: current.id,
        activatedAt: now,
        version: 1,
      }
      application = {
        ...current,
        status: 'ENROLLMENT_PENDING_IDENTITY',
        studentId,
        studentNumber: student.studentNumber,
        version: current.version + 1,
        updatedAt: now,
        updatedBy: context.uid,
      }
      state.students.set(student.id, structuredClone(student))
      state.applications.set(application.id, structuredClone(application))
      state.idempotency.set(namespace, { requestHash: hash, response: { applicationId }, createdAt: now })
    }
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan PMB tidak tersedia.')
    const applicationRef = db.collection('admissionApplications').doc(applicationId)
    const idemRef = db.collection('admissionIdempotency').doc(opaqueId('idem', namespace))
    const prepared = await db.runTransaction(async (transaction) => {
      const [snapshot, prior] = await Promise.all([transaction.get(applicationRef), transaction.get(idemRef)])
      if (!snapshot.exists) notFound('Pendaftaran PMB')
      const current = { id: snapshot.id, ...snapshot.data() } as AdmissionApplicationRecord
      if (prior.exists) {
        const data = prior.data() as { requestHash: string; studentId: string }
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk konversi berbeda.')
        return { application: current, studentId: data.studentId, replayed: current.status === 'ENROLLED' }
      }
      validateFresh(current)
      const sequenceId = `${current.programStudyId}-${cohortYear(current)}`
      const sequenceRef = db.collection('studentNumberSequences').doc(sequenceId)
      const sequenceSnapshot = await transaction.get(sequenceRef)
      const priorSequence = Number(sequenceSnapshot.data()?.lastSequence || 0)
      if (!Number.isSafeInteger(priorSequence) || priorSequence < 0) serviceUnavailable('Urutan NIM tidak valid.')
      const sequence = priorSequence + 1
      const now = new Date().toISOString()
      const studentId = opaqueId('student', current.id)
      const studentRecord: AdmissionStudentRecord = {
        id: studentId,
        userUid: current.applicantUid!,
        studentNumber: studentNumberFor(current, sequence),
        fullName: current.fullName,
        email: current.email,
        programStudyId: current.programStudyId,
        unitId: current.unitId,
        cohortYear: cohortYear(current),
        academicYear: current.academicYear,
        status: 'PENDING_IDENTITY',
        sourceApplicationId: current.id,
        activatedAt: now,
        version: 1,
      }
      const pending: AdmissionApplicationRecord = {
        ...current,
        status: 'ENROLLMENT_PENDING_IDENTITY',
        studentId,
        studentNumber: studentRecord.studentNumber,
        version: current.version + 1,
        updatedAt: now,
        updatedBy: context.uid,
      }
      transaction.set(sequenceRef, { lastSequence: sequence, updatedAt: now, programStudyId: current.programStudyId, cohortYear: cohortYear(current) })
      transaction.create(db.collection('students').doc(studentId), studentRecord)
      transaction.set(applicationRef, pending)
      transaction.create(idemRef, {
        requestHash: hash, applicationId, studentId, createdAt: now,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
      })
      return { application: pending, studentId, replayed: false }
    })
    application = prepared.application
    student = await loadStudent(prepared.studentId)
    replayed = prepared.replayed && student.status === 'ACTIVE'
  }

  if (replayed) return { application: applicationView(application), student, replayed: true }
  if (!application.applicantUid || !application.studentId) serviceUnavailable('Konversi PMB belum memiliki referensi akun dan mahasiswa.')

  await promoteApplicantAccount(context, {
    accountId: application.applicantUid,
    studentId: application.studentId,
    programStudyId: application.programStudyId,
    unitId: application.unitId,
    cohortYear: student.cohortYear,
  }, event)

  const completedAt = new Date().toISOString()
  if (dataMode() === 'mock') {
    student = { ...student, status: 'ACTIVE', activatedAt: completedAt, version: student.version + 1 }
    application = {
      ...application, status: 'ENROLLED', enrolledAt: completedAt,
      version: application.version + 1, updatedAt: completedAt, updatedBy: context.uid,
    }
    admissionModuleState().students.set(student.id, structuredClone(student))
    admissionModuleState().applications.set(application.id, structuredClone(application))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan PMB tidak tersedia.')
    const applicationRef = db.collection('admissionApplications').doc(application.id)
    const studentRef = db.collection('students').doc(student.id)
    const finalized = await db.runTransaction(async (transaction) => {
      const [applicationSnapshot, studentSnapshot] = await Promise.all([
        transaction.get(applicationRef), transaction.get(studentRef),
      ])
      if (!applicationSnapshot.exists || !studentSnapshot.exists) serviceUnavailable('Data konversi PMB tidak lengkap.')
      const currentApplication = { id: applicationSnapshot.id, ...applicationSnapshot.data() } as AdmissionApplicationRecord
      const currentStudent = { id: studentSnapshot.id, ...studentSnapshot.data() } as AdmissionStudentRecord
      if (currentApplication.status === 'ENROLLED' && currentStudent.status === 'ACTIVE') {
        return { application: currentApplication, student: currentStudent }
      }
      if (currentApplication.status !== 'ENROLLMENT_PENDING_IDENTITY' || currentStudent.status !== 'PENDING_IDENTITY') {
        conflict('CONVERSION_STATE_CONFLICT', 'Status konversi PMB tidak konsisten.')
      }
      const nextApplication: AdmissionApplicationRecord = {
        ...currentApplication, status: 'ENROLLED', enrolledAt: completedAt,
        version: currentApplication.version + 1, updatedAt: completedAt, updatedBy: context.uid,
      }
      const nextStudent: AdmissionStudentRecord = {
        ...currentStudent, status: 'ACTIVE', activatedAt: completedAt, version: currentStudent.version + 1,
      }
      transaction.set(applicationRef, nextApplication)
      transaction.set(studentRef, nextStudent)
      return { application: nextApplication, student: nextStudent }
    })
    application = finalized.application
    student = finalized.student
  }

  const audit = await appendAudit({
    actor: context,
    action: 'ADMISSION_APPLICANT_ENROLLED',
    resourceType: 'admission_application',
    resourceId: application.id,
    after: {
      status: application.status,
      studentId: application.studentId,
      studentNumber: application.studentNumber,
      programStudyId: application.programStudyId,
    },
    event,
  })
  return { application: applicationView(application), student: structuredClone(student), replayed: false, auditId: audit.id }
}

export function admissionRuntimeForTests(): {
  applications: AdmissionApplicationRecord[]
  students: AdmissionStudentRecord[]
  sequences: Record<string, number>
} {
  const state = admissionModuleState()
  return {
    applications: [...state.applications.values()].map(item => structuredClone(item)),
    students: [...state.students.values()].map(item => structuredClone(item)),
    sequences: Object.fromEntries(state.studentSequences.entries()),
  }
}
