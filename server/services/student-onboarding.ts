import type { H3Event } from 'h3'
import type { DocumentReference } from 'firebase-admin/firestore'
import type { StudentAcademicProfileRecord, AcademicPeriodDefinition, AcademicProgramStudy, CurriculumVersion } from '../types/academic-administration'
import type { AuthContext } from '../types/auth'
import type { BillingStudentProfile } from '../types/billing'
import type { KrsStudentAcademicState } from '../types/krs-enrollment'
import type { StudentOnboardingRecord, StudentOnboardingResult, StudentOnboardingSnapshot } from '../types/student-onboarding'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { withFirestorePurgeAfter } from '../utils/firestore-ttl'
import { hasProgramAccess, hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { optionalString, requireInteger, requireRecord, requireString } from '../utils/validation'
import { accountRuntimeForTests, findActiveAccountByEmail, type AccountRecord } from './accounts'
import { academicAdministrationState } from './academic-administration-state'
import { billingModuleState } from './billing-state'
import { krsModuleState } from './krs-state'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const STUDENT_NUMBER = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,31}$/
const COURSE_CODE = /^[A-Z0-9][A-Z0-9._-]{0,29}$/
const IDEM_TTL_MS = 24 * 60 * 60 * 1_000

type StudentStatus = StudentAcademicProfileRecord['status']
type StudentPathway = StudentAcademicProfileRecord['pathway']

interface ParsedOnboardingInput {
  accountId: string
  studentId: string
  studentNumber: string
  programStudyId: string
  cohortYear: number
  advisorId: string
  currentPeriodId: string
  curriculumVersionId: string
  status: StudentStatus
  pathway: StudentPathway
  partnerInstitution?: string
  originInstitution?: string
  maximumCredits: number
  registeredCredits: number
  totalEarnedCredits: number
  cumulativeGpa: number
  completedCourseCodes: string[]
  reason: string
  expectedVersion: number
}

function clone<T>(value: T): T { return structuredClone(value) }
function safeId(value: unknown, label: string): string { return requireString(value, label, { max: 128, pattern: SAFE_ID }) }
function requireKey(value: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(value)) invalidInput('Idempotency key tidak valid.'); return value }

function requireOnboardingStaff(context: AuthContext, programStudyId?: string): void {
  if (!hasRole(context, 'academic_staff')) forbidden('Onboarding akademik hanya dapat dikelola staf akademik.')
  if (programStudyId && !hasProgramAccess(context, programStudyId)) forbidden('Mahasiswa berada di luar lingkup program studi Anda.')
}

function validNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalidInput(`${label} harus berupa angka antara ${min} dan ${max}.`)
  return value
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 300) invalidInput(`${label} harus berupa array dengan maksimal 300 item.`)
  const result = value.map((item, index) => requireString(item, `${label}[${index}]`, { max: 30, pattern: COURSE_CODE }).toUpperCase())
  if (new Set(result).size !== result.length) invalidInput(`${label} tidak boleh berisi nilai duplikat.`)
  return result
}

function rejectUnknown(body: Record<string, unknown>): void {
  const allowed = [
    'accountEmail', 'accountId', 'studentId', 'studentNumber', 'programStudyId', 'cohortYear',
    'advisorEmail', 'advisorId', 'currentPeriodId', 'curriculumVersionId', 'status', 'pathway',
    'partnerInstitution', 'originInstitution', 'maximumCredits', 'registeredCredits',
    'totalEarnedCredits', 'cumulativeGpa', 'completedCourseCodes', 'reason', 'expectedVersion',
  ]
  const unknown = Object.keys(body).filter(key => !allowed.includes(key))
  if (unknown.length) invalidInput(`Field tidak didukung: ${unknown.join(', ')}.`)
}

