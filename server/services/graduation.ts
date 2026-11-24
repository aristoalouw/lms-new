import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  GraduationApplication,
  GraduationApplicationStatus,
  GraduationEligibilityEvaluation,
  GraduationEligibilitySnapshot,
  GraduationParticipant,
  GraduationParticipantStatus,
  GraduationPeriod,
  GraduationPeriodStatus,
  GraduationRequirements,
  GraduationStatusEvent,
} from '../types/graduation'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { hasRole, requirePermission } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { graduationModuleState } from './graduation-state'

export interface GraduationRequirementsInput {
  academic: GraduationRequirements['academic']
  finance: GraduationRequirements['finance']
  library: GraduationRequirements['library']
  studentAffairs: GraduationRequirements['studentAffairs']
}

export interface CreateGraduationPeriodInput {
  code: string
  name: string
  programStudyIds: string[]
  registrationOpensAt: string
  registrationClosesAt: string
  yudisiumDate: string
  graduationDate?: string
  requirements: GraduationRequirementsInput
}

export interface UpdateGraduationPeriodInput {
  expectedVersion: number
  status?: GraduationPeriodStatus
  registrationClosesAt?: string
  yudisiumDate?: string
  graduationDate?: string
  requirements?: GraduationRequirementsInput
}

export type ApplicationTransition = 'START_REVIEW' | 'FIRST_APPROVE' | 'FINAL_APPROVE' | 'REJECT' | 'CANCEL'

function isStaff(context: AuthContext): boolean {
  return hasRole(context, 'academic_staff')
}

function programScoped(context: AuthContext, programStudyId: string): boolean {
  return context.scope.programStudyIds.includes(programStudyId)
}

function requireStaffScope(context: AuthContext, programStudyId: string): void {
  if (!isStaff(context) || !programScoped(context, programStudyId)) forbidden('Data kelulusan berada di luar lingkup program studi Anda.')
}

function canReadApplication(context: AuthContext, application: GraduationApplication): boolean {
  return application.studentUid === context.uid
    || (hasRole(context, 'academic_staff', 'lecturer', 'advisor') && programScoped(context, application.programStudyId))
}

function requireApplicationRead(context: AuthContext, application: GraduationApplication): void {
  if (!canReadApplication(context, application)) forbidden('Pengajuan kelulusan bukan milik Anda.')
}

function canReadParticipant(context: AuthContext, participant: GraduationParticipant): boolean {
  return participant.studentUid === context.uid
    || (hasRole(context, 'academic_staff', 'lecturer', 'advisor') && programScoped(context, participant.programStudyId))
}

function validateRequirements(input: GraduationRequirementsInput): void {
  const values = [
    input.academic.minimumCredits,
    input.academic.minimumGpa,
    input.academic.maximumGradeD,
    input.finance.maximumOutstandingAmount,
    input.library.maximumUnreturnedItems,
    input.studentAffairs.minimumPoints,
    input.studentAffairs.maximumActiveSanctions,
  ]
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) invalidInput('Nilai persyaratan kelulusan tidak valid.')
  if (input.academic.minimumGpa > 4 || !Number.isInteger(input.academic.minimumCredits)
    || !Number.isInteger(input.academic.maximumGradeD) || !Number.isInteger(input.library.maximumUnreturnedItems)
    || !Number.isInteger(input.studentAffairs.minimumPoints) || !Number.isInteger(input.studentAffairs.maximumActiveSanctions)) {
    invalidInput('Format persyaratan kelulusan tidak valid.')
  }
}

function requirementsVersion(input: GraduationRequirementsInput, version: number, context: AuthContext, now: string): GraduationRequirements {
  validateRequirements(input)
  return { ...structuredClone(input), version, effectiveAt: now, updatedBy: context.uid }
}

function validatePeriodDates(input: { registrationOpensAt: string; registrationClosesAt: string; yudisiumDate: string; graduationDate?: string }): void {
  const opens = new Date(input.registrationOpensAt)
  const closes = new Date(input.registrationClosesAt)
  const yudisium = new Date(input.yudisiumDate)
  const graduation = input.graduationDate ? new Date(input.graduationDate) : undefined
  if ([opens, closes, yudisium, graduation].filter(Boolean).some(date => Number.isNaN(date!.getTime()))
    || opens >= closes || closes >= yudisium || (graduation && yudisium > graduation)) invalidInput('Urutan tanggal periode kelulusan tidak valid.')
}

