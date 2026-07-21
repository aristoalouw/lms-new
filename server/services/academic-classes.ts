import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Query } from 'firebase-admin/firestore'
import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { LearningSpace } from '../types/learning'
import type {
  AcademicClassDetail,
  AcademicClassRecord,
  AttendanceChallenge,
  AttendanceRecord,
  AttendanceStatus,
  ClassMeetingSchedule,
  ClassEnrollment,
  ClassRosterEntry,
  DeliveryMode,
  GradeComponent,
  GradeConfiguration,
  GradePublicationSnapshot,
  IssuedAttendanceChallenge,
  KhsPublishedResult,
  PublishedGradeRow,
  StudentGrade,
  TeachingJournal,
} from '../types/academic-classes'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { hasRole, requirePermission } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { normalizeIsoInstant, optionalString, requireInteger, requirePositiveNumber, requireRecord, requireString, requireStringArray } from '../utils/validation'
import { normalizeFeatureProfile } from '../../shared/features'
import { learningMockState } from './learning-mock'

export interface AcademicClassListQuery {
  periodId?: string
  programStudyId?: string
  cursor?: string
  limit?: number
}

export interface AcademicClassPage {
  items: AcademicClassRecord[]
  nextCursor?: string
}

export interface AcademicWriteResult<T> {
  value: T
  replayed: boolean
  auditId?: string
}

export interface CreateAcademicClassInput {
  courseCode: string
  courseName: string
  credits: number
  section: string
  periodId: string
  programStudyId: string
  unitId: string
  lecturerIds: string[]
  lecturerNames: string[]
  capacity: number
  firstMeetingStartsAt: string
  meetingCount: number
  meetingDurationMinutes: number
}

export interface UpdateAcademicClassInput {
  expectedVersion: number
  courseCode?: string
  courseName?: string
  credits?: number
  section?: string
  periodId?: string
  programStudyId?: string
  unitId?: string
  lecturerIds?: string[]
  lecturerNames?: string[]
  capacity?: number
  firstMeetingStartsAt?: string
  meetingCount?: number
  meetingDurationMinutes?: number
  status?: 'ACTIVE' | 'CLOSED'
}

export interface CreateClassEnrollmentInput {
  studentId: string
  studentUid: string
  studentNumber: string
  studentName: string
  programStudyId?: string
  reason: string
  sourceRef?: string
}

export interface UpdateClassEnrollmentInput {
  status: 'ACTIVE' | 'WITHDRAWN'
  reason: string
  expectedVersion: number
}