async function activeAccount(identity: { accountId?: unknown; email?: unknown }, label: string): Promise<AccountRecord> {
  const accountId = identity.accountId === undefined ? undefined : safeId(identity.accountId, `${label}Id`)
  const email = identity.email === undefined ? undefined : requireString(identity.email, `${label}Email`, { max: 254 })
  if ((accountId ? 1 : 0) + (email ? 1 : 0) !== 1) invalidInput(`Gunakan tepat satu ${label}Id atau ${label}Email.`)
  if (email) {
    const account = await findActiveAccountByEmail(email)
    if (!account) notFound(`Akun aktif ${label}`)
    return account
  }
  if (dataMode() === 'mock') {
    const account = accountRuntimeForTests().accounts.find(item => item.id === accountId && item.status === 'active')
    if (!account) notFound(`Akun aktif ${label}`)
    return account
  }
  const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan akun tidak tersedia.')
  const snapshot = await db.collection('accounts').doc(accountId!).get()
  if (!snapshot.exists || snapshot.data()?.status !== 'active') notFound(`Akun aktif ${label}`)
  return { id: snapshot.id, ...snapshot.data() } as AccountRecord
}

function validateStudentAccount(account: AccountRecord, input: Pick<ParsedOnboardingInput, 'studentId' | 'programStudyId' | 'cohortYear'>, facultyId: string): void {
  if (account.status !== 'active' || account.roles.length !== 1 || account.roles[0] !== 'student') conflict('STUDENT_ACCOUNT_INVALID', 'Akun harus aktif dan hanya memiliki role student.')
  if (account.scope.studentIds.length !== 1 || account.scope.studentIds[0] !== input.studentId) conflict('STUDENT_SCOPE_MISMATCH', 'scope.studentIds akun belum sama dengan ID mahasiswa onboarding.')
  if (account.scope.programStudyIds.length !== 1 || account.scope.programStudyIds[0] !== input.programStudyId) conflict('STUDENT_SCOPE_MISMATCH', 'scope.programStudyIds akun belum sama dengan program studi onboarding.')
  if (account.scope.cohortYears.length && !account.scope.cohortYears.includes(input.cohortYear)) conflict('STUDENT_SCOPE_MISMATCH', 'scope.cohortYears akun belum memuat angkatan onboarding.')
  if (account.scope.unitIds.length && !account.scope.unitIds.includes(facultyId)) conflict('STUDENT_SCOPE_MISMATCH', 'scope.unitIds akun tidak cocok dengan fakultas program studi.')
}

function validateAdvisorAccount(account: AccountRecord, programStudyId: string): void {
  if (account.status !== 'active' || !account.roles.includes('advisor') || !account.roles.includes('lecturer')) conflict('ADVISOR_ACCOUNT_INVALID', 'Dosen wali harus berupa akun aktif dengan role lecturer dan advisor.')
  if (account.scope.programStudyIds.length && !account.scope.programStudyIds.includes(programStudyId)) conflict('ADVISOR_SCOPE_MISMATCH', 'Dosen wali berada di luar program studi mahasiswa.')
}