export function evaluateGraduationEligibility(
  snapshot: GraduationEligibilitySnapshot,
  requirements: GraduationRequirements,
  now = new Date(),
): GraduationEligibilityEvaluation {
  const checks = [
    { code: 'ACADEMIC_CREDITS', area: 'ACADEMIC' as const, label: 'Jumlah SKS lulus', passed: snapshot.academic.earnedCredits >= requirements.academic.minimumCredits, actual: snapshot.academic.earnedCredits, required: requirements.academic.minimumCredits },
    { code: 'ACADEMIC_GPA', area: 'ACADEMIC' as const, label: 'IPK minimum', passed: snapshot.academic.gpa >= requirements.academic.minimumGpa, actual: snapshot.academic.gpa, required: requirements.academic.minimumGpa },
    { code: 'ACADEMIC_GRADE_D', area: 'ACADEMIC' as const, label: 'Batas nilai D', passed: snapshot.academic.gradeDCount <= requirements.academic.maximumGradeD, actual: snapshot.academic.gradeDCount, required: requirements.academic.maximumGradeD },
    { code: 'ACADEMIC_NO_E', area: 'ACADEMIC' as const, label: 'Tidak memiliki nilai E', passed: !requirements.academic.requireNoGradeE || snapshot.academic.gradeECount === 0, actual: snapshot.academic.gradeECount, required: 0 },
    { code: 'ACADEMIC_THESIS', area: 'ACADEMIC' as const, label: 'Tugas akhir lulus', passed: !requirements.academic.requireThesisPassed || snapshot.academic.thesisPassed, actual: snapshot.academic.thesisPassed, required: requirements.academic.requireThesisPassed },
    { code: 'FINANCE_CLEARANCE', area: 'FINANCE' as const, label: 'Bebas tunggakan', passed: snapshot.finance.outstandingAmount <= requirements.finance.maximumOutstandingAmount, actual: snapshot.finance.outstandingAmount, required: requirements.finance.maximumOutstandingAmount },
    { code: 'LIBRARY_CLEARANCE', area: 'LIBRARY' as const, label: 'Bebas perpustakaan', passed: !requirements.library.requireClearance || snapshot.library.cleared, actual: snapshot.library.cleared, required: requirements.library.requireClearance },
    { code: 'LIBRARY_ITEMS', area: 'LIBRARY' as const, label: 'Pengembalian koleksi', passed: snapshot.library.unreturnedItems <= requirements.library.maximumUnreturnedItems, actual: snapshot.library.unreturnedItems, required: requirements.library.maximumUnreturnedItems },
    { code: 'AFFAIRS_POINTS', area: 'STUDENT_AFFAIRS' as const, label: 'Poin kemahasiswaan', passed: snapshot.studentAffairs.points >= requirements.studentAffairs.minimumPoints, actual: snapshot.studentAffairs.points, required: requirements.studentAffairs.minimumPoints },
    { code: 'AFFAIRS_SANCTIONS', area: 'STUDENT_AFFAIRS' as const, label: 'Sanksi aktif', passed: snapshot.studentAffairs.activeSanctions <= requirements.studentAffairs.maximumActiveSanctions, actual: snapshot.studentAffairs.activeSanctions, required: requirements.studentAffairs.maximumActiveSanctions },
  ]
  return {
    eligible: checks.every(check => check.passed), requirementsVersion: requirements.version,
    evaluatedAt: now.toISOString(), snapshotId: snapshot.id, checks,
    blockerCodes: checks.filter(check => !check.passed).map(check => check.code),
  }
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

async function loadParticipant(id: string): Promise<GraduationParticipant> {
  if (dataMode() === 'mock') {
    const participant = graduationModuleState().participants.get(id)
    if (!participant) notFound('Peserta kelulusan')
    return structuredClone(participant)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
  const snapshot = await db.collection('graduationParticipants').doc(id).get()
  if (!snapshot.exists) notFound('Peserta kelulusan')
  return { id: snapshot.id, ...snapshot.data() } as GraduationParticipant
}

async function loadGraduationIdempotency(namespace: string): Promise<{ requestHash: string; response: unknown } | undefined> {
  if (dataMode() === 'mock') {
    const entry = graduationModuleState().idempotency.get(namespace)
    return entry ? { requestHash: entry.requestHash, response: structuredClone(entry.response) } : undefined
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
  const snapshot = await db.collection('graduationIdempotency').doc(opaqueId('idem', namespace)).get()
  if (!snapshot.exists) return undefined
  const data = snapshot.data() as { requestHash: string } & Record<string, unknown>
  return { requestHash: data.requestHash, response: data }
}

async function loadStudentAndSnapshot(studentId: string): Promise<{ student: { id: string; userUid: string; name: string; studentNumber: string; programStudyId: string; programStudyName: string }; snapshot: GraduationEligibilitySnapshot }> {
  if (dataMode() === 'mock') {
    const student = graduationModuleState().students.get(studentId)
    const snapshot = graduationModuleState().eligibilitySnapshots.get(studentId)
    if (!student || !snapshot) notFound('Snapshot kelayakan mahasiswa')
    return { student: structuredClone(student), snapshot: structuredClone(snapshot) }
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
  const [studentDocument, snapshotDocument] = await Promise.all([
    db.collection('students').doc(studentId).get(), db.collection('graduationEligibilitySnapshots').doc(studentId).get(),
  ])
  if (!studentDocument.exists || !snapshotDocument.exists) notFound('Snapshot kelayakan mahasiswa')
  const data = studentDocument.data() as Record<string, unknown>
  return {
    student: {
      id: studentDocument.id, userUid: String(data.userUid), name: String(data.name), studentNumber: String(data.studentNumber),
      programStudyId: String(data.programStudyId), programStudyName: String(data.programStudyName),
    },
    snapshot: { id: snapshotDocument.id, ...snapshotDocument.data() } as GraduationEligibilitySnapshot,
  }
}

export async function listGraduationPeriods(context: AuthContext): Promise<GraduationPeriod[]> {
  if (!context.uid) forbidden()
  if (dataMode() === 'mock') return [...graduationModuleState().periods.values()].map(period => structuredClone(period)).sort((a, b) => b.registrationOpensAt.localeCompare(a.registrationOpensAt))
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
  const snapshot = await db.collection('graduationPeriods').limit(50).get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as GraduationPeriod).sort((a, b) => b.registrationOpensAt.localeCompare(a.registrationOpensAt))
}

export async function createGraduationPeriod(context: AuthContext, input: CreateGraduationPeriodInput, idempotencyKey: string, event?: H3Event): Promise<{ period: GraduationPeriod; replayed: boolean; auditId?: string }> {
  requirePermission(context, 'graduation.configure')
  validatePeriodDates(input)
  if (!input.programStudyIds.length || input.programStudyIds.length > 100) invalidInput('Lingkup program studi tidak valid.')
  const hash = requestHash(input)
  const namespace = `graduation-period:${idempotencyKey}`
  const now = new Date().toISOString()
  const id = opaqueId('grad_period', idempotencyKey)
  const requirement = requirementsVersion(input.requirements, 1, context, now)
  const period: GraduationPeriod = {
    id, code: input.code.trim().slice(0, 40), name: input.name.trim().slice(0, 160),
    programStudyIds: [...new Set(input.programStudyIds)], status: 'DRAFT',
    registrationOpensAt: new Date(input.registrationOpensAt).toISOString(), registrationClosesAt: new Date(input.registrationClosesAt).toISOString(),
    yudisiumDate: input.yudisiumDate, ...(input.graduationDate ? { graduationDate: input.graduationDate } : {}),
    version: 1, currentRequirements: requirement, requirementHistory: [requirement], createdAt: now, updatedAt: now,
  }
  let replayed = false
  if (dataMode() === 'mock') {
    const previous = graduationModuleState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { period: structuredClone((previous.response as { period: GraduationPeriod }).period), replayed: true }
    }
    graduationModuleState().periods.set(id, structuredClone(period))
    graduationModuleState().idempotency.set(namespace, { requestHash: hash, response: { period } })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
    const idem = db.collection('graduationIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async transaction => {
      const previous = await transaction.get(idem)
      if (previous.exists) {
        const data = previous.data() as { requestHash: string; period: GraduationPeriod }
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return { period: data.period, replayed: true }
      }
      transaction.create(db.collection('graduationPeriods').doc(id), period)
      transaction.create(idem, { requestHash: hash, period, createdAt: now })
      return { period, replayed: false }
    })
    if (result.replayed) return result
    replayed = result.replayed
  }
  const audit = await appendAudit({ actor: context, action: 'GRADUATION_PERIOD_CREATED', resourceType: 'graduation_period', resourceId: id, after: { code: period.code, requirementsVersion: 1 }, event })
  return { period, replayed, auditId: audit.id }
}

export async function updateGraduationPeriod(context: AuthContext, id: string, input: UpdateGraduationPeriodInput, idempotencyKey: string, event?: H3Event): Promise<{ period: GraduationPeriod; replayed: boolean; auditId?: string }> {
  requirePermission(context, 'graduation.configure')
  const hash = requestHash({ id, input })
  const namespace = `graduation-period-update:${idempotencyKey}`
  const now = new Date().toISOString()
  const update = (current: GraduationPeriod): GraduationPeriod => {
    if (current.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Periode telah berubah.', { currentVersion: current.version })
    const closes = input.registrationClosesAt ?? current.registrationClosesAt
    const yudisium = input.yudisiumDate ?? current.yudisiumDate
    const graduation = input.graduationDate ?? current.graduationDate
    validatePeriodDates({ registrationOpensAt: current.registrationOpensAt, registrationClosesAt: closes, yudisiumDate: yudisium, graduationDate: graduation })
    const nextRequirement = input.requirements
      ? requirementsVersion(input.requirements, current.currentRequirements.version + 1, context, now)
      : current.currentRequirements
    return {
      ...current, ...(input.status ? { status: input.status } : {}), registrationClosesAt: new Date(closes).toISOString(),
      yudisiumDate: yudisium, ...(graduation ? { graduationDate: graduation } : {}),
      currentRequirements: nextRequirement,
      requirementHistory: input.requirements ? [...current.requirementHistory, nextRequirement] : current.requirementHistory,
      version: current.version + 1, updatedAt: now,
    }
  }
  let period: GraduationPeriod
  if (dataMode() === 'mock') {
    const previous = graduationModuleState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { period: structuredClone((previous.response as { period: GraduationPeriod }).period), replayed: true }
    }
    period = update(await loadPeriod(id))
    graduationModuleState().periods.set(id, structuredClone(period))
    graduationModuleState().idempotency.set(namespace, { requestHash: hash, response: { period } })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
    const reference = db.collection('graduationPeriods').doc(id)
    const idem = db.collection('graduationIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async transaction => {
      const previous = await transaction.get(idem)
      if (previous.exists) {
        const data = previous.data() as { requestHash: string; period: GraduationPeriod }
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return { period: data.period, replayed: true }
      }
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) notFound('Periode kelulusan')
      const next = update({ id: snapshot.id, ...snapshot.data() } as GraduationPeriod)
      transaction.set(reference, next)
      transaction.create(idem, { requestHash: hash, period: next, createdAt: now })
      return { period: next, replayed: false }
    })
    if (result.replayed) return result
    period = result.period
  }
  const audit = await appendAudit({ actor: context, action: 'GRADUATION_PERIOD_UPDATED', resourceType: 'graduation_period', resourceId: id, after: { status: period.status, version: period.version, requirementsVersion: period.currentRequirements.version }, event })
  return { period, replayed: false, auditId: audit.id }
}

