import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  AcademicClassDetail,
  AcademicClassRecord,
  AttendanceChallenge,
  AttendanceRecord,
  AttendanceStatus,
  ClassMeetingSchedule,
  ClassRosterEntry,
  DeliveryMode,
  GradeComponent,
  GradeConfiguration,
  GradePublicationSnapshot,
  KhsPublishedResult,
  PublishedGradeRow,
  StudentGrade,
  TeachingJournal,
} from '../types/academic-classes'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { normalizeIsoInstant, optionalString, requireInteger, requireRecord, requireString } from '../utils/validation'

export interface AcademicClassListQuery {
  periodId?: string
  programStudyId?: string
}

export interface AcademicWriteResult<T> {
  value: T
  replayed: boolean
  auditId?: string
}

interface JournalInput {
  meetingNumber: number
  occurredAt: string
  durationMinutes: number
  topic: string
  deliveryMode: DeliveryMode
  makeupReason?: string
  notes?: string
}

interface ChallengeInput {
  meetingNumber: number
  ttlSeconds: number
}

interface AttendanceCorrectionInput {
  meetingNumber: number
  studentId: string
  status: AttendanceStatus
  reason: string
  expectedVersion: number
}

interface GradeConfigurationInput {
  expectedVersion: number
  components: GradeComponent[]
}

interface GradeEntryInput {
  expectedVersion: number
  expectedConfigVersion: number
  componentScores: Record<string, number>
}

interface GradePublicationInput {
  expectedGradebookVersion: number
}

interface IdempotencyRecord<T = unknown> {
  requestHash: string
  response: AcademicWriteResult<T>
  createdAt: string
}

interface AcademicMockState {
  classes: Map<string, AcademicClassRecord>
  rosters: Map<string, Map<string, ClassRosterEntry>>
  journals: Map<string, Map<number, TeachingJournal>>
  attendance: Map<string, AttendanceRecord>
  challenges: Map<string, AttendanceChallenge>
  gradeConfigurations: Map<string, GradeConfiguration>
  grades: Map<string, Map<string, StudentGrade>>
  publications: Map<string, Map<string, GradePublicationSnapshot>>
  idempotency: Map<string, IdempotencyRecord>
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
const CLASS_LIMIT = 1_000
const ATTENDANCE_STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'EXCUSED', 'ABSENT']
const DELIVERY_MODES: DeliveryMode[] = ['ONSITE', 'ONLINE', 'HYBRID']

function clone<T>(value: T): T {
  return structuredClone(value)
}

function weeklySchedule(startIso: string, count = 16): ClassMeetingSchedule[] {
  const start = Date.parse(startIso)
  return Array.from({ length: count }, (_, index) => {
    const scheduledStart = start + index * 7 * 24 * 60 * 60 * 1000
    const scheduledEnd = scheduledStart + 100 * 60 * 1000
    return {
      meetingNumber: index + 1,
      scheduledStartAt: new Date(scheduledStart).toISOString(),
      scheduledEndAt: new Date(scheduledEnd).toISOString(),
      attendanceOpensAt: new Date(scheduledStart - 15 * 60 * 1000).toISOString(),
      attendanceClosesAt: new Date(scheduledEnd + 15 * 60 * 1000).toISOString(),
    }
  })
}

const DEFAULT_COMPONENTS: GradeComponent[] = [
  { id: 'assignments', label: 'Tugas terstruktur', weight: 30, maxScore: 100, order: 1 },
  { id: 'midterm', label: 'Ujian tengah semester', weight: 30, maxScore: 100, order: 2 },
  { id: 'final', label: 'Ujian akhir semester', weight: 40, maxScore: 100, order: 3 },
]

const SEEDED_CLASSES: AcademicClassRecord[] = [
  {
    id: 'class-mgt-401-a',
    courseCode: 'MGT401',
    courseName: 'Manajemen Strategik',
    credits: 3,
    section: 'A',
    periodId: '2025-2026-2',
    programStudyId: 'management-s1',
    unitId: 'faculty-economics',
    lecturerIds: ['advisor-001'],
    lecturerNames: ['Dr. Budi Santoso'],
    timezone: 'Asia/Jakarta',
    status: 'ACTIVE',
    totalScheduledMeetings: 16,
    realizedMeetingCount: 0,
    schedule: weeklySchedule('2026-07-21T01:00:00.000Z'),
    rosterStudentIds: ['student-001', 'student-002'],
    gradeConfigVersion: 1,
    gradebookVersion: 2,
    publicationVersion: 0,
    updatedAt: '2026-07-20T08:00:00.000Z',
  },
  {
    id: 'class-inf-601-a',
    courseCode: 'IF601',
    courseName: 'Keamanan Aplikasi',
    credits: 3,
    section: 'A',
    periodId: '2025-2026-2',
    programStudyId: 'informatics-s1',
    unitId: 'faculty-engineering',
    lecturerIds: ['lecturer-002'],
    lecturerNames: ['Dr. Surya Hidayat'],
    timezone: 'Asia/Jakarta',
    status: 'ACTIVE',
    totalScheduledMeetings: 16,
    realizedMeetingCount: 0,
    schedule: weeklySchedule('2026-07-21T03:00:00.000Z'),
    rosterStudentIds: ['student-003'],
    gradeConfigVersion: 1,
    gradebookVersion: 1,
    publicationVersion: 0,
    updatedAt: '2026-07-19T08:00:00.000Z',
  },
]

const SEEDED_ROSTERS: Record<string, ClassRosterEntry[]> = {
  'class-mgt-401-a': [
    { studentId: 'student-001', studentNumber: '23011001', studentName: 'Nabila Putri', programStudyId: 'management-s1', status: 'ACTIVE' },
    { studentId: 'student-002', studentNumber: '23011002', studentName: 'Rafi Ramadhan', programStudyId: 'management-s1', status: 'ACTIVE' },
  ],
  'class-inf-601-a': [
    { studentId: 'student-003', studentNumber: '23021001', studentName: 'Sinta Maharani', programStudyId: 'informatics-s1', status: 'ACTIVE' },
  ],
}

const SEEDED_GRADES: Record<string, StudentGrade[]> = {
  'class-mgt-401-a': [
    {
      id: 'grade-class-mgt-401-a-student-001',
      classId: 'class-mgt-401-a',
      studentId: 'student-001',
      componentScores: { assignments: 85, midterm: 82, final: 90 },
      finalScore: 86.1,
      letterGrade: 'A',
      configVersion: 1,
      version: 1,
      updatedAt: '2026-07-20T06:00:00.000Z',
      updatedBy: 'advisor-001',
    },
    {
      id: 'grade-class-mgt-401-a-student-002',
      classId: 'class-mgt-401-a',
      studentId: 'student-002',
      componentScores: { assignments: 80, midterm: 78, final: 84 },
      finalScore: 81,
      letterGrade: 'A-',
      configVersion: 1,
      version: 1,
      updatedAt: '2026-07-20T06:05:00.000Z',
      updatedBy: 'advisor-001',
    },
  ],
  'class-inf-601-a': [
    {
      id: 'grade-class-inf-601-a-student-003',
      classId: 'class-inf-601-a',
      studentId: 'student-003',
      componentScores: { assignments: 88, midterm: 86, final: 90 },
      finalScore: 88.2,
      letterGrade: 'A',
      configVersion: 1,
      version: 1,
      updatedAt: '2026-07-20T07:00:00.000Z',
      updatedBy: 'lecturer-002',
    },
  ],
}

