import { FieldPath, type Query } from 'firebase-admin/firestore'
import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { AcademicClassDetail, AcademicClassRecord } from '../types/academic-classes'
import type {
  LearningActivityEvent,
  LearningAnnouncement,
  LearningAssignment,
  LearningAssignmentVersion,
  LearningFileReference,
  LearningGrade,
  LearningMaterial,
  LearningMaterialKind,
  LearningMaterialVersion,
  LearningModule,
  LearningModuleVersion,
  LearningPage,
  LearningSpace,
  LearningSpaceDetail,
  LearningSubmission,
  SafeRichContent,
} from '../types/learning'
import { appendAudit } from '../utils/audit'
import { CampusError, conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { FIRESTORE_TTL_RETENTION_MS, withFirestorePurgeAfter } from '../utils/firestore-ttl'
import { can, hasRole, requirePermission } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { getAcademicClassDetail, listActiveClassRecipientUids } from './academic-classes'
import { getPrivateFileDetail } from './files'
import { learningMockState } from './learning-mock'
import {
  learningGradeId,
  learningSubmissionAttemptId,
  learningSubmissionId,
} from './learning-record-ids'
import { enqueueLearningNotificationBatch } from './notifications'
import { fileUploadsEnabled } from '../utils/capabilities'
import { serverFeatureProfile } from '../utils/feature-profile'
import {
  cleanLearningId,
  cleanLearningIds,
  cleanLearningInstant,
  cleanLearningInteger,
  cleanLearningText,
  validateExternalLearningUrl,
  validateSafeRichContent,
} from './learning-validation'

export interface CreateLearningSpaceInput {
  kind: LearningSpace['kind']
  title: string
  description?: string
  academicClassId?: string
  programStudyId?: string
  unitId?: string
  lecturerIds?: string[]
  participantUserIds?: string[]
  gamificationAvailable?: boolean
}

export interface CreateLearningModuleInput {
  spaceId: string
  title: string
  description?: SafeRichContent
  order: number
  status: LearningModule['status']
}

export interface UpdateLearningModuleInput extends Omit<CreateLearningModuleInput, 'spaceId'> {
  expectedVersion: number
}

export interface CreateLearningMaterialInput {
  spaceId: string
  moduleId: string
  kind: LearningMaterialKind
  title: string
  summary?: string
  content?: SafeRichContent
  fileId?: string
  externalUrl?: string
  order: number
  status: LearningMaterial['status']
}

export interface UpdateLearningMaterialInput extends Omit<CreateLearningMaterialInput, 'spaceId' | 'moduleId'> {
  expectedVersion: number
}

export interface DuplicateLearningMaterialInput {
  targetModuleId: string
  title?: string
  order: number
}

export interface CreateLearningAssignmentInput {
  spaceId: string
  moduleId?: string
  title: string
  instructions: SafeRichContent
  opensAt: string
  dueAt: string
  closesAt: string
  maximumPoints: number
  maximumAttempts: number
  maximumFiles: number
  status: LearningAssignment['status']
}

export interface UpdateLearningAssignmentInput extends Omit<CreateLearningAssignmentInput, 'spaceId' | 'moduleId'> {
  expectedVersion: number
}

export interface CreateLearningAnnouncementInput {
  spaceId: string
  title: string
  body: SafeRichContent
  pinned: boolean
}

export interface UpdateLearningAnnouncementInput {
  title: string
  body: SafeRichContent
  pinned: boolean
  status: LearningAnnouncement['status']
  expectedVersion: number
}

export interface LearningSpaceAccess {
  canRead: boolean
  canManage: boolean
  studentId?: string
  academicClass?: AcademicClassRecord
}

const COLLECTION_LIMIT = 50

function clone<T>(value: T): T { return structuredClone(value) }

function requireIdempotencyKey(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(value)) invalidInput('Idempotency key tidak valid.')
  return value
}

function cleanOptionalText(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return cleanLearningText(value, label, maximum)
}

function assignedClassManager(context: AuthContext, record: AcademicClassRecord): boolean {
  return hasRole(context, 'lecturer') && record.lecturerIds.includes(context.uid)
}

function generalManager(context: AuthContext, space: LearningSpace): boolean {
  return hasRole(context, 'lecturer') && space.lecturerIds.includes(context.uid)
}

export async function learningSpaceAccess(context: AuthContext, space: LearningSpace): Promise<LearningSpaceAccess> {
  if (space.kind === 'ACADEMIC_CLASS') {
    if (!space.academicClassId) return { canRead: false, canManage: false }
    try {
      const detail = await getAcademicClassDetail(context, space.academicClassId)
      const canManage = assignedClassManager(context, detail.classRecord)
      const studentId = hasRole(context, 'student') && detail.roster.length === 1 ? detail.roster[0]?.studentId : undefined
      return { canRead: true, canManage, studentId, academicClass: detail.classRecord }
    } catch (error) {
      if (error instanceof CampusError && [403, 404].includes(error.statusCode)) return { canRead: false, canManage: false }
      throw error
    }
  }
  const canManage = generalManager(context, space)
  const scopedAcademicReader = hasRole(context, 'academic_staff')
    && Boolean(space.programStudyId)
    && (context.scope.programStudyIds.includes(space.programStudyId!) || (hasRole(context, 'administrator') && !context.scope.programStudyIds.length))
  const assignedAdvisor = hasRole(context, 'advisor') && space.lecturerIds.includes(context.uid)
  const participant = space.participantUserIds.includes(context.uid)
    || context.scope.studentIds.some(studentId => space.participantUserIds.includes(studentId))
  const canRead = canManage || scopedAcademicReader || assignedAdvisor
    || (hasRole(context, 'student', 'lecturer', 'advisor') && participant)
  return { canRead, canManage, ...(hasRole(context, 'student') && participant ? { studentId: context.scope.studentIds[0] || context.uid } : {}) }
}

export async function requireLearningSpaceRead(context: AuthContext, space: LearningSpace): Promise<LearningSpaceAccess> {
  requirePermission(context, 'learning.read')
  const access = await learningSpaceAccess(context, space)
  if (!access.canRead) forbidden('Ruang pembelajaran berada di luar lingkup akses Anda.')
  return access
}

export async function requireLearningSpaceManage(context: AuthContext, space: LearningSpace): Promise<LearningSpaceAccess> {
  requirePermission(context, 'learning.write')
  const access = await learningSpaceAccess(context, space)
  if (!access.canManage) forbidden('Anda tidak berwenang mengelola ruang pembelajaran ini.')
  return access
}