function statusEvent(context: AuthContext, to: GraduationApplicationStatus, occurredAt: string, from?: GraduationApplicationStatus, reason?: string): GraduationStatusEvent {
  return {
    id: opaqueId('event', `${context.uid}:${occurredAt}:${to}:${Math.random()}`), ...(from ? { from } : {}), to,
    actorUid: context.uid, actorName: context.displayName.slice(0, 150), occurredAt, ...(reason ? { reason: reason.slice(0, 500) } : {}),
  }
}

export async function submitGraduationApplication(context: AuthContext, input: { periodId: string; studentId: string }, idempotencyKey: string, event?: H3Event, now = new Date()): Promise<{ application: GraduationApplication; replayed: boolean; auditId?: string }> {
  const [period, source] = await Promise.all([loadPeriod(input.periodId), loadStudentAndSnapshot(input.studentId)])
  if (source.student.userUid !== context.uid) requireStaffScope(context, source.student.programStudyId)
  if (!period.programStudyIds.includes(source.student.programStudyId)) conflict('PROGRAM_NOT_IN_PERIOD', 'Program studi tidak termasuk dalam periode ini.')
  const normalized = { periodId: period.id, studentId: source.student.id }
  const hash = requestHash(normalized)
  const namespace = `graduation-application:${idempotencyKey}`
  const previous = await loadGraduationIdempotency(namespace)
  if (previous) {
    if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
    return { application: structuredClone((previous.response as { application: GraduationApplication }).application), replayed: true }
  }
  if (period.status !== 'OPEN' || now < new Date(period.registrationOpensAt) || now > new Date(period.registrationClosesAt)) conflict('PERIOD_NOT_OPEN', 'Pendaftaran yudisium tidak sedang dibuka.')
  const evaluation = evaluateGraduationEligibility(source.snapshot, period.currentRequirements, now)
  const status: GraduationApplicationStatus = evaluation.eligible ? 'SUBMITTED' : 'BLOCKED'
  const timestamp = now.toISOString()
  const id = opaqueId('grad_app', `${period.id}:${source.student.id}`)
  const application: GraduationApplication = {
    id, periodId: period.id, studentId: source.student.id, studentUid: source.student.userUid,
    studentName: source.student.name, studentNumber: source.student.studentNumber,
    programStudyId: source.student.programStudyId, programStudyName: source.student.programStudyName,
    status, eligibilitySnapshot: source.snapshot, eligibilityEvaluation: evaluation, version: 1,
    submittedAt: timestamp, updatedAt: timestamp, history: [statusEvent(context, status, timestamp)],
  }
  if (dataMode() === 'mock') {
    const previous = graduationModuleState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { application: structuredClone((previous.response as { application: GraduationApplication }).application), replayed: true }
    }
    if ([...graduationModuleState().applications.values()].some(item => item.periodId === period.id && item.studentId === source.student.id)) conflict('APPLICATION_EXISTS', 'Mahasiswa sudah memiliki pengajuan pada periode ini.')
    graduationModuleState().applications.set(id, structuredClone(application))
    graduationModuleState().idempotency.set(namespace, { requestHash: hash, response: { application } })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
    const idem = db.collection('graduationIdempotency').doc(opaqueId('idem', namespace))
    const assignment = db.collection('graduationApplicationAssignments').doc(opaqueId('assignment', `${period.id}:${source.student.id}`))
    const result = await db.runTransaction(async transaction => {
      const previous = await transaction.get(idem)
      if (previous.exists) {
        const data = previous.data() as { requestHash: string; application: GraduationApplication }
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return { application: data.application, replayed: true }
      }
      const existing = await transaction.get(assignment)
      if (existing.exists) conflict('APPLICATION_EXISTS', 'Mahasiswa sudah memiliki pengajuan pada periode ini.')
      transaction.create(db.collection('graduationApplications').doc(id), application)
      transaction.create(assignment, { applicationId: id, periodId: period.id, studentId: source.student.id, createdAt: timestamp })
      transaction.create(idem, { requestHash: hash, application, createdAt: timestamp })
      return { application, replayed: false }
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'GRADUATION_APPLICATION_SUBMITTED', resourceType: 'graduation_application', resourceId: id, after: { status, eligible: evaluation.eligible, blockerCodes: evaluation.blockerCodes }, event })
  return { application, replayed: false, auditId: audit.id }
}

