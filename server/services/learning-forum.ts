import { FieldPath } from 'firebase-admin/firestore'
import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { LearningForumPost, LearningForumThread, LearningPage, SafeRichContent } from '../types/learning'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { FIRESTORE_TTL_RETENTION_MS, withFirestorePurgeAfter } from '../utils/firestore-ttl'
import { requirePermission } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { appendLearningActivity, loadLearningSpace, requireLearningSpaceManage, requireLearningSpaceRead } from './learning'
import { learningMockState } from './learning-mock'
import { cleanLearningId, cleanLearningInteger, cleanLearningText, validateSafeRichContent } from './learning-validation'

export interface CreateLearningForumThreadInput {
  spaceId: string
  title: string
  body: SafeRichContent
}

export interface UpdateLearningForumThreadInput {
  expectedVersion: number
  title: string
  body: SafeRichContent
}

export interface ModerateLearningForumThreadInput {
  expectedVersion: number
  status: 'OPEN' | 'LOCKED' | 'HIDDEN'
  reason: string
}

export interface CreateLearningForumPostInput {
  threadId: string
  parentPostId?: string
  body: SafeRichContent
}

export interface UpdateLearningForumPostInput {
  expectedVersion: number
  body: SafeRichContent
}

export interface ModerateLearningForumPostInput {
  expectedVersion: number
  hidden: boolean
  reason: string
}

function clone<T>(value: T): T { return structuredClone(value) }

function requireIdempotencyKey(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(value)) invalidInput('Idempotency key tidak valid.')
}

function limitValue(value?: number): number {
  return Math.min(Math.max(Number.isInteger(value) ? value! : 20, 1), 50)
}

function encodeCursor(value: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor(value?: string): { createdAt: string; id: string } | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (typeof parsed.createdAt !== 'string' || Number.isNaN(Date.parse(parsed.createdAt)) || typeof parsed.id !== 'string') invalidInput('Cursor forum tidak valid.')
    return { createdAt: parsed.createdAt, id: cleanLearningId(parsed.id, 'cursor.id') }
  } catch { invalidInput('Cursor forum tidak valid.') }
}

function afterCursor<T extends { createdAt: string; id: string }>(item: T, cursor?: { createdAt: string; id: string }): boolean {
  return !cursor || item.createdAt < cursor.createdAt || (item.createdAt === cursor.createdAt && item.id < cursor.id)
}

async function loadThread(id: string): Promise<LearningForumThread> {
  const safeId = cleanLearningId(id, 'threadId')
  if (dataMode() === 'mock') {
    const thread = learningMockState().forumThreads.get(safeId)
    if (!thread) notFound('Topik forum')
    return clone(thread)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan forum tidak tersedia.')
  const snapshot = await db.collection('learningForumThreads').doc(safeId).get()
  if (!snapshot.exists) notFound('Topik forum')
  return { id: snapshot.id, ...snapshot.data() } as LearningForumThread
}

async function loadPost(id: string): Promise<LearningForumPost> {
  const safeId = cleanLearningId(id, 'postId')
  if (dataMode() === 'mock') {
    const post = learningMockState().forumPosts.get(safeId)
    if (!post) notFound('Balasan forum')
    return clone(post)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan forum tidak tersedia.')
  const snapshot = await db.collection('learningForumPosts').doc(safeId).get()
  if (!snapshot.exists) notFound('Balasan forum')
  return { id: snapshot.id, ...snapshot.data() } as LearningForumPost
}

export async function listLearningForumThreads(context: AuthContext, spaceId: string, options: { cursor?: string; limit?: number } = {}): Promise<LearningPage<LearningForumThread>> {
  const space = await loadLearningSpace(spaceId)
  const access = await requireLearningSpaceRead(context, space)
  const limit = limitValue(options.limit), cursor = decodeCursor(options.cursor)
  let records: LearningForumThread[]
  if (dataMode() === 'mock') {
    records = [...learningMockState().forumThreads.values()]
      .filter(item => item.spaceId === space.id && (access.canManage || item.status !== 'HIDDEN'))
      .map(clone)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .filter(item => afterCursor(item, cursor))
      .slice(0, limit + 1)
  }
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan forum tidak tersedia.')
    let query = db.collection('learningForumThreads').where('spaceId', '==', space.id)
    if (!access.canManage) query = query.where('status', 'in', ['OPEN', 'LOCKED'])
    query = query.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc')
    if (cursor) query = query.startAfter(cursor.createdAt, cursor.id)
    const snapshot = await query.limit(limit + 1).get()
    records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as LearningForumThread)
  }
  const items = records.slice(0, limit)
  return { items, ...(records.length > limit && items.length ? { nextCursor: encodeCursor(items.at(-1)!) } : {}) }
}