export async function loadLearningSpace(id: string): Promise<LearningSpace> {
  const safeId = cleanLearningId(id, 'spaceId')
  if (dataMode() === 'mock') {
    const record = learningMockState().spaces.get(safeId)
    if (!record) notFound('Ruang pembelajaran')
    return clone(record)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.')
  const snapshot = await db.collection('learningSpaces').doc(safeId).get()
  if (!snapshot.exists) notFound('Ruang pembelajaran')
  return { id: snapshot.id, ...snapshot.data() } as LearningSpace
}

export async function loadLearningModule(id: string): Promise<LearningModule> {
  const safeId = cleanLearningId(id, 'moduleId')
  if (dataMode() === 'mock') {
    const record = learningMockState().modules.get(safeId)
    if (!record) notFound('Modul pembelajaran')
    return clone(record)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.')
  const snapshot = await db.collection('learningModules').doc(safeId).get()
  if (!snapshot.exists) notFound('Modul pembelajaran')
  return { id: snapshot.id, ...snapshot.data() } as LearningModule
}

export async function loadLearningAssignment(id: string): Promise<LearningAssignment> {
  const safeId = cleanLearningId(id, 'assignmentId')
  if (dataMode() === 'mock') {
    const record = learningMockState().assignments.get(safeId)
    if (!record) notFound('Tugas pembelajaran')
    return clone(record)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.')
  const snapshot = await db.collection('learningAssignments').doc(safeId).get()
  if (!snapshot.exists) notFound('Tugas pembelajaran')
  return { id: snapshot.id, ...snapshot.data() } as LearningAssignment
}

async function loadLearningMaterial(id: string): Promise<LearningMaterial> {
  const safeId = cleanLearningId(id, 'materialId')
  if (dataMode() === 'mock') {
    const record = learningMockState().materials.get(safeId)
    if (!record) notFound('Materi pembelajaran')
    return clone(record)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.')
  const snapshot = await db.collection('learningMaterials').doc(safeId).get()
  if (!snapshot.exists) notFound('Materi pembelajaran')
  return { id: snapshot.id, ...snapshot.data() } as LearningMaterial
}

async function loadLearningAnnouncement(id: string): Promise<LearningAnnouncement> {
  const safeId = cleanLearningId(id, 'announcementId')
  if (dataMode() === 'mock') {
    const record = learningMockState().announcements.get(safeId)
    if (!record) notFound('Pengumuman pembelajaran')
    return clone(record)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.')
  const snapshot = await db.collection('learningAnnouncements').doc(safeId).get()
  if (!snapshot.exists) notFound('Pengumuman pembelajaran')
  return { id: snapshot.id, ...snapshot.data() } as LearningAnnouncement
}

export async function appendLearningActivity(input: Omit<LearningActivityEvent, 'id'>): Promise<LearningActivityEvent> {
  const id = opaqueId('learning_event', `${input.spaceId}:${input.actorUid}:${input.kind}:${input.resourceId}:${input.occurredAt}`)
  const event: LearningActivityEvent = { id, ...input }
  if (dataMode() === 'mock') learningMockState().activityEvents.set(id, clone(event))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan aktivitas pembelajaran tidak tersedia.')
    await db.collection('learningActivityEvents').doc(id).set(event)
  }
  return event
}

async function notifyClassLearningEvent(
  context: AuthContext,
  space: LearningSpace,
  input: {
    templateKey: string
    resourceId: string
    resourceVersion: number
    resourceTitle: string
    actionPath: string
  },
  event?: H3Event,
): Promise<void> {
  if (!space.academicClassId) return
  const recipientUids = await listActiveClassRecipientUids(space.academicClassId)
  await enqueueLearningNotificationBatch(context, {
    recipientUids,
    templateKey: input.templateKey,
    variables: { spaceTitle: space.title, resourceTitle: input.resourceTitle },
    actionPath: input.actionPath,
    eventKey: `${input.templateKey}:${input.resourceId}:v${input.resourceVersion}`,
  }, event)
}

export async function cleanLearningFileReference(context: AuthContext, fileId: string, targetSpaceId?: string): Promise<LearningFileReference> {
  const detail = await getPrivateFileDetail(context, cleanLearningId(fileId, 'fileId'))
  const currentVersion = detail.file.currentVersion
  const version = detail.versions.find(item => item.version === currentVersion)
  if (detail.file.deleted || detail.file.status !== 'CLEAN' || !currentVersion || version?.status !== 'CLEAN') conflict('LEARNING_FILE_NOT_CLEAN', 'Materi hanya dapat memakai file privat yang telah lolos pemeriksaan keamanan.')
  if (targetSpaceId && serverFeatureProfile() === 'lms-mvp'
    && !detail.file.access.learningSpaceIds?.includes(targetSpaceId)) {
    conflict('LEARNING_FILE_SCOPE_MISMATCH', 'File harus diunggah dengan lingkup ruang kelas tujuan.')
  }
  return { fileId: detail.file.id, fileVersion: currentVersion, fileName: detail.file.name, mimeType: detail.file.mimeType, sizeBytes: detail.file.sizeBytes }
}

async function mockIdempotent<T>(namespace: string, hash: string): Promise<T | undefined> {
  if (dataMode() !== 'mock') return undefined
  const previous = learningMockState().idempotency.get(namespace)
  if (!previous) return undefined
  if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
  return clone(previous.response) as T
}

function storeMockIdempotency(namespace: string, hash: string, response: unknown): void {
  learningMockState().idempotency.set(namespace, { requestHash: hash, response: clone(response) })
}

export async function createLearningSpace(
  context: AuthContext,
  input: CreateLearningSpaceInput,
  idempotencyKey: string,
  event?: H3Event,
): Promise<{ space: LearningSpace; replayed: boolean; auditId?: string }> {
  if (!can(context, 'learning.write') && !can(context, 'academic.configure')) forbidden('Anda tidak memiliki izin membuat ruang pembelajaran.')
  requireIdempotencyKey(idempotencyKey)
  if (!['ACADEMIC_CLASS', 'GENERAL', 'MOOC'].includes(input.kind)) invalidInput('Jenis ruang pembelajaran tidak valid.')
  const normalized = {
    kind: input.kind,
    title: cleanLearningText(input.title, 'Judul ruang', 160),
    description: cleanOptionalText(input.description, 'Deskripsi ruang', 1_000),
    academicClassId: input.academicClassId ? cleanLearningId(input.academicClassId, 'academicClassId') : undefined,
    programStudyId: input.programStudyId ? cleanLearningId(input.programStudyId, 'programStudyId') : undefined,
    unitId: input.unitId ? cleanLearningId(input.unitId, 'unitId') : undefined,
    lecturerIds: cleanLearningIds(input.lecturerIds ?? [], 'lecturerIds', 20),
    participantUserIds: cleanLearningIds(input.participantUserIds ?? [], 'participantUserIds', 500),
    gamificationAvailable: Boolean(input.gamificationAvailable),
  }
  let classDetail: AcademicClassDetail | undefined
  if (normalized.kind === 'ACADEMIC_CLASS') {
    if (!normalized.academicClassId) invalidInput('academicClassId wajib untuk ruang kelas akademik.')
    classDetail = await getAcademicClassDetail(context, normalized.academicClassId)
    if (!assignedClassManager(context, classDetail.classRecord)) forbidden('Anda tidak berwenang membuat ruang untuk kelas ini.')
  } else {
    if (normalized.academicClassId) invalidInput('Ruang GENERAL/MOOC tidak menerima academicClassId.')
    if (!normalized.programStudyId) invalidInput('programStudyId wajib untuk ruang GENERAL/MOOC.')
    if (!hasRole(context, 'administrator') && !(hasRole(context, 'academic_staff') && context.scope.programStudyIds.includes(normalized.programStudyId))) forbidden('Pembuatan ruang berada di luar lingkup Anda.')
  }
  const hash = requestHash(normalized)
  const namespace = `space:create:${idempotencyKey}`
  const replay = await mockIdempotent<{ space: LearningSpace; replayed: boolean }>(namespace, hash)
  if (replay) return { ...replay, replayed: true }
  const idSeed = classDetail ? `class:${classDetail.classRecord.id}` : `${context.uid}:${idempotencyKey}`
  const id = opaqueId('learning_space', idSeed)
  const now = new Date().toISOString()
  const record: LearningSpace = {
    id, kind: normalized.kind, title: normalized.title, description: normalized.description,
    ...(classDetail ? {
      academicClassId: classDetail.classRecord.id, courseCode: classDetail.classRecord.courseCode, section: classDetail.classRecord.section,
      periodId: classDetail.classRecord.periodId, programStudyId: classDetail.classRecord.programStudyId, unitId: classDetail.classRecord.unitId,
      lecturerIds: [...classDetail.classRecord.lecturerIds], participantUserIds: [],
    } : {
      programStudyId: normalized.programStudyId, unitId: normalized.unitId,
      lecturerIds: normalized.lecturerIds.length ? normalized.lecturerIds : [context.uid], participantUserIds: normalized.participantUserIds,
    }),
    status: 'ACTIVE', gamificationAvailable: normalized.gamificationAvailable, version: 1,
    createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid,
  }
  const response = { space: record, replayed: false }
  if (dataMode() === 'mock') {
    if (record.academicClassId && [...learningMockState().spaces.values()].some(space => space.academicClassId === record.academicClassId)) conflict('LEARNING_SPACE_EXISTS', 'Ruang pembelajaran untuk kelas ini sudah ada.')
    learningMockState().spaces.set(id, clone(record)); storeMockIdempotency(namespace, hash, response)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.')
    if (record.academicClassId) {
      const existing = await db.collection('learningSpaces').where('academicClassId', '==', record.academicClassId).limit(1).get()
      if (!existing.empty) conflict('LEARNING_SPACE_EXISTS', 'Ruang pembelajaran untuk kelas ini sudah ada.')
    }
    const idem = db.collection('learningIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async transaction => {
      const prior = await transaction.get(idem)
      if (prior.exists) {
        const stored = prior.data() as { requestHash: string; response: typeof response }
        if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return { ...stored.response, replayed: true }
      }
      transaction.create(db.collection('learningSpaces').doc(id), record)
      transaction.create(idem, withFirestorePurgeAfter(
        { requestHash: hash, response, createdAt: now },
        now,
        FIRESTORE_TTL_RETENTION_MS.idempotency,
      ))
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'LEARNING_SPACE_CREATED', resourceType: 'learning_space', resourceId: id, after: { kind: record.kind, academicClassId: record.academicClassId, programStudyId: record.programStudyId }, event })
  return { ...response, auditId: audit.id }
}

function encodeSpaceCursor(space: LearningSpace): string {
  return Buffer.from(JSON.stringify({ updatedAt: space.updatedAt, id: space.id }), 'utf8').toString('base64url')
}

function decodeSpaceCursor(value?: string): { updatedAt: string; id: string } | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    return {
      updatedAt: cleanLearningText(parsed.updatedAt, 'cursor.updatedAt', 48),
      id: cleanLearningId(parsed.id, 'cursor.id'),
    }
  } catch {
    invalidInput('Cursor ruang pembelajaran tidak valid.')
  }
}

function afterSpaceCursor(space: LearningSpace, cursor?: { updatedAt: string; id: string }): boolean {
  if (!cursor) return true
  return space.updatedAt < cursor.updatedAt || (space.updatedAt === cursor.updatedAt && space.id > cursor.id)
}

export async function listLearningSpacesPage(
  context: AuthContext,
  options: { limit?: number; cursor?: string } = {},
): Promise<LearningPage<LearningSpace>> {
  requirePermission(context, 'learning.read')
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 50)
  const cursor = decodeSpaceCursor(options.cursor)
  let spaces: LearningSpace[]
  if (dataMode() === 'mock') spaces = [...learningMockState().spaces.values()].map(clone)
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.')
    const candidateLimit = Math.min(limit * 2 + 1, 101)
    const pageSpaceQuery = (candidate: Query) => {
      let paged = candidate.orderBy('updatedAt', 'desc').orderBy(FieldPath.documentId(), 'asc')
      if (cursor) paged = paged.startAfter(cursor.updatedAt, cursor.id)
      return paged.limit(candidateLimit)
    }
    if (hasRole(context, 'student')) {
      const candidates = [...new Set([context.uid, ...context.scope.studentIds])].slice(0, 10)
      const enrollmentSnapshots = await Promise.all(candidates.flatMap(candidate => [
        db.collection('classEnrollments').where('studentUid', '==', candidate).where('status', '==', 'ACTIVE').limit(candidateLimit).get(),
        db.collection('classEnrollments').where('studentId', '==', candidate).where('status', '==', 'ACTIVE').limit(candidateLimit).get(),
      ]))
      const classIds = [...new Set(enrollmentSnapshots.flatMap(snapshot => snapshot.docs.map(document => String(document.data().classId))))]
      const [classSpaces, participantSnapshots] = await Promise.all([
        Promise.all(classIds.slice(0, candidateLimit).map(id => db.collection('learningSpaces').doc(id).get())),
        Promise.all(candidates.map(candidate => pageSpaceQuery(db.collection('learningSpaces').where('participantUserIds', 'array-contains', candidate)).get())),
      ])
      spaces = [
        ...classSpaces.filter(snapshot => snapshot.exists).map(snapshot => ({ id: snapshot.id, ...snapshot.data() }) as LearningSpace),
        ...participantSnapshots.flatMap(snapshot => snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as LearningSpace)),
      ]
    } else if (hasRole(context, 'lecturer', 'advisor')) {
      const [managed, participant] = await Promise.all([
        pageSpaceQuery(db.collection('learningSpaces').where('lecturerIds', 'array-contains', context.uid)).get(),
        pageSpaceQuery(db.collection('learningSpaces').where('participantUserIds', 'array-contains', context.uid)).get(),
      ])
      spaces = [...managed.docs, ...participant.docs].map(document => ({ id: document.id, ...document.data() }) as LearningSpace)
    } else if (hasRole(context, 'academic_staff') && context.scope.programStudyIds.length) {
      const snapshots = await Promise.all(context.scope.programStudyIds.slice(0, 10).map(programStudyId => pageSpaceQuery(db.collection('learningSpaces').where('programStudyId', '==', programStudyId)).get()))
      spaces = snapshots.flatMap(snapshot => snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as LearningSpace))
    } else if ((serverFeatureProfile() === 'lms-mvp' && hasRole(context, 'administrator')) || (hasRole(context, 'academic_staff') && hasRole(context, 'administrator') && !context.scope.programStudyIds.length)) {
      const snapshot = await pageSpaceQuery(db.collection('learningSpaces')).get()
      spaces = snapshot.docs.map(document => ({ id: document.id, ...document.data() }) as LearningSpace)
    } else spaces = []
  }
  spaces = [...new Map(spaces.map(space => [space.id, space])).values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .filter(space => afterSpaceCursor(space, cursor))
  const visible: LearningSpace[] = []
  for (const space of spaces) {
    if ((await learningSpaceAccess(context, space)).canRead) visible.push(space)
    if (visible.length > limit) break
  }
  const hasMore = visible.length > limit
  const items = visible.slice(0, limit).map(clone)
  return { items, ...(hasMore && items.length ? { nextCursor: encodeSpaceCursor(items.at(-1)!) } : {}) }
}