export async function listGraduationApplications(
  context: AuthContext,
  filters: { periodId?: string; status?: GraduationApplicationStatus; limit?: number } | number = {},
): Promise<GraduationApplication[]> {
  requirePermission(context, 'graduation.read')
  if (!hasRole(context, 'academic_staff', 'lecturer', 'advisor', 'student') && hasRole(context, 'leader', 'administrator')) forbidden('Role ini hanya dapat mengakses agregat atau konfigurasi kelulusan.')
  const options = typeof filters === 'number' ? { limit: filters } : filters
  const limit = options.limit ?? 100
  let applications: GraduationApplication[]
  if (dataMode() === 'mock') applications = [...graduationModuleState().applications.values()].map(item => structuredClone(item))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
    if (hasRole(context, 'academic_staff', 'lecturer', 'advisor')) {
      const snapshots = await Promise.all(context.scope.programStudyIds.slice(0, 30).map(programStudyId => db.collection('graduationApplications').where('programStudyId', '==', programStudyId).limit(100).get()))
      applications = snapshots.flatMap(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as GraduationApplication))
    } else {
      const snapshot = await db.collection('graduationApplications').where('studentUid', '==', context.uid).limit(20).get()
      applications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as GraduationApplication)
    }
  }
  return applications
    .filter(application => canReadApplication(context, application))
    .filter(application => !options.periodId || application.periodId === options.periodId)
    .filter(application => !options.status || application.status === options.status)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, Math.min(limit, 200))
}

