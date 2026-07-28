import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  AcademicAdministrationWorkspace,
  AcademicCalendarEvent,
  AcademicCourseVersion,
  AcademicGradeRecord,
  LmsAcademicCatalog,
  AcademicPeriodDefinition,
  AcademicProgramStudy,
  AcademicTranscript,
  AdvisingSession,
  CurriculumVersion,
  LeaveRequest,
  MbkmActivity,
  MbkmConversion,
  MbkmLogEntry,
  RpsHead,
  RpsSection,
  RpsVersion,
  SemesterResult,
  StudentAcademicProfileRecord,
  ThesisGuidanceEntry,
  ThesisRecord,
} from '../types/academic-administration'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { withFirestorePurgeAfter } from '../utils/firestore-ttl'
import { hasRole, requirePermission } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { normalizeIsoInstant, optionalString, requireInteger, requireRecord, requireString } from '../utils/validation'
import { academicAdministrationState, resetAcademicAdministrationStateForTests } from './academic-administration-state'
import { getPrivateFileDetail } from './files'
import { krsModuleState } from './krs-state'
import { validateSafeRichContent } from './learning-validation'

export { resetAcademicAdministrationStateForTests }

const MAX_SCAN = 5_000
const IDEM_TTL_MS = 24 * 60 * 60 * 1_000
function clone<T>(value: T): T { return structuredClone(value) }
function safeId(value: unknown, label: string): string { return requireString(value, label, { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ }) }
function idempotencyKey(value: string): string { if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(value)) invalidInput('Idempotency key tidak valid.'); return value }
function rejectUnknown(body: Record<string, unknown>, allowed: readonly string[]): void { const unknown = Object.keys(body).filter(key => !allowed.includes(key)); if (unknown.length) invalidInput(`Field tidak didukung: ${unknown.join(', ')}.`) }
function studentCandidates(context: AuthContext): string[] { return [...new Set([context.uid, ...context.scope.studentIds])] }
function financeHoldActive(studentId: string): boolean { return krsModuleState().students.get(studentId)?.holds.some(item => item.type === 'FINANCE' && item.active) || false }
function canProgram(context: AuthContext, programStudyId: string): boolean { return hasRole(context, 'administrator', 'leader') || context.scope.programStudyIds.includes(programStudyId) }
function requireAcademicStaff(context: AuthContext, programStudyId: string): void { if (!hasRole(context, 'administrator') && !(hasRole(context, 'academic_staff') && context.scope.programStudyIds.includes(programStudyId))) forbidden('Data akademik berada di luar lingkup staf.') }

async function all<T>(collection: string, mockValues: () => T[]): Promise<T[]> {
  if (dataMode() === 'mock') return mockValues().map(clone)
  const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan administrasi akademik tidak tersedia.')
  const snapshot = await db.collection(collection).limit(MAX_SCAN).get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as T)
}

async function masterById<T>(collection: string, id: string, mockValues: Map<string, T>): Promise<T | undefined> {
  if (dataMode() === 'mock') {
    const value = mockValues.get(id)
    return value ? clone(value) : undefined
  }
  const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan administrasi akademik tidak tersedia.')
  const snapshot = await db.collection(collection).doc(id).get()
  return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as T) : undefined
}

export async function listLmsAcademicCatalog(context: AuthContext): Promise<LmsAcademicCatalog> {
  requirePermission(context, 'classes:manage')
  const [programs, periods, courses] = await Promise.all([
    all<AcademicProgramStudy>('academicProgramStudies', () => [...academicAdministrationState().programs.values()]),
    all<AcademicPeriodDefinition>('academicPeriodDefinitions', () => [...academicAdministrationState().periods.values()]),
    all<AcademicCourseVersion>('academicCourseVersions', () => [...academicAdministrationState().courses.values()]),
  ])
  const activePrograms = programs.filter(program => program.active)
  const activeProgramIds = new Set(activePrograms.map(program => program.id))
  return {
    programs: activePrograms.sort((left, right) => left.code.localeCompare(right.code, 'id')),
    periods: periods.filter(period => period.active).sort((left, right) => right.startsAt.localeCompare(left.startsAt) || left.id.localeCompare(right.id)),
    courses: courses
      .filter(course => course.status === 'ACTIVE' && course.immutable === true && activeProgramIds.has(course.programStudyId))
      .sort((left, right) => left.code.localeCompare(right.code, 'id') || right.version - left.version),
  }
}

export interface LmsClassCatalogSelection {
  course: AcademicCourseVersion
  period: AcademicPeriodDefinition
  program: AcademicProgramStudy
}

export async function resolveLmsClassCatalogSelection(
  context: AuthContext,
  courseVersionId: string,
  periodId: string,
): Promise<LmsClassCatalogSelection> {
  requirePermission(context, 'classes:manage')
  const safeCourseVersionId = safeId(courseVersionId, 'courseVersionId')
  const safePeriodId = safeId(periodId, 'periodId')
  const state = academicAdministrationState()
  const [course, period] = await Promise.all([
    masterById<AcademicCourseVersion>('academicCourseVersions', safeCourseVersionId, state.courses),
    masterById<AcademicPeriodDefinition>('academicPeriodDefinitions', safePeriodId, state.periods),
  ])
  if (!course) notFound('Versi mata kuliah')
  if (course.status !== 'ACTIVE' || course.immutable !== true) {
    conflict('COURSE_VERSION_NOT_ACTIVE', 'Kelas LMS hanya dapat memakai versi mata kuliah ACTIVE yang immutable.')
  }
  if (!period) notFound('Periode akademik')
  if (!period.active) conflict('ACADEMIC_PERIOD_NOT_ACTIVE', 'Kelas LMS hanya dapat memakai periode akademik aktif.')
  const program = await masterById<AcademicProgramStudy>('academicProgramStudies', course.programStudyId, state.programs)
  if (!program) notFound('Program studi mata kuliah')
  if (!program.active) conflict('PROGRAM_STUDY_NOT_ACTIVE', 'Program studi mata kuliah tidak aktif.')
  return { course, period, program }
}

async function profileById(studentId: string): Promise<StudentAcademicProfileRecord> {
  const id = safeId(studentId, 'studentId')
  if (dataMode() === 'mock') { const value = academicAdministrationState().profiles.get(id); if (!value) notFound('Profil akademik mahasiswa'); return clone(value) }
  const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan profil akademik tidak tersedia.')
  const snapshot = await db.collection('academicStudentProfiles').doc(id).get(); if (!snapshot.exists) notFound('Profil akademik mahasiswa')
  return { studentId: snapshot.id, ...snapshot.data() } as StudentAcademicProfileRecord
}

async function ownProfile(context: AuthContext): Promise<StudentAcademicProfileRecord> {
  const matches: StudentAcademicProfileRecord[] = []
  for (const candidate of studentCandidates(context)) { try { matches.push(await profileById(candidate)) } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'NOT_FOUND')) throw error } }
  const unique = [...new Map(matches.map(item => [item.studentId, item])).values()]
  if (unique.length !== 1) forbidden('Identitas mahasiswa tidak dapat ditentukan secara unik.')
  return unique[0]!
}

function canReadProfile(context: AuthContext, profile: StudentAcademicProfileRecord): boolean {
  return hasRole(context, 'administrator', 'leader') || (hasRole(context, 'student', 'guardian') && studentCandidates(context).includes(profile.studentId))
    || (hasRole(context, 'advisor') && profile.advisorId === context.uid) || (hasRole(context, 'academic_staff') && context.scope.programStudyIds.includes(profile.programStudyId))
}

async function visibleProfile(context: AuthContext, requested?: string): Promise<StudentAcademicProfileRecord | undefined> {
  if (hasRole(context, 'student')) return ownProfile(context)
  if (!requested) return undefined
  const profile = await profileById(requested); if (!canReadProfile(context, profile)) forbidden('Profil mahasiswa berada di luar lingkup akses Anda.')
  return profile
}

function redactAdvising(context: AuthContext, item: AdvisingSession): AdvisingSession {
  if (hasRole(context, 'student', 'guardian') && !hasRole(context, 'administrator', 'academic_staff', 'advisor')) { const copy = clone(item); delete copy.privateAdvisorNote; return copy }
  return clone(item)
}