function initialMockState(): AcademicMockState {
  return {
    classes: new Map(SEEDED_CLASSES.map((record) => [record.id, clone(record)])),
    rosters: new Map(Object.entries(SEEDED_ROSTERS).map(([classId, rows]) => [classId, new Map(rows.map((row) => [row.studentId, clone(row)]))])),
    journals: new Map(SEEDED_CLASSES.map((record) => [record.id, new Map()])),
    attendance: new Map(),
    challenges: new Map(),
    gradeConfigurations: new Map(SEEDED_CLASSES.map((record) => [record.id, {
      classId: record.id,
      version: 1,
      components: clone(DEFAULT_COMPONENTS),
      updatedAt: '2026-07-20T05:00:00.000Z',
      updatedBy: record.lecturerIds[0] || 'system',
    }])),
    grades: new Map(Object.entries(SEEDED_GRADES).map(([classId, rows]) => [classId, new Map(rows.map((row) => [row.studentId, clone(row)]))])),
    publications: new Map(SEEDED_CLASSES.map((record) => [record.id, new Map()])),
    idempotency: new Map(),
  }
}

let state = initialMockState()

function rejectUnknown(body: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key))
  if (unknown.length) invalidInput(`Field tidak didukung: ${unknown.join(', ')}.`)
}

function safeClassId(value: unknown): string {
  return requireString(value, 'classId', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
}

function safeStudentId(value: unknown): string {
  return requireString(value, 'studentId', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
}

function studentCandidates(context: AuthContext): string[] {
  return [...new Set([context.uid, ...context.scope.studentIds])]
}

function isAssignedLecturer(context: AuthContext, record: AcademicClassRecord): boolean {
  return hasRole(context, 'lecturer', 'advisor') && record.lecturerIds.includes(context.uid)
}

function isScopedAcademicStaff(context: AuthContext, record: AcademicClassRecord): boolean {
  return hasRole(context, 'academic_staff') && context.scope.programStudyIds.includes(record.programStudyId)
}

function canManageClass(context: AuthContext, record: AcademicClassRecord): boolean {
  return hasRole(context, 'administrator') || isAssignedLecturer(context, record) || isScopedAcademicStaff(context, record)
}

function canReadClass(context: AuthContext, record: AcademicClassRecord): boolean {
  if (canManageClass(context, record) || hasRole(context, 'leader')) return true
  return hasRole(context, 'student') && studentCandidates(context).some((id) => record.rosterStudentIds.includes(id))
}

function requireClassRead(context: AuthContext, record: AcademicClassRecord): void {
  if (!canReadClass(context, record)) forbidden('Kelas berada di luar lingkup akses Anda.')
}

function requireClassManagement(context: AuthContext, record: AcademicClassRecord): void {
  if (!canManageClass(context, record)) forbidden('Anda tidak berwenang mengelola kelas ini.')
}

function ownRosterStudentId(context: AuthContext, roster: ClassRosterEntry[]): string {
  if (!hasRole(context, 'student')) forbidden('Hasil terbit hanya dapat dibaca mahasiswa pemiliknya.')
  const matches = roster.filter((entry) => entry.status === 'ACTIVE' && studentCandidates(context).includes(entry.studentId))
  if (matches.length !== 1) forbidden('Identitas mahasiswa tidak cocok dengan roster kelas.')
  return matches[0]!.studentId
}

async function loadClass(classId: string): Promise<AcademicClassRecord> {
  if (dataMode() === 'mock') {
    const record = state.classes.get(classId)
    if (!record) notFound('Kelas')
    return clone(record)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelas tidak tersedia.')
  const snapshot = await db.collection('academicClasses').doc(classId).get()
  if (!snapshot.exists) notFound('Kelas')
  return { id: snapshot.id, ...snapshot.data() } as AcademicClassRecord
}

async function loadRoster(classId: string): Promise<ClassRosterEntry[]> {
  if (dataMode() === 'mock') return [...(state.rosters.get(classId)?.values() ?? [])].map(clone)
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan roster tidak tersedia.')
  const snapshot = await db.collection('academicClasses').doc(classId).collection('roster').get()
  return snapshot.docs.map((document) => ({ studentId: document.id, ...document.data() }) as ClassRosterEntry)
}

async function loadGradeConfiguration(classId: string): Promise<GradeConfiguration> {
  if (dataMode() === 'mock') {
    const configuration = state.gradeConfigurations.get(classId)
    if (!configuration) notFound('Konfigurasi nilai')
    return clone(configuration)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan nilai tidak tersedia.')
  const snapshot = await db.collection('academicClasses').doc(classId).collection('gradeConfiguration').doc('current').get()
  if (!snapshot.exists) notFound('Konfigurasi nilai')
  return snapshot.data() as GradeConfiguration
}

async function loadGrades(classId: string): Promise<StudentGrade[]> {
  if (dataMode() === 'mock') return [...(state.grades.get(classId)?.values() ?? [])].map(clone)
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan nilai tidak tersedia.')
  const snapshot = await db.collection('academicClasses').doc(classId).collection('grades').get()
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as StudentGrade)
}

function mockReplay<T>(namespace: string, hash: string): AcademicWriteResult<T> | undefined {
  const previous = state.idempotency.get(namespace)
  if (!previous) return undefined
  if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
  return { ...(clone(previous.response) as AcademicWriteResult<T>), replayed: true, auditId: undefined }
}

function saveMockReplay<T>(namespace: string, hash: string, response: AcademicWriteResult<T>, now: string): void {
  state.idempotency.set(namespace, { requestHash: hash, response: clone(response), createdAt: now })
}

async function firebaseReplay<T>(namespace: string, hash: string): Promise<AcademicWriteResult<T> | undefined> {
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kelas tidak tersedia.')
  const snapshot = await db.collection('idempotencyKeys').doc(opaqueId('idem', namespace)).get()
  if (!snapshot.exists) return undefined
  const data = snapshot.data() as IdempotencyRecord<T>
  if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
  return { ...data.response, replayed: true, auditId: undefined }
}

function idempotencyDocument<T>(hash: string, response: AcademicWriteResult<T>, now: string): Record<string, unknown> {
  return {
    requestHash: hash,
    response,
    createdAt: now,
    expiresAt: new Date(Date.parse(now) + IDEMPOTENCY_TTL_MS).toISOString(),
  }
}

function meetingFor(record: AcademicClassRecord, meetingNumber: number): ClassMeetingSchedule {
  const meeting = record.schedule.find((item) => item.meetingNumber === meetingNumber)
  if (!meeting) invalidInput('Nomor pertemuan tidak terdapat pada jadwal kelas.')
  return meeting
}

function attendanceKey(classId: string, meetingNumber: number, studentId: string): string {
  return `${classId}:${meetingNumber}:${studentId}`
}

function parseJournalInput(value: unknown, now: Date): JournalInput {
  const body = requireRecord(value)
  rejectUnknown(body, ['meetingNumber', 'occurredAt', 'durationMinutes', 'topic', 'deliveryMode', 'makeupReason', 'notes'])
  const deliveryMode = requireString(body.deliveryMode, 'deliveryMode', { max: 20 }) as DeliveryMode
  if (!DELIVERY_MODES.includes(deliveryMode)) invalidInput('deliveryMode harus ONSITE, ONLINE, atau HYBRID.')
  return {
    meetingNumber: requireInteger(body.meetingNumber, 'meetingNumber', 1, 30),
    occurredAt: normalizeIsoInstant(body.occurredAt, 'occurredAt', { now: now.getTime(), maxFutureMs: 15 * 60 * 1000 }),
    durationMinutes: requireInteger(body.durationMinutes, 'durationMinutes', 30, 300),
    topic: requireString(body.topic, 'topic', { min: 3, max: 300 }),
    deliveryMode,
    makeupReason: optionalString(body.makeupReason, 'makeupReason', 500),
    notes: optionalString(body.notes, 'notes', 1_000),
  }
}

function journalFromInput(record: AcademicClassRecord, context: AuthContext, input: JournalInput, now: string): TeachingJournal {
  const meeting = meetingFor(record, input.meetingNumber)
  const variance = Math.round((Date.parse(input.occurredAt) - Date.parse(meeting.scheduledStartAt)) / 60_000)
  const onSchedule = variance >= -120 && variance <= 360
  if (!onSchedule && (!input.makeupReason || input.makeupReason.length < 10)) {
    invalidInput('Pertemuan di luar rentang jadwal wajib memiliki alasan pengganti minimal 10 karakter.')
  }
  return {
    id: `journal-${record.id}-${input.meetingNumber}`,
    classId: record.id,
    meetingNumber: input.meetingNumber,
    scheduledStartAt: meeting.scheduledStartAt,
    occurredAt: input.occurredAt,
    durationMinutes: input.durationMinutes,
    topic: input.topic,
    deliveryMode: input.deliveryMode,
    realization: onSchedule ? 'ON_SCHEDULE' : 'MAKEUP',
    scheduleVarianceMinutes: variance,
    ...(input.makeupReason ? { makeupReason: input.makeupReason } : {}),
    ...(input.notes ? { notes: input.notes } : {}),
    createdAt: now,
    createdBy: context.uid,
  }
}

function parseChallengeInput(value: unknown): ChallengeInput {
  const body = requireRecord(value)
  rejectUnknown(body, ['meetingNumber', 'ttlSeconds'])
  return {
    meetingNumber: requireInteger(body.meetingNumber, 'meetingNumber', 1, 30),
    ttlSeconds: body.ttlSeconds === undefined ? 120 : requireInteger(body.ttlSeconds, 'ttlSeconds', 30, 300),
  }
}

function ensureAttendanceWindow(record: AcademicClassRecord, meetingNumber: number, now: Date): ClassMeetingSchedule {
  const meeting = meetingFor(record, meetingNumber)
  const instant = now.getTime()
  if (instant < Date.parse(meeting.attendanceOpensAt) || instant > Date.parse(meeting.attendanceClosesAt)) {
    conflict('ATTENDANCE_WINDOW_CLOSED', 'Presensi QR hanya tersedia pada jendela waktu pertemuan.')
  }
  return meeting
}

function parseCorrectionInput(value: unknown): AttendanceCorrectionInput {
  const body = requireRecord(value)
  rejectUnknown(body, ['meetingNumber', 'studentId', 'status', 'reason', 'expectedVersion'])
  const status = requireString(body.status, 'status', { max: 20 }) as AttendanceStatus
  if (!ATTENDANCE_STATUSES.includes(status)) invalidInput('Status presensi tidak valid.')
  return {
    meetingNumber: requireInteger(body.meetingNumber, 'meetingNumber', 1, 30),
    studentId: safeStudentId(body.studentId),
    status,
    reason: requireString(body.reason, 'reason', { min: 10, max: 500 }),
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 0),
  }
}

function parseGradeComponents(value: unknown): GradeConfigurationInput {
  const body = requireRecord(value)
  rejectUnknown(body, ['expectedVersion', 'components'])
  if (!Array.isArray(body.components) || body.components.length < 1 || body.components.length > 10) {
    invalidInput('components harus berisi 1-10 komponen nilai.')
  }
  const components = body.components.map((item, index) => {
    const component = requireRecord(item, `components[${index}]`)
    rejectUnknown(component, ['id', 'label', 'weight', 'maxScore', 'order'])
    const weight = component.weight
    const maxScore = component.maxScore
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0 || weight > 100) invalidInput(`components[${index}].weight tidak valid.`)
    if (typeof maxScore !== 'number' || !Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 1_000) invalidInput(`components[${index}].maxScore tidak valid.`)
    return {
      id: requireString(component.id, `components[${index}].id`, { max: 40, pattern: /^[a-z][a-z0-9_-]*$/ }),
      label: requireString(component.label, `components[${index}].label`, { min: 2, max: 100 }),
      weight,
      maxScore,
      order: component.order === undefined ? index + 1 : requireInteger(component.order, `components[${index}].order`, 1, 100),
    }
  })
  if (new Set(components.map((component) => component.id)).size !== components.length) invalidInput('ID komponen nilai harus unik.')
  const weightTotal = components.reduce((total, component) => total + component.weight, 0)
  if (Math.abs(weightTotal - 100) > 0.0001) invalidInput('Total bobot komponen nilai harus tepat 100%.', { weightTotal })
  return {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 0),
    components: components.sort((left, right) => left.order - right.order),
  }
}