export async function getGraduationApplication(context: AuthContext, id: string): Promise<GraduationApplication> {
  const application = await loadApplication(id)
  requireApplicationRead(context, application)
  return application
}

export async function reevaluateGraduationApplication(context: AuthContext, id: string, expectedVersion: number, idempotencyKey: string, event?: H3Event): Promise<{ application: GraduationApplication; replayed: boolean; auditId?: string }> {
  const current = await loadApplication(id)
  if (current.studentUid !== context.uid) requireStaffScope(context, current.programStudyId)
  const hash = requestHash({ id, expectedVersion })
  const namespace = `graduation-reevaluate:${idempotencyKey}`
  const previous = await loadGraduationIdempotency(namespace)
  if (previous) {
    if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
    return { application: structuredClone((previous.response as { application: GraduationApplication }).application), replayed: true }
  }
  if (!['BLOCKED', 'SUBMITTED'].includes(current.status)) conflict('APPLICATION_NOT_REEVALUABLE', 'Pengajuan tidak dapat dievaluasi ulang pada status ini.')
  const [period, source] = await Promise.all([loadPeriod(current.periodId), loadStudentAndSnapshot(current.studentId)])
  const now = new Date().toISOString()
  const update = (fresh: GraduationApplication): GraduationApplication => {
    if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Pengajuan telah berubah.', { currentVersion: fresh.version })
    const evaluation = evaluateGraduationEligibility(source.snapshot, period.currentRequirements, new Date(now))
    const status: GraduationApplicationStatus = evaluation.eligible ? 'SUBMITTED' : 'BLOCKED'
    return { ...fresh, status, eligibilitySnapshot: source.snapshot, eligibilityEvaluation: evaluation, version: fresh.version + 1, updatedAt: now, history: [...fresh.history, statusEvent(context, status, now, fresh.status, 'Evaluasi ulang snapshot sumber')] }
  }
  const result = await idempotentApplicationMutation(id, namespace, hash, update)
  if (result.replayed) return result
  const audit = await appendAudit({ actor: context, action: 'GRADUATION_APPLICATION_REEVALUATED', resourceType: 'graduation_application', resourceId: id, after: { status: result.application.status, blockerCodes: result.application.eligibilityEvaluation.blockerCodes }, event })
  return { ...result, auditId: audit.id }
}