export async function getAcademicAdministrationWorkspace(context: AuthContext, requestedStudentId?: string): Promise<AcademicAdministrationWorkspace> {
  const profile = await visibleProfile(context, requestedStudentId)
  const [programs, periods, courses, curricula, calendar, leaves, advising, rps, theses, mbkm] = await Promise.all([
    all<AcademicProgramStudy>('academicProgramStudies', () => [...academicAdministrationState().programs.values()]),
    all<AcademicPeriodDefinition>('academicPeriodDefinitions', () => [...academicAdministrationState().periods.values()]),
    all<AcademicCourseVersion>('academicCourseVersions', () => [...academicAdministrationState().courses.values()]),
    all<CurriculumVersion>('academicCurriculumVersions', () => [...academicAdministrationState().curricula.values()]),
    all<AcademicCalendarEvent>('academicCalendarEvents', () => [...academicAdministrationState().calendar.values()]),
    all<LeaveRequest>('academicLeaveRequests', () => [...academicAdministrationState().leaveRequests.values()]),
    all<AdvisingSession>('academicAdvisingSessions', () => [...academicAdministrationState().advisingSessions.values()]),
    all<RpsVersion>('academicRpsVersions', () => [...academicAdministrationState().rpsVersions.values()]),
    all<ThesisRecord>('academicTheses', () => [...academicAdministrationState().theses.values()]),
    all<MbkmActivity>('academicMbkmActivities', () => [...academicAdministrationState().mbkmActivities.values()]),
  ])
  const programFilter = (programStudyId?: string) => !programStudyId || canProgram(context, programStudyId)
  const studentFilter = (studentId: string, programStudyId: string) => profile ? studentId === profile.studentId : canProgram(context, programStudyId)
  return {
    ...(profile ? { profile } : {}), programs: programs.filter(item => programFilter(item.id)), periods: periods.filter(item => item.active),
    courses: courses.filter(item => programFilter(item.programStudyId) && item.status !== 'RETIRED'), curricula: curricula.filter(item => programFilter(item.programStudyId) && item.status !== 'RETIRED'),
    calendar: calendar.filter(item => !item.programStudyIds.length || item.programStudyIds.some(programFilter)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    leaveRequests: leaves.filter(item => studentFilter(item.studentId, item.programStudyId)).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    advisingSessions: advising.filter(item => studentFilter(item.studentId, item.programStudyId) && (!hasRole(context, 'advisor') || item.advisorId === context.uid)).map(item => redactAdvising(context, item)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    rpsVersions: rps.filter(item => programFilter(item.programStudyId) && (item.status === 'PUBLISHED' || item.lecturerIds.includes(context.uid) || hasRole(context, 'administrator', 'academic_staff'))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    theses: theses.filter(item => studentFilter(item.studentId, item.programStudyId) && (!hasRole(context, 'advisor', 'lecturer') || item.supervisorIds.includes(context.uid))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    mbkmActivities: mbkm.filter(item => studentFilter(item.studentId, item.programStudyId) && (!hasRole(context, 'advisor', 'lecturer') || item.supervisorIds.includes(context.uid))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  }
}

async function gradeRows(studentId: string): Promise<AcademicGradeRecord[]> {
  return (await all<AcademicGradeRecord>('academicGradeRecords', () => [...academicAdministrationState().grades.values()])).filter(item => item.studentId === studentId)
}

function gpa(rows: AcademicGradeRecord[]): number { const credits = rows.reduce((sum, item) => sum + item.credits, 0); return credits ? Math.round(rows.reduce((sum, item) => sum + item.credits * item.gradePoint, 0) * 100 / credits) / 100 : 0 }

export async function getSemesterResult(context: AuthContext, studentId: string, periodId: string): Promise<SemesterResult> {
  const profile = await profileById(studentId); if (!canReadProfile(context, profile)) forbidden('KHS berada di luar lingkup akses Anda.')
  const rows = (await gradeRows(profile.studentId)).filter(item => item.periodId === safeId(periodId, 'periodId')).sort((a, b) => a.courseCode.localeCompare(b.courseCode))
  return { periodId, studentId: profile.studentId, rows, attemptedCredits: rows.reduce((sum, item) => sum + item.credits, 0), earnedCredits: rows.filter(item => item.gradePoint > 0).reduce((sum, item) => sum + item.credits, 0), semesterGpa: gpa(rows), generatedAt: new Date().toISOString() }
}

export async function getProvisionalTranscript(context: AuthContext, studentId: string): Promise<AcademicTranscript> {
  const student = await profileById(studentId); if (!canReadProfile(context, student)) forbidden('Transkrip berada di luar lingkup akses Anda.')
  const rows = (await gradeRows(student.studentId)).sort((a, b) => a.periodId.localeCompare(b.periodId) || a.courseCode.localeCompare(b.courseCode))
  return { student, rows, totalAttemptedCredits: rows.reduce((sum, item) => sum + item.credits, 0), totalEarnedCredits: rows.filter(item => item.gradePoint > 0).reduce((sum, item) => sum + item.credits, 0), cumulativeGpa: gpa(rows), generatedAt: new Date().toISOString(), status: 'PROVISIONAL' }
}

async function cleanOptionalFile(context: AuthContext, value: unknown): Promise<string | undefined> {
  if (value === undefined || value === null || value === '') return undefined
  const id = safeId(value, 'supportingFileId'), detail = await getPrivateFileDetail(context, id)
  if (detail.file.status !== 'CLEAN' || detail.file.deleted) conflict('FILE_NOT_CLEAN', 'Dokumen pendukung harus menggunakan file privat CLEAN.')
  return id
}

export async function submitLeaveRequest(context: AuthContext, value: unknown, key: string, event?: H3Event, clock = new Date()): Promise<{ request: LeaveRequest; replayed: boolean; auditId?: string }> {
  if (!hasRole(context, 'student')) forbidden('Pengajuan cuti hanya tersedia untuk mahasiswa.')
  idempotencyKey(key); const body = requireRecord(value); rejectUnknown(body, ['periodId', 'reason', 'supportingFileId'])
  const profile = await ownProfile(context), periodId = safeId(body.periodId, 'periodId'), reason = requireString(body.reason, 'reason', { min: 20, max: 2_000 }), supportingFileId = await cleanOptionalFile(context, body.supportingFileId)
  if (profile.status !== 'ACTIVE') conflict('LEAVE_STUDENT_NOT_ACTIVE', 'Hanya mahasiswa aktif yang dapat mengajukan cuti.')
  const now = clock.toISOString(), hash = requestHash({ studentId: profile.studentId, periodId, reason, supportingFileId }), namespace = `academic:leave:${context.uid}:${key}`
  const id = opaqueId('leave', `${profile.studentId}:${periodId}`), request: LeaveRequest = { id, studentId: profile.studentId, studentUid: context.uid, programStudyId: profile.programStudyId, periodId, reason, ...(supportingFileId ? { supportingFileId } : {}), eligibilitySnapshot: { status: profile.status, financeHoldActive: financeHoldActive(profile.studentId), requestedAt: now }, status: 'SUBMITTED', version: 1, submittedAt: now }
  if (request.eligibilitySnapshot.financeHoldActive) conflict('LEAVE_FINANCE_HOLD', 'Pengajuan cuti diblokir karena kewajiban keuangan aktif.')
  let replayed = false
  if (dataMode() === 'mock') {
    const prior = academicAdministrationState().idempotency.get(namespace); if (prior) { if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...(clone(prior.response) as { request: LeaveRequest; replayed: boolean }), replayed: true } }
    if ([...academicAdministrationState().leaveRequests.values()].some(item => item.studentId === profile.studentId && item.periodId === periodId && ['SUBMITTED', 'APPROVED'].includes(item.status))) conflict('LEAVE_REQUEST_EXISTS', 'Pengajuan cuti untuk periode ini sudah ada.')
    academicAdministrationState().leaveRequests.set(id, clone(request)); academicAdministrationState().idempotency.set(namespace, { requestHash: hash, response: { request, replayed: false }, createdAt: now })
  } else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan pengajuan cuti tidak tersedia.')
    const requestRef = db.collection('academicLeaveRequests').doc(id), keyRef = db.collection('academicLeaveKeys').doc(id), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)), academicRef = db.collection('studentAcademicStates').doc(profile.studentId)
    const response = await db.runTransaction(async transaction => {
      const [prior, existing, academic] = await Promise.all([transaction.get(idemRef), transaction.get(keyRef), transaction.get(academicRef)])
      if (prior.exists) { const stored = prior.data() as { requestHash: string; response: { request: LeaveRequest; replayed: boolean } }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } }
      if (existing.exists) conflict('LEAVE_REQUEST_EXISTS', 'Pengajuan cuti untuk periode ini sudah ada.')
      const holds = academic.exists && Array.isArray(academic.data()?.holds) ? academic.data()!.holds as Array<{ type?: string; active?: boolean }> : []
      if (holds.some(item => item.type === 'FINANCE' && item.active)) conflict('LEAVE_FINANCE_HOLD', 'Pengajuan cuti diblokir karena kewajiban keuangan aktif.')
      transaction.create(requestRef, request); transaction.create(keyRef, { requestId: id, status: 'SUBMITTED', createdAt: now }); transaction.create(idemRef, { requestHash: hash, response: { request, replayed: false }, createdAt: now, expiresAt: new Date(clock.getTime() + IDEM_TTL_MS).toISOString() }); return { request, replayed: false }
    })
    if (response.replayed) return response; replayed = response.replayed
  }
  const audit = await appendAudit({ actor: context, action: 'ACADEMIC_LEAVE_SUBMITTED', resourceType: 'academic_leave', resourceId: id, after: { studentId: profile.studentId, periodId, eligibilitySnapshot: request.eligibilitySnapshot, supportingFileId }, event })
  return { request, replayed, auditId: audit.id }
}