export async function listLearningSpaces(context: AuthContext, options: { limit?: number; cursor?: string } = {}): Promise<LearningSpace[]> {
  return (await listLearningSpacesPage(context, options)).items
}

async function listSpaceRecords<T>(spaceId: string, collection: string, mockValues: () => T[]): Promise<T[]> {
  if (dataMode() === 'mock') return mockValues().slice(0, COLLECTION_LIMIT).map(clone)
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.')
  const snapshot = await db.collection(collection).where('spaceId', '==', spaceId).limit(COLLECTION_LIMIT).get()
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as T)
}

function assertOwnSubmission(
  submission: LearningSubmission,
  assignment: LearningAssignment,
  studentId: string,
  studentUid: string,
): LearningSubmission {
  if (
    submission.id !== learningSubmissionId(assignment.id, studentId)
    || submission.assignmentId !== assignment.id
    || submission.spaceId !== assignment.spaceId
    || submission.studentId !== studentId
    || submission.studentUid !== studentUid
  ) {
    conflict('LEARNING_RECORD_INTEGRITY', 'Data pengumpulan tugas tidak konsisten.')
  }
  return submission
}

function assertOwnGrade(
  grade: LearningGrade,
  assignment: LearningAssignment,
  studentId: string,
  submission: LearningSubmission | undefined,
): LearningGrade {
  const validAttemptIds = new Set(submission
    ? Array.from(
        { length: submission.attemptCount },
        (_, index) => learningSubmissionAttemptId(submission.id, index + 1),
      )
    : [])
  if (
    grade.id !== learningGradeId(assignment.id, studentId)
    || grade.assignmentId !== assignment.id
    || grade.spaceId !== assignment.spaceId
    || grade.studentId !== studentId
    || !submission
    || !validAttemptIds.has(grade.attemptId)
  ) {
    conflict('LEARNING_RECORD_INTEGRITY', 'Data nilai tugas tidak konsisten.')
  }
  return grade
}

