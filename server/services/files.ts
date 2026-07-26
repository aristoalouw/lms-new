import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { LearningSpace } from '../types/learning'
import type {
  AllowedFileMimeType,
  CreateUploadSessionInput,
  CreateUploadSessionResult,
  FileDetailResult,
  FileListFilters,
  FileListResult,
  FileQuota,
  FileUploadSession,
  PrivateFileRecord,
  PrivateFileVersion,
  SignedDownloadResult,
} from '../types/files'
import { appendAudit } from '../utils/audit'
import { CampusError, conflict, forbidden, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { FIRESTORE_TTL_RETENTION_MS, firestorePurgeAfter } from '../utils/firestore-ttl'
import { opaqueId, requestHash } from '../utils/security'
import {
  FILE_DOWNLOAD_TTL_MS,
  FILE_UPLOAD_SESSION_TTL_MS,
  normalizeFileAccess,
  normalizeFileName,
  quotaLimitBytes,
  validateDeclaredFile,
  verifyFileSignature,
} from './files-policy'
import { malwareScanner, type MalwareScanResult } from './files-scanner'
import { fileStorage, putMockUploadObject } from './files-storage'
import { getAcademicClassDetail } from './academic-classes'
import { learningMockState } from './learning-mock'

interface FileMockState {
  files: Map<string, PrivateFileRecord>
  versions: Map<string, PrivateFileVersion>
  sessions: Map<string, FileUploadSession>
  quotas: Map<string, FileQuota>
}

const mock: FileMockState = {
  files: new Map(),
  versions: new Map(),
  sessions: new Map(),
  quotas: new Map(),
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function nowIso(now = Date.now()): string {
  return new Date(now).toISOString()
}

function versionId(fileId: string, version: number): string {
  return `${fileId}_v${version}`
}

function emptyQuota(ownerUid: string, now: string): FileQuota {
  return { ownerUid, usedBytes: 0, reservedBytes: 0, limitBytes: quotaLimitBytes(), updatedAt: now }
}

function mockQuota(ownerUid: string, now = new Date().toISOString()): FileQuota {
  return clone(mock.quotas.get(ownerUid) || emptyQuota(ownerUid, now))
}

function withoutStoragePath(version: PrivateFileVersion): Omit<PrivateFileVersion, 'storagePath' | 'uploadSessionId'> {
  const { storagePath: _storagePath, uploadSessionId: _session, ...safe } = version
  return clone(safe)
}

function withoutStorageSession(session: FileUploadSession): Omit<FileUploadSession, 'storagePath' | 'idempotencyHash'> {
  const { storagePath: _storagePath, idempotencyHash: _idempotencyHash, ...safe } = session
  return clone(safe)
}

function ownsFile(context: AuthContext, file: PrivateFileRecord): boolean {
  return file.ownerUid === context.uid
}

function isAdministrator(context: AuthContext): boolean {
  return context.roles.includes('administrator')
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  return left.some(item => right.includes(item))
}

async function canAccessLearningSpaces(context: AuthContext, learningSpaceIds: readonly string[]): Promise<boolean> {
  for (const spaceId of learningSpaceIds) {
    let space: LearningSpace | undefined
    if (dataMode() === 'mock') space = learningMockState().spaces.get(spaceId)
    else {
      const db = firestoreAdmin()
      if (!db) serviceUnavailable('Penyimpanan ruang pembelajaran tidak tersedia.')
      const snapshot = await db.collection('learningSpaces').doc(spaceId).get()
      if (snapshot.exists) space = { id: snapshot.id, ...snapshot.data() } as LearningSpace
    }
    if (!space) continue
    if (space.academicClassId) {
      try {
        await getAcademicClassDetail(context, space.academicClassId)
        return true
      } catch (error) {
        if (!(error instanceof CampusError) || ![403, 404].includes(error.statusCode)) throw error
      }
    } else if (isAdministrator(context) || space.lecturerIds.includes(context.uid)
      || space.participantUserIds.includes(context.uid)
      || context.scope.studentIds.some(studentId => space!.participantUserIds.includes(studentId))) return true
  }
  return false
}

export async function canAccessPrivateFile(context: AuthContext, file: PrivateFileRecord): Promise<boolean> {
  // A class-scoped file always revalidates current membership first. Ownership
  // must not preserve access after an enrolment is withdrawn.
  if (file.access.learningSpaceIds?.length && !await canAccessLearningSpaces(context, file.access.learningSpaceIds)) return false
  if (ownsFile(context, file) || isAdministrator(context)) return true
  if (file.access.visibility !== 'SCOPED') return false
  if (file.access.allowedUserIds.includes(context.uid)) return true
  const roleMatch = file.access.allowedRoles.length === 0 || intersects(file.access.allowedRoles, context.roles)
  const unitMatch = file.access.unitIds.length === 0 || intersects(file.access.unitIds, context.scope.unitIds)
  const programMatch = file.access.programStudyIds.length === 0
    || intersects(file.access.programStudyIds, context.scope.programStudyIds)
  const studentMatch = file.access.studentIds.length === 0 || intersects(file.access.studentIds, context.scope.studentIds)
  return roleMatch && unitMatch && programMatch && studentMatch
}

async function requireReadAccess(context: AuthContext, file: PrivateFileRecord): Promise<void> {
  if (!await canAccessPrivateFile(context, file)) forbidden('File berada di luar lingkup akses Anda.')
}

function requireManageAccess(context: AuthContext, file: PrivateFileRecord): void {
  if (!ownsFile(context, file) && !isAdministrator(context)) forbidden('Hanya pemilik atau administrator yang dapat mengelola file ini.')
}

function fileCursorSecret(): string {
  return process.env.FILE_CURSOR_SECRET || process.env.DEMO_SESSION_SECRET || process.env.FIREBASE_PROJECT_ID || 'file-cursor-development-secret'
}

interface FileCursor {
  updatedAt: string
  id: string
}

function encodeCursor(cursor: FileCursor): string {
  const payload = Buffer.from(JSON.stringify(cursor)).toString('base64url')
  const signature = createHmac('sha256', fileCursorSecret()).update(payload).digest('base64url').slice(0, 24)
  return `${payload}.${signature}`
}

function decodeCursor(value?: string): FileCursor | undefined {
  if (!value) return undefined
  try {
    const [payload, signature] = value.split('.')
    if (!payload || !signature) throw new Error('cursor')
    const expected = createHmac('sha256', fileCursorSecret()).update(payload).digest('base64url').slice(0, 24)
    const left = Buffer.from(signature)
    const right = Buffer.from(expected)
    if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error('cursor')
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as FileCursor
    if (!/^file_[a-f0-9]{24}$/.test(parsed.id) || Number.isNaN(Date.parse(parsed.updatedAt))) throw new Error('cursor')
    return parsed
  } catch {
    throw new CampusError(400, 'INVALID_CURSOR', 'Cursor daftar file tidak valid.')
  }
}

function cursorCompare(file: PrivateFileRecord, cursor: FileCursor): boolean {
  return file.updatedAt < cursor.updatedAt || (file.updatedAt === cursor.updatedAt && file.id < cursor.id)
}

function sortNewest(left: PrivateFileRecord, right: PrivateFileRecord): number {
  return right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)
}

async function matchesFilters(context: AuthContext, file: PrivateFileRecord, filters: FileListFilters): Promise<boolean> {
  const scope = filters.scope || 'owned'
  if (scope === 'owned' && !ownsFile(context, file)) return false
  if (scope === 'accessible' && !await canAccessPrivateFile(context, file)) return false
  if (scope === 'all' && !isAdministrator(context)) forbidden('Hanya administrator yang dapat melihat seluruh file.')
  if (!filters.includeDeleted && file.deleted) return false
  if (filters.status && file.status !== filters.status) return false
  if (filters.mimeType && file.mimeType !== filters.mimeType) return false
  if (filters.search && !file.name.toLocaleLowerCase('id-ID').includes(filters.search.toLocaleLowerCase('id-ID'))) return false
  return true
}

async function getQuota(ownerUid: string): Promise<FileQuota> {
  const now = new Date().toISOString()
  if (dataMode() === 'mock') return mockQuota(ownerUid, now)
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan kuota file tidak tersedia.')
  const snapshot = await db.collection('fileQuotas').doc(ownerUid).get()
  return snapshot.exists ? ({ ownerUid, ...snapshot.data() } as FileQuota) : emptyQuota(ownerUid, now)
}

async function getFileRecord(fileId: string): Promise<PrivateFileRecord> {
  if (dataMode() === 'mock') {
    const file = mock.files.get(fileId)
    if (!file) notFound('File')
    return clone(file)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan metadata file tidak tersedia.')
  const snapshot = await db.collection('files').doc(fileId).get()
  if (!snapshot.exists) notFound('File')
  return { id: snapshot.id, ...snapshot.data() } as PrivateFileRecord
}

async function getVersionRecord(fileId: string, version: number): Promise<PrivateFileVersion> {
  const id = versionId(fileId, version)
  if (dataMode() === 'mock') {
    const record = mock.versions.get(id)
    if (!record) notFound('Versi file')
    return clone(record)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan versi file tidak tersedia.')
  const snapshot = await db.collection('fileVersions').doc(id).get()
  if (!snapshot.exists) notFound('Versi file')
  return { id: snapshot.id, ...snapshot.data() } as PrivateFileVersion
}

async function getUploadSession(sessionId: string): Promise<FileUploadSession> {
  if (dataMode() === 'mock') {
    const session = mock.sessions.get(sessionId)
    if (!session) notFound('Sesi unggahan')
    return clone(session)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan sesi unggahan tidak tersedia.')
  const snapshot = await db.collection('fileUploadSessions').doc(sessionId).get()
  if (!snapshot.exists) notFound('Sesi unggahan')
  return { id: snapshot.id, ...snapshot.data() } as FileUploadSession
}

function requireSessionActor(context: AuthContext, session: FileUploadSession): void {
  if (session.createdBy !== context.uid && !isAdministrator(context)) forbidden('Sesi unggahan bukan milik akun Anda.')
}

async function releaseReservedSession(
  session: FileUploadSession,
  status: 'REJECTED' | 'EXPIRED',
  rejectionCode: string,
  now: string,
): Promise<void> {
  if (dataMode() === 'mock') {
    const current = mock.sessions.get(session.id)
    if (!current || current.status !== 'RESERVED') return
    const quota = mockQuota(session.ownerUid, now)
    if (quota.reservedBytes < session.expectedSizeBytes) conflict('FILE_QUOTA_INCONSISTENT', 'Reservasi kuota file tidak konsisten.')
    quota.reservedBytes -= session.expectedSizeBytes
    quota.updatedAt = now
    const version = mock.versions.get(session.versionId)
    const file = mock.files.get(session.fileId)
    mock.quotas.set(session.ownerUid, quota)
    mock.sessions.set(session.id, { ...current, status, finalizedAt: now })
    if (version) mock.versions.set(version.id, { ...version, status: 'REJECTED', rejectedAt: now, rejectionCode })
    if (file) {
      mock.files.set(file.id, {
        ...file,
        ...(file.currentVersion === null ? { status: 'REJECTED' as const } : {}),
        ...(file.pendingVersion === session.version ? { pendingVersion: undefined } : {}),
        updatedAt: now,
      })
    }
    return
  }

  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan metadata file tidak tersedia.')
  const sessionRef = db.collection('fileUploadSessions').doc(session.id)
  const quotaRef = db.collection('fileQuotas').doc(session.ownerUid)
  const versionRef = db.collection('fileVersions').doc(session.versionId)
  const fileRef = db.collection('files').doc(session.fileId)
  await db.runTransaction(async (transaction) => {
    const [sessionSnapshot, quotaSnapshot, fileSnapshot] = await Promise.all([
      transaction.get(sessionRef),
      transaction.get(quotaRef),
      transaction.get(fileRef),
    ])
    if (!sessionSnapshot.exists || (sessionSnapshot.data() as FileUploadSession).status !== 'RESERVED') return
    const quota = quotaSnapshot.exists
      ? ({ ownerUid: session.ownerUid, ...quotaSnapshot.data() } as FileQuota)
      : emptyQuota(session.ownerUid, now)
    if (quota.reservedBytes < session.expectedSizeBytes) conflict('FILE_QUOTA_INCONSISTENT', 'Reservasi kuota file tidak konsisten.')
    transaction.set(quotaRef, { ...quota, reservedBytes: quota.reservedBytes - session.expectedSizeBytes, updatedAt: now })
    transaction.update(sessionRef, { status, finalizedAt: now })
    transaction.update(versionRef, { status: 'REJECTED', rejectedAt: now, rejectionCode })
    if (fileSnapshot.exists) {
      const file = { id: fileSnapshot.id, ...fileSnapshot.data() } as PrivateFileRecord
      transaction.update(fileRef, {
        ...(file.currentVersion === null ? { status: 'REJECTED' } : {}),
        ...(file.pendingVersion === session.version ? { pendingVersion: FieldValue.delete() } : {}),
        updatedAt: now,
      })
    }
  })
}

export async function expireUploadSessions(
  context: AuthContext,
  now = Date.now(),
  event?: H3Event,
): Promise<number> {
  const cutoff = nowIso(now)
  let sessions: FileUploadSession[]
  if (dataMode() === 'mock') {
    sessions = [...mock.sessions.values()]
      .filter(session => session.createdBy === context.uid && session.status === 'RESERVED' && session.expiresAt <= cutoff)
      .map(clone)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan sesi unggahan tidak tersedia.')
    const snapshot = await db.collection('fileUploadSessions')
      .where('createdBy', '==', context.uid)
      .where('status', '==', 'RESERVED')
      .where('expiresAt', '<=', cutoff)
      .limit(25)
      .get()
    sessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FileUploadSession))
  }
  for (const session of sessions) {
    await releaseReservedSession(session, 'EXPIRED', 'UPLOAD_SESSION_EXPIRED', cutoff)
    await fileStorage().deleteObject(session.storagePath).catch(() => undefined)
    await appendAudit({
      actor: context,
      action: 'FILE_UPLOAD_EXPIRED',
      resourceType: 'file',
      resourceId: session.fileId,
      metadata: { version: session.version, reservedBytes: session.expectedSizeBytes },
      event,
    })
  }
  return sessions.length
}

export async function createFileUploadSession(
  context: AuthContext,
  input: CreateUploadSessionInput,
  idempotencyKeyOrEvent?: string | H3Event,
  event?: H3Event,
): Promise<CreateUploadSessionResult> {
  const explicitIdempotencyKey = typeof idempotencyKeyOrEvent === 'string' ? idempotencyKeyOrEvent : undefined
  const auditEvent = typeof idempotencyKeyOrEvent === 'string' ? event : idempotencyKeyOrEvent
  if (explicitIdempotencyKey && !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(explicitIdempotencyKey)) {
    throw new CampusError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency key tidak valid.')
  }
  const now = Date.now()
  const createdAt = nowIso(now)
  const expiresAt = nowIso(now + FILE_UPLOAD_SESSION_TTL_MS)
  await expireUploadSessions(context, now, auditEvent)

  const normalizedName = normalizeFileName(input.name)
  const policy = validateDeclaredFile(normalizedName.name, input.declaredMimeType, input.sizeBytes)
  const requestedFileId = input.fileId
  if (requestedFileId && !/^file_[a-f0-9]{24}$/.test(requestedFileId)) {
    throw new CampusError(400, 'INVALID_INPUT', 'fileId tidak valid.')
  }
  const idempotencySeed = explicitIdempotencyKey || randomUUID()
  const idempotencyHash = requestHash({ contextUid: context.uid, input: { ...input, name: normalizedName.name, declaredMimeType: policy.mimeType } })
  const newFileId = requestedFileId || opaqueId('file', `${context.uid}:${idempotencySeed}`)
  const sessionId = opaqueId('upload', `${context.uid}:${idempotencySeed}`)
  let file: PrivateFileRecord
  let session: FileUploadSession
  let quota: FileQuota
  let replayed = false

  if (dataMode() === 'mock') {
    const prior = mock.sessions.get(sessionId)
    if (prior) {
      if (prior.idempotencyHash !== idempotencyHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk unggahan berbeda.')
      if (prior.status !== 'RESERVED') conflict('UPLOAD_SESSION_CLOSED', 'Sesi unggahan tidak lagi menerima data.')
      const priorFile = mock.files.get(prior.fileId)
      if (!priorFile) notFound('File')
      file = clone(priorFile)
      session = clone(prior)
      quota = mockQuota(prior.ownerUid, createdAt)
      replayed = true
    } else {
    const existing = requestedFileId ? mock.files.get(requestedFileId) : undefined
    if (requestedFileId && !existing) notFound('File')
    if (existing) {
      requireManageAccess(context, existing)
      if (existing.deleted) conflict('FILE_DELETED', 'File yang telah dihapus tidak dapat menerima versi baru.')
      if (existing.pendingVersion !== undefined) conflict('FILE_UPLOAD_IN_PROGRESS', 'File masih memiliki versi yang sedang diproses.')
    }
    const ownerUid = existing?.ownerUid || context.uid
    quota = mockQuota(ownerUid, createdAt)
    if (quota.usedBytes + quota.reservedBytes + input.sizeBytes > quota.limitBytes) {
      throw new CampusError(409, 'FILE_QUOTA_EXCEEDED', 'Kuota penyimpanan tidak mencukupi.', {
        availableBytes: Math.max(0, quota.limitBytes - quota.usedBytes - quota.reservedBytes),
      })
    }
    const version = existing?.nextVersion || 1
    const id = versionId(newFileId, version)
    const access = existing?.access || normalizeFileAccess(context, input.access)
    const ownerName = existing?.ownerName || context.displayName
    file = existing
      ? { ...existing, nextVersion: version + 1, pendingVersion: version, updatedAt: createdAt }
      : {
          id: newFileId,
          ownerUid,
          ownerName,
          name: normalizedName.name,
          extension: normalizedName.extension,
          mimeType: policy.mimeType,
          sizeBytes: 0,
          status: 'UPLOADING',
          access,
          currentVersion: null,
          nextVersion: 2,
          versionCount: 0,
          pendingVersion: 1,
          createdAt,
          updatedAt: createdAt,
          deleted: false,
        }
    const storagePath = `private/quarantine/${opaqueId('owner', ownerUid)}/${newFileId}/v${version}/${sessionId}`
    const versionRecord: PrivateFileVersion = {
      id,
      fileId: newFileId,
      uploadSessionId: sessionId,
      version,
      ownerUid,
      createdBy: context.uid,
      name: normalizedName.name,
      extension: normalizedName.extension,
      declaredMimeType: policy.mimeType,
      expectedSizeBytes: input.sizeBytes,
      storagePath,
      status: 'UPLOADING',
      createdAt,
    }
    session = {
      id: sessionId,
      fileId: newFileId,
      versionId: id,
      version,
      ownerUid,
      createdBy: context.uid,
      expectedSizeBytes: input.sizeBytes,
      declaredMimeType: policy.mimeType,
      extension: normalizedName.extension,
      storagePath,
      status: 'RESERVED',
      createdAt,
      expiresAt,
      idempotencyHash,
    }
    quota = { ...quota, reservedBytes: quota.reservedBytes + input.sizeBytes, updatedAt: createdAt }
    mock.files.set(file.id, clone(file))
    mock.versions.set(id, clone(versionRecord))
    mock.sessions.set(session.id, clone(session))
    mock.quotas.set(ownerUid, clone(quota))
    }
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan metadata file tidak tersedia.')
    const fileRef = db.collection('files').doc(newFileId)
    const sessionRef = db.collection('fileUploadSessions').doc(sessionId)
    const existingSnapshot = requestedFileId ? await fileRef.get() : undefined
    if (requestedFileId && !existingSnapshot?.exists) notFound('File')
    const ownerUid = existingSnapshot?.exists ? String(existingSnapshot.data()?.ownerUid) : context.uid
    const quotaRef = db.collection('fileQuotas').doc(ownerUid)

    const transactionResult = await db.runTransaction(async (transaction) => {
      const [fileSnapshot, quotaSnapshot, sessionSnapshot] = await Promise.all([
        transaction.get(fileRef),
        transaction.get(quotaRef),
        transaction.get(sessionRef),
      ])
      const existing = fileSnapshot.exists ? ({ id: fileSnapshot.id, ...fileSnapshot.data() } as PrivateFileRecord) : undefined
      const currentQuota = quotaSnapshot.exists
        ? ({ ownerUid, ...quotaSnapshot.data() } as FileQuota)
        : emptyQuota(ownerUid, createdAt)
      if (sessionSnapshot.exists) {
        const prior = { id: sessionSnapshot.id, ...sessionSnapshot.data() } as FileUploadSession
        if (prior.idempotencyHash !== idempotencyHash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk unggahan berbeda.')
        if (prior.status !== 'RESERVED') conflict('UPLOAD_SESSION_CLOSED', 'Sesi unggahan tidak lagi menerima data.')
        if (!existing) notFound('File')
        return { file: existing, session: prior, quota: currentQuota, replayed: true }
      }
      if (requestedFileId && !existing) notFound('File')
      if (existing) {
        requireManageAccess(context, existing)
        if (existing.deleted) conflict('FILE_DELETED', 'File yang telah dihapus tidak dapat menerima versi baru.')
        if (existing.pendingVersion !== undefined) conflict('FILE_UPLOAD_IN_PROGRESS', 'File masih memiliki versi yang sedang diproses.')
      }
      if (currentQuota.usedBytes + currentQuota.reservedBytes + input.sizeBytes > currentQuota.limitBytes) {
        throw new CampusError(409, 'FILE_QUOTA_EXCEEDED', 'Kuota penyimpanan tidak mencukupi.', {
          availableBytes: Math.max(0, currentQuota.limitBytes - currentQuota.usedBytes - currentQuota.reservedBytes),
        })
      }
      const version = existing?.nextVersion || 1
      const id = versionId(newFileId, version)
      const access = existing?.access || normalizeFileAccess(context, input.access)
      const nextFile: PrivateFileRecord = existing
        ? { ...existing, nextVersion: version + 1, pendingVersion: version, updatedAt: createdAt }
        : {
            id: newFileId,
            ownerUid,
            ownerName: context.displayName,
            name: normalizedName.name,
            extension: normalizedName.extension,
            mimeType: policy.mimeType,
            sizeBytes: 0,
            status: 'UPLOADING',
            access,
            currentVersion: null,
            nextVersion: 2,
            versionCount: 0,
            pendingVersion: 1,
            createdAt,
            updatedAt: createdAt,
            deleted: false,
          }
      const storagePath = `private/quarantine/${opaqueId('owner', ownerUid)}/${newFileId}/v${version}/${sessionId}`
      const nextVersion: PrivateFileVersion = {
        id,
        fileId: newFileId,
        uploadSessionId: sessionId,
        version,
        ownerUid,
        createdBy: context.uid,
        name: normalizedName.name,
        extension: normalizedName.extension,
        declaredMimeType: policy.mimeType,
        expectedSizeBytes: input.sizeBytes,
        storagePath,
        status: 'UPLOADING',
        createdAt,
      }
      const nextSession: FileUploadSession = {
        id: sessionId,
        fileId: newFileId,
        versionId: id,
        version,
        ownerUid,
        createdBy: context.uid,
        expectedSizeBytes: input.sizeBytes,
        declaredMimeType: policy.mimeType,
        extension: normalizedName.extension,
        storagePath,
        status: 'RESERVED',
        createdAt,
        expiresAt,
        idempotencyHash,
      }
      const nextQuota = { ...currentQuota, reservedBytes: currentQuota.reservedBytes + input.sizeBytes, updatedAt: createdAt }
      transaction.set(fileRef, nextFile)
      transaction.create(db.collection('fileVersions').doc(id), nextVersion)
      transaction.create(sessionRef, {
        ...nextSession,
        purgeAfter: firestorePurgeAfter(expiresAt, FIRESTORE_TTL_RETENTION_MS.expiredUploadSessionGrace),
      })
      transaction.set(quotaRef, nextQuota)
      return { file: nextFile, session: nextSession, quota: nextQuota, replayed: false }
    })
    file = transactionResult.file
    session = transactionResult.session
    quota = transactionResult.quota
    replayed = transactionResult.replayed
  }

  let upload: CreateUploadSessionResult['upload']
  try {
    upload = await fileStorage().createUploadTarget({
      sessionId: session.id,
      storagePath: session.storagePath,
      contentType: session.declaredMimeType,
      ownerUid: session.ownerUid,
      expiresAt: session.expiresAt,
    })
  } catch (error) {
    if (!replayed) await releaseReservedSession(session, 'REJECTED', 'UPLOAD_TARGET_ERROR', new Date().toISOString()).catch(() => undefined)
    throw error
  }

  if (!replayed) {
    await appendAudit({
      actor: context,
      action: 'FILE_UPLOAD_RESERVED',
      resourceType: 'file',
      resourceId: file.id,
      metadata: { version: session.version, sizeBytes: session.expectedSizeBytes, mimeType: session.declaredMimeType, expiresAt },
      event: auditEvent,
    })
  }
  return { file: clone(file), session: withoutStorageSession(session), upload, quota: clone(quota) }
}

export async function storeMockUploadContent(
  context: AuthContext,
  sessionId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const session = await getUploadSession(sessionId)
  requireSessionActor(context, session)
  if (session.status !== 'RESERVED') conflict('UPLOAD_SESSION_CLOSED', 'Sesi unggahan tidak lagi menerima data.')
  if (Date.parse(session.expiresAt) <= Date.now()) {
    await releaseReservedSession(session, 'EXPIRED', 'UPLOAD_SESSION_EXPIRED', new Date().toISOString())
    throw new CampusError(410, 'UPLOAD_SESSION_EXPIRED', 'Sesi unggahan telah kedaluwarsa.')
  }
  if (bytes.byteLength > session.expectedSizeBytes) {
    throw new CampusError(413, 'UPLOAD_TOO_LARGE', 'Data unggahan melebihi ukuran yang dipesan.')
  }
  putMockUploadObject(session.storagePath, bytes, contentType)
}

export async function getMockUploadLimit(context: AuthContext, sessionId: string): Promise<number> {
  const session = await getUploadSession(sessionId)
  requireSessionActor(context, session)
  if (session.status !== 'RESERVED') conflict('UPLOAD_SESSION_CLOSED', 'Sesi unggahan tidak lagi menerima data.')
  if (Date.parse(session.expiresAt) <= Date.now()) throw new CampusError(410, 'UPLOAD_SESSION_EXPIRED', 'Sesi unggahan telah kedaluwarsa.')
  return session.expectedSizeBytes
}

async function moveSessionToQuarantine(session: FileUploadSession, detectedMimeType: AllowedFileMimeType, sizeBytes: number, now: string): Promise<PrivateFileRecord> {
  if (dataMode() === 'mock') {
    const current = mock.sessions.get(session.id)
    if (!current || current.status !== 'RESERVED') conflict('UPLOAD_SESSION_CLOSED', 'Sesi unggahan telah diproses.')
    const quota = mockQuota(session.ownerUid, now)
    if (quota.reservedBytes < session.expectedSizeBytes) conflict('FILE_QUOTA_INCONSISTENT', 'Reservasi kuota file tidak konsisten.')
    const version = mock.versions.get(session.versionId)
    const file = mock.files.get(session.fileId)
    if (!version || !file) notFound('Metadata file')
    quota.reservedBytes -= session.expectedSizeBytes
    quota.usedBytes += sizeBytes
    quota.updatedAt = now
    const updatedFile: PrivateFileRecord = {
      ...file,
      ...(file.currentVersion === null ? { status: 'QUARANTINED' as const } : {}),
      updatedAt: now,
    }
    mock.quotas.set(session.ownerUid, quota)
    mock.sessions.set(session.id, { ...current, status: 'QUARANTINED', finalizedAt: now })
    mock.versions.set(version.id, { ...version, status: 'QUARANTINED', detectedMimeType, sizeBytes, finalizedAt: now })
    mock.files.set(file.id, updatedFile)
    return clone(updatedFile)
  }

  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan metadata file tidak tersedia.')
  const sessionRef = db.collection('fileUploadSessions').doc(session.id)
  const quotaRef = db.collection('fileQuotas').doc(session.ownerUid)
  const versionRef = db.collection('fileVersions').doc(session.versionId)
  const fileRef = db.collection('files').doc(session.fileId)
  return db.runTransaction(async (transaction) => {
    const [sessionSnapshot, quotaSnapshot, fileSnapshot] = await Promise.all([
      transaction.get(sessionRef), transaction.get(quotaRef), transaction.get(fileRef),
    ])
    if (!sessionSnapshot.exists || (sessionSnapshot.data() as FileUploadSession).status !== 'RESERVED') {
      conflict('UPLOAD_SESSION_CLOSED', 'Sesi unggahan telah diproses.')
    }
    if (!fileSnapshot.exists) notFound('Metadata file')
    const quota = quotaSnapshot.exists
      ? ({ ownerUid: session.ownerUid, ...quotaSnapshot.data() } as FileQuota)
      : emptyQuota(session.ownerUid, now)
    if (quota.reservedBytes < session.expectedSizeBytes) conflict('FILE_QUOTA_INCONSISTENT', 'Reservasi kuota file tidak konsisten.')
    const file = { id: fileSnapshot.id, ...fileSnapshot.data() } as PrivateFileRecord
    const updatedFile: PrivateFileRecord = {
      ...file,
      ...(file.currentVersion === null ? { status: 'QUARANTINED' as const } : {}),
      updatedAt: now,
    }
    transaction.set(quotaRef, { ...quota, reservedBytes: quota.reservedBytes - session.expectedSizeBytes, usedBytes: quota.usedBytes + sizeBytes, updatedAt: now })
    transaction.update(sessionRef, { status: 'QUARANTINED', finalizedAt: now })
    transaction.update(versionRef, { status: 'QUARANTINED', detectedMimeType, sizeBytes, finalizedAt: now })
    transaction.set(fileRef, updatedFile)
    return updatedFile
  })
}

async function recordScanFailure(version: PrivateFileVersion, error: unknown, now: string): Promise<void> {
  const scanResult = error instanceof CampusError && error.code === 'MALWARE_SCANNER_UNAVAILABLE' ? 'UNAVAILABLE' : 'ERROR'
  const scanMessage = error instanceof Error ? error.message.slice(0, 300) : 'Pemindaian gagal.'
  if (dataMode() === 'mock') {
    const current = mock.versions.get(version.id)
    if (current?.status === 'QUARANTINED') mock.versions.set(version.id, { ...current, scanResult, scanMessage, scannedAt: now })
    return
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan metadata file tidak tersedia.')
  await db.collection('fileVersions').doc(version.id).update({ scanResult, scanMessage, scannedAt: now })
}

async function applyScanVerdict(
  file: PrivateFileRecord,
  version: PrivateFileVersion,
  result: MalwareScanResult,
  now: string,
): Promise<PrivateFileRecord> {
  const infected = result.verdict === 'INFECTED'
  if (infected) await fileStorage().deleteObject(version.storagePath).catch(() => undefined)

  if (dataMode() === 'mock') {
    const currentVersion = mock.versions.get(version.id)
    const currentFile = mock.files.get(file.id)
    const currentSession = mock.sessions.get(version.uploadSessionId)
    if (!currentVersion || !currentFile || currentVersion.status !== 'QUARANTINED') {
      conflict('FILE_SCAN_STATE_CONFLICT', 'Status versi file berubah selama pemindaian.')
    }
    let updatedFile: PrivateFileRecord
    if (infected) {
      const quota = mockQuota(version.ownerUid, now)
      if (quota.usedBytes < (version.sizeBytes || 0)) conflict('FILE_QUOTA_INCONSISTENT', 'Penggunaan kuota file tidak konsisten.')
      quota.usedBytes -= version.sizeBytes || 0
      quota.updatedAt = now
      mock.quotas.set(version.ownerUid, quota)
      updatedFile = {
        ...currentFile,
        ...(currentFile.currentVersion === null ? { status: 'REJECTED' as const } : {}),
        ...(currentFile.pendingVersion === version.version ? { pendingVersion: undefined } : {}),
        updatedAt: now,
      }
      mock.versions.set(version.id, {
        ...currentVersion,
        status: 'REJECTED',
        scanResult: 'INFECTED',
        scanMessage: result.message,
        sha256: result.sha256,
        scannedAt: now,
        rejectedAt: now,
        rejectionCode: 'MALWARE_DETECTED',
      })
      if (currentSession) mock.sessions.set(currentSession.id, { ...currentSession, status: 'REJECTED' })
    } else {
      updatedFile = {
        ...currentFile,
        name: currentVersion.name,
        extension: currentVersion.extension,
        mimeType: currentVersion.detectedMimeType || currentVersion.declaredMimeType,
        sizeBytes: currentVersion.sizeBytes || currentVersion.expectedSizeBytes,
        status: 'CLEAN',
        currentVersion: currentVersion.version,
        versionCount: currentFile.versionCount + 1,
        ...(currentFile.pendingVersion === version.version ? { pendingVersion: undefined } : {}),
        updatedAt: now,
      }
      mock.versions.set(version.id, { ...currentVersion, status: 'CLEAN', scanResult: 'CLEAN', sha256: result.sha256, scannedAt: now })
      if (currentSession) mock.sessions.set(currentSession.id, { ...currentSession, status: 'COMPLETED' })
    }
    mock.files.set(file.id, updatedFile)
    return clone(updatedFile)
  }

  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan metadata file tidak tersedia.')
  const fileRef = db.collection('files').doc(file.id)
  const versionRef = db.collection('fileVersions').doc(version.id)
  const sessionRef = db.collection('fileUploadSessions').doc(version.uploadSessionId)
  const quotaRef = db.collection('fileQuotas').doc(version.ownerUid)
  return db.runTransaction(async (transaction) => {
    const reads = [transaction.get(fileRef), transaction.get(versionRef), transaction.get(sessionRef)] as const
    const [fileSnapshot, versionSnapshot, sessionSnapshot] = await Promise.all(reads)
    const quotaSnapshot = infected ? await transaction.get(quotaRef) : undefined
    if (!fileSnapshot.exists || !versionSnapshot.exists) notFound('Metadata file')
    const currentFile = { id: fileSnapshot.id, ...fileSnapshot.data() } as PrivateFileRecord
    const currentVersion = { id: versionSnapshot.id, ...versionSnapshot.data() } as PrivateFileVersion
    if (currentVersion.status !== 'QUARANTINED') conflict('FILE_SCAN_STATE_CONFLICT', 'Status versi file berubah selama pemindaian.')
    const shouldClearPending = currentFile.pendingVersion === version.version
    const clearPending = shouldClearPending ? { pendingVersion: FieldValue.delete() } : {}
    let updatedFile: PrivateFileRecord
    if (infected) {
      const quota = quotaSnapshot?.exists
        ? ({ ownerUid: version.ownerUid, ...quotaSnapshot.data() } as FileQuota)
        : emptyQuota(version.ownerUid, now)
      const bytes = currentVersion.sizeBytes || 0
      if (quota.usedBytes < bytes) conflict('FILE_QUOTA_INCONSISTENT', 'Penggunaan kuota file tidak konsisten.')
      updatedFile = {
        ...currentFile,
        ...(currentFile.currentVersion === null ? { status: 'REJECTED' as const } : {}),
        updatedAt: now,
      }
      transaction.set(quotaRef, { ...quota, usedBytes: quota.usedBytes - bytes, updatedAt: now })
      transaction.update(versionRef, {
        status: 'REJECTED', scanResult: 'INFECTED', scanMessage: result.message || 'Malware terdeteksi.',
        sha256: result.sha256, scannedAt: now, rejectedAt: now, rejectionCode: 'MALWARE_DETECTED',
      })
      if (sessionSnapshot.exists) transaction.update(sessionRef, { status: 'REJECTED' })
    } else {
      updatedFile = {
        ...currentFile,
        name: currentVersion.name,
        extension: currentVersion.extension,
        mimeType: currentVersion.detectedMimeType || currentVersion.declaredMimeType,
        sizeBytes: currentVersion.sizeBytes || currentVersion.expectedSizeBytes,
        status: 'CLEAN',
        currentVersion: currentVersion.version,
        versionCount: currentFile.versionCount + 1,
        updatedAt: now,
      }
      transaction.update(versionRef, { status: 'CLEAN', scanResult: 'CLEAN', sha256: result.sha256, scannedAt: now })
      if (sessionSnapshot.exists) transaction.update(sessionRef, { status: 'COMPLETED' })
    }
    transaction.update(fileRef, { ...updatedFile, ...clearPending })
    return { ...updatedFile, ...(shouldClearPending ? { pendingVersion: undefined } : {}) }
  })
}

async function scanVersion(
  context: AuthContext,
  file: PrivateFileRecord,
  version: PrivateFileVersion,
  event?: H3Event,
): Promise<PrivateFileRecord> {
  const stream = await fileStorage().openReadStream(version.storagePath)
  let result: MalwareScanResult
  try {
    result = await malwareScanner().scan({
      fileId: file.id,
      version: version.version,
      fileName: version.name,
      mimeType: version.detectedMimeType || version.declaredMimeType,
      sizeBytes: version.sizeBytes || version.expectedSizeBytes,
      stream,
    })
  } catch (error) {
    const now = new Date().toISOString()
    await recordScanFailure(version, error, now)
    await appendAudit({
      actor: context,
      action: 'FILE_SCAN_DEFERRED',
      resourceType: 'file',
      resourceId: file.id,
      outcome: 'FAILURE',
      metadata: { version: version.version, reason: error instanceof CampusError ? error.code : 'SCAN_ERROR' },
      event,
    })
    throw error
  }

  const now = new Date().toISOString()
  const updated = await applyScanVerdict(file, version, result, now)
  await appendAudit({
    actor: context,
    action: result.verdict === 'CLEAN' ? 'FILE_ACCEPTED' : 'FILE_REJECTED_MALWARE',
    resourceType: 'file',
    resourceId: file.id,
    outcome: result.verdict === 'CLEAN' ? 'SUCCESS' : 'DENIED',
    metadata: { version: version.version, sizeBytes: version.sizeBytes, scanner: result.engine, sha256: result.sha256 },
    event,
  })
  return updated
}

export async function finalizeFileUpload(
  context: AuthContext,
  sessionId: string,
  event?: H3Event,
): Promise<FileDetailResult> {
  const session = await getUploadSession(sessionId)
  requireSessionActor(context, session)
  if (session.status !== 'RESERVED') conflict('UPLOAD_SESSION_CLOSED', 'Sesi unggahan telah diproses.')
  const now = Date.now()
  if (Date.parse(session.expiresAt) <= now) {
    await releaseReservedSession(session, 'EXPIRED', 'UPLOAD_SESSION_EXPIRED', nowIso(now))
    await fileStorage().deleteObject(session.storagePath).catch(() => undefined)
    throw new CampusError(410, 'UPLOAD_SESSION_EXPIRED', 'Sesi unggahan telah kedaluwarsa.')
  }

  let inspection
  try {
    inspection = await fileStorage().inspectObject(session.storagePath)
    if (inspection.sizeBytes !== session.expectedSizeBytes) {
      throw new CampusError(400, 'FILE_SIZE_MISMATCH', 'Ukuran objek tidak sama dengan ukuran yang dipesan.')
    }
    if (inspection.contentType !== session.declaredMimeType) {
      throw new CampusError(400, 'FILE_MIME_MISMATCH', 'Tipe MIME objek tidak sama dengan deklarasi unggahan.')
    }
    verifyFileSignature(session.extension, session.declaredMimeType, inspection.firstBytes)
  } catch (error) {
    await releaseReservedSession(session, 'REJECTED', error instanceof CampusError ? error.code : 'FILE_INSPECTION_FAILED', new Date().toISOString())
    await fileStorage().deleteObject(session.storagePath).catch(() => undefined)
    await appendAudit({
      actor: context,
      action: 'FILE_REJECTED_VALIDATION',
      resourceType: 'file',
      resourceId: session.fileId,
      outcome: 'DENIED',
      metadata: { version: session.version, reason: error instanceof CampusError ? error.code : 'FILE_INSPECTION_FAILED' },
      event,
    })
    throw error
  }

  const quarantinedAt = new Date().toISOString()
  const file = await moveSessionToQuarantine(session, session.declaredMimeType, inspection.sizeBytes, quarantinedAt)
  await appendAudit({
    actor: context,
    action: 'FILE_QUARANTINED',
    resourceType: 'file',
    resourceId: file.id,
    metadata: { version: session.version, sizeBytes: inspection.sizeBytes },
    event,
  })
  const version = await getVersionRecord(file.id, session.version)
  await scanVersion(context, file, version, event)
  return getPrivateFileDetail(context, file.id)
}

export async function rescanQuarantinedFile(
  context: AuthContext,
  fileId: string,
  versionNumber: number,
  event?: H3Event,
): Promise<FileDetailResult> {
  if (!isAdministrator(context)) forbidden('Hanya administrator yang dapat menjalankan pemindaian ulang.')
  const file = await getFileRecord(fileId)
  if (file.deleted) conflict('FILE_DELETED', 'File telah dihapus.')
  const version = await getVersionRecord(fileId, versionNumber)
  if (version.status !== 'QUARANTINED') conflict('FILE_NOT_QUARANTINED', 'Versi file tidak berada dalam karantina.')
  await scanVersion(context, file, version, event)
  return getPrivateFileDetail(context, fileId)
}

export async function listPrivateFiles(context: AuthContext, filters: FileListFilters = {}): Promise<FileListResult> {
  const limit = Math.min(Math.max(filters.limit || 20, 1), 50)
  const cursor = decodeCursor(filters.cursor)
  let candidates: PrivateFileRecord[]
  let nextCursor: string | undefined

  if (dataMode() === 'mock') {
    candidates = [...mock.files.values()].map(clone).sort(sortNewest)
    if (cursor) candidates = candidates.filter(file => cursorCompare(file, cursor))
    const matched = await Promise.all(candidates.map(async file => await matchesFilters(context, file, filters) ? file : undefined))
    const filtered = matched.filter((file): file is PrivateFileRecord => Boolean(file))
    const items = filtered.slice(0, limit)
    if (filtered.length > limit && items.length) {
      const last = items.at(-1)!
      nextCursor = encodeCursor({ updatedAt: last.updatedAt, id: last.id })
    }
    return { items, ...(nextCursor ? { nextCursor } : {}), quota: await getQuota(context.uid) }
  }

  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan metadata file tidak tersedia.')
  if (filters.scope === 'all' && !isAdministrator(context)) forbidden('Hanya administrator yang dapat melihat seluruh file.')
  const scanLimit = Math.min(Math.max(limit * 8, 80), 400)
  let query = db.collection('files')
    .orderBy('updatedAt', 'desc')
    .orderBy(FieldPath.documentId(), 'desc')
  if ((filters.scope || 'owned') === 'owned') query = query.where('ownerUid', '==', context.uid)
  if (cursor) query = query.startAfter(cursor.updatedAt, cursor.id)
  const snapshot = await query.limit(scanLimit).get()
  candidates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PrivateFileRecord))
  const matched = await Promise.all(candidates.map(async file => await matchesFilters(context, file, filters) ? file : undefined))
  const filtered = matched.filter((file): file is PrivateFileRecord => Boolean(file))
  const items = filtered.slice(0, limit)
  if (snapshot.size === scanLimit) {
    const lastScanned = candidates.at(-1)!
    nextCursor = encodeCursor({ updatedAt: lastScanned.updatedAt, id: lastScanned.id })
  } else if (items.length === limit) {
    const last = items.at(-1)!
    const remaining = candidates.filter(file => cursorCompare(file, { updatedAt: last.updatedAt, id: last.id }))
    const hasMoreMatched = (await Promise.all(remaining.map(file => matchesFilters(context, file, filters)))).some(Boolean)
    if (hasMoreMatched) nextCursor = encodeCursor({ updatedAt: last.updatedAt, id: last.id })
  }
  return { items: items.map(clone), ...(nextCursor ? { nextCursor } : {}), quota: await getQuota(context.uid) }
}

export async function getPrivateFileDetail(context: AuthContext, fileId: string): Promise<FileDetailResult> {
  const file = await getFileRecord(fileId)
  await requireReadAccess(context, file)
  let versions: PrivateFileVersion[]
  if (dataMode() === 'mock') {
    versions = [...mock.versions.values()]
      .filter(version => version.fileId === fileId)
      .sort((left, right) => right.version - left.version)
      .map(clone)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan versi file tidak tersedia.')
    const snapshot = await db.collection('fileVersions').where('fileId', '==', fileId).orderBy('version', 'desc').limit(100).get()
    versions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PrivateFileVersion))
  }
  return { file: clone(file), versions: versions.map(withoutStoragePath), quota: await getQuota(file.ownerUid) }
}

export async function softDeletePrivateFile(
  context: AuthContext,
  fileId: string,
  event?: H3Event,
): Promise<{ file: PrivateFileRecord; auditId: string }> {
  const now = new Date().toISOString()
  let before: PrivateFileRecord
  let after: PrivateFileRecord
  if (dataMode() === 'mock') {
    const file = mock.files.get(fileId)
    if (!file) notFound('File')
    requireManageAccess(context, file)
    if (file.deleted) conflict('FILE_ALREADY_DELETED', 'File telah dihapus sebelumnya.')
    before = clone(file)
    after = { ...file, status: 'DELETED', deleted: true, deletedAt: now, deletedBy: context.uid, updatedAt: now }
    mock.files.set(fileId, clone(after))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan metadata file tidak tersedia.')
    const ref = db.collection('files').doc(fileId)
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) notFound('File')
      const file = { id: snapshot.id, ...snapshot.data() } as PrivateFileRecord
      requireManageAccess(context, file)
      if (file.deleted) conflict('FILE_ALREADY_DELETED', 'File telah dihapus sebelumnya.')
      const updated: PrivateFileRecord = { ...file, status: 'DELETED', deleted: true, deletedAt: now, deletedBy: context.uid, updatedAt: now }
      transaction.set(ref, updated)
      return { file, updated }
    })
    before = result.file
    after = result.updated
  }
  const audit = await appendAudit({
    actor: context,
    action: 'FILE_SOFT_DELETED',
    resourceType: 'file',
    resourceId: fileId,
    before: { status: before.status, deleted: before.deleted },
    after: { status: after.status, deleted: after.deleted, deletedAt: after.deletedAt },
    event,
  })
  return { file: clone(after), auditId: audit.id }
}