export async function reviewLeaveRequest(context: AuthContext, requestId: string, value: unknown, event?: H3Event, clock = new Date()): Promise<{ request: LeaveRequest; profile: StudentAcademicProfileRecord; auditId: string }> {
  const id = safeId(requestId, 'requestId'), body = requireRecord(value); rejectUnknown(body, ['decision', 'reviewNote', 'expectedVersion'])
  const decision = requireString(body.decision, 'decision', { max: 20 }) as 'APPROVED' | 'REJECTED'; if (!['APPROVED', 'REJECTED'].includes(decision)) invalidInput('decision harus APPROVED atau REJECTED.')
  const note = optionalString(body.reviewNote, 'reviewNote', 1_000), expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 1), now = clock.toISOString()
  let request: LeaveRequest, profile: StudentAcademicProfileRecord
  const transition = (current: LeaveRequest, currentProfile: StudentAcademicProfileRecord) => {
    requireAcademicStaff(context, current.programStudyId); if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Pengajuan cuti telah berubah.', { currentVersion: current.version }); if (current.status !== 'SUBMITTED') conflict('LEAVE_ALREADY_REVIEWED', 'Pengajuan cuti sudah ditinjau.')
    const nextRequest: LeaveRequest = { ...current, status: decision, version: current.version + 1, reviewedAt: now, reviewedBy: context.uid, ...(note ? { reviewNote: note } : {}) }
    const nextProfile = decision === 'APPROVED' ? { ...currentProfile, status: 'LEAVE' as const, version: currentProfile.version + 1, statusHistory: [...currentProfile.statusHistory, { id: opaqueId('status_event', `${current.id}:${decision}`), status: 'LEAVE' as const, periodId: current.periodId, reason: note || 'Cuti akademik disetujui.', effectiveAt: now, recordedBy: context.uid }], updatedAt: now } : currentProfile
    return { request: nextRequest, profile: nextProfile }
  }
  if (dataMode() === 'mock') { const current = academicAdministrationState().leaveRequests.get(id); if (!current) notFound('Pengajuan cuti'); const currentProfile = academicAdministrationState().profiles.get(current.studentId); if (!currentProfile) notFound('Profil akademik mahasiswa'); ({ request, profile } = transition(clone(current), clone(currentProfile))); academicAdministrationState().leaveRequests.set(id, clone(request)); academicAdministrationState().profiles.set(profile.studentId, clone(profile)) }
  else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan pengajuan cuti tidak tersedia.'); const requestRef = db.collection('academicLeaveRequests').doc(id)
    ;({ request, profile } = await db.runTransaction(async transaction => { const requestSnapshot = await transaction.get(requestRef); if (!requestSnapshot.exists) notFound('Pengajuan cuti'); const current = { id: requestSnapshot.id, ...requestSnapshot.data() } as LeaveRequest, profileRef = db.collection('academicStudentProfiles').doc(current.studentId), profileSnapshot = await transaction.get(profileRef); if (!profileSnapshot.exists) notFound('Profil akademik mahasiswa'); const next = transition(current, { studentId: profileSnapshot.id, ...profileSnapshot.data() } as StudentAcademicProfileRecord); transaction.update(requestRef, next.request); if (decision === 'APPROVED') transaction.update(profileRef, next.profile); transaction.set(db.collection('academicLeaveKeys').doc(id), { requestId: id, status: decision, updatedAt: now }); return next }))
  }
  const audit = await appendAudit({ actor: context, action: `ACADEMIC_LEAVE_${decision}`, resourceType: 'academic_leave', resourceId: id, before: { status: 'SUBMITTED', version: expectedVersion }, after: { status: request.status, version: request.version, studentStatus: profile.status, reviewNote: note }, event })
  return { request, profile, auditId: audit.id }
}

export async function requestAdvisingSession(context: AuthContext, value: unknown, key: string, event?: H3Event, clock = new Date()): Promise<{ session: AdvisingSession; replayed: boolean; auditId?: string }> {
  if (!hasRole(context, 'student')) forbidden('Permintaan perwalian hanya tersedia untuk mahasiswa.'); idempotencyKey(key)
  const body = requireRecord(value); rejectUnknown(body, ['topic', 'requestedAt']); const profile = await ownProfile(context), topic = requireString(body.topic, 'topic', { min: 10, max: 1_000 }), requestedAt = normalizeIsoInstant(body.requestedAt, 'requestedAt', { maxFutureMs: 180 * 86_400_000 })
  const now = clock.toISOString(), hash = requestHash({ studentId: profile.studentId, topic, requestedAt }), namespace = `academic:advising:${context.uid}:${key}`, id = opaqueId('advising', `${profile.studentId}:${key}`)
  const session: AdvisingSession = { id, studentId: profile.studentId, studentUid: context.uid, advisorId: profile.advisorId, programStudyId: profile.programStudyId, topic, requestedAt, status: 'REQUESTED', version: 1, createdAt: now, updatedAt: now }
  if (dataMode() === 'mock') { const prior = academicAdministrationState().idempotency.get(namespace); if (prior) { if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...(clone(prior.response) as { session: AdvisingSession; replayed: boolean }), replayed: true } }; const open = [...academicAdministrationState().advisingSessions.values()].filter(item => item.studentId === profile.studentId && ['REQUESTED', 'SCHEDULED'].includes(item.status)); if (open.length >= 5) conflict('ADVISING_OPEN_LIMIT', 'Terlalu banyak sesi perwalian yang masih terbuka.'); academicAdministrationState().advisingSessions.set(id, clone(session)); academicAdministrationState().idempotency.set(namespace, { requestHash: hash, response: { session, replayed: false }, createdAt: now }) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan perwalian tidak tersedia.'); const sessionRef = db.collection('academicAdvisingSessions').doc(id), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)); const response = await db.runTransaction(async transaction => { const prior = await transaction.get(idemRef); if (prior.exists) { const stored = prior.data() as { requestHash: string; response: { session: AdvisingSession; replayed: boolean } }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } }; transaction.create(sessionRef, session); transaction.create(idemRef, { requestHash: hash, response: { session, replayed: false }, createdAt: now }); return { session, replayed: false } }); if (response.replayed) return response }
  const audit = await appendAudit({ actor: context, action: 'ACADEMIC_ADVISING_REQUESTED', resourceType: 'academic_advising', resourceId: id, after: { studentId: profile.studentId, advisorId: profile.advisorId, requestedAt }, event }); return { session, replayed: false, auditId: audit.id }
}

