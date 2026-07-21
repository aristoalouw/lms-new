import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type {
  LearningGrade,
  LearningSubmission,
  LearningSubmissionAttempt,
  SafeRichContent,
} from '../types/learning'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import {
  appendLearningActivity,
  cleanLearningFileReference,
  loadLearningAssignment,
  loadLearningSpace,
  requireLearningSpaceManage,
  requireLearningSpaceRead,
} from './learning'
import { learningMockState } from './learning-mock'
import { cleanLearningId, cleanLearningInteger, validateSafeRichContent } from './learning-validation'

export interface SaveLearningDraftInput {
  assignmentId: string
  expectedVersion: number
  content?: SafeRichContent
  fileIds: string[]
}

export interface FinalizeLearningSubmissionInput {
  assignmentId: string
  expectedVersion: number
}

export interface GradeLearningSubmissionInput {
  attemptId: string
  expectedVersion: number
  score: number
  feedback: SafeRichContent
  status: LearningGrade['status']
}

export interface LearningSubmissionReviewRow {
  submission: LearningSubmission
  attempts: LearningSubmissionAttempt[]
  grade?: LearningGrade
}

function clone<T>(value: T): T { return structuredClone(value) }

function requireIdempotencyKey(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(value)) invalidInput('Idempotency key tidak valid.')
}

function requireAssignmentWindow(opensAt: string, closesAt: string, status: string, now: number): void {
  if (status !== 'PUBLISHED' || now < Date.parse(opensAt)) conflict('ASSIGNMENT_NOT_OPEN', 'Tugas belum dibuka.')
  if (now >= Date.parse(closesAt)) conflict('ASSIGNMENT_CLOSED', 'Jendela pengumpulan tugas telah ditutup.')
}

async function studentForAssignment(context: AuthContext, assignmentId: string, now: number) {
  const assignment = await loadLearningAssignment(assignmentId)
  const space = await loadLearningSpace(assignment.spaceId)
  const access = await requireLearningSpaceRead(context, space)
  if (!hasRole(context, 'student') || !access.studentId) forbidden('Pengumpulan tugas hanya tersedia untuk mahasiswa pada roster ruang ini.')
  requireAssignmentWindow(assignment.opensAt, assignment.closesAt, assignment.status, now)
  return { assignment, space, studentId: access.studentId }
}

function submissionId(assignmentId: string, studentId: string): string {
  return opaqueId('learning_submission', `${assignmentId}:${studentId}`)
}

async function loadSubmission(id: string): Promise<LearningSubmission | undefined> {
  if (dataMode() === 'mock') return clone(learningMockState().submissions.get(id))
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan pengumpulan tugas tidak tersedia.')
  const snapshot = await db.collection('learningSubmissions').doc(id).get()
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } as LearningSubmission : undefined
}