async function loadOwnSpaceRecords(
  assignments: LearningAssignment[],
  studentId: string,
  studentUid: string,
): Promise<{ submissions: LearningSubmission[]; grades: LearningGrade[] }> {
  if (!assignments.length) return { submissions: [], grades: [] }
  if (dataMode() === 'mock') {
    const state = learningMockState()
    const submissions = assignments.flatMap(assignment => {
      const record = state.submissions.get(learningSubmissionId(assignment.id, studentId))
      return record ? [assertOwnSubmission(clone(record), assignment, studentId, studentUid)] : []
    })
    const grades = assignments.flatMap(assignment => {
      const record = state.grades.get(learningGradeId(assignment.id, studentId))
      const submission = submissions.find(item => item.assignmentId === assignment.id)
      return record ? [assertOwnGrade(clone(record), assignment, studentId, submission)] : []
    })
    return { submissions, grades }
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.')
  const submissionRefs = assignments.map(assignment =>
    db.collection('learningSubmissions').doc(learningSubmissionId(assignment.id, studentId)))
  const gradeRefs = assignments.map(assignment =>
    db.collection('learningGrades').doc(learningGradeId(assignment.id, studentId)))
  const [submissionSnapshots, gradeSnapshots] = await Promise.all([
    db.getAll(...submissionRefs),
    db.getAll(...gradeRefs),
  ])
  const submissions = submissionSnapshots.flatMap((snapshot, index) =>
    snapshot.exists
      ? [assertOwnSubmission(
          { id: snapshot.id, ...snapshot.data() } as LearningSubmission,
          assignments[index]!,
          studentId,
          studentUid,
        )]
      : [])
  const grades = gradeSnapshots.flatMap((snapshot, index) =>
    snapshot.exists
      ? [assertOwnGrade(
          { id: snapshot.id, ...snapshot.data() } as LearningGrade,
          assignments[index]!,
          studentId,
          submissions.find(item => item.assignmentId === assignments[index]!.id),
        )]
      : [])
  return { submissions, grades }
}

export async function getLearningSpaceDetail(context: AuthContext, spaceId: string): Promise<LearningSpaceDetail> {
  const space = await loadLearningSpace(spaceId)
  const access = await requireLearningSpaceRead(context, space)
  const [modules, materials, assignments, announcements] = await Promise.all([
    listSpaceRecords(space.id, 'learningModules', () => [...learningMockState().modules.values()].filter(item => item.spaceId === space.id)),
    listSpaceRecords(space.id, 'learningMaterials', () => [...learningMockState().materials.values()].filter(item => item.spaceId === space.id)),
    listSpaceRecords(space.id, 'learningAssignments', () => [...learningMockState().assignments.values()].filter(item => item.spaceId === space.id)),
    listSpaceRecords(space.id, 'learningAnnouncements', () => [...learningMockState().announcements.values()].filter(item => item.spaceId === space.id)),
  ]) as [LearningModule[], LearningMaterial[], LearningAssignment[], LearningAnnouncement[]]
  const ownStudentId = access.studentId
  const visibleAssignments = assignments
    .filter(item => access.canManage || item.status === 'PUBLISHED')
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
  const ownRecords = ownStudentId
    ? await loadOwnSpaceRecords(visibleAssignments, ownStudentId, context.uid)
    : { submissions: [], grades: [] }
  return {
    space,
    modules: modules.filter(item => access.canManage || item.status === 'PUBLISHED').sort((a, b) => a.order - b.order),
    materials: materials.filter(item => access.canManage || item.status === 'PUBLISHED').sort((a, b) => a.order - b.order),
    assignments: visibleAssignments,
    announcements: announcements.filter(item => access.canManage || item.status === 'PUBLISHED').sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt)),
    ownSubmissions: ownRecords.submissions,
    ownGrades: ownRecords.grades.filter(item => item.status === 'PUBLISHED'),
    canManage: access.canManage,
  }
}