export async function updateAdvisingSession(context: AuthContext, sessionId: string, value: unknown, event?: H3Event, clock = new Date()): Promise<{ session: AdvisingSession; auditId: string }> {
  const id = safeId(sessionId, 'sessionId'), body = requireRecord(value); rejectUnknown(body, ['status', 'scheduledAt', 'channel', 'studentSummary', 'privateAdvisorNote', 'expectedVersion'])
  const status = requireString(body.status, 'status', { max: 20 }) as AdvisingSession['status']; if (!['SCHEDULED', 'COMPLETED', 'CANCELLED'].includes(status)) invalidInput('Status perwalian tidak valid.')
  const scheduledAt = body.scheduledAt !== undefined ? normalizeIsoInstant(body.scheduledAt, 'scheduledAt', { maxFutureMs: 365 * 86_400_000 }) : undefined, channel = optionalString(body.channel, 'channel', 20) as AdvisingSession['channel'] | undefined
  if (channel && !['IN_PERSON', 'VIDEO', 'PHONE'].includes(channel)) invalidInput('Channel perwalian tidak valid.')
  const studentSummary = optionalString(body.studentSummary, 'studentSummary', 2_000), privateAdvisorNote = optionalString(body.privateAdvisorNote, 'privateAdvisorNote', 4_000), expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 1), now = clock.toISOString()
  const transition = (current: AdvisingSession): AdvisingSession => { if (!hasRole(context, 'administrator', 'academic_staff') && !(hasRole(context, 'advisor') && current.advisorId === context.uid)) forbidden('Sesi bukan perwalian Anda.'); if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Sesi perwalian telah berubah.', { currentVersion: current.version }); if (!['REQUESTED', 'SCHEDULED'].includes(current.status)) conflict('ADVISING_CLOSED', 'Sesi perwalian telah ditutup.'); if (status === 'SCHEDULED' && (!scheduledAt || !channel)) invalidInput('Jadwal dan channel wajib diisi.'); return { ...current, status, ...(scheduledAt ? { scheduledAt } : {}), ...(channel ? { channel } : {}), ...(studentSummary ? { studentSummary } : {}), ...(privateAdvisorNote ? { privateAdvisorNote } : {}), version: current.version + 1, updatedAt: now } }
  let session: AdvisingSession
  if (dataMode() === 'mock') { const current = academicAdministrationState().advisingSessions.get(id); if (!current) notFound('Sesi perwalian'); session = transition(clone(current)); academicAdministrationState().advisingSessions.set(id, clone(session)) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan perwalian tidak tersedia.'); const ref = db.collection('academicAdvisingSessions').doc(id); session = await db.runTransaction(async transaction => { const snapshot = await transaction.get(ref); if (!snapshot.exists) notFound('Sesi perwalian'); const next = transition({ id: snapshot.id, ...snapshot.data() } as AdvisingSession); transaction.update(ref, next); return next }) }
  const audit = await appendAudit({ actor: context, action: `ACADEMIC_ADVISING_${status}`, resourceType: 'academic_advising', resourceId: id, before: { version: expectedVersion }, after: { version: session.version, status, scheduledAt, channel, hasPrivateAdvisorNote: Boolean(privateAdvisorNote) }, event }); return { session, auditId: audit.id }
}

function parseRps(value: unknown) {
  const body = requireRecord(value); rejectUnknown(body, ['courseVersionId', 'programStudyId', 'periodId', 'lecturerIds', 'expectedCurrentVersion', 'title', 'description', 'courseLearningOutcomes', 'sections', 'assessmentWeights', 'status'])
  if (!Array.isArray(body.lecturerIds) || body.lecturerIds.length < 1 || body.lecturerIds.length > 10) invalidInput('lecturerIds harus berisi 1-10 dosen.')
  if (!Array.isArray(body.courseLearningOutcomes) || body.courseLearningOutcomes.length < 1 || body.courseLearningOutcomes.length > 20) invalidInput('Capaian pembelajaran harus berisi 1-20 butir.')
  if (!Array.isArray(body.sections) || body.sections.length < 1 || body.sections.length > 20) invalidInput('Bagian RPS harus berisi 1-20 minggu.')
  const sections: RpsSection[] = body.sections.map((raw, index) => { const item = requireRecord(raw, `sections[${index}]`); rejectUnknown(item, ['week', 'learningOutcome', 'topic', 'method', 'assessment', 'references']); if (!Array.isArray(item.references) || item.references.length > 20) invalidInput('Referensi RPS tidak valid.'); return { week: requireInteger(item.week, `sections[${index}].week`, 1, 20), learningOutcome: requireString(item.learningOutcome, 'learningOutcome', { min: 3, max: 1_000 }), topic: requireString(item.topic, 'topic', { min: 3, max: 1_000 }), method: requireString(item.method, 'method', { min: 2, max: 500 }), assessment: requireString(item.assessment, 'assessment', { min: 2, max: 500 }), references: item.references.map((entry, refIndex) => requireString(entry, `references[${refIndex}]`, { max: 500 })) } })
  if (new Set(sections.map(item => item.week)).size !== sections.length) invalidInput('Nomor minggu RPS harus unik.')
  if (!Array.isArray(body.assessmentWeights) || body.assessmentWeights.length < 1 || body.assessmentWeights.length > 20) invalidInput('Bobot penilaian RPS tidak valid.')
  const assessmentWeights = body.assessmentWeights.map((raw, index) => { const item = requireRecord(raw); return { label: requireString(item.label, `assessmentWeights[${index}].label`, { max: 120 }), weight: requireInteger(item.weight, `assessmentWeights[${index}].weight`, 0, 100) } })
  const status = requireString(body.status, 'status', { max: 20 }) as RpsVersion['status']; if (!['DRAFT', 'PUBLISHED'].includes(status)) invalidInput('Status RPS tidak valid.'); if (status === 'PUBLISHED' && assessmentWeights.reduce((sum, item) => sum + item.weight, 0) !== 100) invalidInput('Total bobot RPS terbit harus 100.')
  return { courseVersionId: safeId(body.courseVersionId, 'courseVersionId'), programStudyId: safeId(body.programStudyId, 'programStudyId'), periodId: safeId(body.periodId, 'periodId'), lecturerIds: [...new Set(body.lecturerIds.map((item, index) => safeId(item, `lecturerIds[${index}]`)))], expectedCurrentVersion: requireInteger(body.expectedCurrentVersion, 'expectedCurrentVersion', 0), title: requireString(body.title, 'title', { min: 5, max: 240 }), description: validateSafeRichContent(body.description, 'description', 20_000), courseLearningOutcomes: body.courseLearningOutcomes.map((item, index) => requireString(item, `courseLearningOutcomes[${index}]`, { min: 3, max: 1_000 })), sections, assessmentWeights, status }
}

export async function createRpsVersion(context: AuthContext, value: unknown, key: string, event?: H3Event, clock = new Date()): Promise<{ head: RpsHead; version: RpsVersion; replayed: boolean; auditId?: string }> {
  idempotencyKey(key); const input = parseRps(value)
  if (!hasRole(context, 'administrator', 'academic_staff') && !(hasRole(context, 'lecturer', 'advisor') && input.lecturerIds.includes(context.uid))) forbidden('Anda tidak berwenang membuat RPS ini.')
  if (!hasRole(context, 'administrator') && !context.scope.programStudyIds.includes(input.programStudyId)) forbidden('RPS berada di luar lingkup program studi Anda.')
  const course = dataMode() === 'mock' ? academicAdministrationState().courses.get(input.courseVersionId) : (await all<AcademicCourseVersion>('academicCourseVersions', () => [])).find(item => item.id === input.courseVersionId)
  if (!course || course.programStudyId !== input.programStudyId) invalidInput('Versi mata kuliah RPS tidak valid.')
  const headId = opaqueId('rps', `${input.courseVersionId}:${input.periodId}`), now = clock.toISOString(), hash = requestHash(input), namespace = `academic:rps:${context.uid}:${key}`
  const build = (current?: RpsHead) => { const currentVersion = current?.currentVersion ?? 0; if (currentVersion !== input.expectedCurrentVersion) conflict('VERSION_CONFLICT', 'RPS telah berubah.', { currentVersion }); const nextVersion = currentVersion + 1, id = `${headId}_v${nextVersion}`; const version: RpsVersion = { id, rpsId: headId, courseVersionId: input.courseVersionId, programStudyId: input.programStudyId, periodId: input.periodId, lecturerIds: input.lecturerIds, version: nextVersion, title: input.title, description: input.description, courseLearningOutcomes: input.courseLearningOutcomes, sections: input.sections, assessmentWeights: input.assessmentWeights, status: input.status, source: 'MANUAL', createdAt: now, createdBy: context.uid, immutable: true }; const head: RpsHead = { id: headId, courseVersionId: input.courseVersionId, programStudyId: input.programStudyId, periodId: input.periodId, currentVersion: nextVersion, currentVersionId: id, ...(input.status === 'PUBLISHED' ? { publishedVersion: nextVersion, publishedVersionId: id } : current?.publishedVersion ? { publishedVersion: current.publishedVersion, publishedVersionId: current.publishedVersionId } : {}), updatedAt: now, updatedBy: context.uid }; return { head, version } }
  let result: { head: RpsHead; version: RpsVersion; replayed: boolean }
  if (dataMode() === 'mock') { const prior = academicAdministrationState().idempotency.get(namespace); if (prior) { if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...(clone(prior.response) as typeof result), replayed: true } }; const next = build(academicAdministrationState().rpsHeads.get(headId)); academicAdministrationState().rpsHeads.set(headId, clone(next.head)); academicAdministrationState().rpsVersions.set(next.version.id, clone(next.version)); result = { ...next, replayed: false }; academicAdministrationState().idempotency.set(namespace, { requestHash: hash, response: result, createdAt: now }) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan RPS tidak tersedia.'); const headRef = db.collection('academicRpsHeads').doc(headId), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)); result = await db.runTransaction(async transaction => { const [prior, headSnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(headRef)]); if (prior.exists) { const stored = prior.data() as { requestHash: string; response: typeof result }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } }; const next = build(headSnapshot.exists ? ({ id: headSnapshot.id, ...headSnapshot.data() } as RpsHead) : undefined), response = { ...next, replayed: false }; transaction.set(headRef, next.head); transaction.create(db.collection('academicRpsVersions').doc(next.version.id), next.version); transaction.create(idemRef, { requestHash: hash, response, createdAt: now }); return response }) }
  if (result.replayed) return result
  const audit = await appendAudit({ actor: context, action: 'ACADEMIC_RPS_VERSION_CREATED', resourceType: 'academic_rps', resourceId: headId, after: { versionId: result.version.id, version: result.version.version, status: result.version.status, source: 'MANUAL', sectionCount: result.version.sections.length }, event }); return { ...result, auditId: audit.id }
}

export async function createThesisProposal(context: AuthContext, value: unknown, key: string, event?: H3Event, clock = new Date()): Promise<{ thesis: ThesisRecord; replayed: boolean; auditId?: string }> {
  if (!hasRole(context, 'student')) forbidden('Proposal tugas akhir hanya tersedia untuk mahasiswa.'); idempotencyKey(key)
  const body = requireRecord(value); rejectUnknown(body, ['title', 'abstract', 'proposalFileId']); const profile = await ownProfile(context), title = requireString(body.title, 'title', { min: 15, max: 300 }), abstract = validateSafeRichContent(body.abstract, 'abstract', 20_000), proposalFileId = await cleanOptionalFile(context, body.proposalFileId)
  const now = clock.toISOString(), normalized = { studentId: profile.studentId, title, abstract, proposalFileId }, hash = requestHash(normalized), namespace = `academic:thesis:${context.uid}:${key}`, id = opaqueId('thesis', profile.studentId)
  const thesis: ThesisRecord = { id, studentId: profile.studentId, studentUid: context.uid, programStudyId: profile.programStudyId, title, abstract, supervisorIds: [profile.advisorId], status: 'PROPOSED', ...(proposalFileId ? { proposalFileId } : {}), guidance: [], version: 1, createdAt: now, updatedAt: now }
  if (dataMode() === 'mock') { const prior = academicAdministrationState().idempotency.get(namespace); if (prior) { if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...(clone(prior.response) as { thesis: ThesisRecord; replayed: boolean }), replayed: true } }; const existing = academicAdministrationState().theses.get(id); if (existing && !['PASSED', 'REJECTED'].includes(existing.status)) conflict('THESIS_ACTIVE_EXISTS', 'Mahasiswa sudah memiliki tugas akhir aktif.'); academicAdministrationState().theses.set(id, clone(thesis)); academicAdministrationState().idempotency.set(namespace, { requestHash: hash, response: { thesis, replayed: false }, createdAt: now }) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan tugas akhir tidak tersedia.'); const ref = db.collection('academicTheses').doc(id), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)); const response = await db.runTransaction(async transaction => { const [prior, existing] = await Promise.all([transaction.get(idemRef), transaction.get(ref)]); if (prior.exists) { const stored = prior.data() as { requestHash: string; response: { thesis: ThesisRecord; replayed: boolean } }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } }; if (existing.exists && !['PASSED', 'REJECTED'].includes(String(existing.data()?.status))) conflict('THESIS_ACTIVE_EXISTS', 'Mahasiswa sudah memiliki tugas akhir aktif.'); transaction.set(ref, thesis); transaction.create(idemRef, { requestHash: hash, response: { thesis, replayed: false }, createdAt: now }); return { thesis, replayed: false } }); if (response.replayed) return response }
  const audit = await appendAudit({ actor: context, action: 'ACADEMIC_THESIS_PROPOSED', resourceType: 'academic_thesis', resourceId: id, after: { studentId: profile.studentId, title, supervisorIds: thesis.supervisorIds, proposalFileId }, event }); return { thesis, replayed: false, auditId: audit.id }
}

const THESIS_TRANSITIONS: Record<ThesisRecord['status'], ThesisRecord['status'][]> = { PROPOSED: ['APPROVED', 'REJECTED'], APPROVED: ['IN_PROGRESS'], IN_PROGRESS: ['READY_FOR_DEFENSE'], READY_FOR_DEFENSE: ['PASSED', 'IN_PROGRESS'], PASSED: [], REJECTED: [] }
export async function transitionThesis(context: AuthContext, thesisId: string, value: unknown, event?: H3Event, clock = new Date()): Promise<{ thesis: ThesisRecord; auditId: string }> {
  const id = safeId(thesisId, 'thesisId'), body = requireRecord(value); rejectUnknown(body, ['status', 'expectedVersion']); const status = requireString(body.status, 'status', { max: 30 }) as ThesisRecord['status'], expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 1), now = clock.toISOString()
  const transition = (current: ThesisRecord) => { if (!hasRole(context, 'administrator', 'academic_staff') && !current.supervisorIds.includes(context.uid)) forbidden('Tugas akhir bukan bimbingan Anda.'); if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Tugas akhir telah berubah.', { currentVersion: current.version }); if (!THESIS_TRANSITIONS[current.status].includes(status)) conflict('INVALID_STATE_TRANSITION', `Status ${current.status} tidak dapat diubah menjadi ${status}.`); return { ...current, status, version: current.version + 1, updatedAt: now, reviewedAt: now, reviewedBy: context.uid } }
  let thesis: ThesisRecord
  if (dataMode() === 'mock') { const current = academicAdministrationState().theses.get(id); if (!current) notFound('Tugas akhir'); thesis = transition(clone(current)); academicAdministrationState().theses.set(id, clone(thesis)) } else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan tugas akhir tidak tersedia.'); const ref = db.collection('academicTheses').doc(id); thesis = await db.runTransaction(async transaction => { const snapshot = await transaction.get(ref); if (!snapshot.exists) notFound('Tugas akhir'); const next = transition({ id: snapshot.id, ...snapshot.data() } as ThesisRecord); transaction.update(ref, next); return next }) }
  const audit = await appendAudit({ actor: context, action: `ACADEMIC_THESIS_${status}`, resourceType: 'academic_thesis', resourceId: id, before: { version: expectedVersion }, after: { version: thesis.version, status }, event }); return { thesis, auditId: audit.id }
}

export async function addThesisGuidance(context: AuthContext, thesisId: string, value: unknown, key: string, event?: H3Event, clock = new Date()): Promise<{ thesis: ThesisRecord; entry: ThesisGuidanceEntry; replayed: boolean; auditId?: string }> {
  idempotencyKey(key); const id = safeId(thesisId, 'thesisId'), body = requireRecord(value); rejectUnknown(body, ['occurredAt', 'summary', 'nextAction', 'expectedVersion']); const occurredAt = normalizeIsoInstant(body.occurredAt, 'occurredAt', { maxFutureMs: 5 * 60 * 1000 }), summary = requireString(body.summary, 'summary', { min: 10, max: 4_000 }), nextAction = requireString(body.nextAction, 'nextAction', { min: 5, max: 2_000 }), expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 1), now = clock.toISOString(), hash = requestHash({ id, occurredAt, summary, nextAction, expectedVersion }), namespace = `academic:thesis-guidance:${context.uid}:${key}`
  const update = (current: ThesisRecord) => { if (!current.supervisorIds.includes(context.uid) && !hasRole(context, 'administrator', 'academic_staff')) forbidden('Tugas akhir bukan bimbingan Anda.'); if (!['APPROVED', 'IN_PROGRESS', 'READY_FOR_DEFENSE'].includes(current.status)) conflict('THESIS_NOT_IN_GUIDANCE', 'Status tugas akhir belum menerima bimbingan.'); if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Tugas akhir telah berubah.', { currentVersion: current.version }); const entry: ThesisGuidanceEntry = { id: opaqueId('thesis_guidance', `${id}:${key}`), occurredAt, summary, nextAction, recordedBy: context.uid, immutable: true }, thesis: ThesisRecord = { ...current, status: current.status === 'APPROVED' ? 'IN_PROGRESS' : current.status, guidance: [...current.guidance, entry], version: current.version + 1, updatedAt: now }; return { thesis, entry } }
  let result: { thesis: ThesisRecord; entry: ThesisGuidanceEntry; replayed: boolean }
  if (dataMode() === 'mock') { const prior = academicAdministrationState().idempotency.get(namespace); if (prior) { if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...(clone(prior.response) as typeof result), replayed: true } }; const current = academicAdministrationState().theses.get(id); if (!current) notFound('Tugas akhir'); const next = update(clone(current)); academicAdministrationState().theses.set(id, clone(next.thesis)); result = { ...next, replayed: false }; academicAdministrationState().idempotency.set(namespace, { requestHash: hash, response: result, createdAt: now }) } else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan tugas akhir tidak tersedia.'); const ref = db.collection('academicTheses').doc(id), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)); result = await db.runTransaction(async transaction => { const [prior, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(ref)]); if (prior.exists) { const stored = prior.data() as { requestHash: string; response: typeof result }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } }; if (!snapshot.exists) notFound('Tugas akhir'); const next = update({ id: snapshot.id, ...snapshot.data() } as ThesisRecord), response = { ...next, replayed: false }; transaction.update(ref, next.thesis); transaction.create(idemRef, { requestHash: hash, response, createdAt: now }); return response }) }
  if (result.replayed) return result; const audit = await appendAudit({ actor: context, action: 'ACADEMIC_THESIS_GUIDANCE_ADDED', resourceType: 'academic_thesis', resourceId: id, after: { entryId: result.entry.id, occurredAt, version: result.thesis.version }, event }); return { ...result, auditId: audit.id }
}