function parseGradeEntry(value: unknown): GradeEntryInput {
  const body = requireRecord(value)
  rejectUnknown(body, ['expectedVersion', 'expectedConfigVersion', 'componentScores'])
  const scoreBody = requireRecord(body.componentScores, 'componentScores')
  const scores: Record<string, number> = {}
  for (const [key, value] of Object.entries(scoreBody)) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(key) || typeof value !== 'number' || !Number.isFinite(value)) {
      invalidInput(`Nilai komponen ${key} tidak valid.`)
    }
    scores[key] = value
  }
  return {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 0),
    expectedConfigVersion: requireInteger(body.expectedConfigVersion, 'expectedConfigVersion', 1),
    componentScores: scores,
  }
}

function validateAndCalculateGrade(configuration: GradeConfiguration, input: GradeEntryInput): { finalScore: number; letterGrade: string } {
  if (configuration.version !== input.expectedConfigVersion) {
    conflict('GRADE_CONFIG_VERSION_CONFLICT', 'Konfigurasi nilai telah berubah.', { currentVersion: configuration.version })
  }
  const expectedIds = configuration.components.map((component) => component.id).sort()
  const actualIds = Object.keys(input.componentScores).sort()
  if (expectedIds.length !== actualIds.length || expectedIds.some((id, index) => id !== actualIds[index])) {
    invalidInput('componentScores harus memuat tepat seluruh komponen nilai aktif.')
  }
  let total = 0
  for (const component of configuration.components) {
    const score = input.componentScores[component.id]!
    if (score < 0 || score > component.maxScore) invalidInput(`Nilai ${component.label} harus berada pada rentang 0-${component.maxScore}.`)
    total += score / component.maxScore * component.weight
  }
  const finalScore = Math.round(total * 100) / 100
  return { finalScore, letterGrade: letterFor(finalScore) }
}