async function loadAttempt(id: string): Promise<LearningSubmissionAttempt> {
  if (dataMode() === 'mock') {
    const attempt = learningMockState().submissionAttempts.get(id)
    if (!attempt) notFound('Percobaan pengumpulan')
    return clone(attempt)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan pengumpulan tugas tidak tersedia.')
  const snapshot = await db.collection('learningSubmissionAttempts').doc(id).get()
  if (!snapshot.exists) notFound('Percobaan pengumpulan')
  return { id: snapshot.id, ...snapshot.data() } as LearningSubmissionAttempt
}

async function previousIdempotency<T>(namespace: string, hash: string): Promise<T | undefined> {
  if (dataMode() === 'mock') {
    const previous = learningMockState().idempotency.get(namespace)
    if (!previous) return undefined
    if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
    return clone(previous.response) as T
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan pembelajaran tidak tersedia.')
  const snapshot = await db.collection('learningIdempotency').doc(opaqueId('idem', namespace)).get()
  if (!snapshot.exists) return undefined
  const previous = snapshot.data() as { requestHash: string; response: T }
  if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
  return previous.response
}

export async function saveLearningSubmissionDraft(
  context: AuthContext,
  input: SaveLearningDraftInput,
  idempotencyKey: string,
  event?: H3Event,
  now = Date.now(),
): Promise<{ submission: LearningSubmission; replayed: boolean; auditId?: string }> {
  requireIdempotencyKey(idempotencyKey)
  const expectedVersion = cleanLearningInteger(input.expectedVersion, 'expectedVersion', 0, 100_000)
  if (!Array.isArray(input.fileIds) || input.fileIds.length > 10 || new Set(input.fileIds).size !== input.fileIds.length) invalidInput('Referensi file draf tidak valid.')
  const { assignment, space, studentId } = await studentForAssignment(context, cleanLearningId(input.assignmentId, 'assignmentId'), now)
  if (input.fileIds.length > assignment.maximumFiles) invalidInput(`Tugas menerima paling banyak ${assignment.maximumFiles} file.`)
  const content = input.content ? validateSafeRichContent(input.content, 'Isi jawaban', 20_000) : undefined
  const files = await Promise.all(input.fileIds.map(fileId => cleanLearningFileReference(context, fileId)))
  const id = submissionId(assignment.id, studentId)
  const normalizedHash = requestHash({ assignmentId: assignment.id, studentId, expectedVersion, content, files })
  const namespace = `submission:draft:${idempotencyKey}`
  const prior = await previousIdempotency<{ submission: LearningSubmission; replayed: boolean }>(namespace, normalizedHash)
  if (prior) return { ...prior, replayed: true }
  const current = await loadSubmission(id)
  if ((current?.version ?? 0) !== expectedVersion) conflict('VERSION_CONFLICT', 'Draf pengumpulan telah berubah.', { currentVersion: current?.version ?? 0 })
  if (current?.status === 'SUBMITTED' && current.attemptCount >= assignment.maximumAttempts) conflict('MAXIMUM_ATTEMPTS_REACHED', 'Jumlah percobaan pengumpulan sudah mencapai batas.')
  const timestamp = new Date(now).toISOString()
  const submission: LearningSubmission = {
    id, assignmentId: assignment.id, spaceId: space.id, studentId, studentUid: context.uid,
    draftContent: content, draftFiles: files, status: 'DRAFT', attemptCount: current?.attemptCount ?? 0,
    latestAttemptId: current?.latestAttemptId, version: (current?.version ?? 0) + 1,
    createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp,
  }
  const response = { submission, replayed: false }
  if (dataMode() === 'mock') {
    const fresh = learningMockState().submissions.get(id)
    if ((fresh?.version ?? 0) !== expectedVersion) conflict('VERSION_CONFLICT', 'Draf pengumpulan telah berubah.', { currentVersion: fresh?.version ?? 0 })
    learningMockState().submissions.set(id, clone(submission))
    learningMockState().idempotency.set(namespace, { requestHash: normalizedHash, response: clone(response) })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan pengumpulan tugas tidak tersedia.')
    const submissionRef = db.collection('learningSubmissions').doc(id)
    const idemRef = db.collection('learningIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async transaction => {
      const [idem, snapshot] = await Promise.all([transaction.get(idemRef), transaction.get(submissionRef)])
      if (idem.exists) {
        const stored = idem.data() as { requestHash: string; response: typeof response }
        if (stored.requestHash !== normalizedHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.')
        return { ...stored.response, replayed: true }
      }
      const fresh = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } as LearningSubmission : undefined
      if ((fresh?.version ?? 0) !== expectedVersion) conflict('VERSION_CONFLICT', 'Draf pengumpulan telah berubah.', { currentVersion: fresh?.version ?? 0 })
      transaction.set(submissionRef, submission)
      transaction.create(idemRef, { requestHash: normalizedHash, response, createdAt: timestamp })
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'LEARNING_SUBMISSION_DRAFT_SAVED', resourceType: 'learning_submission', resourceId: id, after: { assignmentId: assignment.id, version: submission.version, fileIds: files.map(file => file.fileId) }, event })
  return { ...response, auditId: audit.id }
}

export async function finalizeLearningSubmission(
  context: AuthContext,
  input: FinalizeLearningSubmissionInput,
  idempotencyKey: string,
  event?: H3Event,
  now = Date.now(),
): Promise<{ submission: LearningSubmission; attempt: LearningSubmissionAttempt; replayed: boolean; auditId?: string }> {
  requireIdempotencyKey(idempotencyKey)
  const expectedVersion = cleanLearningInteger(input.expectedVersion, 'expectedVersion', 1, 100_000)
  const { assignment, space, studentId } = await studentForAssignment(context, cleanLearningId(input.assignmentId, 'assignmentId'), now)
  const id = submissionId(assignment.id, studentId)
  const current = await loadSubmission(id)
  if (!current || current.status !== 'DRAFT') conflict('SUBMISSION_DRAFT_REQUIRED', 'Simpan draf sebelum mengirim final.')
  if (current.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Draf pengumpulan telah berubah.', { currentVersion: current.version })
  if (!current.draftContent && !current.draftFiles.length) invalidInput('Pengumpulan final harus memiliki jawaban atau file.')
  if (current.attemptCount >= assignment.maximumAttempts) conflict('MAXIMUM_ATTEMPTS_REACHED', 'Jumlah percobaan pengumpulan sudah mencapai batas.')
  const nextAttempt = current.attemptCount + 1
  const normalizedHash = requestHash({ submissionId: id, expectedVersion, nextAttempt })
  const namespace = `submission:final:${idempotencyKey}`
  const prior = await previousIdempotency<{ submission: LearningSubmission; attempt: LearningSubmissionAttempt; replayed: boolean }>(namespace, normalizedHash)
  if (prior) return { ...prior, replayed: true }
  const submittedAt = new Date(now).toISOString()
  const attemptId = opaqueId('learning_attempt', `${id}:${nextAttempt}`)
  const attempt: LearningSubmissionAttempt = {
    id: attemptId, submissionId: id, assignmentId: assignment.id, spaceId: space.id,
    studentId, studentUid: context.uid, attemptNumber: nextAttempt, content: current.draftContent,
    files: clone(current.draftFiles), submittedAt,
    timeliness: now <= Date.parse(assignment.dueAt) ? 'ON_TIME' : 'LATE', assignmentVersion: assignment.currentVersion,
  }
  const submission: LearningSubmission = { ...current, status: 'SUBMITTED', attemptCount: nextAttempt, latestAttemptId: attempt.id, version: current.version + 1, updatedAt: submittedAt }
  const response = { submission, attempt, replayed: false }
  if (dataMode() === 'mock') {
    const fresh = learningMockState().submissions.get(id)
    if (!fresh || fresh.version !== expectedVersion || fresh.status !== 'DRAFT') conflict('VERSION_CONFLICT', 'Draf pengumpulan telah berubah.', { currentVersion: fresh?.version ?? 0 })
    if (learningMockState().submissionAttempts.has(attempt.id)) conflict('SUBMISSION_ATTEMPT_EXISTS', 'Percobaan pengumpulan sudah tercatat.')
    learningMockState().submissions.set(id, clone(submission)); learningMockState().submissionAttempts.set(attempt.id, clone(attempt)); learningMockState().idempotency.set(namespace, { requestHash: normalizedHash, response: clone(response) })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan pengumpulan tugas tidak tersedia.')
    const submissionRef = db.collection('learningSubmissions').doc(id), attemptRef = db.collection('learningSubmissionAttempts').doc(attempt.id), idemRef = db.collection('learningIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async transaction => {
      const [idem, freshSnapshot, attemptSnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(submissionRef), transaction.get(attemptRef)])
      if (idem.exists) { const stored = idem.data() as { requestHash: string; response: typeof response }; if (stored.requestHash !== normalizedHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } }
      if (!freshSnapshot.exists) notFound('Draf pengumpulan')
      const fresh = { id: freshSnapshot.id, ...freshSnapshot.data() } as LearningSubmission
      if (fresh.version !== expectedVersion || fresh.status !== 'DRAFT') conflict('VERSION_CONFLICT', 'Draf pengumpulan telah berubah.', { currentVersion: fresh.version })
      if (attemptSnapshot.exists) conflict('SUBMISSION_ATTEMPT_EXISTS', 'Percobaan pengumpulan sudah tercatat.')
      transaction.set(submissionRef, submission); transaction.create(attemptRef, attempt); transaction.create(idemRef, { requestHash: normalizedHash, response, createdAt: submittedAt }); return response
    })
    if (result.replayed) return result
  }
  await appendLearningActivity({ spaceId: space.id, actorUid: context.uid, kind: 'SUBMISSION_FINALIZED', resourceId: attempt.id, label: assignment.title, occurredAt: submittedAt })
  const audit = await appendAudit({ actor: context, action: 'LEARNING_SUBMISSION_FINALIZED', resourceType: 'learning_submission_attempt', resourceId: attempt.id, after: { assignmentId: assignment.id, attemptNumber: attempt.attemptNumber, timeliness: attempt.timeliness, fileIds: attempt.files.map(file => file.fileId), assignmentVersion: attempt.assignmentVersion }, event })
  return { ...response, auditId: audit.id }
}

export async function gradeLearningSubmission(
  context: AuthContext,
  input: GradeLearningSubmissionInput,
  event?: H3Event,
): Promise<{ grade: LearningGrade; auditId: string }> {
  const attempt = await loadAttempt(cleanLearningId(input.attemptId, 'attemptId'))
  const assignment = await loadLearningAssignment(attempt.assignmentId)
  const space = await loadLearningSpace(attempt.spaceId)
  await requireLearningSpaceManage(context, space)
  const expectedVersion = cleanLearningInteger(input.expectedVersion, 'expectedVersion', 0, 100_000)
  if (typeof input.score !== 'number' || !Number.isFinite(input.score) || input.score < 0 || input.score > assignment.maximumPoints) invalidInput(`Nilai harus berada pada rentang 0-${assignment.maximumPoints}.`)
  if (!['DRAFT', 'PUBLISHED'].includes(input.status)) invalidInput('Status nilai tidak valid.')
  const feedback = validateSafeRichContent(input.feedback, 'Umpan balik', 10_000)
  const id = opaqueId('learning_grade', `${assignment.id}:${attempt.studentId}`)
  const timestamp = new Date().toISOString()
  let grade: LearningGrade
  let previousStatus: LearningGrade['status'] | undefined
  if (dataMode() === 'mock') {
    const current = learningMockState().grades.get(id)
    if ((current?.version ?? 0) !== expectedVersion) conflict('VERSION_CONFLICT', 'Nilai telah berubah.', { currentVersion: current?.version ?? 0 })
    previousStatus = current?.status
    grade = { id, assignmentId: assignment.id, spaceId: space.id, studentId: attempt.studentId, attemptId: attempt.id, score: Math.round(input.score * 100) / 100, feedback, status: input.status, version: (current?.version ?? 0) + 1, gradedAt: current?.gradedAt ?? timestamp, gradedBy: context.uid, updatedAt: timestamp }
    learningMockState().grades.set(id, clone(grade))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan nilai tugas tidak tersedia.')
    const reference = db.collection('learningGrades').doc(id)
    const result = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference)
      const current = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } as LearningGrade : undefined
      if ((current?.version ?? 0) !== expectedVersion) conflict('VERSION_CONFLICT', 'Nilai telah berubah.', { currentVersion: current?.version ?? 0 })
      const next: LearningGrade = { id, assignmentId: assignment.id, spaceId: space.id, studentId: attempt.studentId, attemptId: attempt.id, score: Math.round(input.score * 100) / 100, feedback, status: input.status, version: (current?.version ?? 0) + 1, gradedAt: current?.gradedAt ?? timestamp, gradedBy: context.uid, updatedAt: timestamp }
      transaction.set(reference, next); return { grade: next, previousStatus: current?.status }
    })
    grade = result.grade; previousStatus = result.previousStatus
  }
  if (grade.status === 'PUBLISHED' && previousStatus !== 'PUBLISHED') await appendLearningActivity({ spaceId: space.id, actorUid: context.uid, kind: 'GRADE_PUBLISHED', resourceId: grade.id, label: assignment.title, occurredAt: timestamp })
  const audit = await appendAudit({ actor: context, action: 'LEARNING_SUBMISSION_GRADED', resourceType: 'learning_grade', resourceId: grade.id, before: { version: expectedVersion, status: previousStatus }, after: { version: grade.version, attemptId: attempt.id, score: grade.score, status: grade.status }, event })
  return { grade, auditId: audit.id }
}