function parseBody(body: Record<string, unknown>, student: AccountRecord, advisor: AccountRecord): ParsedOnboardingInput {
  const status = requireString(body.status, 'status', { max: 24 }) as StudentStatus
  if (!['ACTIVE', 'LEAVE', 'INACTIVE', 'GRADUATED', 'TRANSFERRED_OUT'].includes(status)) invalidInput('Status akademik mahasiswa tidak valid.')
  const pathway = requireString(body.pathway, 'pathway', { max: 24 }) as StudentPathway
  if (!['REGULAR', 'TRANSFER', 'DOUBLE_DEGREE'].includes(pathway)) invalidInput('Jalur masuk mahasiswa tidak valid.')
  const partnerInstitution = optionalString(body.partnerInstitution, 'partnerInstitution', 180)
  const originInstitution = optionalString(body.originInstitution, 'originInstitution', 180)
  if (pathway === 'TRANSFER' && !originInstitution) invalidInput('Institusi asal wajib diisi untuk mahasiswa transfer.')
  if (pathway === 'DOUBLE_DEGREE' && !partnerInstitution) invalidInput('Institusi mitra wajib diisi untuk mahasiswa double degree.')
  if (pathway === 'REGULAR' && (partnerInstitution || originInstitution)) invalidInput('Institusi asal/mitra hanya boleh diisi untuk jalur yang sesuai.')
  const maximumCredits = requireInteger(body.maximumCredits, 'maximumCredits', 0, 30)
  const registeredCredits = requireInteger(body.registeredCredits, 'registeredCredits', 0, 30)
  if (registeredCredits > maximumCredits && status === 'ACTIVE') invalidInput('SKS terdaftar tidak boleh melebihi batas SKS mahasiswa aktif.')
  if (status === 'ACTIVE' && maximumCredits < 1) invalidInput('Mahasiswa aktif wajib memiliki batas SKS minimal 1.')
  return {
    accountId: student.id,
    studentId: safeId(body.studentId, 'studentId'),
    studentNumber: requireString(body.studentNumber, 'studentNumber', { max: 32, pattern: STUDENT_NUMBER }).toUpperCase(),
    programStudyId: safeId(body.programStudyId, 'programStudyId'),
    cohortYear: requireInteger(body.cohortYear, 'cohortYear', 1950, 2200),
    advisorId: advisor.id,
    currentPeriodId: safeId(body.currentPeriodId, 'currentPeriodId'),
    curriculumVersionId: safeId(body.curriculumVersionId, 'curriculumVersionId'),
    status,
    pathway,
    ...(partnerInstitution ? { partnerInstitution } : {}),
    ...(originInstitution ? { originInstitution } : {}),
    maximumCredits,
    registeredCredits,
    totalEarnedCredits: requireInteger(body.totalEarnedCredits, 'totalEarnedCredits', 0, 400),
    cumulativeGpa: validNumber(body.cumulativeGpa, 'cumulativeGpa', 0, 4),
    completedCourseCodes: stringList(body.completedCourseCodes, 'completedCourseCodes'),
    reason: requireString(body.reason, 'reason', { min: 10, max: 1_000 }),
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 0),
  }
}

function validateMaster(
  input: ParsedOnboardingInput,
  studentAccount: AccountRecord,
  advisorAccount: AccountRecord,
  program: AcademicProgramStudy | undefined,
  period: AcademicPeriodDefinition | undefined,
  curriculum: CurriculumVersion | undefined,
): asserts program is AcademicProgramStudy {
  if (!program || !program.active) conflict('PROGRAM_STUDY_NOT_ACTIVE', 'Program studi onboarding tidak tersedia atau tidak aktif.')
  if (!period || !period.active) conflict('ACADEMIC_PERIOD_NOT_ACTIVE', 'Periode akademik onboarding tidak tersedia atau tidak aktif.')
  if (!curriculum || curriculum.status !== 'ACTIVE' || curriculum.programStudyId !== input.programStudyId) conflict('CURRICULUM_NOT_ACTIVE', 'Versi kurikulum aktif untuk program studi belum tersedia.')
  if (input.cohortYear < curriculum.effectiveCohortFrom || input.cohortYear > curriculum.effectiveCohortTo) conflict('CURRICULUM_COHORT_MISMATCH', 'Angkatan mahasiswa berada di luar rentang kurikulum.')
  validateStudentAccount(studentAccount, input, program.facultyId)
  validateAdvisorAccount(advisorAccount, input.programStudyId)
}