async function idempotentApplicationMutation(
  id: string,
  namespace: string,
  hash: string,
  mutate: (application: GraduationApplication) => GraduationApplication,
  participant?: GraduationParticipant,
): Promise<{ application: GraduationApplication; participant?: GraduationParticipant; replayed: boolean }> {
  if (dataMode() === 'mock') {
    const previous = graduationModuleState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { ...(structuredClone(previous.response) as { application: GraduationApplication; participant?: GraduationParticipant }), replayed: true }
    }
    const current = await loadApplication(id)
    const application = mutate(current)
    graduationModuleState().applications.set(id, structuredClone(application))
    if (participant) graduationModuleState().participants.set(participant.id, structuredClone(participant))
    graduationModuleState().idempotency.set(namespace, { requestHash: hash, response: { application, ...(participant ? { participant } : {}) } })
    return { application, ...(participant ? { participant } : {}), replayed: false }
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
  const reference = db.collection('graduationApplications').doc(id)
  const idem = db.collection('graduationIdempotency').doc(opaqueId('idem', namespace))
  return db.runTransaction(async transaction => {
    const previous = await transaction.get(idem)
    if (previous.exists) {
      const data = previous.data() as { requestHash: string; application: GraduationApplication; participant?: GraduationParticipant }
      if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { application: data.application, ...(data.participant ? { participant: data.participant } : {}), replayed: true }
    }
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists) notFound('Pengajuan kelulusan')
    const application = mutate({ id: snapshot.id, ...snapshot.data() } as GraduationApplication)
    transaction.set(reference, application)
    if (participant) transaction.create(db.collection('graduationParticipants').doc(participant.id), participant)
    transaction.create(idem, { requestHash: hash, application, ...(participant ? { participant } : {}), createdAt: new Date().toISOString() })
    return { application, ...(participant ? { participant } : {}), replayed: false }
  })
}