export interface ClassEnrollmentPage {
  items: ClassEnrollment[]
  nextCursor?: string
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

export interface AcademicMockState {
  classes: Map<string, AcademicClassRecord>
  rosters: Map<string, Map<string, ClassRosterEntry>>
  enrollments: Map<string, ClassEnrollment>
  journals: Map<string, Map<number, TeachingJournal>>
  attendance: Map<string, AttendanceRecord>
  challenges: Map<string, AttendanceChallenge>
  gradeConfigurations: Map<string, GradeConfiguration>
  grades: Map<string, Map<string, StudentGrade>>
  publications: Map<string, Map<string, GradePublicationSnapshot>>
  idempotency: Map<string, IdempotencyRecord>
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000
const CLASS_LIMIT = 50
const ATTENDANCE_STATUSES: AttendanceStatus[] = ['PRESENT', 'LATE', 'EXCUSED', 'ABSENT']
const DELIVERY_MODES: DeliveryMode[] = ['ONSITE', 'ONLINE', 'HYBRID']

function clone<T>(value: T): T {
  return structuredClone(value)
}

function weeklySchedule(startIso: string, count = 16, durationMinutes = 100): ClassMeetingSchedule[] {
  const start = Date.parse(startIso)
  return Array.from({ length: count }, (_, index) => {
    const scheduledStart = start + index * 7 * 24 * 60 * 60 * 1000
    const scheduledEnd = scheduledStart + durationMinutes * 60 * 1000
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
    enrollmentCount: 2,
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
    enrollmentCount: 1,
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
  const enrollments = new Map<string, ClassEnrollment>()
  for (const [classId, rows] of Object.entries(SEEDED_ROSTERS)) {
    const classRecord = SEEDED_CLASSES.find(record => record.id === classId)!
    for (const row of rows) {
      const id = classEnrollmentId(classId, row.studentId)
      enrollments.set(id, {
        id,
        classId,
        studentId: row.studentId,
        studentUid: row.studentId,
        studentNumber: row.studentNumber,
        studentName: row.studentName,
        programStudyId: row.programStudyId,
        periodId: classRecord.periodId,
        status: row.status,
        source: 'KRS',
        sourceRef: `seed-${classId}-${row.studentId}`,
        version: 1,
        createdAt: classRecord.updatedAt,
        createdBy: 'system',
        updatedAt: classRecord.updatedAt,
        updatedBy: 'system',
      })
    }
  }
  return {
    classes: new Map(SEEDED_CLASSES.map((record) => [record.id, clone(record)])),
    rosters: new Map(Object.entries(SEEDED_ROSTERS).map(([classId, rows]) => [classId, new Map(rows.map((row) => [row.studentId, clone(row)]))])),
    enrollments,
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

export function classEnrollmentId(classId: string, studentId: string): string {
  return `${safeClassId(classId)}_${safeStudentId(studentId)}`
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
  return isAssignedLecturer(context, record) || isScopedAcademicStaff(context, record)
}

async function canReadClass(context: AuthContext, record: AcademicClassRecord): Promise<boolean> {
  if (canManageClass(context, record) || hasRole(context, 'administrator', 'leader')) return true
  if (!hasRole(context, 'student')) return false
  return Boolean(await activeStudentEnrollment(context, record.id))
}

async function requireClassRead(context: AuthContext, record: AcademicClassRecord): Promise<void> {
  if (!await canReadClass(context, record)) forbidden('Kelas berada di luar lingkup akses Anda.')
}

function requireClassManagement(context: AuthContext, record: AcademicClassRecord): void {
  if (!canManageClass(context, record)) forbidden('Anda tidak berwenang mengelola kelas ini.')
}

function enrollmentRosterEntry(enrollment: ClassEnrollment): ClassRosterEntry {
  return {
    studentId: enrollment.studentId,
    studentNumber: enrollment.studentNumber,
    studentName: enrollment.studentName,
    programStudyId: enrollment.programStudyId,
    status: enrollment.status,
  }
}

async function activeStudentEnrollment(context: AuthContext, classId: string): Promise<ClassEnrollment | undefined> {
  if (!hasRole(context, 'student')) return undefined
  const candidates = studentCandidates(context).slice(0, 20)
  let matches: ClassEnrollment[]
  if (dataMode() === 'mock') {
    matches = [...state.enrollments.values()].filter(enrollment => enrollment.classId === classId
      && enrollment.status === 'ACTIVE'
      && (candidates.includes(enrollment.studentId) || enrollment.studentUid === context.uid))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan enrolment tidak tersedia.')
    const [directSnapshots, uidSnapshot] = await Promise.all([
      Promise.all(candidates.map(studentId => db.collection('classEnrollments').doc(classEnrollmentId(classId, studentId)).get())),
      db.collection('classEnrollments')
        .where('classId', '==', classId)
        .where('studentUid', '==', context.uid)
        .where('status', '==', 'ACTIVE')
        .limit(2)
        .get(),
    ])
    matches = [
      ...directSnapshots.filter(snapshot => snapshot.exists).map(snapshot => ({ id: snapshot.id, ...snapshot.data() }) as ClassEnrollment),
      ...uidSnapshot.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() }) as ClassEnrollment),
    ].filter(enrollment => enrollment.status === 'ACTIVE')
  }
  const unique = [...new Map(matches.map(enrollment => [enrollment.id, enrollment])).values()]
  if (unique.length > 1) forbidden('Identitas mahasiswa cocok dengan lebih dari satu enrolment kelas.')
  return unique[0] ? clone(unique[0]) : undefined
}

async function requireActiveStudentEnrollment(context: AuthContext, classId: string): Promise<ClassEnrollment> {
  if (!hasRole(context, 'student')) forbidden('Aksi ini hanya tersedia bagi mahasiswa.')
  const enrollment = await activeStudentEnrollment(context, classId)
  if (!enrollment) forbidden('Mahasiswa tidak memiliki enrolment aktif pada kelas ini.')
  return enrollment
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

async function loadRoster(classId: string, limit = 2_000): Promise<ClassRosterEntry[]> {
  if (dataMode() === 'mock') {
    return [...state.enrollments.values()]
      .filter(enrollment => enrollment.classId === classId)
      .map(enrollment => ({
        studentId: enrollment.studentId,
        studentNumber: enrollment.studentNumber,
        studentName: enrollment.studentName,
        programStudyId: enrollment.programStudyId,
        status: enrollment.status,
      }))
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan roster tidak tersedia.')
  const snapshot = await db.collection('classEnrollments').where('classId', '==', classId).limit(limit).get()
  return snapshot.docs.map(document => {
    const enrollment = { id: document.id, ...document.data() } as ClassEnrollment
    return {
      studentId: enrollment.studentId,
      studentNumber: enrollment.studentNumber,
      studentName: enrollment.studentName,
      programStudyId: enrollment.programStudyId,
      status: enrollment.status,
    }
  })
}

export async function listActiveClassRecipientUids(classId: string): Promise<string[]> {
  const safeId = safeClassId(classId)
  if (dataMode() === 'mock') {
    return [...new Set([...state.enrollments.values()]
      .filter(enrollment => enrollment.classId === safeId && enrollment.status === 'ACTIVE')
      .map(enrollment => enrollment.studentUid))]
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan enrolment tidak tersedia.')
  const snapshot = await db.collection('classEnrollments').where('classId', '==', safeId).where('status', '==', 'ACTIVE').limit(2_000).get()
  return [...new Set(snapshot.docs.map(document => String(document.data().studentUid)).filter(Boolean))]
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

function stableIdentifier(value: unknown, label: string): string {
  return requireString(value, label, { max: 100, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
}

function parseClassInstant(value: unknown, label: string): string {
  const raw = requireString(value, label, {
    max: 48,
    pattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/,
  })
  const instant = new Date(raw)
  if (Number.isNaN(instant.getTime())) invalidInput(`${label} harus berupa waktu ISO yang valid.`)
  return instant.toISOString()
}

function classKey(record: Pick<AcademicClassRecord, 'periodId' | 'courseCode' | 'section'>): string {
  return `${record.periodId.trim().toLowerCase()}|${record.courseCode.trim().toLowerCase()}|${record.section.trim().toLowerCase()}`
}

function classKeyDocumentId(record: Pick<AcademicClassRecord, 'periodId' | 'courseCode' | 'section'>): string {
  return requestHash(classKey(record))
}

function parseLecturers(idsValue: unknown, namesValue: unknown): { lecturerIds: string[]; lecturerNames: string[] } {
  const lecturerIds = requireStringArray(idsValue, 'lecturerIds', 20).map((value, index) => stableIdentifier(value, `lecturerIds[${index}]`))
  const lecturerNames = requireStringArray(namesValue, 'lecturerNames', 20)
    .map((value, index) => requireString(value, `lecturerNames[${index}]`, { max: 150 }))
  if (lecturerIds.length !== lecturerNames.length) invalidInput('lecturerIds dan lecturerNames harus memiliki jumlah item yang sama.')
  return { lecturerIds, lecturerNames }
}

function parseCreateClassInput(value: unknown): CreateAcademicClassInput {
  const body = requireRecord(value)
  rejectUnknown(body, [
    'courseCode', 'courseName', 'credits', 'section', 'periodId', 'programStudyId',
    'unitId', 'lecturerIds', 'lecturerNames', 'capacity', 'firstMeetingStartsAt',
    'meetingCount', 'meetingDurationMinutes',
  ])
  const lecturers = parseLecturers(body.lecturerIds, body.lecturerNames)
  return {
    courseCode: requireString(body.courseCode, 'courseCode', { max: 30, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/ }).toUpperCase(),
    courseName: requireString(body.courseName, 'courseName', { max: 160 }),
    credits: requireInteger(body.credits, 'credits', 1, 24),
    section: requireString(body.section, 'section', { max: 20, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/ }).toUpperCase(),
    periodId: stableIdentifier(body.periodId, 'periodId'),
    programStudyId: stableIdentifier(body.programStudyId, 'programStudyId'),
    unitId: stableIdentifier(body.unitId, 'unitId'),
    ...lecturers,
    capacity: requireInteger(body.capacity, 'capacity', 1, 5_000),
    firstMeetingStartsAt: parseClassInstant(body.firstMeetingStartsAt, 'firstMeetingStartsAt'),
    meetingCount: requireInteger(body.meetingCount, 'meetingCount', 1, 32),
    meetingDurationMinutes: requireInteger(body.meetingDurationMinutes, 'meetingDurationMinutes', 30, 360),
  }
}

function parseUpdateClassInput(value: unknown): UpdateAcademicClassInput {
  const body = requireRecord(value)
  rejectUnknown(body, [
    'expectedVersion', 'courseCode', 'courseName', 'credits', 'section', 'periodId',
    'programStudyId', 'unitId', 'lecturerIds', 'lecturerNames', 'capacity',
    'firstMeetingStartsAt', 'meetingCount', 'meetingDurationMinutes', 'status',
  ])
  if (Object.keys(body).length < 2) invalidInput('Setidaknya satu field kelas harus diubah.')
  const result: UpdateAcademicClassInput = {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1),
  }
  if (body.courseCode !== undefined) result.courseCode = requireString(body.courseCode, 'courseCode', { max: 30, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/ }).toUpperCase()
  if (body.courseName !== undefined) result.courseName = requireString(body.courseName, 'courseName', { max: 160 })
  if (body.credits !== undefined) result.credits = requireInteger(body.credits, 'credits', 1, 24)
  if (body.section !== undefined) result.section = requireString(body.section, 'section', { max: 20, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/ }).toUpperCase()
  if (body.periodId !== undefined) result.periodId = stableIdentifier(body.periodId, 'periodId')
  if (body.programStudyId !== undefined) result.programStudyId = stableIdentifier(body.programStudyId, 'programStudyId')
  if (body.unitId !== undefined) result.unitId = stableIdentifier(body.unitId, 'unitId')
  if (body.capacity !== undefined) result.capacity = requireInteger(body.capacity, 'capacity', 1, 5_000)
  if (body.firstMeetingStartsAt !== undefined) result.firstMeetingStartsAt = parseClassInstant(body.firstMeetingStartsAt, 'firstMeetingStartsAt')
  if (body.meetingCount !== undefined) result.meetingCount = requireInteger(body.meetingCount, 'meetingCount', 1, 32)
  if (body.meetingDurationMinutes !== undefined) result.meetingDurationMinutes = requireInteger(body.meetingDurationMinutes, 'meetingDurationMinutes', 30, 360)
  if (body.status !== undefined) {
    const status = requireString(body.status, 'status', { max: 20 })
    if (!['ACTIVE', 'CLOSED'].includes(status)) invalidInput('status kelas tidak valid.')
    result.status = status as UpdateAcademicClassInput['status']
  }
  if (body.lecturerIds !== undefined || body.lecturerNames !== undefined) {
    if (body.lecturerIds === undefined || body.lecturerNames === undefined) invalidInput('lecturerIds dan lecturerNames harus diperbarui bersama-sama.')
    Object.assign(result, parseLecturers(body.lecturerIds, body.lecturerNames))
  }
  return result
}

function learningSpaceForClass(record: AcademicClassRecord, actorId: string, now: string): LearningSpace {
  return {
    id: record.id,
    kind: 'ACADEMIC_CLASS',
    title: `${record.courseName} · Kelas ${record.section}`,
    description: `Ruang pembelajaran ${record.courseCode} untuk periode ${record.periodId}.`,
    academicClassId: record.id,
    courseCode: record.courseCode,
    section: record.section,
    periodId: record.periodId,
    programStudyId: record.programStudyId,
    unitId: record.unitId,
    lecturerIds: [...record.lecturerIds],
    participantUserIds: [],
    status: record.status === 'ACTIVE' ? 'ACTIVE' : 'ARCHIVED',
    gamificationAvailable: false,
    version: record.version ?? 1,
    createdAt: record.createdAt ?? now,
    createdBy: record.createdBy ?? actorId,
    updatedAt: now,
    updatedBy: actorId,
  }
}

export async function createAcademicClass(
  context: AuthContext,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AcademicWriteResult<{ classRecord: AcademicClassRecord; learningSpace: LearningSpace }>> {
  requirePermission(context, 'classes:manage')
  const input = parseCreateClassInput(value)
  const hash = requestHash(input)
  const namespace = `academic:class-create:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  const id = opaqueId('class', classKey(input))
  const record: AcademicClassRecord = {
    id,
    courseCode: input.courseCode,
    courseName: input.courseName,
    credits: input.credits,
    section: input.section,
    periodId: input.periodId,
    programStudyId: input.programStudyId,
    unitId: input.unitId,
    lecturerIds: [...input.lecturerIds],
    lecturerNames: [...input.lecturerNames],
    timezone: 'Asia/Jakarta',
    status: 'ACTIVE',
    totalScheduledMeetings: input.meetingCount,
    realizedMeetingCount: 0,
    schedule: weeklySchedule(input.firstMeetingStartsAt, input.meetingCount, input.meetingDurationMinutes),
    enrollmentCount: 0,
    capacity: input.capacity,
    reservedSeatCount: 0,
    gradeConfigVersion: 1,
    gradebookVersion: 0,
    publicationVersion: 0,
    version: 1,
    createdAt: now,
    createdBy: context.uid,
    updatedAt: now,
    updatedBy: context.uid,
  }
  const learningSpace = learningSpaceForClass(record, context.uid, now)
  let result: AcademicWriteResult<{ classRecord: AcademicClassRecord; learningSpace: LearningSpace }>

  if (dataMode() === 'mock') {
    const replay = mockReplay<{ classRecord: AcademicClassRecord; learningSpace: LearningSpace }>(namespace, hash)
    if (replay) return replay
    if ([...state.classes.values()].some(existing => classKey(existing) === classKey(record))) {
      conflict('ACADEMIC_CLASS_DUPLICATE', 'Kelas dengan periode, mata kuliah, dan section yang sama sudah ada.')
    }
    state.classes.set(id, clone(record))
    state.rosters.set(id, new Map())
    state.journals.set(id, new Map())
    state.gradeConfigurations.set(id, { classId: id, version: 1, components: clone(DEFAULT_COMPONENTS), updatedAt: now, updatedBy: context.uid })
    state.grades.set(id, new Map())
    state.publications.set(id, new Map())
    learningMockState().spaces.set(id, clone(learningSpace))
    result = { value: { classRecord: clone(record), learningSpace: clone(learningSpace) }, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kelas tidak tersedia.')
    const classRef = db.collection('academicClasses').doc(id)
    const keyRef = db.collection('academicClassKeys').doc(classKeyDocumentId(record))
    const spaceRef = db.collection('learningSpaces').doc(id)
    const configRef = classRef.collection('gradeConfiguration').doc('current')
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [previous, existingKey, existingClass, existingSpace] = await Promise.all([
        transaction.get(idemRef), transaction.get(keyRef), transaction.get(classRef), transaction.get(spaceRef),
      ])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<{ classRecord: AcademicClassRecord; learningSpace: LearningSpace }>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (existingKey.exists || existingClass.exists || existingSpace.exists) {
        conflict('ACADEMIC_CLASS_DUPLICATE', 'Kelas dengan periode, mata kuliah, dan section yang sama sudah ada.')
      }
      const response: AcademicWriteResult<{ classRecord: AcademicClassRecord; learningSpace: LearningSpace }> = {
        value: { classRecord: record, learningSpace }, replayed: false,
      }
      transaction.create(classRef, record)
      transaction.create(keyRef, { classId: id, key: classKey(record), createdAt: now, createdBy: context.uid })
      transaction.create(spaceRef, learningSpace)
      transaction.create(configRef, { classId: id, version: 1, components: DEFAULT_COMPONENTS, updatedAt: now, updatedBy: context.uid })
      transaction.create(idemRef, idempotencyDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }

  const audit = await appendAudit({
    actor: context,
    action: 'ACADEMIC_CLASS_CREATED',
    resourceType: 'academic_class',
    resourceId: id,
    after: { courseCode: record.courseCode, section: record.section, periodId: record.periodId, programStudyId: record.programStudyId },
    event,
  })
  result.auditId = audit.id
  return result
}

export async function updateAcademicClass(
  context: AuthContext,
  classId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AcademicWriteResult<{ classRecord: AcademicClassRecord; learningSpace: LearningSpace }>> {
  requirePermission(context, 'classes:manage')
  const safeId = safeClassId(classId)
  const input = parseUpdateClassInput(value)
  const hash = requestHash({ classId: safeId, ...input })
  const namespace = `academic:class-update:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let before!: AcademicClassRecord
  let result: AcademicWriteResult<{ classRecord: AcademicClassRecord; learningSpace: LearningSpace }>

  const updatedRecord = (current: AcademicClassRecord): AcademicClassRecord => {
    const currentVersion = current.version ?? 1
    if (currentVersion !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Kelas telah berubah.', { currentVersion })
    const firstStart = input.firstMeetingStartsAt ?? current.schedule[0]?.scheduledStartAt
    const meetingCount = input.meetingCount ?? current.totalScheduledMeetings
    const durationMinutes = input.meetingDurationMinutes
      ?? (current.schedule[0] ? Math.round((Date.parse(current.schedule[0].scheduledEndAt) - Date.parse(current.schedule[0].scheduledStartAt)) / 60_000) : 100)
    const shouldRegenerate = input.firstMeetingStartsAt !== undefined || input.meetingCount !== undefined || input.meetingDurationMinutes !== undefined
    return {
      ...current,
      ...(input.courseCode ? { courseCode: input.courseCode } : {}),
      ...(input.courseName ? { courseName: input.courseName } : {}),
      ...(input.credits ? { credits: input.credits } : {}),
      ...(input.section ? { section: input.section } : {}),
      ...(input.periodId ? { periodId: input.periodId } : {}),
      ...(input.programStudyId ? { programStudyId: input.programStudyId } : {}),
      ...(input.unitId ? { unitId: input.unitId } : {}),
      ...(input.lecturerIds ? { lecturerIds: [...input.lecturerIds], lecturerNames: [...input.lecturerNames!] } : {}),
      ...(input.capacity ? { capacity: input.capacity } : {}),
      ...(input.status ? { status: input.status } : {}),
      totalScheduledMeetings: meetingCount,
      ...(shouldRegenerate && firstStart ? { schedule: weeklySchedule(firstStart, meetingCount, durationMinutes) } : {}),
      version: currentVersion + 1,
      updatedAt: now,
      updatedBy: context.uid,
    }
  }

  if (dataMode() === 'mock') {
    const replay = mockReplay<{ classRecord: AcademicClassRecord; learningSpace: LearningSpace }>(namespace, hash)
    if (replay) return replay
    before = await loadClass(safeId)
    const updated = updatedRecord(before)
    if ((updated.capacity ?? Number.MAX_SAFE_INTEGER) < (updated.enrollmentCount ?? 0)) invalidInput('Kapasitas tidak boleh lebih kecil dari enrolment aktif.')
    if (classKey(before) !== classKey(updated) && [...state.classes.values()].some(existing => existing.id !== safeId && classKey(existing) === classKey(updated))) {
      conflict('ACADEMIC_CLASS_DUPLICATE', 'Kelas dengan periode, mata kuliah, dan section yang sama sudah ada.')
    }
    const existingSpace = [...learningMockState().spaces.values()].find(space => space.academicClassId === safeId)
    const space = { ...learningSpaceForClass(updated, context.uid, now), createdAt: existingSpace?.createdAt ?? updated.createdAt ?? now, createdBy: existingSpace?.createdBy ?? updated.createdBy ?? context.uid }
    state.classes.set(safeId, clone(updated))
    if (existingSpace && existingSpace.id !== safeId) learningMockState().spaces.delete(existingSpace.id)
    learningMockState().spaces.set(safeId, clone(space))
    result = { value: { classRecord: clone(updated), learningSpace: clone(space) }, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kelas tidak tersedia.')
    const classRef = db.collection('academicClasses').doc(safeId)
    const spaceRef = db.collection('learningSpaces').doc(safeId)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [previous, classSnapshot, spaceSnapshot] = await Promise.all([
        transaction.get(idemRef), transaction.get(classRef), transaction.get(spaceRef),
      ])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<{ classRecord: AcademicClassRecord; learningSpace: LearningSpace }>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!classSnapshot.exists) notFound('Kelas')
      before = { id: classSnapshot.id, ...classSnapshot.data() } as AcademicClassRecord
      const updated = updatedRecord(before)
      if ((updated.capacity ?? Number.MAX_SAFE_INTEGER) < (updated.enrollmentCount ?? 0)) invalidInput('Kapasitas tidak boleh lebih kecil dari enrolment aktif.')
      const oldKeyRef = db.collection('academicClassKeys').doc(classKeyDocumentId(before))
      const newKeyRef = db.collection('academicClassKeys').doc(classKeyDocumentId(updated))
      if (oldKeyRef.id !== newKeyRef.id) {
        const newKey = await transaction.get(newKeyRef)
        if (newKey.exists) conflict('ACADEMIC_CLASS_DUPLICATE', 'Kelas dengan periode, mata kuliah, dan section yang sama sudah ada.')
        transaction.delete(oldKeyRef)
        transaction.create(newKeyRef, { classId: safeId, key: classKey(updated), createdAt: now, createdBy: context.uid })
      }
      const currentSpace = spaceSnapshot.exists ? ({ id: spaceSnapshot.id, ...spaceSnapshot.data() } as LearningSpace) : undefined
      const space = { ...learningSpaceForClass(updated, context.uid, now), createdAt: currentSpace?.createdAt ?? updated.createdAt ?? now, createdBy: currentSpace?.createdBy ?? updated.createdBy ?? context.uid }
      const response: AcademicWriteResult<{ classRecord: AcademicClassRecord; learningSpace: LearningSpace }> = { value: { classRecord: updated, learningSpace: space }, replayed: false }
      transaction.set(classRef, updated)
      transaction.set(spaceRef, space)
      transaction.create(idemRef, idempotencyDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }

  const audit = await appendAudit({
    actor: context,
    action: result.value.classRecord.status === 'CLOSED' && before.status !== 'CLOSED' ? 'ACADEMIC_CLASS_ARCHIVED' : 'ACADEMIC_CLASS_UPDATED',
    resourceType: 'academic_class',
    resourceId: safeId,
    before: { version: before.version ?? 1, status: before.status, lecturerIds: before.lecturerIds },
    after: { version: result.value.classRecord.version, status: result.value.classRecord.status, lecturerIds: result.value.classRecord.lecturerIds },
    event,
  })
  result.auditId = audit.id
  return result
}

function parseCreateEnrollmentInput(value: unknown): CreateClassEnrollmentInput {
  const body = requireRecord(value)
  rejectUnknown(body, ['studentId', 'studentUid', 'studentNumber', 'studentName', 'programStudyId', 'reason', 'sourceRef'])
  return {
    studentId: safeStudentId(body.studentId),
    studentUid: stableIdentifier(body.studentUid, 'studentUid'),
    studentNumber: requireString(body.studentNumber, 'studentNumber', { max: 40, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/ }),
    studentName: requireString(body.studentName, 'studentName', { max: 150 }),
    programStudyId: body.programStudyId === undefined ? undefined : stableIdentifier(body.programStudyId, 'programStudyId'),
    reason: requireString(body.reason, 'reason', { min: 10, max: 500 }),
    sourceRef: optionalString(body.sourceRef, 'sourceRef', 128),
  }
}

function parseUpdateEnrollmentInput(value: unknown): UpdateClassEnrollmentInput {
  const body = requireRecord(value)
  rejectUnknown(body, ['status', 'reason', 'expectedVersion'])
  const status = requireString(body.status, 'status', { max: 20 })
  if (!['ACTIVE', 'WITHDRAWN'].includes(status)) invalidInput('Status enrolment tidak valid.')
  return {
    status: status as UpdateClassEnrollmentInput['status'],
    reason: requireString(body.reason, 'reason', { min: 10, max: 500 }),
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1),
  }
}

function encodeEnrollmentCursor(record: ClassEnrollment): string {
  return Buffer.from(JSON.stringify({ studentNumber: record.studentNumber, id: record.id }), 'utf8').toString('base64url')
}

function decodeEnrollmentCursor(value?: string): { studentNumber: string; id: string } | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    return {
      studentNumber: requireString(parsed.studentNumber, 'cursor.studentNumber', { max: 40 }),
      id: requireString(parsed.id, 'cursor.id', { max: 260 }),
    }
  } catch {
    invalidInput('Cursor enrolment tidak valid.')
  }
}

export async function listClassEnrollments(
  context: AuthContext,
  classId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<ClassEnrollmentPage> {
  requirePermission(context, 'enrollments:manage')
  const safeId = safeClassId(classId)
  await loadClass(safeId)
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 50)
  const cursor = decodeEnrollmentCursor(options.cursor)
  let rows: ClassEnrollment[]
  if (dataMode() === 'mock') {
    rows = [...state.enrollments.values()]
      .filter(record => record.classId === safeId)
      .sort((left, right) => left.studentNumber.localeCompare(right.studentNumber, 'id') || left.id.localeCompare(right.id))
      .filter(record => !cursor || record.studentNumber > cursor.studentNumber || (record.studentNumber === cursor.studentNumber && record.id > cursor.id))
      .slice(0, limit + 1)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan enrolment tidak tersedia.')
    let query = db.collection('classEnrollments').where('classId', '==', safeId).orderBy('studentNumber').orderBy('__name__').limit(limit + 1)
    if (cursor) query = query.startAfter(cursor.studentNumber, cursor.id)
    const snapshot = await query.get()
    rows = snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as ClassEnrollment)
  }
  const hasMore = rows.length > limit
  const items = rows.slice(0, limit).map(clone)
  return { items, ...(hasMore && items.length ? { nextCursor: encodeEnrollmentCursor(items.at(-1)!) } : {}) }
}

export async function createClassEnrollment(
  context: AuthContext,
  classId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AcademicWriteResult<ClassEnrollment>> {
  requirePermission(context, 'enrollments:manage')
  const safeId = safeClassId(classId)
  const input = parseCreateEnrollmentInput(value)
  const hash = requestHash({ classId: safeId, ...input })
  const namespace = `academic:enrollment-create:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  const enrollmentId = classEnrollmentId(safeId, input.studentId)
  let result: AcademicWriteResult<ClassEnrollment>

  if (dataMode() === 'mock') {
    const replay = mockReplay<ClassEnrollment>(namespace, hash)
    if (replay) return replay
    const classRecord = await loadClass(safeId)
    if (classRecord.status !== 'ACTIVE') conflict('ACADEMIC_CLASS_CLOSED', 'Enrolment tidak dapat ditambah pada kelas yang ditutup.')
    if ((input.programStudyId ?? classRecord.programStudyId) !== classRecord.programStudyId) forbidden('Mahasiswa berada di luar program studi kelas.')
    const existing = state.enrollments.get(enrollmentId)
    if (existing) conflict('ENROLLMENT_EXISTS', 'Enrolment sudah ada; gunakan reaktivasi bila statusnya ditarik.')
    const activeCount = [...state.enrollments.values()].filter(item => item.classId === safeId && item.status === 'ACTIVE').length
    if (activeCount >= (classRecord.capacity ?? Number.MAX_SAFE_INTEGER)) conflict('CLASS_CAPACITY_EXCEEDED', 'Kapasitas kelas telah penuh.')
    const enrollment: ClassEnrollment = {
      id: enrollmentId, classId: safeId, studentId: input.studentId, studentUid: input.studentUid,
      studentNumber: input.studentNumber, studentName: input.studentName,
      programStudyId: input.programStudyId ?? classRecord.programStudyId, periodId: classRecord.periodId,
      status: 'ACTIVE', source: 'ADMIN', sourceRef: input.sourceRef, overrideReason: input.reason,
      version: 1, createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid,
    }
    state.enrollments.set(enrollmentId, clone(enrollment))
    state.classes.set(safeId, { ...classRecord, enrollmentCount: activeCount + 1, updatedAt: now, updatedBy: context.uid })
    result = { value: enrollment, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan enrolment tidak tersedia.')
    const classRef = db.collection('academicClasses').doc(safeId)
    const enrollmentRef = db.collection('classEnrollments').doc(enrollmentId)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [previous, classSnapshot, existing] = await Promise.all([
        transaction.get(idemRef), transaction.get(classRef), transaction.get(enrollmentRef),
      ])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<ClassEnrollment>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!classSnapshot.exists) notFound('Kelas')
      if (existing.exists) conflict('ENROLLMENT_EXISTS', 'Enrolment sudah ada; gunakan reaktivasi bila statusnya ditarik.')
      const classRecord = { id: classSnapshot.id, ...classSnapshot.data() } as AcademicClassRecord
      if (classRecord.status !== 'ACTIVE') conflict('ACADEMIC_CLASS_CLOSED', 'Enrolment tidak dapat ditambah pada kelas yang ditutup.')
      if ((input.programStudyId ?? classRecord.programStudyId) !== classRecord.programStudyId) forbidden('Mahasiswa berada di luar program studi kelas.')
      const activeCount = classRecord.enrollmentCount ?? 0
      if (activeCount >= (classRecord.capacity ?? Number.MAX_SAFE_INTEGER)) conflict('CLASS_CAPACITY_EXCEEDED', 'Kapasitas kelas telah penuh.')
      const enrollment: ClassEnrollment = {
        id: enrollmentId, classId: safeId, studentId: input.studentId, studentUid: input.studentUid,
        studentNumber: input.studentNumber, studentName: input.studentName,
        programStudyId: input.programStudyId ?? classRecord.programStudyId, periodId: classRecord.periodId,
        status: 'ACTIVE', source: 'ADMIN', sourceRef: input.sourceRef, overrideReason: input.reason,
        version: 1, createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid,
      }
      const response: AcademicWriteResult<ClassEnrollment> = { value: enrollment, replayed: false }
      transaction.create(enrollmentRef, enrollment)
      transaction.update(classRef, { enrollmentCount: activeCount + 1, updatedAt: now, updatedBy: context.uid })
      transaction.create(idemRef, idempotencyDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }

  const audit = await appendAudit({ actor: context, action: 'CLASS_ENROLLMENT_OVERRIDDEN', resourceType: 'class_enrollment', resourceId: enrollmentId, after: { classId: safeId, studentId: input.studentId, source: 'ADMIN', reason: input.reason }, event })
  result.auditId = audit.id
  return result
}

export async function updateClassEnrollment(
  context: AuthContext,
  classId: string,
  studentId: string,
  value: unknown,
  idempotencyKey: string,
  event?: H3Event,
  clock = new Date(),
): Promise<AcademicWriteResult<ClassEnrollment>> {
  requirePermission(context, 'enrollments:manage')
  const safeId = safeClassId(classId)
  const safeStudent = safeStudentId(studentId)
  const input = parseUpdateEnrollmentInput(value)
  const hash = requestHash({ classId: safeId, studentId: safeStudent, ...input })
  const namespace = `academic:enrollment-update:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  const enrollmentId = classEnrollmentId(safeId, safeStudent)
  let before!: ClassEnrollment
  let result: AcademicWriteResult<ClassEnrollment>

  const updatedEnrollment = (current: ClassEnrollment): ClassEnrollment => {
    if (current.version !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Enrolment telah berubah.', { currentVersion: current.version })
    if (current.status === input.status) conflict('ENROLLMENT_STATUS_UNCHANGED', 'Status enrolment sudah sesuai permintaan.')
    return { ...current, status: input.status, overrideReason: input.reason, version: current.version + 1, updatedAt: now, updatedBy: context.uid }
  }

  if (dataMode() === 'mock') {
    const replay = mockReplay<ClassEnrollment>(namespace, hash)
    if (replay) return replay
    const classRecord = await loadClass(safeId)
    const existing = state.enrollments.get(enrollmentId)
    if (!existing) notFound('Enrolment')
    before = clone(existing)
    const updated = updatedEnrollment(before)
    const activeCount = [...state.enrollments.values()].filter(item => item.classId === safeId && item.status === 'ACTIVE').length
    if (updated.status === 'ACTIVE' && activeCount >= (classRecord.capacity ?? Number.MAX_SAFE_INTEGER)) conflict('CLASS_CAPACITY_EXCEEDED', 'Kapasitas kelas telah penuh.')
    const nextCount = Math.max(0, activeCount + (updated.status === 'ACTIVE' ? 1 : -1))
    state.enrollments.set(enrollmentId, clone(updated))
    state.classes.set(safeId, { ...classRecord, enrollmentCount: nextCount, updatedAt: now, updatedBy: context.uid })
    result = { value: updated, replayed: false }
    saveMockReplay(namespace, hash, result, now)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan enrolment tidak tersedia.')
    const classRef = db.collection('academicClasses').doc(safeId)
    const enrollmentRef = db.collection('classEnrollments').doc(enrollmentId)
    const idemRef = db.collection('idempotencyKeys').doc(opaqueId('idem', namespace))
    result = await db.runTransaction(async transaction => {
      const [previous, classSnapshot, enrollmentSnapshot] = await Promise.all([
        transaction.get(idemRef), transaction.get(classRef), transaction.get(enrollmentRef),
      ])
      if (previous.exists) {
        const data = previous.data() as IdempotencyRecord<ClassEnrollment>
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (!classSnapshot.exists) notFound('Kelas')
      if (!enrollmentSnapshot.exists) notFound('Enrolment')
      const classRecord = { id: classSnapshot.id, ...classSnapshot.data() } as AcademicClassRecord
      before = { id: enrollmentSnapshot.id, ...enrollmentSnapshot.data() } as ClassEnrollment
      const updated = updatedEnrollment(before)
      const activeCount = classRecord.enrollmentCount ?? 0
      if (updated.status === 'ACTIVE' && activeCount >= (classRecord.capacity ?? Number.MAX_SAFE_INTEGER)) conflict('CLASS_CAPACITY_EXCEEDED', 'Kapasitas kelas telah penuh.')
      const nextCount = Math.max(0, activeCount + (updated.status === 'ACTIVE' ? 1 : -1))
      const response: AcademicWriteResult<ClassEnrollment> = { value: updated, replayed: false }
      transaction.set(enrollmentRef, updated)
      transaction.update(classRef, { enrollmentCount: nextCount, updatedAt: now, updatedBy: context.uid })
      transaction.create(idemRef, idempotencyDocument(hash, response, now))
      return response
    })
    if (result.replayed) return result
  }

  const audit = await appendAudit({ actor: context, action: input.status === 'ACTIVE' ? 'CLASS_ENROLLMENT_REACTIVATED' : 'CLASS_ENROLLMENT_WITHDRAWN', resourceType: 'class_enrollment', resourceId: enrollmentId, before: { status: before.status, version: before.version }, after: { status: result.value.status, version: result.value.version, reason: input.reason }, event })
  result.auditId = audit.id
  return result
}

export function upsertMockKrsClassEnrollment(input: {
  classId: string
  studentId: string
  studentUid: string
  studentNumber: string
  studentName: string
  programStudyId: string
  periodId: string
  sourceRef: string
  actorId: string
  now: string
}): ClassEnrollment {
  const id = classEnrollmentId(input.classId, input.studentId)
  const previous = state.enrollments.get(id)
  const enrollment: ClassEnrollment = {
    id,
    classId: input.classId,
    studentId: input.studentId,
    studentUid: input.studentUid,
    studentNumber: input.studentNumber,
    studentName: input.studentName,
    programStudyId: input.programStudyId,
    periodId: input.periodId,
    status: 'ACTIVE',
    source: 'KRS',
    sourceRef: input.sourceRef,
    version: previous ? previous.version + 1 : 1,
    createdAt: previous?.createdAt ?? input.now,
    createdBy: previous?.createdBy ?? input.actorId,
    updatedAt: input.now,
    updatedBy: input.actorId,
  }
  state.enrollments.set(id, clone(enrollment))
  const classRecord = state.classes.get(input.classId)
  if (classRecord && previous?.status !== 'ACTIVE') {
    state.classes.set(input.classId, { ...classRecord, enrollmentCount: (classRecord.enrollmentCount ?? classRecord.rosterStudentIds?.length ?? 0) + 1, updatedAt: input.now, updatedBy: input.actorId })
  }
  return clone(enrollment)
}

function encodeClassCursor(record: AcademicClassRecord): string {
  return Buffer.from(JSON.stringify({ id: record.id }), 'utf8').toString('base64url')
}

function decodeClassCursor(value?: string): { id: string } | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    return { id: safeClassId(parsed.id) }
  } catch {
    invalidInput('Cursor kelas tidak valid.')
  }
}

export async function listAcademicClassesPage(context: AuthContext, query: AcademicClassListQuery = {}): Promise<AcademicClassPage> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 50)
  const cursor = decodeClassCursor(query.cursor)
  let records: AcademicClassRecord[]
  if (dataMode() === 'mock') records = [...state.classes.values()].map(clone)
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kelas tidak tersedia.')
    const pageQuery = (candidate: Query) => (cursor ? candidate.startAfter(cursor.id) : candidate).limit(limit + 1)
    if (hasRole(context, 'student')) {
      const candidates = studentCandidates(context).slice(0, 10)
      const snapshots = await Promise.all(candidates.flatMap(candidate => [
        pageQuery(db.collection('classEnrollments').where('studentUid', '==', candidate).where('status', '==', 'ACTIVE').orderBy('classId')).get(),
        pageQuery(db.collection('classEnrollments').where('studentId', '==', candidate).where('status', '==', 'ACTIVE').orderBy('classId')).get(),
      ]))
      const classIds = [...new Set(snapshots.flatMap(snapshot => snapshot.docs.map(document => String(document.data().classId))))].sort().slice(0, limit + 1)
      const classSnapshots = await Promise.all(classIds.map(id => db.collection('academicClasses').doc(id).get()))
      records = classSnapshots.filter(snapshot => snapshot.exists).map(snapshot => ({ id: snapshot.id, ...snapshot.data() }) as AcademicClassRecord)
    } else if (hasRole(context, 'lecturer', 'advisor')) {
      const snapshot = await pageQuery(db.collection('academicClasses').where('lecturerIds', 'array-contains', context.uid).orderBy('__name__')).get()
      records = snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as AcademicClassRecord)
    } else if (hasRole(context, 'academic_staff') && context.scope.programStudyIds.length) {
      const snapshots = await Promise.all(context.scope.programStudyIds.slice(0, 10).map(programStudyId => pageQuery(db.collection('academicClasses').where('programStudyId', '==', programStudyId).orderBy('__name__')).get()))
      records = [...new Map(snapshots.flatMap(snapshot => snapshot.docs).map(document => [document.id, ({ id: document.id, ...document.data() }) as AcademicClassRecord])).values()].slice(0, limit + 1)
    } else if (hasRole(context, 'administrator', 'leader')) {
      const snapshot = await pageQuery(db.collection('academicClasses').orderBy('__name__')).get()
      records = snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as AcademicClassRecord)
    } else records = []
  }
  const candidates = records
    .filter(record => !cursor || record.id > cursor.id)
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, limit + 1)
  const hasMore = candidates.length > limit
  const consumed = candidates.slice(0, limit)
  const authorized = (await Promise.all(consumed.map(async record => await canReadClass(context, record) ? record : undefined)))
    .filter((record): record is AcademicClassRecord => Boolean(record))
  const items = authorized
    .filter((record) => !query.periodId || record.periodId === query.periodId)
    .filter((record) => !query.programStudyId || record.programStudyId === query.programStudyId)
    .map(clone)
  return { items, ...(hasMore && consumed.length ? { nextCursor: encodeClassCursor(consumed.at(-1)!) } : {}) }
}

export async function listAcademicClasses(context: AuthContext, query: AcademicClassListQuery = {}): Promise<AcademicClassRecord[]> {
  return (await listAcademicClassesPage(context, query)).items
}

export async function getAcademicClassDetail(context: AuthContext, classId: string): Promise<AcademicClassDetail> {
  const safeId = safeClassId(classId)
  const record = await loadClass(safeId)
  await requireClassRead(context, record)
  const ownEnrollment = hasRole(context, 'student') && !canManageClass(context, record)
    ? await requireActiveStudentEnrollment(context, safeId)
    : undefined
  const boundedRosterLimit = normalizeFeatureProfile(process.env.APP_FEATURE_PROFILE) === 'lms-mvp' ? 50 : 2_000
  let roster: ClassRosterEntry[]
  let journals: TeachingJournal[]
  let attendance: AttendanceRecord[]
  let configuration: GradeConfiguration | undefined
  let grades: StudentGrade[] | undefined

  if (dataMode() === 'mock') {
    roster = ownEnrollment ? [enrollmentRosterEntry(ownEnrollment)] : (await loadRoster(safeId)).slice(0, boundedRosterLimit)
    journals = [...(state.journals.get(safeId)?.values() ?? [])].sort((left, right) => left.meetingNumber - right.meetingNumber).map(clone)
    attendance = [...state.attendance.values()]
      .filter(item => item.classId === safeId && (!ownEnrollment || item.studentId === ownEnrollment.studentId))
      .slice(0, boundedRosterLimit)
      .map(clone)
    if (canManageClass(context, record)) {
      configuration = clone(state.gradeConfigurations.get(safeId)!)
      grades = [...(state.grades.get(safeId)?.values() ?? [])].map(clone)
    }
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan kelas tidak tersedia.')
    const reference = db.collection('academicClasses').doc(safeId)
    const attendanceQuery = ownEnrollment
      ? reference.collection('attendance').where('studentId', '==', ownEnrollment.studentId).limit(50)
      : reference.collection('attendance').limit(boundedRosterLimit)
    const [loadedRoster, journalSnapshot, attendanceSnapshot] = await Promise.all([
      ownEnrollment ? Promise.resolve([enrollmentRosterEntry(ownEnrollment)]) : loadRoster(safeId, boundedRosterLimit),
      reference.collection('journals').orderBy('meetingNumber').get(),
      attendanceQuery.get(),
    ])
    roster = loadedRoster
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
    roster = roster.filter(entry => entry.studentId === ownEnrollment!.studentId)
    attendance = attendance.filter(item => item.studentId === ownEnrollment!.studentId)
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
    }
    state.challenges.set(challengeId, stored)
    const encodedClassId = Buffer.from(safeId, 'utf8').toString('base64url')
    result = { value: { challengeId, classId: safeId, meetingNumber: input.meetingNumber, challengeToken: `qr1.${encodedClassId}.${challengeId}.${nonce}`, expiresAt }, replayed: false }
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
      const stored: AttendanceChallenge = { id: challengeId, classId: safeId, meetingNumber: input.meetingNumber, nonceHash: requestHash(nonce), issuedAt: now, expiresAt, issuedBy: context.uid }
      const encodedClassId = Buffer.from(safeId, 'utf8').toString('base64url')
      const response: AcademicWriteResult<IssuedAttendanceChallenge> = {
        value: { challengeId, classId: safeId, meetingNumber: input.meetingNumber, challengeToken: `qr1.${encodedClassId}.${challengeId}.${nonce}`, expiresAt },
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

export function parseAttendanceChallengeToken(value: unknown): { classId: string; challengeId: string; nonce: string } {
  const token = requireString(value, 'challengeToken', { max: 500, pattern: /^qr1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/ })
  const [, encodedClassId, challengeId, nonce] = token.split('.')
  let classId: string
  try {
    classId = safeClassId(Buffer.from(encodedClassId!, 'base64url').toString('utf8'))
  } catch {
    conflict('INVALID_ATTENDANCE_CHALLENGE', 'Tantangan presensi tidak valid.')
  }
  return { classId, challengeId: challengeId!, nonce: nonce! }
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
  const token = parseAttendanceChallengeToken(body.challengeToken)
  if (token.classId !== safeId) conflict('INVALID_ATTENDANCE_CHALLENGE', 'Tantangan presensi tidak valid untuk kelas ini.')
  const hash = requestHash({ classId: safeId, challengeToken: body.challengeToken })
  const namespace = `academic:attendance-checkin:${context.uid}:${idempotencyKey}`
  const now = clock.toISOString()
  let result: AcademicWriteResult<AttendanceRecord>

  if (dataMode() === 'mock') {
    const replay = mockReplay<AttendanceRecord>(namespace, hash)
    if (replay) return replay
    const record = await loadClass(safeId)
    const studentId = (await requireActiveStudentEnrollment(context, safeId)).studentId
    const challenge = state.challenges.get(token.challengeId)
    if (!challenge || challenge.classId !== safeId) conflict('INVALID_ATTENDANCE_CHALLENGE', 'Tantangan presensi tidak valid untuk kelas ini.')
    ensureAttendanceWindow(record, challenge.meetingNumber, clock)
    if (clock.getTime() > Date.parse(challenge.expiresAt)) conflict('ATTENDANCE_CHALLENGE_EXPIRED', 'Tantangan presensi telah kedaluwarsa.')
    if (!nonceMatches(challenge.nonceHash, token.nonce)) conflict('INVALID_ATTENDANCE_CHALLENGE', 'Tantangan presensi tidak valid.')
    const key = attendanceKey(safeId, challenge.meetingNumber, studentId)
    if (state.attendance.has(key)) conflict('ATTENDANCE_NONCE_REPLAYED', 'Presensi pertemuan telah tercatat untuk mahasiswa ini.')
    const attendance = checkedInRecord(record, challenge, studentId, context, now)
    state.attendance.set(key, clone(attendance))
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
    const studentId = (await requireActiveStudentEnrollment(context, safeId)).studentId
    const rosterRef = db.collection('classEnrollments').doc(classEnrollmentId(safeId, studentId))
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
      const challenge = { id: challengeSnapshot.id, ...challengeSnapshot.data() } as AttendanceChallenge
      if (challenge.classId !== safeId) conflict('INVALID_ATTENDANCE_CHALLENGE', 'Tantangan presensi tidak valid untuk kelas ini.')
      ensureAttendanceWindow(record, challenge.meetingNumber, clock)
      if (clock.getTime() > Date.parse(challenge.expiresAt)) conflict('ATTENDANCE_CHALLENGE_EXPIRED', 'Tantangan presensi telah kedaluwarsa.')
      if (!nonceMatches(challenge.nonceHash, token.nonce)) conflict('INVALID_ATTENDANCE_CHALLENGE', 'Tantangan presensi tidak valid.')
      const actualAttendanceRef = classRef.collection('attendance').doc(opaqueId('attendance', attendanceKey(safeId, challenge.meetingNumber, studentId)))
      const attendanceSnapshot = await transaction.get(actualAttendanceRef)
      if (attendanceSnapshot.exists) conflict('ATTENDANCE_NONCE_REPLAYED', 'Presensi pertemuan telah tercatat untuk mahasiswa ini.')
      const attendance = checkedInRecord(record, challenge, studentId, context, now)
      const response: AcademicWriteResult<AttendanceRecord> = { value: attendance, replayed: false }
      transaction.create(actualAttendanceRef, attendance)
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
    const roster = state.enrollments.get(classEnrollmentId(safeId, input.studentId))
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
    const rosterRef = db.collection('classEnrollments').doc(classEnrollmentId(safeId, input.studentId))
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
    const roster = state.enrollments.get(classEnrollmentId(safeId, safeStudent))
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
    const rosterRef = db.collection('classEnrollments').doc(classEnrollmentId(safeId, safeStudent))
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
  const studentId = (await requireActiveStudentEnrollment(context, safeId)).studentId
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
    enrollments: state.enrollments,
    journals: state.journals,
    attendance: state.attendance,
    challenges: state.challenges,
    gradeConfigurations: state.gradeConfigurations,
    grades: state.grades,
    publications: state.publications,
    idempotency: state.idempotency,
  })
}