const MBKM_SCHEMES: MbkmActivity['scheme'][] = ['INTERNSHIP', 'EXCHANGE', 'TEACHING', 'RESEARCH', 'ENTREPRENEURSHIP', 'HUMANITARIAN']
export async function createMbkmActivity(context: AuthContext, value: unknown, key: string, event?: H3Event, clock = new Date()): Promise<{ activity: MbkmActivity; replayed: boolean; auditId?: string }> {
  if (!hasRole(context, 'student')) forbidden('Pengajuan MBKM hanya tersedia untuk mahasiswa.'); idempotencyKey(key)
  const body = requireRecord(value); rejectUnknown(body, ['periodId', 'scheme', 'partnerName', 'title', 'startsOn', 'endsOn']); const profile = await ownProfile(context), scheme = requireString(body.scheme, 'scheme', { max: 30 }) as MbkmActivity['scheme']; if (!MBKM_SCHEMES.includes(scheme)) invalidInput('Skema MBKM tidak valid.')
  const periodId = safeId(body.periodId, 'periodId'), partnerName = requireString(body.partnerName, 'partnerName', { min: 3, max: 240 }), title = requireString(body.title, 'title', { min: 5, max: 300 }), startsOn = requireString(body.startsOn, 'startsOn', { max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ }), endsOn = requireString(body.endsOn, 'endsOn', { max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ }); if (endsOn < startsOn) invalidInput('Tanggal selesai MBKM harus setelah tanggal mulai.')
  const now = clock.toISOString(), normalized = { studentId: profile.studentId, periodId, scheme, partnerName, title, startsOn, endsOn }, hash = requestHash(normalized), namespace = `academic:mbkm:${context.uid}:${key}`, id = opaqueId('mbkm', `${profile.studentId}:${periodId}:${key}`)
  const activity: MbkmActivity = { id, studentId: profile.studentId, studentUid: context.uid, programStudyId: profile.programStudyId, periodId, scheme, partnerName, title, startsOn, endsOn, supervisorIds: [profile.advisorId], status: 'PROPOSED', logbook: [], conversions: [], version: 1, createdAt: now, updatedAt: now }
  if (dataMode() === 'mock') { const prior = academicAdministrationState().idempotency.get(namespace); if (prior) { if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...(clone(prior.response) as { activity: MbkmActivity; replayed: boolean }), replayed: true } }; if ([...academicAdministrationState().mbkmActivities.values()].some(item => item.studentId === profile.studentId && item.periodId === periodId && !['COMPLETED', 'REJECTED'].includes(item.status))) conflict('MBKM_ACTIVE_EXISTS', 'Mahasiswa sudah memiliki aktivitas MBKM aktif pada periode ini.'); academicAdministrationState().mbkmActivities.set(id, clone(activity)); academicAdministrationState().idempotency.set(namespace, { requestHash: hash, response: { activity, replayed: false }, createdAt: now }) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan MBKM tidak tersedia.'); const ref = db.collection('academicMbkmActivities').doc(id), keyRef = db.collection('academicMbkmKeys').doc(opaqueId('mbkm_key', `${profile.studentId}:${periodId}`)), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)); const response = await db.runTransaction(async transaction => { const [prior, existing] = await Promise.all([transaction.get(idemRef), transaction.get(keyRef)]); if (prior.exists) { const stored = prior.data() as { requestHash: string; response: { activity: MbkmActivity; replayed: boolean } }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } }; if (existing.exists) conflict('MBKM_ACTIVE_EXISTS', 'Mahasiswa sudah memiliki aktivitas MBKM aktif pada periode ini.'); transaction.create(ref, activity); transaction.create(keyRef, { activityId: id, status: 'PROPOSED', createdAt: now }); transaction.create(idemRef, { requestHash: hash, response: { activity, replayed: false }, createdAt: now }); return { activity, replayed: false } }); if (response.replayed) return response }
  const audit = await appendAudit({ actor: context, action: 'ACADEMIC_MBKM_PROPOSED', resourceType: 'academic_mbkm', resourceId: id, after: { studentId: profile.studentId, periodId, scheme, partnerName, supervisorIds: activity.supervisorIds }, event }); return { activity, replayed: false, auditId: audit.id }
}