export async function issuePrivateFileDownload(
  context: AuthContext,
  fileId: string,
  requestedVersion?: number,
  event?: H3Event,
): Promise<SignedDownloadResult> {
  const file = await getFileRecord(fileId)
  await requireReadAccess(context, file)
  if (file.deleted) throw new CampusError(410, 'FILE_DELETED', 'File telah dihapus.')
  const versionNumber = requestedVersion || file.currentVersion
  if (!versionNumber) conflict('FILE_NOT_READY', 'File belum memiliki versi bersih yang dapat diunduh.')
  const version = await getVersionRecord(fileId, versionNumber)
  if (version.status !== 'CLEAN') conflict('FILE_NOT_CLEAN', 'Versi file belum lolos pemeriksaan keamanan.')
  const expiresAt = new Date(Date.now() + FILE_DOWNLOAD_TTL_MS).toISOString()
  const url = await fileStorage().createDownloadUrl({
    storagePath: version.storagePath,
    fileName: version.name,
    contentType: version.detectedMimeType || version.declaredMimeType,
    expiresAt,
  })
  const audit = await appendAudit({
    actor: context,
    action: 'FILE_DOWNLOAD_ISSUED',
    resourceType: 'file',
    resourceId: fileId,
    metadata: { version: version.version, expiresAt, ownerUid: file.ownerUid },
    event,
  })
  return {
    url,
    expiresAt,
    fileName: version.name,
    mimeType: version.detectedMimeType || version.declaredMimeType,
    sizeBytes: version.sizeBytes || version.expectedSizeBytes,
    version: version.version,
    auditId: audit.id,
  }
}

export function resetFileServiceForTests(): void {
  mock.files.clear()
  mock.versions.clear()
  mock.sessions.clear()
  mock.quotas.clear()
}

export function fileMockStateForTests(): Readonly<FileMockState> {
  return mock
}