function normalizeModule(input: Omit<CreateLearningModuleInput, 'spaceId'>) {
  if (!['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(input.status)) invalidInput('Status modul tidak valid.')
  return {
    title: cleanLearningText(input.title, 'Judul modul', 160),
    description: input.description ? validateSafeRichContent(input.description, 'Deskripsi modul', 5_000) : undefined,
    order: cleanLearningInteger(input.order, 'Urutan modul', 1, 1_000), status: input.status,
  }
}

function moduleSnapshot(record: LearningModule): LearningModuleVersion {
  return { id: `${record.id}_v${record.currentVersion}`, moduleId: record.id, spaceId: record.spaceId, version: record.currentVersion, title: record.title, description: record.description, order: record.order, status: record.status, createdAt: record.updatedAt, createdBy: record.updatedBy }
}

export async function createLearningModule(context: AuthContext, input: CreateLearningModuleInput, idempotencyKey: string, event?: H3Event): Promise<{ module: LearningModule; definition: LearningModuleVersion; replayed: boolean; auditId?: string }> {
  requireIdempotencyKey(idempotencyKey)
  const space = await loadLearningSpace(input.spaceId); await requireLearningSpaceManage(context, space)
  const normalized = normalizeModule(input)
  const hash = requestHash({ spaceId: space.id, ...normalized }); const namespace = `module:create:${idempotencyKey}`
  const replay = await mockIdempotent<{ module: LearningModule; definition: LearningModuleVersion; replayed: boolean }>(namespace, hash)
  if (replay) return { ...replay, replayed: true }
  const now = new Date().toISOString(); const id = opaqueId('learning_module', `${space.id}:${idempotencyKey}`)
  const module: LearningModule = { id, spaceId: space.id, ...normalized, currentVersion: 1, version: 1, createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid }
  const definition = moduleSnapshot(module); const response = { module, definition, replayed: false }
  if (dataMode() === 'mock') { learningMockState().modules.set(id, clone(module)); learningMockState().moduleVersions.set(definition.id, clone(definition)); storeMockIdempotency(namespace, hash, response) }
  else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.')
    const idem = db.collection('learningIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async transaction => {
      const prior = await transaction.get(idem)
      if (prior.exists) { const stored = prior.data() as { requestHash: string; response: typeof response }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } }
      transaction.create(db.collection('learningModules').doc(id), module); transaction.create(db.collection('learningModuleVersions').doc(definition.id), definition); transaction.create(idem, withFirestorePurgeAfter({ requestHash: hash, response, createdAt: now }, now, FIRESTORE_TTL_RETENTION_MS.idempotency)); return response
    }); if (result.replayed) return result
  }
  if (module.status === 'PUBLISHED') await appendLearningActivity({ spaceId: space.id, actorUid: context.uid, kind: 'MODULE_PUBLISHED', resourceId: id, label: module.title, occurredAt: now })
  const audit = await appendAudit({ actor: context, action: 'LEARNING_MODULE_CREATED', resourceType: 'learning_module', resourceId: id, after: { spaceId: space.id, status: module.status, version: 1 }, event })
  return { ...response, auditId: audit.id }
}