export async function createLearningForumThread(context: AuthContext, input: CreateLearningForumThreadInput, idempotencyKey: string, event?: H3Event): Promise<{ thread: LearningForumThread; replayed: boolean; auditId?: string }> {
  requireIdempotencyKey(idempotencyKey)
  requirePermission(context, 'learning:participate_forum')
  const space = await loadLearningSpace(input.spaceId); await requireLearningSpaceRead(context, space)
  const normalized = { title: cleanLearningText(input.title, 'Judul topik', 180), body: validateSafeRichContent(input.body, 'Isi topik', 10_000) }
  const hash = requestHash({ spaceId: space.id, authorUid: context.uid, ...normalized }), namespace = `forum:thread:create:${idempotencyKey}`
  if (dataMode() === 'mock') { const previous = learningMockState().idempotency.get(namespace); if (previous) { if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...(clone(previous.response) as { thread: LearningForumThread; replayed: boolean }), replayed: true } } }
  const now = new Date().toISOString(), id = opaqueId('learning_thread', `${space.id}:${context.uid}:${idempotencyKey}`)
  const thread: LearningForumThread = { id, spaceId: space.id, ...normalized, authorUid: context.uid, status: 'OPEN', replyCount: 0, version: 1, editHistory: [], createdAt: now, updatedAt: now }
  const response = { thread, replayed: false }
  if (dataMode() === 'mock') { learningMockState().forumThreads.set(id, clone(thread)); learningMockState().idempotency.set(namespace, { requestHash: hash, response: clone(response) }) }
  else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan forum tidak tersedia.'); const idem = db.collection('learningIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async transaction => { const prior = await transaction.get(idem); if (prior.exists) { const stored = prior.data() as { requestHash: string; response: typeof response }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } } transaction.create(db.collection('learningForumThreads').doc(id), thread); transaction.create(idem, withFirestorePurgeAfter({ requestHash: hash, response, createdAt: now }, now, FIRESTORE_TTL_RETENTION_MS.idempotency)); return response }); if (result.replayed) return result
  }
  await appendLearningActivity({ spaceId: space.id, actorUid: context.uid, kind: 'FORUM_THREAD_CREATED', resourceId: id, label: thread.title, occurredAt: now })
  const audit = await appendAudit({ actor: context, action: 'LEARNING_FORUM_THREAD_CREATED', resourceType: 'learning_forum_thread', resourceId: id, after: { spaceId: space.id }, event })
  return { ...response, auditId: audit.id }
}