function letterFor(score: number): string {
  if (score >= 85) return 'A'
  if (score >= 80) return 'A-'
  if (score >= 75) return 'B+'
  if (score >= 70) return 'B'
  if (score >= 65) return 'B-'
  if (score >= 60) return 'C+'
  if (score >= 55) return 'C'
  if (score >= 40) return 'D'
  return 'E'
}

function qualityFor(letter: string): number {
  return ({ A: 4, 'A-': 3.75, 'B+': 3.5, B: 3, 'B-': 2.75, 'C+': 2.5, C: 2, D: 1, E: 0 } as Record<string, number>)[letter] ?? 0
}

function parsePublicationInput(value: unknown): GradePublicationInput {
  const body = requireRecord(value)
  rejectUnknown(body, ['expectedGradebookVersion'])
  return { expectedGradebookVersion: requireInteger(body.expectedGradebookVersion, 'expectedGradebookVersion', 0) }
}

function publicationRows(
  record: AcademicClassRecord,
  roster: ClassRosterEntry[],
  configuration: GradeConfiguration,
  grades: StudentGrade[],
): PublishedGradeRow[] {
  const activeRoster = roster.filter((entry) => entry.status === 'ACTIVE')
  const byStudent = new Map(grades.map((grade) => [grade.studentId, grade]))
  return activeRoster.map((entry) => {
    const grade = byStudent.get(entry.studentId)
    if (!grade) conflict('GRADEBOOK_INCOMPLETE', `Nilai ${entry.studentNumber} belum lengkap.`)
    if (grade.configVersion !== configuration.version) {
      conflict('GRADEBOOK_CONFIG_MISMATCH', `Nilai ${entry.studentNumber} masih menggunakan konfigurasi lama.`)
    }
    return {
      studentId: entry.studentId,
      studentNumber: entry.studentNumber,
      studentName: entry.studentName,
      componentScores: clone(grade.componentScores),
      finalScore: grade.finalScore,
      letterGrade: grade.letterGrade,
      credits: record.credits,
      qualityPoints: Math.round(qualityFor(grade.letterGrade) * record.credits * 100) / 100,
      sourceGradeVersion: grade.version,
    }
  })
}

export async function listAcademicClasses(context: AuthContext, query: AcademicClassListQuery = {}): Promise<AcademicClassRecord[]> {
  let records: AcademicClassRecord[]
  if (dataMode() === 'mock') records = [...state.classes.values()].map(clone)
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kelas tidak tersedia.')
    const snapshot = await db.collection('academicClasses').orderBy('updatedAt', 'desc').limit(CLASS_LIMIT).get()
    records = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as AcademicClassRecord)
  }
  return records
    .filter((record) => canReadClass(context, record))
    .filter((record) => !query.periodId || record.periodId === query.periodId)
    .filter((record) => !query.programStudyId || record.programStudyId === query.programStudyId)
    .sort((left, right) => left.courseCode.localeCompare(right.courseCode, 'id'))
    .map(clone)
}

export async function getAcademicClassDetail(context: AuthContext, classId: string): Promise<AcademicClassDetail> {
  const safeId = safeClassId(classId)
  const record = await loadClass(safeId)
  requireClassRead(context, record)
  let roster: ClassRosterEntry[]
  let journals: TeachingJournal[]
  let attendance: AttendanceRecord[]
  let configuration: GradeConfiguration | undefined
  let grades: StudentGrade[] | undefined

  if (dataMode() === 'mock') {
    roster = [...(state.rosters.get(safeId)?.values() ?? [])].map(clone)
    journals = [...(state.journals.get(safeId)?.values() ?? [])].sort((left, right) => left.meetingNumber - right.meetingNumber).map(clone)
    attendance = [...state.attendance.values()].filter((item) => item.classId === safeId).map(clone)
    if (canManageClass(context, record)) {
      configuration = clone(state.gradeConfigurations.get(safeId)!)
      grades = [...(state.grades.get(safeId)?.values() ?? [])].map(clone)
    }
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kelas tidak tersedia.')
    const reference = db.collection('academicClasses').doc(safeId)
    const [rosterSnapshot, journalSnapshot, attendanceSnapshot] = await Promise.all([
      reference.collection('roster').get(),
      reference.collection('journals').orderBy('meetingNumber').get(),
      reference.collection('attendance').get(),
    ])
    roster = rosterSnapshot.docs.map((document) => ({ studentId: document.id, ...document.data() }) as ClassRosterEntry)
    journals = journalSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as TeachingJournal)
    attendance = attendanceSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as AttendanceRecord)
    if (canManageClass(context, record)) {
      const [configurationSnapshot, gradeSnapshot] = await Promise.all([
        reference.collection('gradeConfiguration').doc('current').get(),
        reference.collection('grades').get(),
      ])
      if (configurationSnapshot.exists) configuration = configurationSnapshot.data() as GradeConfiguration
      grades = gradeSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as StudentGrade)
    }
  }

  if (hasRole(context, 'student') && !canManageClass(context, record)) {
    const ownId = ownRosterStudentId(context, roster)
    roster = roster.filter((entry) => entry.studentId === ownId)
    attendance = attendance.filter((item) => item.studentId === ownId)
  }
  return {
    classRecord: clone(record),
    roster: roster.map(clone),
    journals: journals.map(clone),
    attendance: attendance.map(clone),
    ...(configuration ? { gradeConfiguration: clone(configuration) } : {}),
    ...(grades ? { grades: grades.map(clone) } : {}),
  }
}