export async function updateLearningModule(context: AuthContext, id: string, input: UpdateLearningModuleInput, event?: H3Event): Promise<{ module: LearningModule; definition: LearningModuleVersion; auditId: string }> {
  const current = await loadLearningModule(id); const space = await loadLearningSpace(current.spaceId); await requireLearningSpaceManage(context, space)
  const expectedVersion = cleanLearningInteger(input.expectedVersion, 'expectedVersion', 1, 100_000); const normalized = normalizeModule(input)
  const transitions: Record<LearningModule['status'], LearningModule['status'][]> = {
    DRAFT: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
    PUBLISHED: ['PUBLISHED', 'ARCHIVED'],
    ARCHIVED: ['ARCHIVED'],
  }
  if (!transitions[current.status].includes(normalized.status)) conflict('INVALID_STATE_TRANSITION', 'Status modul tidak dapat dikembalikan ke tahap sebelumnya.')
  const now = new Date().toISOString(); let module: LearningModule; let definition: LearningModuleVersion
  if (dataMode() === 'mock') {
    const fresh = learningMockState().modules.get(current.id); if (!fresh) notFound('Modul pembelajaran'); if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Modul telah berubah.', { currentVersion: fresh.version })
    module = { ...fresh, ...normalized, currentVersion: fresh.currentVersion + 1, version: fresh.version + 1, updatedAt: now, updatedBy: context.uid }; definition = moduleSnapshot(module)
    learningMockState().modules.set(id, clone(module)); learningMockState().moduleVersions.set(definition.id, clone(definition))
  } else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.'); const reference = db.collection('learningModules').doc(id)
    ;({ module, definition } = await db.runTransaction(async transaction => { const snapshot = await transaction.get(reference); if (!snapshot.exists) notFound('Modul pembelajaran'); const fresh = { id: snapshot.id, ...snapshot.data() } as LearningModule; if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Modul telah berubah.', { currentVersion: fresh.version }); const next: LearningModule = { ...fresh, ...normalized, currentVersion: fresh.currentVersion + 1, version: fresh.version + 1, updatedAt: now, updatedBy: context.uid }; const version = moduleSnapshot(next); transaction.set(reference, next); transaction.create(db.collection('learningModuleVersions').doc(version.id), version); return { module: next, definition: version } }))
  }
  if (current.status !== 'PUBLISHED' && module.status === 'PUBLISHED') await appendLearningActivity({ spaceId: space.id, actorUid: context.uid, kind: 'MODULE_PUBLISHED', resourceId: id, label: module.title, occurredAt: now })
  const audit = await appendAudit({ actor: context, action: 'LEARNING_MODULE_UPDATED', resourceType: 'learning_module', resourceId: id, before: { version: expectedVersion, status: current.status }, after: { version: module.version, definitionVersion: module.currentVersion, status: module.status }, event })
  return { module, definition, auditId: audit.id }
}

async function normalizeMaterial(context: AuthContext, input: Omit<CreateLearningMaterialInput, 'spaceId' | 'moduleId'>, spaceId: string) {
  if (!['RICH_TEXT', 'FILE', 'EXTERNAL_LINK'].includes(input.kind)) invalidInput('Jenis materi tidak valid.')
  if (!['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(input.status)) invalidInput('Status materi tidak valid.')
  const common = { kind: input.kind, title: cleanLearningText(input.title, 'Judul materi', 180), summary: cleanOptionalText(input.summary, 'Ringkasan materi', 500), order: cleanLearningInteger(input.order, 'Urutan materi', 1, 10_000), status: input.status }
  if (input.kind === 'RICH_TEXT') {
    if (!input.content || input.fileId || input.externalUrl) invalidInput('Materi teks harus memiliki content tanpa file atau URL.')
    return { ...common, content: validateSafeRichContent(input.content, 'Isi materi') }
  }
  if (input.kind === 'FILE') {
    if (!input.fileId || input.content || input.externalUrl) invalidInput('Materi file harus memiliki satu fileId CLEAN.')
    return { ...common, file: await cleanLearningFileReference(context, input.fileId, spaceId) }
  }
  if (!input.externalUrl || input.content || input.fileId) invalidInput('Materi tautan harus memiliki satu externalUrl.')
  return { ...common, externalUrl: validateExternalLearningUrl(input.externalUrl) }
}

function materialSnapshot(record: LearningMaterial): LearningMaterialVersion {
  return { id: `${record.id}_v${record.currentVersion}`, materialId: record.id, spaceId: record.spaceId, moduleId: record.moduleId, version: record.currentVersion, kind: record.kind, title: record.title, summary: record.summary, content: record.content, file: record.file, externalUrl: record.externalUrl, order: record.order, status: record.status, duplicatedFromId: record.duplicatedFromId, createdAt: record.updatedAt, createdBy: record.updatedBy }
}

export async function createLearningMaterial(context: AuthContext, input: CreateLearningMaterialInput, idempotencyKey: string, event?: H3Event): Promise<{ material: LearningMaterial; definition: LearningMaterialVersion; replayed: boolean; auditId?: string }> {
  requireIdempotencyKey(idempotencyKey); const module = await loadLearningModule(input.moduleId); const space = await loadLearningSpace(input.spaceId)
  if (module.spaceId !== space.id) invalidInput('Modul tidak berada pada ruang tujuan.'); await requireLearningSpaceManage(context, space)
  const normalized = await normalizeMaterial(context, input, space.id); const hash = requestHash({ spaceId: space.id, moduleId: module.id, ...normalized }); const namespace = `material:create:${idempotencyKey}`
  const replay = await mockIdempotent<{ material: LearningMaterial; definition: LearningMaterialVersion; replayed: boolean }>(namespace, hash); if (replay) return { ...replay, replayed: true }
  const now = new Date().toISOString(); const id = opaqueId('learning_material', `${module.id}:${idempotencyKey}`)
  const material: LearningMaterial = { id, spaceId: space.id, moduleId: module.id, ...normalized, currentVersion: 1, version: 1, createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid }
  const definition = materialSnapshot(material); const response = { material, definition, replayed: false }
  if (dataMode() === 'mock') { learningMockState().materials.set(id, clone(material)); learningMockState().materialVersions.set(definition.id, clone(definition)); storeMockIdempotency(namespace, hash, response) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.'); const idem = db.collection('learningIdempotency').doc(opaqueId('idem', namespace)); const result = await db.runTransaction(async transaction => { const prior = await transaction.get(idem); if (prior.exists) { const stored = prior.data() as { requestHash: string; response: typeof response }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } } transaction.create(db.collection('learningMaterials').doc(id), material); transaction.create(db.collection('learningMaterialVersions').doc(definition.id), definition); transaction.create(idem, withFirestorePurgeAfter({ requestHash: hash, response, createdAt: now }, now, FIRESTORE_TTL_RETENTION_MS.idempotency)); return response }); if (result.replayed) return result }
  if (material.status === 'PUBLISHED') {
    await appendLearningActivity({ spaceId: space.id, actorUid: context.uid, kind: 'MATERIAL_PUBLISHED', resourceId: id, label: material.title, occurredAt: now })
    await notifyClassLearningEvent(context, space, {
      templateKey: 'learning-material-published',
      resourceId: material.id,
      resourceVersion: material.version,
      resourceTitle: material.title,
      actionPath: `/pembelajaran/${space.id}/materi`,
    }, event)
  }
  const audit = await appendAudit({ actor: context, action: 'LEARNING_MATERIAL_CREATED', resourceType: 'learning_material', resourceId: id, after: { spaceId: space.id, moduleId: module.id, kind: material.kind, fileId: material.file?.fileId, fileVersion: material.file?.fileVersion, status: material.status }, event })
  return { ...response, auditId: audit.id }
}

export async function updateLearningMaterial(context: AuthContext, id: string, input: UpdateLearningMaterialInput, event?: H3Event): Promise<{ material: LearningMaterial; definition: LearningMaterialVersion; auditId: string }> {
  const current = await loadLearningMaterial(id); const space = await loadLearningSpace(current.spaceId); await requireLearningSpaceManage(context, space)
  const expectedVersion = cleanLearningInteger(input.expectedVersion, 'expectedVersion', 1, 100_000); const normalized = await normalizeMaterial(context, input, space.id)
  const transitions: Record<LearningMaterial['status'], LearningMaterial['status'][]> = {
    DRAFT: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
    PUBLISHED: ['PUBLISHED', 'ARCHIVED'],
    ARCHIVED: ['ARCHIVED'],
  }
  if (!transitions[current.status].includes(normalized.status)) conflict('INVALID_STATE_TRANSITION', 'Status materi tidak dapat dikembalikan ke tahap sebelumnya.')
  const now = new Date().toISOString(); let material: LearningMaterial; let definition: LearningMaterialVersion
  if (dataMode() === 'mock') { const fresh = learningMockState().materials.get(id); if (!fresh) notFound('Materi pembelajaran'); if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Materi telah berubah.', { currentVersion: fresh.version }); material = { ...fresh, ...normalized, currentVersion: fresh.currentVersion + 1, version: fresh.version + 1, updatedAt: now, updatedBy: context.uid }; definition = materialSnapshot(material); learningMockState().materials.set(id, clone(material)); learningMockState().materialVersions.set(definition.id, clone(definition)) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.'); const reference = db.collection('learningMaterials').doc(id); ;({ material, definition } = await db.runTransaction(async transaction => { const snapshot = await transaction.get(reference); if (!snapshot.exists) notFound('Materi pembelajaran'); const fresh = { id: snapshot.id, ...snapshot.data() } as LearningMaterial; if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Materi telah berubah.', { currentVersion: fresh.version }); const next: LearningMaterial = { ...fresh, ...normalized, currentVersion: fresh.currentVersion + 1, version: fresh.version + 1, updatedAt: now, updatedBy: context.uid }; const version = materialSnapshot(next); transaction.set(reference, next); transaction.create(db.collection('learningMaterialVersions').doc(version.id), version); return { material: next, definition: version } })) }
  if (current.status !== 'PUBLISHED' && material.status === 'PUBLISHED') {
    await appendLearningActivity({ spaceId: space.id, actorUid: context.uid, kind: 'MATERIAL_PUBLISHED', resourceId: id, label: material.title, occurredAt: now })
    await notifyClassLearningEvent(context, space, {
      templateKey: 'learning-material-published',
      resourceId: material.id,
      resourceVersion: material.version,
      resourceTitle: material.title,
      actionPath: `/pembelajaran/${space.id}/materi`,
    }, event)
  }
  const audit = await appendAudit({ actor: context, action: 'LEARNING_MATERIAL_UPDATED', resourceType: 'learning_material', resourceId: id, before: { version: expectedVersion }, after: { version: material.version, definitionVersion: material.currentVersion, fileId: material.file?.fileId, fileVersion: material.file?.fileVersion, status: material.status }, event })
  return { material, definition, auditId: audit.id }
}

export async function duplicateLearningMaterial(context: AuthContext, id: string, input: DuplicateLearningMaterialInput, idempotencyKey: string, event?: H3Event): Promise<{ material: LearningMaterial; definition: LearningMaterialVersion; replayed: boolean; auditId?: string }> {
  const source = await loadLearningMaterial(id); const targetModule = await loadLearningModule(input.targetModuleId); const targetSpace = await loadLearningSpace(targetModule.spaceId); await requireLearningSpaceManage(context, targetSpace)
  if (source.file) await cleanLearningFileReference(context, source.file.fileId, targetSpace.id)
  const result = await createLearningMaterial(context, { spaceId: targetSpace.id, moduleId: targetModule.id, kind: source.kind, title: input.title ? cleanLearningText(input.title, 'Judul materi', 180) : source.title, summary: source.summary, content: source.content, fileId: source.file?.fileId, externalUrl: source.externalUrl, order: input.order, status: source.status }, idempotencyKey, event)
  const duplicated = { ...result.material, duplicatedFromId: source.id }; const definition = materialSnapshot(duplicated)
  if (!result.replayed) {
    if (dataMode() === 'mock') { learningMockState().materials.set(duplicated.id, clone(duplicated)); learningMockState().materialVersions.set(definition.id, clone(definition)) }
    else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.'); await db.collection('learningMaterials').doc(duplicated.id).set(duplicated); await db.collection('learningMaterialVersions').doc(definition.id).set(definition) }
  }
  return { ...result, material: duplicated, definition }
}

function normalizeAssignment(input: Omit<CreateLearningAssignmentInput, 'spaceId' | 'moduleId'>) {
  if (!['DRAFT', 'PUBLISHED', 'CLOSED'].includes(input.status)) invalidInput('Status tugas tidak valid.')
  const opensAt = cleanLearningInstant(input.opensAt, 'opensAt'), dueAt = cleanLearningInstant(input.dueAt, 'dueAt'), closesAt = cleanLearningInstant(input.closesAt, 'closesAt')
  if (!(Date.parse(opensAt) < Date.parse(dueAt) && Date.parse(dueAt) <= Date.parse(closesAt))) invalidInput('Jendela tugas harus memenuhi opensAt < dueAt <= closesAt.')
  const maximumFiles = cleanLearningInteger(input.maximumFiles, 'File maksimum', 0, 10)
  if (!fileUploadsEnabled() && maximumFiles > 0) {
    invalidInput('Lampiran file belum tersedia pada paket awal. Atur file maksimum menjadi 0.')
  }
  return { title: cleanLearningText(input.title, 'Judul tugas', 180), instructions: validateSafeRichContent(input.instructions, 'Instruksi tugas'), opensAt, dueAt, closesAt, maximumPoints: cleanLearningInteger(input.maximumPoints, 'Nilai maksimum', 1, 1_000), maximumAttempts: cleanLearningInteger(input.maximumAttempts, 'Percobaan maksimum', 1, 10), maximumFiles, status: input.status }
}

function assignmentSnapshot(record: LearningAssignment): LearningAssignmentVersion { return { id: `${record.id}_v${record.currentVersion}`, assignmentId: record.id, spaceId: record.spaceId, version: record.currentVersion, title: record.title, instructions: record.instructions, opensAt: record.opensAt, dueAt: record.dueAt, closesAt: record.closesAt, maximumPoints: record.maximumPoints, maximumAttempts: record.maximumAttempts, maximumFiles: record.maximumFiles, status: record.status, createdAt: record.updatedAt, createdBy: record.updatedBy } }

export async function createLearningAssignment(context: AuthContext, input: CreateLearningAssignmentInput, idempotencyKey: string, event?: H3Event): Promise<{ assignment: LearningAssignment; definition: LearningAssignmentVersion; replayed: boolean; auditId?: string }> {
  requireIdempotencyKey(idempotencyKey); const space = await loadLearningSpace(input.spaceId); await requireLearningSpaceManage(context, space)
  const moduleId = input.moduleId ? cleanLearningId(input.moduleId, 'moduleId') : undefined; if (moduleId && (await loadLearningModule(moduleId)).spaceId !== space.id) invalidInput('Modul tugas tidak berada pada ruang tujuan.')
  const normalized = normalizeAssignment(input); const hash = requestHash({ spaceId: space.id, moduleId, ...normalized }); const namespace = `assignment:create:${idempotencyKey}`
  const replay = await mockIdempotent<{ assignment: LearningAssignment; definition: LearningAssignmentVersion; replayed: boolean }>(namespace, hash); if (replay) return { ...replay, replayed: true }
  const now = new Date().toISOString(), id = opaqueId('learning_assignment', `${space.id}:${idempotencyKey}`); const assignment: LearningAssignment = { id, spaceId: space.id, moduleId, ...normalized, currentVersion: 1, version: 1, createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid }; const definition = assignmentSnapshot(assignment); const response = { assignment, definition, replayed: false }
  if (dataMode() === 'mock') { learningMockState().assignments.set(id, clone(assignment)); learningMockState().assignmentVersions.set(definition.id, clone(definition)); storeMockIdempotency(namespace, hash, response) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.'); const idem = db.collection('learningIdempotency').doc(opaqueId('idem', namespace)); const result = await db.runTransaction(async transaction => { const prior = await transaction.get(idem); if (prior.exists) { const stored = prior.data() as { requestHash: string; response: typeof response }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } } transaction.create(db.collection('learningAssignments').doc(id), assignment); transaction.create(db.collection('learningAssignmentVersions').doc(definition.id), definition); transaction.create(idem, withFirestorePurgeAfter({ requestHash: hash, response, createdAt: now }, now, FIRESTORE_TTL_RETENTION_MS.idempotency)); return response }); if (result.replayed) return result }
  if (assignment.status === 'PUBLISHED') {
    await appendLearningActivity({ spaceId: space.id, actorUid: context.uid, kind: 'ASSIGNMENT_PUBLISHED', resourceId: id, label: assignment.title, occurredAt: now })
    await notifyClassLearningEvent(context, space, {
      templateKey: 'learning-assignment-published',
      resourceId: assignment.id,
      resourceVersion: assignment.version,
      resourceTitle: assignment.title,
      actionPath: `/pembelajaran/${space.id}/tugas/${assignment.id}`,
    }, event)
  }
  const audit = await appendAudit({ actor: context, action: 'LEARNING_ASSIGNMENT_CREATED', resourceType: 'learning_assignment', resourceId: id, after: { spaceId: space.id, opensAt: assignment.opensAt, dueAt: assignment.dueAt, closesAt: assignment.closesAt, status: assignment.status, version: 1 }, event }); return { ...response, auditId: audit.id }
}

export async function updateLearningAssignment(context: AuthContext, id: string, input: UpdateLearningAssignmentInput, event?: H3Event): Promise<{ assignment: LearningAssignment; definition: LearningAssignmentVersion; auditId: string }> {
  const current = await loadLearningAssignment(id); const space = await loadLearningSpace(current.spaceId); await requireLearningSpaceManage(context, space); const expectedVersion = cleanLearningInteger(input.expectedVersion, 'expectedVersion', 1, 100_000); const normalized = normalizeAssignment(input)
  const transitions: Record<LearningAssignment['status'], LearningAssignment['status'][]> = { DRAFT: ['DRAFT', 'PUBLISHED', 'CLOSED'], PUBLISHED: ['PUBLISHED', 'CLOSED'], CLOSED: ['CLOSED'] }; if (!transitions[current.status].includes(normalized.status)) conflict('INVALID_STATE_TRANSITION', 'Status tugas tidak dapat dikembalikan ke tahap sebelumnya.')
  const now = new Date().toISOString(); let assignment: LearningAssignment; let definition: LearningAssignmentVersion
  if (dataMode() === 'mock') { const fresh = learningMockState().assignments.get(id); if (!fresh) notFound('Tugas pembelajaran'); if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Tugas telah berubah.', { currentVersion: fresh.version }); assignment = { ...fresh, ...normalized, currentVersion: fresh.currentVersion + 1, version: fresh.version + 1, updatedAt: now, updatedBy: context.uid }; definition = assignmentSnapshot(assignment); learningMockState().assignments.set(id, clone(assignment)); learningMockState().assignmentVersions.set(definition.id, clone(definition)) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.'); const reference = db.collection('learningAssignments').doc(id); ;({ assignment, definition } = await db.runTransaction(async transaction => { const snapshot = await transaction.get(reference); if (!snapshot.exists) notFound('Tugas pembelajaran'); const fresh = { id: snapshot.id, ...snapshot.data() } as LearningAssignment; if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Tugas telah berubah.', { currentVersion: fresh.version }); const next: LearningAssignment = { ...fresh, ...normalized, currentVersion: fresh.currentVersion + 1, version: fresh.version + 1, updatedAt: now, updatedBy: context.uid }; const version = assignmentSnapshot(next); transaction.set(reference, next); transaction.create(db.collection('learningAssignmentVersions').doc(version.id), version); return { assignment: next, definition: version } })) }
  if (current.status !== 'PUBLISHED' && assignment.status === 'PUBLISHED') {
    await appendLearningActivity({ spaceId: space.id, actorUid: context.uid, kind: 'ASSIGNMENT_PUBLISHED', resourceId: id, label: assignment.title, occurredAt: now })
    await notifyClassLearningEvent(context, space, {
      templateKey: 'learning-assignment-published',
      resourceId: assignment.id,
      resourceVersion: assignment.version,
      resourceTitle: assignment.title,
      actionPath: `/pembelajaran/${space.id}/tugas/${assignment.id}`,
    }, event)
  }
  const audit = await appendAudit({ actor: context, action: 'LEARNING_ASSIGNMENT_UPDATED', resourceType: 'learning_assignment', resourceId: id, before: { version: expectedVersion, status: current.status }, after: { version: assignment.version, definitionVersion: assignment.currentVersion, status: assignment.status }, event }); return { assignment, definition, auditId: audit.id }
}

export async function createLearningAnnouncement(context: AuthContext, input: CreateLearningAnnouncementInput, idempotencyKey: string, event?: H3Event): Promise<{ announcement: LearningAnnouncement; replayed: boolean; auditId?: string }> {
  requireIdempotencyKey(idempotencyKey); const space = await loadLearningSpace(input.spaceId); await requireLearningSpaceManage(context, space)
  const normalized = { title: cleanLearningText(input.title, 'Judul pengumuman', 180), body: validateSafeRichContent(input.body, 'Isi pengumuman', 10_000), pinned: Boolean(input.pinned) }; const hash = requestHash({ spaceId: space.id, ...normalized }); const namespace = `announcement:create:${idempotencyKey}`
  const replay = await mockIdempotent<{ announcement: LearningAnnouncement; replayed: boolean }>(namespace, hash); if (replay) return { ...replay, replayed: true }
  const now = new Date().toISOString(), id = opaqueId('learning_announcement', `${space.id}:${idempotencyKey}`); const announcement: LearningAnnouncement = { id, spaceId: space.id, ...normalized, status: 'PUBLISHED', version: 1, createdAt: now, createdBy: context.uid, updatedAt: now, updatedBy: context.uid }; const response = { announcement, replayed: false }
  if (dataMode() === 'mock') { learningMockState().announcements.set(id, clone(announcement)); storeMockIdempotency(namespace, hash, response) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.'); const idem = db.collection('learningIdempotency').doc(opaqueId('idem', namespace)); const result = await db.runTransaction(async transaction => { const prior = await transaction.get(idem); if (prior.exists) { const stored = prior.data() as { requestHash: string; response: typeof response }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } } transaction.create(db.collection('learningAnnouncements').doc(id), announcement); transaction.create(idem, withFirestorePurgeAfter({ requestHash: hash, response, createdAt: now }, now, FIRESTORE_TTL_RETENTION_MS.idempotency)); return response }); if (result.replayed) return result }
  await appendLearningActivity({ spaceId: space.id, actorUid: context.uid, kind: 'ANNOUNCEMENT_PUBLISHED', resourceId: id, label: announcement.title, occurredAt: now })
  await notifyClassLearningEvent(context, space, {
    templateKey: 'learning-announcement-published',
    resourceId: announcement.id,
    resourceVersion: announcement.version,
    resourceTitle: announcement.title,
    actionPath: `/pembelajaran/${space.id}`,
  }, event)
  const audit = await appendAudit({ actor: context, action: 'LEARNING_ANNOUNCEMENT_CREATED', resourceType: 'learning_announcement', resourceId: id, after: { spaceId: space.id, pinned: announcement.pinned }, event })
  return { ...response, auditId: audit.id }
}

export async function updateLearningAnnouncement(
  context: AuthContext,
  id: string,
  input: UpdateLearningAnnouncementInput,
  event?: H3Event,
): Promise<{ announcement: LearningAnnouncement; auditId: string }> {
  const current = await loadLearningAnnouncement(id)
  const space = await loadLearningSpace(current.spaceId)
  await requireLearningSpaceManage(context, space)
  const expectedVersion = cleanLearningInteger(input.expectedVersion, 'expectedVersion', 1, 100_000)
  const status = cleanLearningText(input.status, 'status', 20) as LearningAnnouncement['status']
  if (!['PUBLISHED', 'ARCHIVED'].includes(status)) invalidInput('Status pengumuman tidak valid.')
  if (current.status === 'ARCHIVED' && status === 'PUBLISHED') conflict('INVALID_STATE_TRANSITION', 'Pengumuman yang diarsipkan tidak dapat diterbitkan kembali.')
  const normalized = {
    title: cleanLearningText(input.title, 'Judul pengumuman', 180),
    body: validateSafeRichContent(input.body, 'Isi pengumuman', 10_000),
    pinned: Boolean(input.pinned),
    status,
  }
  const now = new Date().toISOString()
  let announcement: LearningAnnouncement
  if (dataMode() === 'mock') {
    const fresh = learningMockState().announcements.get(current.id)
    if (!fresh) notFound('Pengumuman pembelajaran')
    if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Pengumuman telah berubah.', { currentVersion: fresh.version })
    announcement = { ...fresh, ...normalized, version: fresh.version + 1, updatedAt: now, updatedBy: context.uid }
    learningMockState().announcements.set(current.id, clone(announcement))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.')
    const reference = db.collection('learningAnnouncements').doc(current.id)
    announcement = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) notFound('Pengumuman pembelajaran')
      const fresh = { id: snapshot.id, ...snapshot.data() } as LearningAnnouncement
      if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Pengumuman telah berubah.', { currentVersion: fresh.version })
      const next: LearningAnnouncement = { ...fresh, ...normalized, version: fresh.version + 1, updatedAt: now, updatedBy: context.uid }
      transaction.set(reference, next)
      return next
    })
  }
  if (announcement.status === 'PUBLISHED') {
    await notifyClassLearningEvent(context, space, {
      templateKey: 'learning-announcement-published',
      resourceId: announcement.id,
      resourceVersion: announcement.version,
      resourceTitle: announcement.title,
      actionPath: `/pembelajaran/${space.id}`,
    }, event)
  }
  const audit = await appendAudit({
    actor: context,
    action: announcement.status === 'ARCHIVED' ? 'LEARNING_ANNOUNCEMENT_ARCHIVED' : 'LEARNING_ANNOUNCEMENT_UPDATED',
    resourceType: 'learning_announcement',
    resourceId: current.id,
    before: { version: current.version, status: current.status, pinned: current.pinned },
    after: { version: announcement.version, status: announcement.status, pinned: announcement.pinned },
    event,
  })
  return { announcement, auditId: audit.id }
}