export async function updateLearningForumThread(context: AuthContext, id: string, input: UpdateLearningForumThreadInput, event?: H3Event): Promise<{ thread: LearningForumThread; auditId: string }> {
  requirePermission(context, 'learning:participate_forum')
  const current = await loadThread(id), space = await loadLearningSpace(current.spaceId); await requireLearningSpaceRead(context, space)
  if (current.authorUid !== context.uid) forbidden('Topik hanya dapat diubah penulisnya.')
  const expectedVersion = cleanLearningInteger(input.expectedVersion, 'expectedVersion', 1, 100_000)
  const normalized = { title: cleanLearningText(input.title, 'Judul topik', 180), body: validateSafeRichContent(input.body, 'Isi topik', 10_000) }
  const now = new Date().toISOString(), history = [...current.editHistory, { body: current.body, editedAt: now, editedBy: context.uid }].slice(-10)
  let thread: LearningForumThread
  if (dataMode() === 'mock') { const fresh = learningMockState().forumThreads.get(id); if (!fresh) notFound('Topik forum'); if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Topik telah berubah.', { currentVersion: fresh.version }); thread = { ...fresh, ...normalized, version: fresh.version + 1, editHistory: history, updatedAt: now }; learningMockState().forumThreads.set(id, clone(thread)) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan forum tidak tersedia.'); const reference = db.collection('learningForumThreads').doc(id); thread = await db.runTransaction(async transaction => { const snapshot = await transaction.get(reference); if (!snapshot.exists) notFound('Topik forum'); const fresh = { id: snapshot.id, ...snapshot.data() } as LearningForumThread; if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Topik telah berubah.', { currentVersion: fresh.version }); const next = { ...fresh, ...normalized, version: fresh.version + 1, editHistory: [...fresh.editHistory, { body: fresh.body, editedAt: now, editedBy: context.uid }].slice(-10), updatedAt: now }; transaction.set(reference, next); return next }) }
  const audit = await appendAudit({ actor: context, action: 'LEARNING_FORUM_THREAD_UPDATED', resourceType: 'learning_forum_thread', resourceId: id, before: { version: expectedVersion }, after: { version: thread.version, historyCount: thread.editHistory.length }, event })
  return { thread, auditId: audit.id }
}

export async function moderateLearningForumThread(context: AuthContext, id: string, input: ModerateLearningForumThreadInput, event?: H3Event): Promise<{ thread: LearningForumThread; auditId: string }> {
  requirePermission(context, 'learning:moderate_forum')
  const current = await loadThread(id), space = await loadLearningSpace(current.spaceId); await requireLearningSpaceManage(context, space)
  const expectedVersion = cleanLearningInteger(input.expectedVersion, 'expectedVersion', 1, 100_000)
  if (!['OPEN', 'LOCKED', 'HIDDEN'].includes(input.status)) invalidInput('Status moderasi tidak valid.')
  const reason = cleanLearningText(input.reason, 'Alasan moderasi', 500), now = new Date().toISOString()
  let thread: LearningForumThread
  if (dataMode() === 'mock') { const fresh = learningMockState().forumThreads.get(id); if (!fresh) notFound('Topik forum'); if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Topik telah berubah.', { currentVersion: fresh.version }); thread = { ...fresh, status: input.status, version: fresh.version + 1, updatedAt: now, moderatedAt: now, moderatedBy: context.uid, moderationReason: reason }; learningMockState().forumThreads.set(id, clone(thread)) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan forum tidak tersedia.'); const reference = db.collection('learningForumThreads').doc(id); thread = await db.runTransaction(async transaction => { const snapshot = await transaction.get(reference); if (!snapshot.exists) notFound('Topik forum'); const fresh = { id: snapshot.id, ...snapshot.data() } as LearningForumThread; if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Topik telah berubah.', { currentVersion: fresh.version }); const next = { ...fresh, status: input.status, version: fresh.version + 1, updatedAt: now, moderatedAt: now, moderatedBy: context.uid, moderationReason: reason }; transaction.set(reference, next); return next }) }
  const audit = await appendAudit({ actor: context, action: 'LEARNING_FORUM_THREAD_MODERATED', resourceType: 'learning_forum_thread', resourceId: id, before: { status: current.status, version: expectedVersion }, after: { status: thread.status, version: thread.version, reason }, event }); return { thread, auditId: audit.id }
}

export async function listLearningForumPosts(context: AuthContext, threadId: string, options: { cursor?: string; limit?: number } = {}): Promise<LearningPage<LearningForumPost>> {
  const thread = await loadThread(threadId), space = await loadLearningSpace(thread.spaceId), access = await requireLearningSpaceRead(context, space)
  if (thread.status === 'HIDDEN' && !access.canManage) notFound('Topik forum')
  const limit = limitValue(options.limit), cursor = decodeCursor(options.cursor)
  let records: LearningForumPost[]
  if (dataMode() === 'mock') {
    records = [...learningMockState().forumPosts.values()]
      .filter(item => item.threadId === thread.id && (access.canManage || item.status === 'VISIBLE'))
      .map(clone)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .filter(item => afterCursor(item, cursor))
      .slice(0, limit + 1)
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan forum tidak tersedia.')
    let query = db.collection('learningForumPosts').where('threadId', '==', thread.id)
    if (!access.canManage) query = query.where('status', '==', 'VISIBLE')
    query = query.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc')
    if (cursor) query = query.startAfter(cursor.createdAt, cursor.id)
    const snapshot = await query.limit(limit + 1).get()
    records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as LearningForumPost)
  }
  const items = records.slice(0, limit)
  return { items, ...(records.length > limit && items.length ? { nextCursor: encodeCursor(items.at(-1)!) } : {}) }
}

export async function createLearningForumPost(context: AuthContext, input: CreateLearningForumPostInput, idempotencyKey: string, event?: H3Event): Promise<{ post: LearningForumPost; thread: LearningForumThread; replayed: boolean; auditId?: string }> {
  requireIdempotencyKey(idempotencyKey); requirePermission(context, 'learning:participate_forum')
  const thread = await loadThread(input.threadId), space = await loadLearningSpace(thread.spaceId); await requireLearningSpaceRead(context, space)
  if (thread.status !== 'OPEN') conflict('FORUM_THREAD_LOCKED', 'Topik tidak menerima balasan baru.')
  const parent = input.parentPostId ? await loadPost(input.parentPostId) : undefined
  if (parent && (parent.threadId !== thread.id || parent.depth !== 0)) conflict('FORUM_DEPTH_LIMIT', 'Balasan forum dibatasi sampai dua tingkat.')
  const body = validateSafeRichContent(input.body, 'Isi balasan', 10_000), hash = requestHash({ threadId: thread.id, parentPostId: parent?.id, body, authorUid: context.uid }), namespace = `forum:post:create:${idempotencyKey}`
  if (dataMode() === 'mock') { const prior = learningMockState().idempotency.get(namespace); if (prior) { if (prior.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...(clone(prior.response) as { post: LearningForumPost; thread: LearningForumThread; replayed: boolean }), replayed: true } } }
  if (thread.replyCount >= 200) conflict('FORUM_REPLY_LIMIT', 'Topik telah mencapai batas 200 balasan.')
  const now = new Date().toISOString(), id = opaqueId('learning_post', `${thread.id}:${context.uid}:${idempotencyKey}`)
  const post: LearningForumPost = { id, threadId: thread.id, spaceId: space.id, parentPostId: parent?.id, depth: parent ? 1 : 0, body, authorUid: context.uid, status: 'VISIBLE', version: 1, editHistory: [], createdAt: now, updatedAt: now }
  let nextThread: LearningForumThread = { ...thread, replyCount: thread.replyCount + 1, version: thread.version + 1, updatedAt: now }
  const response = { post, thread: nextThread, replayed: false }
  if (dataMode() === 'mock') {
    const fresh = learningMockState().forumThreads.get(thread.id); if (!fresh || fresh.version !== thread.version || fresh.status !== 'OPEN') conflict('VERSION_CONFLICT', 'Topik telah berubah.'); if (fresh.replyCount >= 200) conflict('FORUM_REPLY_LIMIT', 'Topik telah mencapai batas 200 balasan.')
    nextThread = { ...fresh, replyCount: fresh.replyCount + 1, version: fresh.version + 1, updatedAt: now }; response.thread = nextThread; learningMockState().forumThreads.set(thread.id, clone(nextThread)); learningMockState().forumPosts.set(id, clone(post)); learningMockState().idempotency.set(namespace, { requestHash: hash, response: clone(response) })
  } else {
    const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan forum tidak tersedia.'); const threadRef = db.collection('learningForumThreads').doc(thread.id), postRef = db.collection('learningForumPosts').doc(id), idemRef = db.collection('learningIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async transaction => { const [idem, threadSnapshot] = await Promise.all([transaction.get(idemRef), transaction.get(threadRef)]); if (idem.exists) { const stored = idem.data() as { requestHash: string; response: typeof response }; if (stored.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key digunakan untuk payload berbeda.'); return { ...stored.response, replayed: true } } if (!threadSnapshot.exists) notFound('Topik forum'); const fresh = { id: threadSnapshot.id, ...threadSnapshot.data() } as LearningForumThread; if (fresh.status !== 'OPEN') conflict('FORUM_THREAD_LOCKED', 'Topik tidak menerima balasan baru.'); if (fresh.replyCount >= 200) conflict('FORUM_REPLY_LIMIT', 'Topik telah mencapai batas 200 balasan.'); const updated = { ...fresh, replyCount: fresh.replyCount + 1, version: fresh.version + 1, updatedAt: now }; const storedResponse = { post, thread: updated, replayed: false }; transaction.set(threadRef, updated); transaction.create(postRef, post); transaction.create(idemRef, withFirestorePurgeAfter({ requestHash: hash, response: storedResponse, createdAt: now }, now, FIRESTORE_TTL_RETENTION_MS.idempotency)); return storedResponse }); if (result.replayed) return result; nextThread = result.thread
  }
  await appendLearningActivity({ spaceId: space.id, actorUid: context.uid, kind: 'FORUM_POST_CREATED', resourceId: id, label: thread.title, occurredAt: now }); const audit = await appendAudit({ actor: context, action: 'LEARNING_FORUM_POST_CREATED', resourceType: 'learning_forum_post', resourceId: id, after: { threadId: thread.id, parentPostId: parent?.id, depth: post.depth }, event }); return { post, thread: nextThread, replayed: false, auditId: audit.id }
}

export async function updateLearningForumPost(context: AuthContext, id: string, input: UpdateLearningForumPostInput, event?: H3Event): Promise<{ post: LearningForumPost; auditId: string }> {
  requirePermission(context, 'learning:participate_forum')
  const current = await loadPost(id), space = await loadLearningSpace(current.spaceId); await requireLearningSpaceRead(context, space)
  if (current.authorUid !== context.uid) forbidden('Balasan hanya dapat diubah penulisnya.')
  const expectedVersion = cleanLearningInteger(input.expectedVersion, 'expectedVersion', 1, 100_000), body = validateSafeRichContent(input.body, 'Isi balasan', 10_000), now = new Date().toISOString()
  let post: LearningForumPost
  if (dataMode() === 'mock') { const fresh = learningMockState().forumPosts.get(id); if (!fresh) notFound('Balasan forum'); if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Balasan telah berubah.', { currentVersion: fresh.version }); post = { ...fresh, body, version: fresh.version + 1, editHistory: [...fresh.editHistory, { body: fresh.body, editedAt: now, editedBy: context.uid }].slice(-10), updatedAt: now }; learningMockState().forumPosts.set(id, clone(post)) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan forum tidak tersedia.'); const reference = db.collection('learningForumPosts').doc(id); post = await db.runTransaction(async transaction => { const snapshot = await transaction.get(reference); if (!snapshot.exists) notFound('Balasan forum'); const fresh = { id: snapshot.id, ...snapshot.data() } as LearningForumPost; if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Balasan telah berubah.', { currentVersion: fresh.version }); const next = { ...fresh, body, version: fresh.version + 1, editHistory: [...fresh.editHistory, { body: fresh.body, editedAt: now, editedBy: context.uid }].slice(-10), updatedAt: now }; transaction.set(reference, next); return next }) }
  const audit = await appendAudit({ actor: context, action: 'LEARNING_FORUM_POST_UPDATED', resourceType: 'learning_forum_post', resourceId: id, before: { version: expectedVersion }, after: { version: post.version, historyCount: post.editHistory.length }, event }); return { post, auditId: audit.id }
}

export async function moderateLearningForumPost(context: AuthContext, id: string, input: ModerateLearningForumPostInput, event?: H3Event): Promise<{ post: LearningForumPost; auditId: string }> {
  requirePermission(context, 'learning:moderate_forum')
  const current = await loadPost(id), space = await loadLearningSpace(current.spaceId); await requireLearningSpaceManage(context, space)
  const expectedVersion = cleanLearningInteger(input.expectedVersion, 'expectedVersion', 1, 100_000), reason = cleanLearningText(input.reason, 'Alasan moderasi', 500), now = new Date().toISOString(), status = input.hidden ? 'HIDDEN' as const : 'VISIBLE' as const
  let post: LearningForumPost
  if (dataMode() === 'mock') { const fresh = learningMockState().forumPosts.get(id); if (!fresh) notFound('Balasan forum'); if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Balasan telah berubah.', { currentVersion: fresh.version }); post = { ...fresh, status, version: fresh.version + 1, moderatedAt: now, moderatedBy: context.uid, moderationReason: reason, updatedAt: now }; learningMockState().forumPosts.set(id, clone(post)) }
  else { const db = firestoreAdmin(); if (!db) serviceUnavailable('Penyimpanan forum tidak tersedia.'); const reference = db.collection('learningForumPosts').doc(id); post = await db.runTransaction(async transaction => { const snapshot = await transaction.get(reference); if (!snapshot.exists) notFound('Balasan forum'); const fresh = { id: snapshot.id, ...snapshot.data() } as LearningForumPost; if (fresh.version !== expectedVersion) conflict('VERSION_CONFLICT', 'Balasan telah berubah.', { currentVersion: fresh.version }); const next = { ...fresh, status, version: fresh.version + 1, moderatedAt: now, moderatedBy: context.uid, moderationReason: reason, updatedAt: now }; transaction.set(reference, next); return next }) }
  const audit = await appendAudit({ actor: context, action: 'LEARNING_FORUM_POST_MODERATED', resourceType: 'learning_forum_post', resourceId: id, before: { status: current.status, version: expectedVersion }, after: { status: post.status, version: post.version, reason }, event }); return { post, auditId: audit.id }
}