export async function createTeachingJournal(
  context: AuthContext,
  classId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AcademicWriteResult<TeachingJournal>> {
  const safeId = safeClassId(classId)
  const input = parseJournalInput(value, clock)
  const hash = requestHash({ classId: safeId, ...input })
  const namespace = `academic:journal:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()

  let result: AcademicWriteResult<TeachingJournal>
  if (dataMode() === 'mock') {
    const replay = mockReplay<TeachingJournal>(namespace, hash)
    if (replay) return replay
    const record = await loadClass(safeId)
    requireClassManagement(context, record)
    if (record.status !== 'ACTIVE') conflict('CLASS_CLOSED', 'Jurnal tidak dapat ditambahkan pada kelas yang ditutup.')
    const journal = journalFromInput(record, context, input, now)
    const journals = state.journals.get(safeId) ?? new Map()
    if (journals.has(input.meetingNumber)) conflict('JOURNAL_ALREADY_EXISTS', 'Jurnal pertemuan sudah tersedia.')
    journals.set(input.meetingNumber, clone(journal))
    state.journals.set(safeId, journals)
    state.classes.set(safeId, { ...record, realizedMeetingCount: record.realizedMeetingCount + 1, updatedAt: now })
    result = { value: journal, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<TeachingJournal>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan jurnal tidak tersedia.')
    const classRef = db.collection('academicClasses').doc(safeId)
    const journalRef = classRef.collection('journals').doc(`meeting-${input.meetingNumber}`)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, classSnapshot, existing] = await Promise.all([
        transaction.get(idemRef), transaction.get(classRef), transaction.get(journalRef),
      ])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<TeachingJournal>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!classSnapshot.exists) notFound('Kelas')
      const record = { id: classSnapshot.id, ...classSnapshot.data() } as AcademicClassRecord
      requireClassManagement(context, record)
      if (record.status !== 'ACTIVE') conflict('CLASS_CLOSED', 'Jurnal tidak dapat ditambahkan pada kelas yang ditutup.')
      if (existing.exists) conflict('JOURNAL_ALREADY_EXISTS', 'Jurnal pertemuan sudah tersedia.')
      const journal = journalFromInput(record, context, input, now)
      const response: AcademicWriteResult<TeachingJournal> = { value: journal, replayed: false }
      transaction.create(journalRef, journal)
      transaction.update(classRef, { realizedMeetingCount: record.realizedMeetingCount + 1, updatedAt: now })
      transaction.create(idemRef, idempotencyDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }

  const audit = await appendAudit({
    actor: context,
    action: 'TEACHING_JOURNAL_CREATED',
    resourceType: 'academic_class_journal',
    resourceId: result.value.id,
    after: {
      classId: safeId,
      meetingNumber: result.value.meetingNumber,
      realization: result.value.realization,
      scheduleVarianceMinutes: result.value.scheduleVarianceMinutes,
      durationMinutes: result.value.durationMinutes,
    },
    event,
  })
  result.auditId = audit.id
  return result
}

export interface IssuedAttendanceChallenge {
  challengeId: string
  classId: string
  meetingNumber: number
  challengeToken: string
  expiresAt: string
}

export async function issueAttendanceChallenge(
  context: AuthContext,
  classId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AcademicWriteResult<IssuedAttendanceChallenge>> {
  const safeId = safeClassId(classId)
  const input = parseChallengeInput(value)
  const hash = requestHash({ classId: safeId, ...input })
  const namespace = `academic:attendance-challenge:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  const challengeId = opaqueId('qr', `${safeId}:${input.meetingNumber}:${idempotencyKey}`)
  const nonce = randomBytes(24).toString('base64url')
  let result: AcademicWriteResult<IssuedAttendanceChallenge>

  if (dataMode() === 'mock') {
    const replay = mockReplay<IssuedAttendanceChallenge>(namespace, hash)
    if (replay) return replay
    const record = await loadClass(safeId)
    requireClassManagement(context, record)
    const meeting = ensureAttendanceWindow(record, input.meetingNumber, clock)
    const expiresAt = new Date(Math.min(clock.getTime() + input.ttlSeconds * 1_000, Date.parse(meeting.attendanceClosesAt))).toISOString()
    const stored: AttendanceChallenge = {
      id: challengeId,
      classId: safeId,
      meetingNumber: input.meetingNumber,
      nonceHash: requestHash(nonce),
      issuedAt: now,
      expiresAt,
      issuedBy: context.uid,
      usedStudentIds: [],
    }
    state.challenges.set(challengeId, stored)
    result = { value: { challengeId, classId: safeId, meetingNumber: input.meetingNumber, challengeToken: `qr1.${challengeId}.${nonce}`, expiresAt }, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<IssuedAttendanceChallenge>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan presensi tidak tersedia.')
    const classRef = db.collection('academicClasses').doc(safeId)
    const challengeRef = classRef.collection('attendanceChallenges').doc(challengeId)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, classSnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(classRef)])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<IssuedAttendanceChallenge>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!classSnapshot.exists) notFound('Kelas')
      const record = { id: classSnapshot.id, ...classSnapshot.data() } as AcademicClassRecord
      requireClassManagement(context, record)
      const meeting = ensureAttendanceWindow(record, input.meetingNumber, clock)
      const expiresAt = new Date(Math.min(clock.getTime() + input.ttlSeconds * 1_000, Date.parse(meeting.attendanceClosesAt))).toISOString()
      const stored: AttendanceChallenge = { id: challengeId, classId: safeId, meetingNumber: input.meetingNumber, nonceHash: requestHash(nonce), issuedAt: now, expiresAt, issuedBy: context.uid, usedStudentIds: [] }
      const response: AcademicWriteResult<IssuedAttendanceChallenge> = {
        value: { challengeId, classId: safeId, meetingNumber: input.meetingNumber, challengeToken: `qr1.${challengeId}.${nonce}`, expiresAt },
        replayed: false,
      }
      transaction.create(challengeRef, { ...stored, purgeAfter: new Date(expiresAt) })
      transaction.create(idemRef, idempotencyDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }

  const audit = await appendAudit({
    actor: context,
    action: 'ATTENDANCE_CHALLENGE_ISSUED',
    resourceType: 'attendance_challenge',
    resourceId: challengeId,
    after: { classId: safeId, meetingNumber: input.meetingNumber, expiresAt: result.value.expiresAt },
    event,
  })
  result.auditId = audit.id
  return result
}

function parseChallengeToken(value: unknown): { challengeId: string; nonce: string } {
  const token = requireString(value, 'challengeToken', { max: 300, pattern: /^qr1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/ })
  const [, challengeId, nonce] = token.split('.')
  return { challengeId: challengeId!, nonce: nonce! }
}