export async function transitionGraduationApplication(context: AuthContext, id: string, input: { transition: ApplicationTransition; expectedVersion: number; reason?: string }, idempotencyKey: string, event?: H3Event): Promise<{ application: GraduationApplication; participant?: GraduationParticipant; replayed: boolean; auditId?: string }> {
  const current = await loadApplication(id)
  const isOwnerCancel = input.transition === 'CANCEL' && current.studentUid === context.uid
  if (!isOwnerCancel) requireStaffScope(context, current.programStudyId)
  if (input.transition === 'REJECT' && !input.reason?.trim()) invalidInput('Alasan penolakan wajib diisi.')
  const hash = requestHash({ id, input })
  const namespace = `graduation-transition:${idempotencyKey}`
  const previous = await loadGraduationIdempotency(namespace)
  if (previous) {
    if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
    return { ...(structuredClone(previous.response) as { application: GraduationApplication; participant?: GraduationParticipant }), replayed: true }
  }
  const now = new Date().toISOString()
  let latestSnapshot: GraduationEligibilitySnapshot | undefined
  let latestEvaluation: GraduationEligibilityEvaluation | undefined
  if (input.transition === 'FINAL_APPROVE') {
    const [period, source] = await Promise.all([loadPeriod(current.periodId), loadStudentAndSnapshot(current.studentId)])
    latestSnapshot = source.snapshot
    latestEvaluation = evaluateGraduationEligibility(source.snapshot, period.currentRequirements, new Date(now))
    if (!latestEvaluation.eligible) conflict('ELIGIBILITY_BLOCKED', 'Finalisasi ditolak karena terdapat persyaratan yang belum terpenuhi.', { blockerCodes: latestEvaluation.blockerCodes })
  }
  const target: Record<ApplicationTransition, GraduationApplicationStatus> = {
    START_REVIEW: 'UNDER_REVIEW', FIRST_APPROVE: 'FIRST_APPROVED', FINAL_APPROVE: 'FINAL_APPROVED', REJECT: 'REJECTED', CANCEL: 'CANCELLED',
  }
  const allowed: Record<ApplicationTransition, GraduationApplicationStatus[]> = {
    START_REVIEW: ['SUBMITTED'], FIRST_APPROVE: ['UNDER_REVIEW'], FINAL_APPROVE: ['FIRST_APPROVED'],
    REJECT: ['SUBMITTED', 'UNDER_REVIEW', 'FIRST_APPROVED'], CANCEL: ['BLOCKED', 'SUBMITTED'],
  }
  const targetStatus = target[input.transition]
  const mutate = (fresh: GraduationApplication): GraduationApplication => {
    if (fresh.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Pengajuan telah berubah.', { currentVersion: fresh.version })
    if (!allowed[input.transition].includes(fresh.status)) conflict('INVALID_STATUS_TRANSITION', 'Transisi status pengajuan tidak diizinkan.', { currentStatus: fresh.status })
    if (input.transition === 'FINAL_APPROVE' && fresh.firstApprovedBy === context.uid) conflict('TWO_PERSON_RULE', 'Penyetuju final harus berbeda dari penyetuju pertama.')
    return {
      ...fresh, status: targetStatus,
      ...(latestSnapshot ? { eligibilitySnapshot: latestSnapshot } : {}), ...(latestEvaluation ? { eligibilityEvaluation: latestEvaluation } : {}),
      ...(input.transition === 'FIRST_APPROVE' ? { firstApprovedBy: context.uid, firstApprovedAt: now } : {}),
      ...(input.transition === 'FINAL_APPROVE' ? { finalApprovedBy: context.uid, finalApprovedAt: now } : {}),
      version: fresh.version + 1, updatedAt: now,
      history: [...fresh.history, statusEvent(context, targetStatus, now, fresh.status, input.reason?.trim())],
    }
  }
  const participant: GraduationParticipant | undefined = input.transition === 'FINAL_APPROVE' ? {
    id: opaqueId('participant', id), applicationId: id, periodId: current.periodId, studentId: current.studentId,
    studentUid: current.studentUid, programStudyId: current.programStudyId, status: 'YUDISIUM_APPROVED', version: 1, createdAt: now, updatedAt: now,
    history: [{ to: 'YUDISIUM_APPROVED', actorUid: context.uid, occurredAt: now }],
  } : undefined
  const result = await idempotentApplicationMutation(id, namespace, hash, mutate, participant)
  if (result.replayed) return result
  const audit = await appendAudit({ actor: context, action: `GRADUATION_APPLICATION_${input.transition}`, resourceType: 'graduation_application', resourceId: id, before: { status: current.status, version: current.version }, after: { status: result.application.status, version: result.application.version, participantId: participant?.id }, event })
  return { ...result, auditId: audit.id }
}

export async function listGraduationParticipants(context: AuthContext, limit = 100): Promise<GraduationParticipant[]> {
  requirePermission(context, 'graduation.read')
  if (!hasRole(context, 'academic_staff', 'lecturer', 'advisor', 'student') && hasRole(context, 'leader', 'administrator')) forbidden('Role ini hanya dapat mengakses agregat atau konfigurasi kelulusan.')
  let participants: GraduationParticipant[]
  if (dataMode() === 'mock') {
    participants = [...graduationModuleState().participants.values()].map(participant => structuredClone(participant))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
    if (hasRole(context, 'academic_staff', 'lecturer', 'advisor')) {
      const scopes = context.scope.programStudyIds
      if (!scopes.length) return []
      const chunks = Array.from({ length: Math.ceil(scopes.length / 30) }, (_, index) => scopes.slice(index * 30, index * 30 + 30))
      const snapshots = await Promise.all(chunks.map(chunk => db.collection('graduationParticipants').where('programStudyId', 'in', chunk).limit(200).get()))
      participants = snapshots.flatMap(snapshot => snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as GraduationParticipant))
    } else {
      const snapshot = await db.collection('graduationParticipants').where('studentUid', '==', context.uid).limit(20).get()
      participants = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as GraduationParticipant)
    }
  }
  return participants.filter(participant => canReadParticipant(context, participant))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, Math.min(limit, 200))
}

export async function getGraduationParticipant(context: AuthContext, participantId: string): Promise<GraduationParticipant> {
  const participant = await loadParticipant(participantId)
  if (!canReadParticipant(context, participant)) forbidden('Data peserta kelulusan bukan milik Anda.')
  return participant
}