const MBKM_TRANSITIONS: Record<MbkmActivity['status'], MbkmActivity['status'][]> = { PROPOSED: ['APPROVED', 'REJECTED'], APPROVED: ['ACTIVE', 'REJECTED'], ACTIVE: ['COMPLETED'], COMPLETED: [], REJECTED: [] }
export async function transitionMbkmActivity(context: AuthContext, activityId: string, value: unknown, event?: H3Event, clock = new Date()): Promise<{ activity: MbkmActivity; auditId: string }> {
  const id = safeId(activityId, 'activityId'), body = requireRecord(value); rejectUnknown(body, ['status', 'expectedVersion']); const status = requireString(body.status, 'status', { max: 20 }) as MbkmActivity['status'], expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 1), now = clock.toISOString()
  const transition = (current: MbkmActivity) => { if (!hasRole(context, 'administrator', 'academic_staff') && !current.supervisorIds.includes(context.uid)) forbidden('Aktivitas MBKM bukan lingkup Anda.'); if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Aktivitas MBKM telah berubah.', { currentVersion: current.version }); if (!MBKM_TRANSITIONS[current.status].includes(status)) conflict('INVALID_STATE_TRANSITION', `Status ${current.status} tidak dapat diubah menjadi ${status}.`); if (status === 'COMPLETED' && !current.evaluation) conflict('MBKM_EVALUATION_REQUIRED', 'Evaluasi dan konversi wajib sebelum MBKM diselesaikan.'); return { ...current, status, version: current.version + 1, updatedAt: now } }
  let activity: MbkmActivity
  if (dataMode() === 'mock') { const current = academicAdministrationState().mbkmActivities.get(id); if (!current) notFound('Aktivitas MBKM'); activity = transition(clone(current)); academicAdministrationState().mbkmActivities.set(id, clone(activity)) } else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan MBKM tidak tersedia.'); const ref = db.collection('academicMbkmActivities').doc(id); activity = await db.runTransaction(async transaction => { const snapshot = await transaction.get(ref); if (!snapshot.exists) notFound('Aktivitas MBKM'); const next = transition({ id: snapshot.id, ...snapshot.data() } as MbkmActivity); transaction.update(ref, next); transaction.set(db.collection('academicMbkmKeys').doc(opaqueId('mbkm_key', `${next.studentId}:${next.periodId}`)), { activityId: id, status, updatedAt: now }); return next }) }
  const audit = await appendAudit({ actor: context, action: `ACADEMIC_MBKM_${status}`, resourceType: 'academic_mbkm', resourceId: id, before: { version: expectedVersion }, after: { version: activity.version, status }, event }); return { activity, auditId: audit.id }
}

export async function addMbkmLog(context: AuthContext, activityId: string, value: unknown, key: string, event?: H3Event, clock = new Date()): Promise<{ activity: MbkmActivity; entry: MbkmLogEntry; replayed: boolean; auditId?: string }> {
  idempotencyKey(key); const id = safeId(activityId, 'activityId'), body = requireRecord(value); rejectUnknown(body, ['occurredOn', 'activity', 'hours', 'evidenceFileId', 'expectedVersion']); const occurredOn = requireString(body.occurredOn, 'occurredOn', { max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ }), activityText = requireString(body.activity, 'activity', { min: 10, max: 4_000 }), hours = requireInteger(body.hours, 'hours', 1, 24), evidenceFileId = await cleanOptionalFile(context, body.evidenceFileId), expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 1), now = clock.toISOString(), hash = requestHash({ id, occurredOn, activityText, hours, evidenceFileId, expectedVersion }), namespace = `academic:mbkm-log:${context.uid}:${key}`
  const update = (current: MbkmActivity) => { if (!(hasRole(context, 'student') && studentCandidates(context).includes(current.studentId)) && !current.supervisorIds.includes(context.uid) && !hasRole(context, 'administrator', 'academic_staff')) forbidden('Aktivitas MBKM berada di luar akses Anda.'); if (current.status !== 'ACTIVE') conflict('MBKM_NOT_ACTIVE', 'Logbook hanya dapat diisi saat MBKM aktif.'); if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Aktivitas MBKM telah berubah.', { currentVersion: current.version }); if (occurredOn < current.startsOn || occurredOn > current.endsOn) invalidInput('Tanggal logbook di luar periode MBKM.'); const entry: MbkmLogEntry = { id: opaqueId('mbkm_log', `${id}:${key}`), occurredOn, activity: activityText, hours, ...(evidenceFileId ? { evidenceFileId } : {}), createdAt: now, immutable: true }, activity: MbkmActivity = { ...current, logbook: [...current.logbook, entry], version: current.version + 1, updatedAt: now }; return { activity, entry } }
  let result: { activity: MbkmActivity; entry: MbkmLogEntry; replayed: boolean }
  if (dataMode() === 'mock') { const prior = academicAdministrationState().idempotency.get(namespace); if (prior) { if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...(clone(prior.response) as typeof result), replayed: true } }; const current = academicAdministrationState().mbkmActivities.get(id); if (!current) notFound('Aktivitas MBKM'); const next = update(clone(current)); academicAdministrationState().mbkmActivities.set(id, clone(next.activity)); result = { ...next, replayed: false }; academicAdministrationState().idempotency.set(namespace, { requestHash: hash, response: result, createdAt: now }) } else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan MBKM tidak tersedia.'); const ref = db.collection('academicMbkmActivities').doc(id), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)); result = await db.runTransaction(async transaction => { const [prior, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(ref)]); if (prior.exists) { const stored = prior.data() as { requestHash: string; response: typeof result }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } }; if (!snapshot.exists) notFound('Aktivitas MBKM'); const next = update({ id: snapshot.id, ...snapshot.data() } as MbkmActivity), response = { ...next, replayed: false }; transaction.update(ref, next.activity); transaction.create(idemRef, { requestHash: hash, response, createdAt: now }); return response }) }
  if (result.replayed) return result; const audit = await appendAudit({ actor: context, action: 'ACADEMIC_MBKM_LOG_ADDED', resourceType: 'academic_mbkm', resourceId: id, after: { entryId: result.entry.id, occurredOn, hours, evidenceFileId, version: result.activity.version }, event }); return { ...result, auditId: audit.id }
}

export async function evaluateMbkmActivity(context: AuthContext, activityId: string, value: unknown, event?: H3Event, clock = new Date()): Promise<{ activity: MbkmActivity; auditId: string }> {
  const id = safeId(activityId, 'activityId'), body = requireRecord(value); rejectUnknown(body, ['score', 'note', 'conversions', 'expectedVersion']); const score = requireInteger(body.score, 'score', 0, 100), note = requireString(body.note, 'note', { min: 10, max: 2_000 }), expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 1)
  if (!Array.isArray(body.conversions) || body.conversions.length > 20) invalidInput('Konversi MBKM tidak valid.')
  const conversions: MbkmConversion[] = body.conversions.map((raw, index) => { const item = requireRecord(raw); return { courseCode: requireString(item.courseCode, `conversions[${index}].courseCode`, { max: 30, pattern: /^[A-Z0-9._-]+$/ }), credits: requireInteger(item.credits, `conversions[${index}].credits`, 1, 12), gradeLetter: requireString(item.gradeLetter, `conversions[${index}].gradeLetter`, { max: 3, pattern: /^[A-DF][+-]?$/ }) } })
  if (new Set(conversions.map(item => item.courseCode)).size !== conversions.length || conversions.reduce((sum, item) => sum + item.credits, 0) > 24) invalidInput('Konversi MBKM harus unik dan maksimal 24 SKS.')
  const now = clock.toISOString(), update = (current: MbkmActivity) => { if (!hasRole(context, 'administrator', 'academic_staff') && !current.supervisorIds.includes(context.uid)) forbidden('Aktivitas MBKM bukan lingkup Anda.'); if (!['APPROVED', 'ACTIVE'].includes(current.status)) conflict('MBKM_NOT_EVALUATABLE', 'Status MBKM belum dapat dievaluasi.'); if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Aktivitas MBKM telah berubah.', { currentVersion: current.version }); return { ...current, evaluation: { score, note, evaluatedAt: now, evaluatedBy: context.uid }, conversions, version: current.version + 1, updatedAt: now } }
  let activity: MbkmActivity
  if (dataMode() === 'mock') { const current = academicAdministrationState().mbkmActivities.get(id); if (!current) notFound('Aktivitas MBKM'); activity = update(clone(current)); academicAdministrationState().mbkmActivities.set(id, clone(activity)) } else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan MBKM tidak tersedia.'); const ref = db.collection('academicMbkmActivities').doc(id); activity = await db.runTransaction(async transaction => { const snapshot = await transaction.get(ref); if (!snapshot.exists) notFound('Aktivitas MBKM'); const next = update({ id: snapshot.id, ...snapshot.data() } as MbkmActivity); transaction.update(ref, next); return next }) }
  const audit = await appendAudit({ actor: context, action: 'ACADEMIC_MBKM_EVALUATED', resourceType: 'academic_mbkm', resourceId: id, before: { version: expectedVersion }, after: { version: activity.version, score, conversions }, event }); return { activity, auditId: audit.id }
}