function nonceMatches(storedHash: string, nonce: string): boolean {
  const expected = Buffer.from(storedHash)
  const actual = Buffer.from(requestHash(nonce))
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function checkedInRecord(
  record: AcademicClassRecord,
  challenge: AttendanceChallenge,
  studentId: string,
  actor: AuthContext,
  now: string,
): AttendanceRecord {
  const meeting = meetingFor(record, challenge.meetingNumber)
  const lateBoundary = Date.parse(meeting.scheduledStartAt) + 15 * 60 * 1_000
  return {
    id: opaqueId('attendance', attendanceKey(record.id, challenge.meetingNumber, studentId)),
    classId: record.id,
    meetingNumber: challenge.meetingNumber,
    studentId,
    status: Date.parse(now) > lateBoundary ? 'LATE' : 'PRESENT',
    source: 'QR',
    checkedInAt: now,
    version: 1,
    updatedAt: now,
    updatedBy: actor.uid,
  }
}

export async function checkInAttendance(
  context: AuthContext,
  classId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AcademicWriteResult<AttendanceRecord>> {
  const safeId = safeClassId(classId)
  const body = requireRecord(value)
  rejectUnknown(body, ['challengeToken'])
  const token = parseChallengeToken(body.challengeToken)
  const hash = requestHash({ classId: safeId, challengeToken: body.challengeToken })
  const namespace = `academic:attendance-checkin:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let result: AcademicWriteResult<AttendanceRecord>

  if (dataMode() === 'mock') {
    const replay = mockReplay<AttendanceRecord>(namespace, hash)
    if (replay) return replay
    const record = await loadClass(safeId)
    requireClassRead(context, record)
    const roster = await loadRoster(safeId)
    const studentId = ownRosterStudentId(context, roster)
    const challenge = state.challenges.get(token.challengeId)
    if (!challenge || challenge.classId !== safeId) conflict('INVALID_ATTENDANCE_CHALLENGE', 'Tantangan presensi tidak valid untuk kelas ini.')
    ensureAttendanceWindow(record, challenge.meetingNumber, clock)
    if (clock.getTime() > Date.parse(challenge.expiresAt)) conflict('ATTENDANCE_CHALLENGE_EXPIRED', 'Tantangan presensi telah kedaluwarsa.')
    if (!nonceMatches(challenge.nonceHash, token.nonce)) conflict('INVALID_ATTENDANCE_CHALLENGE', 'Tantangan presensi tidak valid.')
    if (challenge.usedStudentIds.includes(studentId)) conflict('ATTENDANCE_NONCE_REPLAYED', 'Tantangan presensi telah digunakan oleh mahasiswa ini.')
    const key = attendanceKey(safeId, challenge.meetingNumber, studentId)
    if (state.attendance.has(key)) conflict('ATTENDANCE_ALREADY_RECORDED', 'Presensi pertemuan telah tercatat.')
    const attendance = checkedInRecord(record, challenge, studentId, context, now)
    state.attendance.set(key, clone(attendance))
    state.challenges.set(challenge.id, { ...challenge, usedStudentIds: [...challenge.usedStudentIds, studentId] })
    result = { value: attendance, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<AttendanceRecord>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan presensi tidak tersedia.')
    const classRef = db.collection('academicClasses').doc(safeId)
    const challengeRef = classRef.collection('attendanceChallenges').doc(token.challengeId)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    const roster = await loadRoster(safeId)
    const studentId = ownRosterStudentId(context, roster)
    const rosterRef = classRef.collection('roster').doc(studentId)
    result = await db.runTransaction(async (transaction) => {
      const [previous, classSnapshot, challengeSnapshot, rosterSnapshot] = await Promise.all([
        transaction.get(idemRef), transaction.get(classRef), transaction.get(challengeRef), transaction.get(rosterRef),
      ])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<AttendanceRecord>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!classSnapshot.exists) notFound('Kelas')
      if (!challengeSnapshot.exists) conflict('INVALID_ATTENDANCE_CHALLENGE', 'Tantangan presensi tidak valid untuk kelas ini.')
      if (!rosterSnapshot.exists || rosterSnapshot.data()?.status !== 'ACTIVE') forbidden('Mahasiswa tidak tercatat aktif pada roster kelas.')
      const record = { id: classSnapshot.id, ...classSnapshot.data() } as AcademicClassRecord
      requireClassRead(context, record)
      const challenge = { id: challengeSnapshot.id, ...challengeSnapshot.data() } as AttendanceChallenge
      if (challenge.classId !== safeId) conflict('INVALID_ATTENDANCE_CHALLENGE', 'Tantangan presensi tidak valid untuk kelas ini.')
      ensureAttendanceWindow(record, challenge.meetingNumber, clock)
      if (clock.getTime() > Date.parse(challenge.expiresAt)) conflict('ATTENDANCE_CHALLENGE_EXPIRED', 'Tantangan presensi telah kedaluwarsa.')
      if (!nonceMatches(challenge.nonceHash, token.nonce)) conflict('INVALID_ATTENDANCE_CHALLENGE', 'Tantangan presensi tidak valid.')
      if (challenge.usedStudentIds.includes(studentId)) conflict('ATTENDANCE_NONCE_REPLAYED', 'Tantangan presensi telah digunakan oleh mahasiswa ini.')
      const actualAttendanceRef = classRef.collection('attendance').doc(opaqueId('attendance', attendanceKey(safeId, challenge.meetingNumber, studentId)))
      const attendanceSnapshot = await transaction.get(actualAttendanceRef)
      if (attendanceSnapshot.exists) conflict('ATTENDANCE_ALREADY_RECORDED', 'Presensi pertemuan telah tercatat.')
      const attendance = checkedInRecord(record, challenge, studentId, context, now)
      const response: AcademicWriteResult<AttendanceRecord> = { value: attendance, replayed: false }
      transaction.create(actualAttendanceRef, attendance)
      transaction.update(challengeRef, { usedStudentIds: [...challenge.usedStudentIds, studentId] })
      transaction.create(idemRef, idempotencyDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }

  const audit = await appendAudit({
    actor: context,
    action: 'ATTENDANCE_QR_CHECKED_IN',
    resourceType: 'class_attendance',
    resourceId: result.value.id,
    after: { classId: safeId, meetingNumber: result.value.meetingNumber, status: result.value.status },
    event,
  })
  result.auditId = audit.id
  return result
}

export async function correctAttendance(
  context: AuthContext,
  classId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AcademicWriteResult<AttendanceRecord>> {
  const safeId = safeClassId(classId)
  const input = parseCorrectionInput(value)
  const hash = requestHash({ classId: safeId, ...input })
  const namespace = `academic:attendance-correction:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let before: AttendanceRecord | undefined
  let result: AcademicWriteResult<AttendanceRecord>

  if (dataMode() === 'mock') {
    const replay = mockReplay<AttendanceRecord>(namespace, hash)
    if (replay) return replay
    const record = await loadClass(safeId)
    requireClassManagement(context, record)
    meetingFor(record, input.meetingNumber)
    const roster = state.rosters.get(safeId)?.get(input.studentId)
    if (!roster || roster.status !== 'ACTIVE') invalidInput('Mahasiswa tidak tercatat aktif pada roster kelas.')
    const key = attendanceKey(safeId, input.meetingNumber, input.studentId)
    before = state.attendance.get(key)
    const currentVersion = before?.version ?? 0
    if (currentVersion !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Presensi telah berubah.', { currentVersion })
    const attendance: AttendanceRecord = {
      id: before?.id ?? opaqueId('attendance', key),
      classId: safeId,
      meetingNumber: input.meetingNumber,
      studentId: input.studentId,
      status: input.status,
      source: 'MANUAL',
      ...(before?.checkedInAt ? { checkedInAt: before.checkedInAt } : {}),
      correctionReason: input.reason,
      correctedAt: now,
      correctedBy: context.uid,
      version: currentVersion + 1,
      updatedAt: now,
      updatedBy: context.uid,
    }
    state.attendance.set(key, clone(attendance))
    result = { value: attendance, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<AttendanceRecord>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan presensi tidak tersedia.')
    const classRef = db.collection('academicClasses').doc(safeId)
    const rosterRef = classRef.collection('roster').doc(input.studentId)
    const attendanceRef = classRef.collection('attendance').doc(opaqueId('attendance', attendanceKey(safeId, input.meetingNumber, input.studentId)))
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, classSnapshot, rosterSnapshot, attendanceSnapshot] = await Promise.all([
        transaction.get(idemRef), transaction.get(classRef), transaction.get(rosterRef), transaction.get(attendanceRef),
      ])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<AttendanceRecord>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!classSnapshot.exists) notFound('Kelas')
      const record = { id: classSnapshot.id, ...classSnapshot.data() } as AcademicClassRecord
      requireClassManagement(context, record)
      meetingFor(record, input.meetingNumber)
      if (!rosterSnapshot.exists || rosterSnapshot.data()?.status !== 'ACTIVE') invalidInput('Mahasiswa tidak tercatat aktif pada roster kelas.')
      const current = attendanceSnapshot.exists ? ({ id: attendanceSnapshot.id, ...attendanceSnapshot.data() } as AttendanceRecord) : undefined
      before = current
      const currentVersion = current?.version ?? 0
      if (currentVersion !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Presensi telah berubah.', { currentVersion })
      const attendance: AttendanceRecord = {
        id: current?.id ?? attendanceRef.id,
        classId: safeId,
        meetingNumber: input.meetingNumber,
        studentId: input.studentId,
        status: input.status,
        source: 'MANUAL',
        ...(current?.checkedInAt ? { checkedInAt: current.checkedInAt } : {}),
        correctionReason: input.reason,
        correctedAt: now,
        correctedBy: context.uid,
        version: currentVersion + 1,
        updatedAt: now,
        updatedBy: context.uid,
      }
      const response: AcademicWriteResult<AttendanceRecord> = { value: attendance, replayed: false }
      transaction.set(attendanceRef, attendance)
      transaction.create(idemRef, idempotencyDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }

  const audit = await appendAudit({
    actor: context,
    action: 'ATTENDANCE_MANUALLY_CORRECTED',
    resourceType: 'class_attendance',
    resourceId: result.value.id,
    before: before ? { status: before.status, version: before.version } : { status: 'NOT_RECORDED', version: 0 },
    after: { status: result.value.status, version: result.value.version, reason: input.reason },
    event,
  })
  result.auditId = audit.id
  return result
}

export async function configureGradeComponents(
  context: AuthContext,
  classId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AcademicWriteResult<GradeConfiguration>> {
  const safeId = safeClassId(classId)
  const input = parseGradeComponents(value)
  const hash = requestHash({ classId: safeId, ...input })
  const namespace = `academic:grade-config:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let before: GradeConfiguration | undefined
  let result: AcademicWriteResult<GradeConfiguration>

  if (dataMode() === 'mock') {
    const replay = mockReplay<GradeConfiguration>(namespace, hash)
    if (replay) return replay
    const record = await loadClass(safeId)
    requireClassManagement(context, record)
    before = await loadGradeConfiguration(safeId)
    if (before.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Konfigurasi nilai telah berubah.', { currentVersion: before.version })
    const configuration: GradeConfiguration = { classId: safeId, version: before.version + 1, components: clone(input.components), updatedAt: now, updatedBy: context.uid }
    state.gradeConfigurations.set(safeId, clone(configuration))
    state.classes.set(safeId, { ...record, gradeConfigVersion: configuration.version, gradebookVersion: record.gradebookVersion + 1, updatedAt: now })
    result = { value: configuration, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<GradeConfiguration>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan nilai tidak tersedia.')
    const classRef = db.collection('academicClasses').doc(safeId)
    const configRef = classRef.collection('gradeConfiguration').doc('current')
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, classSnapshot, configSnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(classRef), transaction.get(configRef)])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<GradeConfiguration>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!classSnapshot.exists) notFound('Kelas')
      const record = { id: classSnapshot.id, ...classSnapshot.data() } as AcademicClassRecord
      requireClassManagement(context, record)
      before = configSnapshot.exists
        ? configSnapshot.data() as GradeConfiguration
        : { classId: safeId, version: 0, components: [], updatedAt: record.updatedAt, updatedBy: 'system' }
      if (before.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Konfigurasi nilai telah berubah.', { currentVersion: before.version })
      const configuration: GradeConfiguration = { classId: safeId, version: before.version + 1, components: clone(input.components), updatedAt: now, updatedBy: context.uid }
      const response: AcademicWriteResult<GradeConfiguration> = { value: configuration, replayed: false }
      transaction.set(configRef, configuration)
      transaction.update(classRef, { gradeConfigVersion: configuration.version, gradebookVersion: record.gradebookVersion + 1, updatedAt: now })
      transaction.create(idemRef, idempotencyDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }

  if (!before) serviceUnavailable('Konfigurasi nilai awal tidak tersedia.')
  const audit = await appendAudit({
    actor: context,
    action: 'GRADE_COMPONENTS_CONFIGURED',
    resourceType: 'academic_class',
    resourceId: safeId,
    before: { version: before.version, components: before.components },
    after: { version: result.value.version, components: result.value.components },
    event,
  })
  result.auditId = audit.id
  return result
}

export async function enterStudentGrade(
  context: AuthContext,
  classId: string,
  studentId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AcademicWriteResult<StudentGrade>> {
  const safeId = safeClassId(classId)
  const safeStudent = safeStudentId(studentId)
  const input = parseGradeEntry(value)
  const hash = requestHash({ classId: safeId, studentId: safeStudent, ...input })
  const namespace = `academic:grade-entry:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let before: StudentGrade | undefined
  let result: AcademicWriteResult<StudentGrade>

  if (dataMode() === 'mock') {
    const replay = mockReplay<StudentGrade>(namespace, hash)
    if (replay) return replay
    const record = await loadClass(safeId)
    requireClassManagement(context, record)
    const roster = state.rosters.get(safeId)?.get(safeStudent)
    if (!roster || roster.status !== 'ACTIVE') invalidInput('Mahasiswa tidak tercatat aktif pada roster kelas.')
    const configuration = await loadGradeConfiguration(safeId)
    const calculated = validateAndCalculateGrade(configuration, input)
    before = state.grades.get(safeId)?.get(safeStudent)
    const currentVersion = before?.version ?? 0
    if (currentVersion !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Nilai mahasiswa telah berubah.', { currentVersion })
    const grade: StudentGrade = {
      id: before?.id ?? `grade-${safeId}-${safeStudent}`,
      classId: safeId,
      studentId: safeStudent,
      componentScores: clone(input.componentScores),
      ...calculated,
      configVersion: configuration.version,
      version: currentVersion + 1,
      updatedAt: now,
      updatedBy: context.uid,
    }
    const grades = state.grades.get(safeId) ?? new Map()
    grades.set(safeStudent, clone(grade))
    state.grades.set(safeId, grades)
    state.classes.set(safeId, { ...record, gradebookVersion: record.gradebookVersion + 1, updatedAt: now })
    result = { value: grade, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<StudentGrade>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan nilai tidak tersedia.')
    const classRef = db.collection('academicClasses').doc(safeId)
    const rosterRef = classRef.collection('roster').doc(safeStudent)
    const configRef = classRef.collection('gradeConfiguration').doc('current')
    const gradeRef = classRef.collection('grades').doc(safeStudent)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, classSnapshot, rosterSnapshot, configSnapshot, gradeSnapshot] = await Promise.all([
        transaction.get(idemRef), transaction.get(classRef), transaction.get(rosterRef), transaction.get(configRef), transaction.get(gradeRef),
      ])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<StudentGrade>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!classSnapshot.exists) notFound('Kelas')
      const record = { id: classSnapshot.id, ...classSnapshot.data() } as AcademicClassRecord
      requireClassManagement(context, record)
      if (!rosterSnapshot.exists || rosterSnapshot.data()?.status !== 'ACTIVE') invalidInput('Mahasiswa tidak tercatat aktif pada roster kelas.')
      if (!configSnapshot.exists) notFound('Konfigurasi nilai')
      const configuration = configSnapshot.data() as GradeConfiguration
      const calculated = validateAndCalculateGrade(configuration, input)
      before = gradeSnapshot.exists ? ({ id: gradeSnapshot.id, ...gradeSnapshot.data() } as StudentGrade) : undefined
      const currentVersion = before?.version ?? 0
      if (currentVersion !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Nilai mahasiswa telah berubah.', { currentVersion })
      const grade: StudentGrade = { id: safeStudent, classId: safeId, studentId: safeStudent, componentScores: clone(input.componentScores), ...calculated, configVersion: configuration.version, version: currentVersion + 1, updatedAt: now, updatedBy: context.uid }
      const response: AcademicWriteResult<StudentGrade> = { value: grade, replayed: false }
      transaction.set(gradeRef, grade)
      transaction.update(classRef, { gradebookVersion: record.gradebookVersion + 1, updatedAt: now })
      transaction.create(idemRef, idempotencyDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }

  const audit = await appendAudit({
    actor: context,
    action: 'STUDENT_GRADE_ENTERED',
    resourceType: 'student_grade',
    resourceId: result.value.id,
    before: before ? { finalScore: before.finalScore, letterGrade: before.letterGrade, version: before.version } : { version: 0 },
    after: { classId: safeId, finalScore: result.value.finalScore, letterGrade: result.value.letterGrade, version: result.value.version },
    event,
  })
  result.auditId = audit.id
  return result
}

export async function publishGrades(
  context: AuthContext,
  classId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AcademicWriteResult<GradePublicationSnapshot>> {
  const safeId = safeClassId(classId)
  const input = parsePublicationInput(value)
  const hash = requestHash({ classId: safeId, ...input })
  const namespace = `academic:grade-publication:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let result: AcademicWriteResult<GradePublicationSnapshot>

  if (dataMode() === 'mock') {
    const replay = mockReplay<GradePublicationSnapshot>(namespace, hash)
    if (replay) return replay
    const record = await loadClass(safeId)
    requireClassManagement(context, record)
    if (record.gradebookVersion !== input.expectedGradebookVersion) conflict('GRADEBOOK_VERSION_CONFLICT', 'Gradebook telah berubah.', { currentVersion: record.gradebookVersion })
    if (record.publishedGradebookVersion === record.gradebookVersion) conflict('GRADEBOOK_ALREADY_PUBLISHED', 'Versi gradebook ini telah dipublikasikan.')
    const roster = await loadRoster(safeId)
    const configuration = await loadGradeConfiguration(safeId)
    const grades = await loadGrades(safeId)
    const publicationVersion = record.publicationVersion + 1
    const snapshot: GradePublicationSnapshot = {
      id: `publication-${safeId}-v${publicationVersion}`,
      classId: safeId,
      publicationVersion,
      gradebookVersion: record.gradebookVersion,
      configVersion: configuration.version,
      components: clone(configuration.components),
      rows: publicationRows(record, roster, configuration, grades),
      publishedAt: now,
      publishedBy: context.uid,
    }
    const publications = state.publications.get(safeId) ?? new Map()
    publications.set(snapshot.id, clone(snapshot))
    state.publications.set(safeId, publications)
    state.classes.set(safeId, { ...record, publicationVersion, publishedGradebookVersion: record.gradebookVersion, latestPublicationId: snapshot.id, updatedAt: now })
    result = { value: snapshot, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const replay = await firebaseReplay<GradePublicationSnapshot>(namespace, hash)
    if (replay) return replay
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan nilai tidak tersedia.')
    const classRef = db.collection('academicClasses').doc(safeId)
    const configRef = classRef.collection('gradeConfiguration').doc('current')
    const rosterQuery = classRef.collection('roster').where('status', '==', 'ACTIVE')
    const gradesQuery = classRef.collection('grades')
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async (transaction) => {
      const [previous, classSnapshot, configSnapshot, rosterSnapshot, gradeSnapshot] = await Promise.all([
        transaction.get(idemRef), transaction.get(classRef), transaction.get(configRef), transaction.get(rosterQuery), transaction.get(gradesQuery),
      ])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<GradePublicationSnapshot>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!classSnapshot.exists) notFound('Kelas')
      if (!configSnapshot.exists) notFound('Konfigurasi nilai')
      const record = { id: classSnapshot.id, ...classSnapshot.data() } as AcademicClassRecord
      requireClassManagement(context, record)
      if (record.gradebookVersion !== input.expectedGradebookVersion) conflict('GRADEBOOK_VERSION_CONFLICT', 'Gradebook telah berubah.', { currentVersion: record.gradebookVersion })
      if (record.publishedGradebookVersion === record.gradebookVersion) conflict('GRADEBOOK_ALREADY_PUBLISHED', 'Versi gradebook ini telah dipublikasikan.')
      const configuration = configSnapshot.data() as GradeConfiguration
      const roster = rosterSnapshot.docs.map((document) => ({ studentId: document.id, ...document.data() }) as ClassRosterEntry)
      const grades = gradeSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }) as StudentGrade)
      const publicationVersion = record.publicationVersion + 1
      const snapshot: GradePublicationSnapshot = { id: `publication-${safeId}-v${publicationVersion}`, classId: safeId, publicationVersion, gradebookVersion: record.gradebookVersion, configVersion: configuration.version, components: clone(configuration.components), rows: publicationRows(record, roster, configuration, grades), publishedAt: now, publishedBy: context.uid }
      const response: AcademicWriteResult<GradePublicationSnapshot> = { value: snapshot, replayed: false }
      transaction.create(classRef.collection('gradePublications').doc(snapshot.id), snapshot)
      transaction.update(classRef, { publicationVersion, publishedGradebookVersion: record.gradebookVersion, latestPublicationId: snapshot.id, updatedAt: now })
      transaction.create(idemRef, idempotencyDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }

  const audit = await appendAudit({
    actor: context,
    action: 'GRADES_PUBLISHED',
    resourceType: 'grade_publication',
    resourceId: result.value.id,
    after: { classId: safeId, publicationVersion: result.value.publicationVersion, gradebookVersion: result.value.gradebookVersion, rowCount: result.value.rows.length },
    event,
  })
  result.auditId = audit.id
  return result
}

export async function getOwnPublishedResult(context: AuthContext, classId: string): Promise<KhsPublishedResult> {
  const safeId = safeClassId(classId)
  const record = await loadClass(safeId)
  const roster = await loadRoster(safeId)
  const studentId = ownRosterStudentId(context, roster)
  if (!record.latestPublicationId) notFound('Hasil nilai terbit')
  let snapshot: GradePublicationSnapshot | undefined
  if (dataMode() === 'mock') snapshot = state.publications.get(safeId)?.get(record.latestPublicationId)
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan nilai tidak tersedia.')
    const document = await db.collection('academicClasses').doc(safeId).collection('gradePublications').doc(record.latestPublicationId).get()
    if (document.exists) snapshot = document.data() as GradePublicationSnapshot
  }
  if (!snapshot) notFound('Hasil nilai terbit')
  const row = snapshot.rows.find((item) => item.studentId === studentId)
  if (!row) notFound('Hasil nilai mahasiswa')
  return {
    classId: safeId,
    courseCode: record.courseCode,
    courseName: record.courseName,
    section: record.section,
    periodId: record.periodId,
    credits: record.credits,
    studentId,
    studentNumber: row.studentNumber,
    finalScore: row.finalScore,
    letterGrade: row.letterGrade,
    qualityPoints: row.qualityPoints,
    publicationVersion: snapshot.publicationVersion,
    publishedAt: snapshot.publishedAt,
  }
}

export function resetAcademicClassStateForTests(): void {
  state = initialMockState()
}

export function academicClassStateForTests(): AcademicMockState {
  return clone({
    classes: state.classes,
    rosters: state.rosters,
    journals: state.journals,
    attendance: state.attendance,
    challenges: state.challenges,
    gradeConfigurations: state.gradeConfigurations,
    grades: state.grades,
    publications: state.publications,
    idempotency: state.idempotency,
  })
}