function records(
  input: ParsedOnboardingInput,
  student: AccountRecord,
  facultyId: string,
  previousProfile?: StudentAcademicProfileRecord,
  previousKrs?: KrsStudentAcademicState,
  clock = new Date(),
  recordedBy = 'academic:onboarding',
): StudentOnboardingRecord {
  const now = clock.toISOString()
  if ((previousProfile?.version || 0) !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Profil akademik mahasiswa telah berubah.', { currentVersion: previousProfile?.version || 0 })
  if (previousProfile && previousProfile.studentUid !== student.id) conflict('STUDENT_IDENTITY_IMMUTABLE', 'Identitas akun pada profil akademik tidak dapat diganti.')
  const statusChanged = !previousProfile || previousProfile.status !== input.status
  const statusHistory = statusChanged ? [...(previousProfile?.statusHistory || []), {
    id: opaqueId('student_status', `${input.studentId}:${input.currentPeriodId}:${input.status}:${input.expectedVersion + 1}`),
    status: input.status,
    periodId: input.currentPeriodId,
    reason: input.reason,
    effectiveAt: now,
    recordedBy,
  }] : [...previousProfile.statusHistory]
  const profile: StudentAcademicProfileRecord = {
    studentId: input.studentId,
    studentUid: student.id,
    studentNumber: input.studentNumber,
    studentName: student.displayName,
    programStudyId: input.programStudyId,
    facultyId,
    cohortYear: input.cohortYear,
    advisorId: input.advisorId,
    currentPeriodId: input.currentPeriodId,
    status: input.status,
    pathway: input.pathway,
    ...(input.partnerInstitution ? { partnerInstitution: input.partnerInstitution } : {}),
    ...(input.originInstitution ? { originInstitution: input.originInstitution } : {}),
    curriculumVersionId: input.curriculumVersionId,
    totalEarnedCredits: input.totalEarnedCredits,
    cumulativeGpa: input.cumulativeGpa,
    version: input.expectedVersion + 1,
    statusHistory,
    updatedAt: now,
  }
  const krsState: KrsStudentAcademicState = {
    id: input.studentId,
    studentUid: student.id,
    studentNumber: input.studentNumber,
    studentName: student.displayName,
    programStudyId: input.programStudyId,
    advisorId: input.advisorId,
    active: input.status === 'ACTIVE',
    maximumCredits: input.maximumCredits,
    completedCourseCodes: input.completedCourseCodes,
    holds: clone(previousKrs?.holds || []),
    version: (previousKrs?.version || 0) + 1,
    updatedAt: now,
  }
  const enrollmentStatus: BillingStudentProfile['enrollmentStatus'] = input.status === 'TRANSFERRED_OUT' ? 'INACTIVE' : input.status
  const billingProfile: BillingStudentProfile = {
    studentId: input.studentId,
    studentUid: student.id,
    studentNumber: input.studentNumber,
    studentName: student.displayName,
    programStudyId: input.programStudyId,
    unitId: facultyId,
    cohortYear: input.cohortYear,
    currentPeriodId: input.currentPeriodId,
    enrollmentStatus,
    registeredCredits: input.registeredCredits,
  }
  return { profile, krsState, billingProfile }
}

export async function getStudentOnboarding(context: AuthContext, studentIdValue: string): Promise<StudentOnboardingSnapshot> {
  const studentId = safeId(studentIdValue, 'studentId')
  requireOnboardingStaff(context)
  let result: StudentOnboardingSnapshot
  if (dataMode() === 'mock') {
    const profile = academicAdministrationState().profiles.get(studentId), krsState = krsModuleState().students.get(studentId), billingProfile = billingModuleState().profiles.get(studentId)
    if (!profile && !krsState && !billingProfile) notFound('Data onboarding mahasiswa')
    result = { ...(profile ? { profile: clone(profile) } : {}), ...(krsState ? { krsState: clone(krsState) } : {}), ...(billingProfile ? { billingProfile: clone(billingProfile) } : {}), complete: Boolean(profile && krsState && billingProfile) }
  } else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan onboarding mahasiswa tidak tersedia.')
    const [profile, krsState, billingProfile] = await Promise.all([
      db.collection('academicStudentProfiles').doc(studentId).get(),
      db.collection('studentAcademicStates').doc(studentId).get(),
      db.collection('billingStudentProfiles').doc(studentId).get(),
    ])
    if (!profile.exists && !krsState.exists && !billingProfile.exists) notFound('Data onboarding mahasiswa')
    result = {
      ...(profile.exists ? { profile: { studentId: profile.id, ...profile.data() } as StudentAcademicProfileRecord } : {}),
      ...(krsState.exists ? { krsState: { id: krsState.id, ...krsState.data() } as KrsStudentAcademicState } : {}),
      ...(billingProfile.exists ? { billingProfile: { studentId: billingProfile.id, ...billingProfile.data() } as BillingStudentProfile } : {}),
      complete: profile.exists && krsState.exists && billingProfile.exists,
    }
  }
  const programStudyId = result.profile?.programStudyId || result.krsState?.programStudyId || result.billingProfile?.programStudyId
  if (!programStudyId) serviceUnavailable('Data onboarding mahasiswa tidak memiliki program studi.')
  requireOnboardingStaff(context, programStudyId)
  return result
}