type StableMasterRecord = AcademicProgramStudy | AcademicPeriodDefinition | AcademicCalendarEvent
async function persistStableMaster<T extends StableMasterRecord>(options: {
  collection: string; map: Map<string, T>; id: string; expectedVersion: number; namespace: string; hash: string; build: (current?: T) => T
}): Promise<{ value: T; replayed: boolean }> {
  if (dataMode() === 'mock') {
    const prior = academicAdministrationState().idempotency.get(options.namespace)
    if (prior) { if (prior.requestHash !== options.hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk master data berbeda.'); return { value: clone(prior.response as T), replayed: true } }
    const value = options.build(options.map.get(options.id)); options.map.set(options.id, clone(value)); academicAdministrationState().idempotency.set(options.namespace, { requestHash: options.hash, response: value, createdAt: new Date().toISOString() }); return { value, replayed: false }
  }
  const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan master akademik tidak tersedia.'); const ref = db.collection(options.collection).doc(options.id), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', options.namespace))
  return db.runTransaction(async transaction => { const [snapshot, prior] = await Promise.all([transaction.get(ref), transaction.get(idemRef)]); if (prior.exists) { const stored = prior.data() as { requestHash: string; response: T }; if (stored.requestHash !== options.hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk master data berbeda.'); return { value: stored.response, replayed: true } }; const value = options.build(snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as T) : undefined), createdAt = new Date().toISOString(); transaction.set(ref, value); transaction.create(idemRef, withFirestorePurgeAfter({ requestHash: options.hash, response: value, createdAt }, createdAt, IDEM_TTL_MS)); return { value, replayed: false } })
}

function requireMasterStaff(context: AuthContext, programStudyId?: string): void {
  if (hasRole(context, 'administrator')) return
  if (!hasRole(context, 'academic_staff')) forbidden('Master akademik hanya dapat dikelola staf akademik.')
  if (programStudyId && !context.scope.programStudyIds.includes(programStudyId)) forbidden('Master data berada di luar lingkup program studi Anda.')
}
function cleanMasterList(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) invalidInput(`${label} tidak valid.`)
  return [...new Set(value.map((item, index) => safeId(item, `${label}[${index}]`)))]
}
function optimistic<T extends { version: number }>(current: T | undefined, expectedVersion: number, label: string): void {
  const currentVersion = current?.version || 0; if (currentVersion !== expectedVersion) conflict('VERSION_CONFLICT', `${label} telah berubah.`, { currentVersion })
}

export async function upsertAcademicProgram(context: AuthContext, value: unknown, key: string, event?: H3Event, _clock = new Date()): Promise<{ value: AcademicProgramStudy; replayed: boolean; auditId?: string }> {
  idempotencyKey(key); const body = requireRecord(value); rejectUnknown(body, ['id', 'facultyId', 'code', 'name', 'level', 'active', 'accreditationStatus', 'accreditationExpiresAt', 'expectedVersion'])
  const id = safeId(body.id, 'id'), facultyId = safeId(body.facultyId, 'facultyId'), code = requireString(body.code, 'code', { max: 20, pattern: /^[A-Z0-9._-]+$/ }), name = requireString(body.name, 'name', { min: 3, max: 180 }), level = requireString(body.level, 'level', { max: 5 }) as AcademicProgramStudy['level']; if (!['D3', 'S1', 'S2'].includes(level)) invalidInput('Jenjang program studi tidak valid.')
  const accreditationStatus = requireString(body.accreditationStatus, 'accreditationStatus', { max: 80 }), accreditationExpiresAt = requireString(body.accreditationExpiresAt, 'accreditationExpiresAt', { max: 10, pattern: /^\d{4}-\d{2}-\d{2}$/ }), expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 0), active = body.active === true
  requireMasterStaff(context, id); const normalized = { id, facultyId, code, name, level, active, accreditationStatus, accreditationExpiresAt, expectedVersion }, namespace = `academic:master:program:${context.uid}:${key}`
  const result = await persistStableMaster({ collection: 'academicProgramStudies', map: academicAdministrationState().programs, id, expectedVersion, namespace, hash: requestHash(normalized), build: current => { optimistic(current, expectedVersion, 'Program studi'); return { id, facultyId, code, name, level, active, accreditationStatus, accreditationExpiresAt, version: expectedVersion + 1 } } })
  if (result.replayed) return result; const audit = await appendAudit({ actor: context, action: 'ACADEMIC_PROGRAM_UPSERTED', resourceType: 'academic_program', resourceId: id, before: { version: expectedVersion }, after: { version: result.value.version, code, active }, event }); return { ...result, auditId: audit.id }
}

export async function upsertAcademicPeriod(context: AuthContext, value: unknown, key: string, event?: H3Event, _clock = new Date()): Promise<{ value: AcademicPeriodDefinition; replayed: boolean; auditId?: string }> {
  idempotencyKey(key); requireMasterStaff(context); const body = requireRecord(value); rejectUnknown(body, ['id', 'academicYear', 'term', 'startsAt', 'endsAt', 'krsOpensAt', 'krsClosesAt', 'active', 'expectedVersion'])
  const id = safeId(body.id, 'id'), academicYear = requireString(body.academicYear, 'academicYear', { max: 20, pattern: /^\d{4}[/-]\d{4}$/ }), term = requireString(body.term, 'term', { max: 10 }) as AcademicPeriodDefinition['term']; if (!['ODD', 'EVEN', 'SHORT'].includes(term)) invalidInput('Term akademik tidak valid.')
  const futureWindow = { maxFutureMs: 10 * 365 * 86_400_000 }, startsAt = normalizeIsoInstant(body.startsAt, 'startsAt', futureWindow), endsAt = normalizeIsoInstant(body.endsAt, 'endsAt', futureWindow), krsOpensAt = normalizeIsoInstant(body.krsOpensAt, 'krsOpensAt', futureWindow), krsClosesAt = normalizeIsoInstant(body.krsClosesAt, 'krsClosesAt', futureWindow); if (startsAt >= endsAt || krsOpensAt >= krsClosesAt || krsClosesAt > endsAt) invalidInput('Urutan waktu periode akademik tidak valid.')
  const expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 0), active = body.active === true, normalized = { id, academicYear, term, startsAt, endsAt, krsOpensAt, krsClosesAt, active, expectedVersion }, namespace = `academic:master:period:${context.uid}:${key}`
  const result = await persistStableMaster({ collection: 'academicPeriodDefinitions', map: academicAdministrationState().periods, id, expectedVersion, namespace, hash: requestHash(normalized), build: current => { optimistic(current, expectedVersion, 'Periode akademik'); return { id, academicYear, term, startsAt, endsAt, krsOpensAt, krsClosesAt, active, version: expectedVersion + 1 } } })
  if (result.replayed) return result; const audit = await appendAudit({ actor: context, action: 'ACADEMIC_PERIOD_UPSERTED', resourceType: 'academic_period', resourceId: id, before: { version: expectedVersion }, after: { version: result.value.version, academicYear, term, active }, event }); return { ...result, auditId: audit.id }
}

export async function createAcademicCourseVersion(context: AuthContext, value: unknown, key: string, event?: H3Event, clock = new Date()): Promise<{ value: AcademicCourseVersion; replayed: boolean; auditId?: string }> {
  idempotencyKey(key); const body = requireRecord(value); rejectUnknown(body, ['courseId', 'code', 'name', 'programStudyId', 'credits', 'semesterRecommendation', 'prerequisiteCourseCodes', 'equivalentCourseCodes', 'status', 'expectedCurrentVersion'])
  const courseId = safeId(body.courseId, 'courseId'), code = requireString(body.code, 'code', { max: 30, pattern: /^[A-Z0-9._-]+$/ }), name = requireString(body.name, 'name', { min: 3, max: 180 }), programStudyId = safeId(body.programStudyId, 'programStudyId'), credits = requireInteger(body.credits, 'credits', 1, 12), semesterRecommendation = requireInteger(body.semesterRecommendation, 'semesterRecommendation', 1, 14), prerequisiteCourseCodes = cleanMasterList(body.prerequisiteCourseCodes, 'prerequisiteCourseCodes', 20), equivalentCourseCodes = cleanMasterList(body.equivalentCourseCodes, 'equivalentCourseCodes', 20), status = requireString(body.status, 'status', { max: 20 }) as AcademicCourseVersion['status']; if (!['DRAFT', 'ACTIVE', 'RETIRED'].includes(status)) invalidInput('Status versi mata kuliah tidak valid.')
  requireMasterStaff(context, programStudyId); const expectedCurrentVersion = requireInteger(body.expectedCurrentVersion, 'expectedCurrentVersion', 0), normalized = { courseId, code, name, programStudyId, credits, semesterRecommendation, prerequisiteCourseCodes, equivalentCourseCodes, status, expectedCurrentVersion }, hash = requestHash(normalized), namespace = `academic:master:course:${context.uid}:${key}`, now = clock.toISOString()
  let result: { value: AcademicCourseVersion; replayed: boolean }
  if (dataMode() === 'mock') { const state = academicAdministrationState(), prior = state.idempotency.get(namespace); if (prior) { if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk versi mata kuliah berbeda.'); return { value: clone(prior.response as AcademicCourseVersion), replayed: true } }; const current = Math.max(0, ...[...state.courses.values()].filter(item => item.courseId === courseId).map(item => item.version)); if (current !== expectedCurrentVersion) conflict('VERSION_CONFLICT', 'Versi mata kuliah telah berubah.', { currentVersion: current }); const version = current + 1, record: AcademicCourseVersion = { id: `${courseId}_v${version}`, courseId, code, name, programStudyId, version, credits, semesterRecommendation, prerequisiteCourseCodes, equivalentCourseCodes, status, createdAt: now, createdBy: context.uid, immutable: true }; state.courses.set(record.id, clone(record)); state.idempotency.set(namespace, { requestHash: hash, response: record, createdAt: now }); result = { value: record, replayed: false } }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan versi mata kuliah tidak tersedia.'); const headRef = db.collection('academicCourseHeads').doc(courseId), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)); result = await db.runTransaction(async transaction => { const [head, prior] = await Promise.all([transaction.get(headRef), transaction.get(idemRef)]); if (prior.exists) { const stored = prior.data() as { requestHash: string; response: AcademicCourseVersion }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk versi mata kuliah berbeda.'); return { value: stored.response, replayed: true } }; const current = head.exists ? Number(head.data()?.currentVersion || 0) : 0; if (current !== expectedCurrentVersion) conflict('VERSION_CONFLICT', 'Versi mata kuliah telah berubah.', { currentVersion: current }); const version = current + 1, record: AcademicCourseVersion = { id: `${courseId}_v${version}`, courseId, code, name, programStudyId, version, credits, semesterRecommendation, prerequisiteCourseCodes, equivalentCourseCodes, status, createdAt: now, createdBy: context.uid, immutable: true }; transaction.create(db.collection('academicCourseVersions').doc(record.id), record); transaction.set(headRef, { courseId, programStudyId, currentVersion: version, currentVersionId: record.id, updatedAt: now, updatedBy: context.uid }); transaction.create(idemRef, withFirestorePurgeAfter({ requestHash: hash, response: record, createdAt: now }, now, IDEM_TTL_MS)); return { value: record, replayed: false } }) }
  if (result.replayed) return result; const audit = await appendAudit({ actor: context, action: 'ACADEMIC_COURSE_VERSION_CREATED', resourceType: 'academic_course', resourceId: courseId, after: { versionId: result.value.id, version: result.value.version, code, programStudyId, status }, event }); return { ...result, auditId: audit.id }
}

export async function upsertLmsCatalogPeriod(
  context: AuthContext,
  value: unknown,
  key: string,
  event?: H3Event,
  clock = new Date(),
): ReturnType<typeof upsertAcademicPeriod> {
  requirePermission(context, 'classes:manage')
  return upsertAcademicPeriod(context, value, key, event, clock)
}

export async function upsertLmsCatalogProgram(
  context: AuthContext,
  value: unknown,
  key: string,
  event?: H3Event,
  clock = new Date(),
): ReturnType<typeof upsertAcademicProgram> {
  requirePermission(context, 'classes:manage')
  return upsertAcademicProgram(context, value, key, event, clock)
}

export async function createLmsCatalogCourseVersion(
  context: AuthContext,
  value: unknown,
  key: string,
  event?: H3Event,
  clock = new Date(),
): ReturnType<typeof createAcademicCourseVersion> {
  requirePermission(context, 'classes:manage')
  return createAcademicCourseVersion(context, value, key, event, clock)
}

export async function createAcademicCurriculumVersion(context: AuthContext, value: unknown, key: string, event?: H3Event, clock = new Date()): Promise<{ value: CurriculumVersion; replayed: boolean; auditId?: string }> {
  idempotencyKey(key); const body = requireRecord(value); rejectUnknown(body, ['curriculumId', 'programStudyId', 'name', 'effectiveCohortFrom', 'effectiveCohortTo', 'courseVersionIds', 'status', 'expectedCurrentVersion'])
  const curriculumId = safeId(body.curriculumId, 'curriculumId'), programStudyId = safeId(body.programStudyId, 'programStudyId'), name = requireString(body.name, 'name', { min: 5, max: 180 }), effectiveCohortFrom = requireInteger(body.effectiveCohortFrom, 'effectiveCohortFrom', 1950, 2200), effectiveCohortTo = requireInteger(body.effectiveCohortTo, 'effectiveCohortTo', effectiveCohortFrom, 2200), courseVersionIds = cleanMasterList(body.courseVersionIds, 'courseVersionIds', 300), status = requireString(body.status, 'status', { max: 20 }) as CurriculumVersion['status']; if (!courseVersionIds.length) invalidInput('Kurikulum wajib memuat versi mata kuliah.'); if (!['DRAFT', 'ACTIVE', 'RETIRED'].includes(status)) invalidInput('Status kurikulum tidak valid.')
  requireMasterStaff(context, programStudyId); const courses = dataMode() === 'mock' ? [...academicAdministrationState().courses.values()] : await all<AcademicCourseVersion>('academicCourseVersions', () => []), selected = courseVersionIds.map(id => courses.find(item => item.id === id)); if (selected.some(item => !item || item.programStudyId !== programStudyId)) invalidInput('Versi mata kuliah kurikulum tidak valid atau lintas program studi.')
  const totalCredits = selected.reduce((sum, item) => sum + (item?.credits || 0), 0), expectedCurrentVersion = requireInteger(body.expectedCurrentVersion, 'expectedCurrentVersion', 0), normalized = { curriculumId, programStudyId, name, effectiveCohortFrom, effectiveCohortTo, courseVersionIds, status, expectedCurrentVersion }, hash = requestHash(normalized), namespace = `academic:master:curriculum:${context.uid}:${key}`, now = clock.toISOString()
  let result: { value: CurriculumVersion; replayed: boolean }
  if (dataMode() === 'mock') { const state = academicAdministrationState(), prior = state.idempotency.get(namespace); if (prior) { if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk versi kurikulum berbeda.'); return { value: clone(prior.response as CurriculumVersion), replayed: true } }; const current = Math.max(0, ...[...state.curricula.values()].filter(item => item.curriculumId === curriculumId).map(item => item.version)); if (current !== expectedCurrentVersion) conflict('VERSION_CONFLICT', 'Versi kurikulum telah berubah.', { currentVersion: current }); const version = current + 1, record: CurriculumVersion = { id: `${curriculumId}_v${version}`, curriculumId, programStudyId, name, version, effectiveCohortFrom, effectiveCohortTo, courseVersionIds, totalCredits, status, createdAt: now, createdBy: context.uid, immutable: true }; state.curricula.set(record.id, clone(record)); state.idempotency.set(namespace, { requestHash: hash, response: record, createdAt: now }); result = { value: record, replayed: false } }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan versi kurikulum tidak tersedia.'); const headRef = db.collection('academicCurriculumHeads').doc(curriculumId), idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)); result = await db.runTransaction(async transaction => { const [head, prior] = await Promise.all([transaction.get(headRef), transaction.get(idemRef)]); if (prior.exists) { const stored = prior.data() as { requestHash: string; response: CurriculumVersion }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk versi kurikulum berbeda.'); return { value: stored.response, replayed: true } }; const current = head.exists ? Number(head.data()?.currentVersion || 0) : 0; if (current !== expectedCurrentVersion) conflict('VERSION_CONFLICT', 'Versi kurikulum telah berubah.', { currentVersion: current }); const version = current + 1, record: CurriculumVersion = { id: `${curriculumId}_v${version}`, curriculumId, programStudyId, name, version, effectiveCohortFrom, effectiveCohortTo, courseVersionIds, totalCredits, status, createdAt: now, createdBy: context.uid, immutable: true }; transaction.create(db.collection('academicCurriculumVersions').doc(record.id), record); transaction.set(headRef, { curriculumId, programStudyId, currentVersion: version, currentVersionId: record.id, updatedAt: now, updatedBy: context.uid }); transaction.create(idemRef, { requestHash: hash, response: record, createdAt: now }); return { value: record, replayed: false } }) }
  if (result.replayed) return result; const audit = await appendAudit({ actor: context, action: 'ACADEMIC_CURRICULUM_VERSION_CREATED', resourceType: 'academic_curriculum', resourceId: curriculumId, after: { versionId: result.value.id, version: result.value.version, programStudyId, totalCredits, status }, event }); return { ...result, auditId: audit.id }
}

export async function upsertAcademicCalendarEvent(context: AuthContext, value: unknown, key: string, event?: H3Event, clock = new Date()): Promise<{ value: AcademicCalendarEvent; replayed: boolean; auditId?: string }> {
  idempotencyKey(key); const body = requireRecord(value); rejectUnknown(body, ['id', 'periodId', 'programStudyIds', 'title', 'category', 'startsAt', 'endsAt', 'description', 'expectedVersion'])
  const id = safeId(body.id, 'id'), periodId = safeId(body.periodId, 'periodId'), programStudyIds = cleanMasterList(body.programStudyIds, 'programStudyIds', 100); requireMasterStaff(context); if (!hasRole(context, 'administrator') && programStudyIds.some(programId => !context.scope.programStudyIds.includes(programId))) forbidden('Kalender memuat program studi di luar lingkup Anda.')
  const title = requireString(body.title, 'title', { min: 3, max: 180 }), category = requireString(body.category, 'category', { max: 20 }) as AcademicCalendarEvent['category']; if (!['ACADEMIC', 'KRS', 'EXAM', 'GRADUATION', 'HOLIDAY', 'DEADLINE'].includes(category)) invalidInput('Kategori kalender tidak valid.')
  const futureWindow = { maxFutureMs: 10 * 365 * 86_400_000 }, startsAt = normalizeIsoInstant(body.startsAt, 'startsAt', futureWindow), endsAt = normalizeIsoInstant(body.endsAt, 'endsAt', futureWindow); if (startsAt >= endsAt) invalidInput('Waktu selesai kalender harus setelah waktu mulai.'); const description = optionalString(body.description, 'description', 2_000), expectedVersion = requireInteger(body.expectedVersion, 'expectedVersion', 0), now = clock.toISOString(), normalized = { id, periodId, programStudyIds, title, category, startsAt, endsAt, description, expectedVersion }, namespace = `academic:master:calendar:${context.uid}:${key}`
  const result = await persistStableMaster({ collection: 'academicCalendarEvents', map: academicAdministrationState().calendar, id, expectedVersion, namespace, hash: requestHash(normalized), build: current => { optimistic(current, expectedVersion, 'Agenda akademik'); return { id, periodId, programStudyIds, title, category, startsAt, endsAt, ...(description ? { description } : {}), version: expectedVersion + 1, createdAt: current?.createdAt || now, createdBy: current?.createdBy || context.uid } } })
  if (result.replayed) return result; const audit = await appendAudit({ actor: context, action: 'ACADEMIC_CALENDAR_UPSERTED', resourceType: 'academic_calendar', resourceId: id, before: { version: expectedVersion }, after: { version: result.value.version, periodId, category, programStudyIds }, event }); return { ...result, auditId: audit.id }
}