export async function listLearningAssignmentSubmissions(context: AuthContext, assignmentId: string): Promise<LearningSubmissionReviewRow[]> {
  const assignment = await loadLearningAssignment(cleanLearningId(assignmentId, 'assignmentId'))
  const space = await loadLearningSpace(assignment.spaceId)
  await requireLearningSpaceManage(context, space)
  let submissions: LearningSubmission[], attempts: LearningSubmissionAttempt[], grades: LearningGrade[]
  if (dataMode() === 'mock') {
    submissions = [...learningMockState().submissions.values()].filter(item => item.assignmentId === assignment.id).map(clone)
    attempts = [...learningMockState().submissionAttempts.values()].filter(item => item.assignmentId === assignment.id).map(clone)
    grades = [...learningMockState().grades.values()].filter(item => item.assignmentId === assignment.id).map(clone)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan pengumpulan tugas tidak tersedia.')
    const [submissionSnapshot, attemptSnapshot, gradeSnapshot] = await Promise.all([
      db.collection('learningSubmissions').where('assignmentId', '==', assignment.id).limit(500).get(),
      db.collection('learningSubmissionAttempts').where('assignmentId', '==', assignment.id).limit(1_000).get(),
      db.collection('learningGrades').where('assignmentId', '==', assignment.id).limit(500).get(),
    ])
    submissions = submissionSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as LearningSubmission)
    attempts = attemptSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as LearningSubmissionAttempt)
    grades = gradeSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as LearningGrade)
  }
  return submissions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map(submission => ({
    submission,
    attempts: attempts.filter(attempt => attempt.submissionId === submission.id).sort((left, right) => left.attemptNumber - right.attemptNumber),
    grade: grades.find(grade => grade.studentId === submission.studentId),
  }))
}