export async function updateGraduationParticipantStatus(context: AuthContext, participantId: string, input: { status: GraduationParticipantStatus; expectedVersion: number; reason?: string }, idempotencyKey: string, event?: H3Event): Promise<{ participant: GraduationParticipant; application: GraduationApplication; replayed: boolean; auditId?: string }> {
  const now = new Date().toISOString()
  const hash = requestHash({ participantId, input })
  const namespace = `graduation-participant:${idempotencyKey}`
  const allowed: Record<GraduationParticipantStatus, GraduationParticipantStatus[]> = { YUDISIUM_APPROVED: ['GRADUATED', 'WITHDRAWN'], GRADUATED: [], WITHDRAWN: [] }
  const authorizedParticipant = await loadParticipant(participantId)
  requireStaffScope(context, authorizedParticipant.programStudyId)
  const replay = await loadGraduationIdempotency(namespace)
  if (replay) {
    if (replay.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
    return { ...(structuredClone(replay.response) as { participant: GraduationParticipant; application: GraduationApplication }), replayed: true }
  }
  if (dataMode() === 'mock') {
    const current = authorizedParticipant
    if (current.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Peserta telah berubah.', { currentVersion: current.version })
    if (!allowed[current.status].includes(input.status)) conflict('INVALID_STATUS_TRANSITION', 'Transisi peserta tidak diizinkan.')
    const participant: GraduationParticipant = { ...current, status: input.status, version: current.version + 1, updatedAt: now, history: [...current.history, { from: current.status, to: input.status, actorUid: context.uid, occurredAt: now, ...(input.reason ? { reason: input.reason.slice(0, 500) } : {}) }] }
    const application = await loadApplication(current.applicationId)
    const updatedApplication = input.status === 'GRADUATED'
      ? { ...application, status: 'GRADUATED' as const, version: application.version + 1, updatedAt: now, history: [...application.history, statusEvent(context, 'GRADUATED', now, application.status, input.reason)] }
      : application
    graduationModuleState().participants.set(participantId, structuredClone(participant))
    graduationModuleState().applications.set(application.id, structuredClone(updatedApplication))
    graduationModuleState().idempotency.set(namespace, { requestHash: hash, response: { participant, application: updatedApplication } })
    const audit = await appendAudit({ actor: context, action: 'GRADUATION_PARTICIPANT_STATUS_CHANGED', resourceType: 'graduation_participant', resourceId: participantId, before: { status: current.status }, after: { status: participant.status }, event })
    return { participant, application: updatedApplication, replayed: false, auditId: audit.id }
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelulusan tidak tersedia.')
  const participantReference = db.collection('graduationParticipants').doc(participantId)
  const idem = db.collection('graduationIdempotency').doc(opaqueId('idem', namespace))
  const result = await db.runTransaction(async transaction => {
    const [previous, participantDocument] = await Promise.all([transaction.get(idem), transaction.get(participantReference)])
    if (!participantDocument.exists) notFound('Peserta kelulusan')
    const current = { id: participantDocument.id, ...participantDocument.data() } as GraduationParticipant
    requireStaffScope(context, current.programStudyId)
    if (previous.exists) {
      const data = previous.data() as { requestHash: string; participant: GraduationParticipant; application: GraduationApplication }
      if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
      return { participant: data.participant, application: data.application, replayed: true }
    }
    if (current.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Peserta telah berubah.', { currentVersion: current.version })
    if (!allowed[current.status].includes(input.status)) conflict('INVALID_STATUS_TRANSITION', 'Transisi peserta tidak diizinkan.')
    const applicationReference = db.collection('graduationApplications').doc(current.applicationId)
    const applicationDocument = await transaction.get(applicationReference)
    if (!applicationDocument.exists) notFound('Pengajuan kelulusan')
    const application = { id: applicationDocument.id, ...applicationDocument.data() } as GraduationApplication
    const participant: GraduationParticipant = { ...current, status: input.status, version: current.version + 1, updatedAt: now, history: [...current.history, { from: current.status, to: input.status, actorUid: context.uid, occurredAt: now, ...(input.reason ? { reason: input.reason.slice(0, 500) } : {}) }] }
    const updatedApplication = input.status === 'GRADUATED'
      ? { ...application, status: 'GRADUATED' as const, version: application.version + 1, updatedAt: now, history: [...application.history, statusEvent(context, 'GRADUATED', now, application.status, input.reason)] }
      : application
    transaction.set(participantReference, participant)
    if (updatedApplication !== application) transaction.set(applicationReference, updatedApplication)
    transaction.create(idem, { requestHash: hash, participant, application: updatedApplication, createdAt: now })
    return { participant, application: updatedApplication, replayed: false }
  })
  if (result.replayed) return result
  const audit = await appendAudit({ actor: context, action: 'GRADUATION_PARTICIPANT_STATUS_CHANGED', resourceType: 'graduation_participant', resourceId: participantId, after: { status: result.participant.status }, event })
  return { ...result, auditId: audit.id }
}