export async function onboardStudent(
  context: AuthContext,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<StudentOnboardingResult> {
  requireKey(idempotencyKey); requireOnboardingStaff(context)
  const body = requireRecord(value); rejectUnknown(body)
  const [studentAccount, advisorAccount] = await Promise.all([
    activeAccount({ accountId: body.accountId, email: body.accountEmail }, 'account'),
    activeAccount({ accountId: body.advisorId, email: body.advisorEmail }, 'advisor'),
  ])
  const input = parseBody(body, studentAccount, advisorAccount)
  requireOnboardingStaff(context, input.programStudyId)
  const namespace = `academic:student-onboarding:${context.uid}:${idempotencyKey}`, hash = requestHash(input)
  let result: StudentOnboardingResult

  if (dataMode() === 'mock') {
    const state = academicAdministrationState(), prior = state.idempotency.get(namespace)
    if (prior) { if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk onboarding berbeda.'); return { ...(clone(prior.response) as StudentOnboardingRecord), replayed: true } }
    const program = state.programs.get(input.programStudyId), period = state.periods.get(input.currentPeriodId), curriculum = state.curricula.get(input.curriculumVersionId)
    validateMaster(input, studentAccount, advisorAccount, program, period, curriculum)
    const duplicate = [...state.profiles.values()].find(item => item.studentId !== input.studentId && (item.studentUid === studentAccount.id || item.studentNumber === input.studentNumber))
    if (duplicate) conflict('STUDENT_IDENTITY_ALREADY_USED', 'Akun atau NIM telah digunakan mahasiswa lain.')
    const onboarding = records(input, studentAccount, program.facultyId, state.profiles.get(input.studentId), krsModuleState().students.get(input.studentId), clock, context.uid)
    state.profiles.set(input.studentId, clone(onboarding.profile)); krsModuleState().students.set(input.studentId, clone(onboarding.krsState)); billingModuleState().profiles.set(input.studentId, clone(onboarding.billingProfile)); state.idempotency.set(namespace, { requestHash: hash, response: onboarding, createdAt: clock.toISOString() })
    result = { ...onboarding, replayed: false }
  } else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan onboarding mahasiswa tidak tersedia.')
    const profileRef = db.collection('academicStudentProfiles').doc(input.studentId), krsRef = db.collection('studentAcademicStates').doc(input.studentId), billingRef = db.collection('billingStudentProfiles').doc(input.studentId), studentAccountRef = db.collection('accounts').doc(studentAccount.id), advisorAccountRef = db.collection('accounts').doc(advisorAccount.id), programRef = db.collection('academicProgramStudies').doc(input.programStudyId), periodRef = db.collection('academicPeriodDefinitions').doc(input.currentPeriodId), curriculumRef = db.collection('academicCurriculumVersions').doc(input.curriculumVersionId), uidKeyRef = db.collection('academicStudentUidKeys').doc(opaqueId('student_uid', studentAccount.id)), numberKeyRef = db.collection('academicStudentNumberKeys').doc(opaqueId('student_number', input.studentNumber)), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [profileSnapshot, krsSnapshot, accountSnapshot, advisorSnapshot, programSnapshot, periodSnapshot, curriculumSnapshot, uidKey, numberKey, prior] = await Promise.all([
        transaction.get(profileRef), transaction.get(krsRef), transaction.get(studentAccountRef), transaction.get(advisorAccountRef), transaction.get(programRef), transaction.get(periodRef), transaction.get(curriculumRef), transaction.get(uidKeyRef), transaction.get(numberKeyRef), transaction.get(idemRef),
      ])
      if (prior.exists) { const stored = prior.data() as { requestHash: string; response: StudentOnboardingRecord }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk onboarding berbeda.'); return { ...stored.response, replayed: true } }
      if (!accountSnapshot.exists || !advisorSnapshot.exists) notFound('Akun onboarding')
      const currentStudentAccount = { id: accountSnapshot.id, ...accountSnapshot.data() } as AccountRecord, currentAdvisorAccount = { id: advisorSnapshot.id, ...advisorSnapshot.data() } as AccountRecord
      const program = programSnapshot.exists ? ({ id: programSnapshot.id, ...programSnapshot.data() } as AcademicProgramStudy) : undefined, period = periodSnapshot.exists ? ({ id: periodSnapshot.id, ...periodSnapshot.data() } as AcademicPeriodDefinition) : undefined, curriculum = curriculumSnapshot.exists ? ({ id: curriculumSnapshot.id, ...curriculumSnapshot.data() } as CurriculumVersion) : undefined
      validateMaster(input, currentStudentAccount, currentAdvisorAccount, program, period, curriculum)
      if ((uidKey.exists && uidKey.data()?.studentId !== input.studentId) || (numberKey.exists && numberKey.data()?.studentId !== input.studentId)) conflict('STUDENT_IDENTITY_ALREADY_USED', 'Akun atau NIM telah digunakan mahasiswa lain.')
      const previousProfile = profileSnapshot.exists ? ({ studentId: profileSnapshot.id, ...profileSnapshot.data() } as StudentAcademicProfileRecord) : undefined, previousKrs = krsSnapshot.exists ? ({ id: krsSnapshot.id, ...krsSnapshot.data() } as KrsStudentAcademicState) : undefined
      let oldNumberKey: DocumentReference | undefined
      if (previousProfile && previousProfile.studentNumber !== input.studentNumber) {
        oldNumberKey = db.collection('academicStudentNumberKeys').doc(opaqueId('student_number', previousProfile.studentNumber))
        const oldKey = await transaction.get(oldNumberKey)
        if (oldKey.exists && oldKey.data()?.studentId !== input.studentId) conflict('STUDENT_IDENTITY_KEY_CONFLICT', 'Indeks NIM lama tidak konsisten.')
      }
      const onboarding = records(input, currentStudentAccount, program.facultyId, previousProfile, previousKrs, clock, context.uid), now = clock.toISOString()
      transaction.set(profileRef, onboarding.profile); transaction.set(krsRef, onboarding.krsState); transaction.set(billingRef, onboarding.billingProfile); transaction.set(uidKeyRef, { studentId: input.studentId, studentUid: currentStudentAccount.id, updatedAt: now }); transaction.set(numberKeyRef, { studentId: input.studentId, studentNumber: input.studentNumber, updatedAt: now }); if (oldNumberKey) transaction.delete(oldNumberKey); transaction.create(idemRef, withFirestorePurgeAfter({ requestHash: hash, response: onboarding, createdAt: now }, now, IDEM_TTL_MS))
      return { ...onboarding, replayed: false }
    })
  }
  if (result.replayed) return result
  const audit = await appendAudit({ actor: context, action: input.expectedVersion === 0 ? 'ACADEMIC_STUDENT_ONBOARDED' : 'ACADEMIC_STUDENT_PROFILE_UPDATED', resourceType: 'academic_student', resourceId: input.studentId, before: { version: input.expectedVersion }, after: { version: result.profile.version, programStudyId: input.programStudyId, cohortYear: input.cohortYear, currentPeriodId: input.currentPeriodId, status: input.status, pathway: input.pathway, maximumCredits: input.maximumCredits, registeredCredits: input.registeredCredits, reason: input.reason }, event })
  return { ...result, auditId: audit.id }
}
