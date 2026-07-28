import type { H3Event } from 'h3'
import type { AuthContext, UserRole } from '../types/auth'
import {
  LMS_MVP_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  type EmailDeliveryAdapter,
  type EmailOutboxRecord,
  type EmailOutboxSummary,
  type InAppNotification,
  type NotificationCategory,
  type NotificationPreferences,
  type NotificationTemplate,
} from '../types/communications'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, isCampusError, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { FIRESTORE_TTL_RETENTION_MS, firestorePurgeAfter } from '../utils/firestore-ttl'
import { hasRole } from '../utils/rbac'
import { opaqueId, requestHash } from '../utils/security'
import { listActiveAccountsByIds } from './accounts'
import { BUILT_IN_LMS_NOTIFICATION_TEMPLATES, notificationModuleState } from './notifications-state'
import { serverFeatureProfile } from '../utils/feature-profile'
import { emailDeliveryEnabled } from '../utils/capabilities'

const CATEGORY_ROLES: Record<NotificationCategory, UserRole[]> = {
  ACADEMIC: ['academic_staff'],
  FINANCE: ['finance_staff'],
  LEARNING: ['lecturer', 'academic_staff'],
  SERVICE: ['academic_staff', 'finance_staff', 'student_affairs_staff', 'admissions_staff'],
  SYSTEM: ['administrator'],
}

const SENSITIVE_VARIABLE = /password|passcode|token|secret|credential|cookie|authorization|private|nik|bank.?account/i
const LMS_MVP_NOTIFICATION_CATEGORY_SET = new Set<NotificationCategory>(LMS_MVP_NOTIFICATION_CATEGORIES)

export interface EnqueueNotificationInput {
  recipientUid: string
  recipientEmail?: string
  programStudyId?: string
  templateKey: string
  variables: Record<string, string | number | boolean>
  actionPath?: string
}

export interface EnqueueNotificationResult {
  notification?: InAppNotification
  outboxId?: string
  channels: Array<'IN_APP' | 'EMAIL'>
  replayed: boolean
  auditId?: string
}

export interface EnqueueLearningNotificationBatchInput {
  recipientUids: string[]
  templateKey: string
  variables: Record<string, string | number | boolean>
  actionPath: string
  eventKey: string
}

export interface EnqueueLearningNotificationBatchResult {
  requestedRecipients: number
  activeRecipients: number
  inAppQueued: number
  emailQueued: number
}

export interface EnqueuePasswordResetResult {
  outboxId: string
  replayed: boolean
}

export interface UpsertTemplateInput {
  name: string
  category: NotificationCategory
  titleTemplate: string
  bodyTemplate: string
  emailSubjectTemplate: string
  emailBodyTemplate: string
  channels: Array<'IN_APP' | 'EMAIL'>
  active: boolean
  expectedVersion?: number
}

function requireAdministrator(context: AuthContext): void {
  if (!hasRole(context, 'administrator')) forbidden('Fitur ini hanya tersedia untuk administrator.')
}

function cleanText(value: string, max: number): string {
  const clean = value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean || clean.length > max) invalidInput('Konten notifikasi tidak valid.')
  return clean
}

function normalizeVariables(value: Record<string, string | number | boolean>): Record<string, string> {
  const entries = Object.entries(value)
  if (entries.length > 30) invalidInput('Variabel notifikasi terlalu banyak.')
  return Object.fromEntries(entries.map(([key, item]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,49}$/.test(key) || SENSITIVE_VARIABLE.test(key)) {
      invalidInput('Nama variabel notifikasi tidak diizinkan.')
    }
    return [key, cleanText(String(item), 300)]
  }))
}

function render(template: string, variables: Record<string, string>): string {
  return cleanText(template.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (_, key: string) => variables[key] ?? ''), 4_000)
}

function normalizeEmail(value?: string): string | undefined {
  if (!value) return undefined
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalidInput('Alamat email penerima tidak valid.')
  return email
}

function normalizeActionPath(value?: string): string | undefined {
  if (!value) return undefined
  if (!value.startsWith('/') || value.startsWith('//') || value.length > 300 || /[\u0000-\u001F]/.test(value)) {
    invalidInput('Tautan tindakan notifikasi tidak valid.')
  }
  return value
}

function defaultPreferences(uid: string, now = new Date().toISOString()): NotificationPreferences {
  return {
    uid,
    inAppEnabled: true,
    emailEnabled: true,
    categoryEmail: { ACADEMIC: true, FINANCE: true, LEARNING: true, SERVICE: true, SYSTEM: true },
    updatedAt: now,
  }
}

function isLmsMvpProfile(): boolean {
  return serverFeatureProfile() === 'lms-mvp'
}

function isLmsMvpNotificationCategory(category: NotificationCategory | undefined): category is 'LEARNING' | 'SYSTEM' {
  return Boolean(category && LMS_MVP_NOTIFICATION_CATEGORY_SET.has(category))
}

function preferencesForCurrentProfile(preferences: NotificationPreferences): NotificationPreferences {
  const clone = structuredClone(preferences)
  if (!isLmsMvpProfile()) return clone
  clone.categoryEmail.ACADEMIC = false
  clone.categoryEmail.FINANCE = false
  clone.categoryEmail.SERVICE = false
  return clone
}

function emailOutboxSummary(record: EmailOutboxRecord, category = record.category): EmailOutboxSummary {
  return {
    id: record.id,
    deliveryKind: record.deliveryKind,
    templateKey: record.templateKey,
    ...(category ? { category } : {}),
    status: record.status,
    attempts: record.attempts,
    maxAttempts: record.maxAttempts,
    nextAttemptAt: record.nextAttemptAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.sentAt ? { sentAt: record.sentAt } : {}),
    ...(record.lastError ? { lastError: { code: record.lastError.code, occurredAt: record.lastError.occurredAt } } : {}),
  }
}

export function nextEmailDeliveryAt(preferences: NotificationPreferences, now = new Date()): string {
  const quiet = preferences.quietHours
  if (!quiet || quiet.start === quiet.end) return now.toISOString()
  const [startHour, startMinute] = quiet.start.split(':').map(Number) as [number, number]
  const [endHour, endMinute] = quiet.end.split(':').map(Number) as [number, number]
  const offsetMs = 7 * 60 * 60 * 1000
  const local = new Date(now.getTime() + offsetMs)
  const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes()
  const start = startHour * 60 + startMinute
  const end = endHour * 60 + endMinute
  const crossesMidnight = start > end
  const isQuiet = crossesMidnight ? minuteOfDay >= start || minuteOfDay < end : minuteOfDay >= start && minuteOfDay < end
  if (!isQuiet) return now.toISOString()
  if (crossesMidnight && minuteOfDay >= start) local.setUTCDate(local.getUTCDate() + 1)
  local.setUTCHours(endHour, endMinute, 0, 0)
  return new Date(local.getTime() - offsetMs).toISOString()
}

function canEnqueue(context: AuthContext, template: NotificationTemplate, programStudyId?: string): boolean {
  if (hasRole(context, 'administrator')) return true
  if (!CATEGORY_ROLES[template.category].some(role => hasRole(context, role))) return false
  return !programStudyId || context.scope.programStudyIds.includes(programStudyId)
}

async function templateByKey(key: string): Promise<NotificationTemplate> {
  if (dataMode() === 'mock') {
    const template = notificationModuleState().templates.get(key)
    if (!template) notFound('Template notifikasi')
    return structuredClone(template)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan notifikasi tidak tersedia.')
  const snapshot = await db.collection('notificationTemplates').doc(key).get()
  if (!snapshot.exists) {
    const builtIn = BUILT_IN_LMS_NOTIFICATION_TEMPLATES.find(template => template.key === key)
    if (builtIn) return structuredClone(builtIn)
    notFound('Template notifikasi')
  }
  return { key: snapshot.id, ...snapshot.data() } as NotificationTemplate
}

async function allNotificationTemplates(): Promise<NotificationTemplate[]> {
  if (dataMode() === 'mock') {
    return [...notificationModuleState().templates.values()].map(template => structuredClone(template))
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan template notifikasi tidak tersedia.')
  const snapshot = await db.collection('notificationTemplates').limit(100).get()
  const stored = snapshot.docs.map(doc => ({ key: doc.id, ...doc.data() }) as NotificationTemplate)
  const storedKeys = new Set(stored.map(template => template.key))
  return [
    ...stored,
    ...BUILT_IN_LMS_NOTIFICATION_TEMPLATES
      .filter(template => !storedKeys.has(template.key))
      .map(template => structuredClone(template)),
  ]
}

async function categoryForEmailOutbox(record: EmailOutboxRecord): Promise<NotificationCategory | undefined> {
  if (record.category && NOTIFICATION_CATEGORIES.includes(record.category)) return record.category
  if (record.deliveryKind === 'PASSWORD_RESET' || record.templateKey === 'password-reset') return 'SYSTEM'
  try {
    return (await templateByKey(record.templateKey)).category
  } catch (error) {
    if (isCampusError(error) && error.statusCode === 404) return undefined
    throw error
  }
}

export async function getNotificationPreferences(uid: string): Promise<NotificationPreferences> {
  let preferences: NotificationPreferences
  if (dataMode() === 'mock') preferences = notificationModuleState().preferences.get(uid) ?? defaultPreferences(uid)
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan preferensi notifikasi tidak tersedia.')
    const snapshot = await db.collection('notificationPreferences').doc(uid).get()
    preferences = snapshot.exists ? snapshot.data() as NotificationPreferences : defaultPreferences(uid)
  }
  return preferencesForCurrentProfile(preferences)
}

export async function updateNotificationPreferences(
  context: AuthContext,
  input: Omit<NotificationPreferences, 'uid' | 'updatedAt'>,
  event?: H3Event,
): Promise<{ preferences: NotificationPreferences; auditId: string }> {
  const now = new Date().toISOString()
  for (const category of NOTIFICATION_CATEGORIES) {
    if (typeof input.categoryEmail?.[category] !== 'boolean') invalidInput('Preferensi kategori tidak lengkap.')
  }
  if (input.quietHours && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.quietHours.start)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.quietHours.end)
    || input.quietHours.timezone !== 'Asia/Jakarta')) invalidInput('Jam tenang tidak valid.')
  const preferences: NotificationPreferences = {
    uid: context.uid,
    inAppEnabled: Boolean(input.inAppEnabled),
    emailEnabled: Boolean(input.emailEnabled),
    categoryEmail: {
      ...input.categoryEmail,
      ...(isLmsMvpProfile() ? { ACADEMIC: false, FINANCE: false, SERVICE: false } : {}),
    },
    ...(input.quietHours ? { quietHours: { ...input.quietHours } } : {}),
    updatedAt: now,
  }
  if (dataMode() === 'mock') notificationModuleState().preferences.set(context.uid, structuredClone(preferences))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan preferensi notifikasi tidak tersedia.')
    await db.collection('notificationPreferences').doc(context.uid).set(preferences)
  }
  const audit = await appendAudit({
    actor: context, action: 'NOTIFICATION_PREFERENCES_UPDATED', resourceType: 'notification_preferences',
    resourceId: context.uid, after: { inAppEnabled: preferences.inAppEnabled, emailEnabled: preferences.emailEnabled }, event,
  })
  return { preferences, auditId: audit.id }
}

export async function listNotificationTemplates(context: AuthContext): Promise<NotificationTemplate[]> {
  requireAdministrator(context)
  const templates = await allNotificationTemplates()
  return isLmsMvpProfile()
    ? templates.filter(template => isLmsMvpNotificationCategory(template.category))
    : templates
}

export async function upsertNotificationTemplate(
  context: AuthContext,
  key: string,
  input: UpsertTemplateInput,
  event?: H3Event,
): Promise<{ template: NotificationTemplate; auditId: string }> {
  requireAdministrator(context)
  if (!/^[a-z][a-z0-9-]{2,79}$/.test(key)) invalidInput('Kunci template tidak valid.')
  if (!NOTIFICATION_CATEGORIES.includes(input.category)) invalidInput('Kategori notifikasi tidak valid.')
  const channels = [...new Set(input.channels)]
  if (!channels.length || channels.some(channel => !['IN_APP', 'EMAIL'].includes(channel))) invalidInput('Kanal template tidak valid.')
  const now = new Date().toISOString()
  let template: NotificationTemplate
  if (dataMode() === 'mock') {
    const current = notificationModuleState().templates.get(key)
    if (input.expectedVersion !== undefined && (current?.version ?? 0) !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Template telah berubah.')
    template = {
      key, name: cleanText(input.name, 120), category: input.category,
      titleTemplate: cleanText(input.titleTemplate, 180), bodyTemplate: cleanText(input.bodyTemplate, 1_000),
      emailSubjectTemplate: cleanText(input.emailSubjectTemplate, 180), emailBodyTemplate: cleanText(input.emailBodyTemplate, 4_000),
      channels, active: Boolean(input.active), version: (current?.version ?? 0) + 1, updatedAt: now, updatedBy: context.uid,
    }
    notificationModuleState().templates.set(key, structuredClone(template))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan template notifikasi tidak tersedia.')
    const reference = db.collection('notificationTemplates').doc(key)
    template = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      const current = snapshot.exists ? snapshot.data() as NotificationTemplate : undefined
      if (input.expectedVersion !== undefined && (current?.version ?? 0) !== input.expectedVersion) conflict('VERSION_CONFLICT', 'Template telah berubah.')
      const next: NotificationTemplate = {
        key, name: cleanText(input.name, 120), category: input.category,
        titleTemplate: cleanText(input.titleTemplate, 180), bodyTemplate: cleanText(input.bodyTemplate, 1_000),
        emailSubjectTemplate: cleanText(input.emailSubjectTemplate, 180), emailBodyTemplate: cleanText(input.emailBodyTemplate, 4_000),
        channels, active: Boolean(input.active), version: (current?.version ?? 0) + 1, updatedAt: now, updatedBy: context.uid,
      }
      transaction.set(reference, next)
      return next
    })
  }
  const audit = await appendAudit({ actor: context, action: 'NOTIFICATION_TEMPLATE_UPSERTED', resourceType: 'notification_template', resourceId: key, after: { category: template.category, active: template.active, version: template.version }, event })
  return { template, auditId: audit.id }
}

async function enqueueNotificationWithAuthorization(
  context: AuthContext,
  input: EnqueueNotificationInput,
  idempotencyKey: string,
  event?: H3Event,
  trustedLearningEvent = false,
): Promise<EnqueueNotificationResult> {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) invalidInput('Idempotency key tidak valid.')
  const template = await templateByKey(input.templateKey)
  if (isLmsMvpProfile() && !isLmsMvpNotificationCategory(template.category)) notFound('Template notifikasi')
  if (!template.active) conflict('TEMPLATE_INACTIVE', 'Template notifikasi tidak aktif.')
  const builtInLearningEvent = template.category === 'LEARNING'
    && BUILT_IN_LMS_NOTIFICATION_TEMPLATES.some(candidate => candidate.key === template.key)
  if (trustedLearningEvent ? !builtInLearningEvent : !canEnqueue(context, template, input.programStudyId)) {
    forbidden('Notifikasi berada di luar lingkup kewenangan Anda.')
  }
  const variables = normalizeVariables(input.variables)
  const recipientUid = cleanText(input.recipientUid, 128)
  const recipientEmail = normalizeEmail(input.recipientEmail)
  const actionPath = normalizeActionPath(input.actionPath)
  const normalized = { recipientUid, recipientEmail, templateKey: template.key, variables, actionPath, programStudyId: input.programStudyId }
  const hash = requestHash(normalized)
  const namespace = `notification:${idempotencyKey}`
  const now = new Date().toISOString()
  const preferences = await getNotificationPreferences(recipientUid)
  const channels: Array<'IN_APP' | 'EMAIL'> = []
  const notification = template.channels.includes('IN_APP') && preferences.inAppEnabled
    ? {
        id: opaqueId('notification', idempotencyKey), recipientUid, templateKey: template.key, category: template.category,
        title: render(template.titleTemplate, variables), body: render(template.bodyTemplate, variables),
        ...(actionPath ? { actionPath } : {}), createdAt: now,
      } satisfies InAppNotification
    : undefined
  if (notification) channels.push('IN_APP')
  const emailEnabled = emailDeliveryEnabled() && template.channels.includes('EMAIL') && preferences.emailEnabled
    && preferences.categoryEmail[template.category] && Boolean(recipientEmail)
  const outbox = emailEnabled
    ? {
      id: opaqueId('email', idempotencyKey), recipientUid, recipientEmail: recipientEmail!, templateKey: template.key,
        category: template.category,
        deliveryKind: 'RENDERED_TEMPLATE', subject: render(template.emailSubjectTemplate, variables), textBody: render(template.emailBodyTemplate, variables),
        status: 'QUEUED', attempts: 0, maxAttempts: 5,
        nextAttemptAt: template.category === 'SYSTEM' ? now : nextEmailDeliveryAt(preferences, new Date(now)),
        createdAt: now, updatedAt: now,
      } satisfies EmailOutboxRecord
    : undefined
  if (outbox) channels.push('EMAIL')
  const response: EnqueueNotificationResult = { ...(notification ? { notification } : {}), ...(outbox ? { outboxId: outbox.id } : {}), channels, replayed: false }

  if (dataMode() === 'mock') {
    const previous = notificationModuleState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
      return { ...(structuredClone(previous.response) as EnqueueNotificationResult), replayed: true, auditId: undefined }
    }
    if (notification) notificationModuleState().notifications.set(notification.id, structuredClone(notification))
    if (outbox) notificationModuleState().outbox.set(outbox.id, structuredClone(outbox))
    notificationModuleState().idempotency.set(namespace, { requestHash: hash, response: structuredClone(response) })
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan notifikasi tidak tersedia.')
    const idemReference = db.collection('communicationIdempotency').doc(opaqueId('idem', namespace))
    const result = await db.runTransaction(async (transaction) => {
      const previous = await transaction.get(idemReference)
      if (previous.exists) {
        const data = previous.data() as { requestHash: string; response: EnqueueNotificationResult }
        if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
        return { ...data.response, replayed: true, auditId: undefined }
      }
      if (notification) transaction.create(db.collection('inAppNotifications').doc(notification.id), notification)
      if (outbox) transaction.create(db.collection('emailOutbox').doc(outbox.id), outbox)
      transaction.create(idemReference, {
        requestHash: hash,
        response,
        createdAt: now,
        purgeAfter: firestorePurgeAfter(now, FIRESTORE_TTL_RETENTION_MS.communicationKey),
      })
      return response
    })
    if (result.replayed) return result
  }
  const audit = await appendAudit({ actor: context, action: 'NOTIFICATION_ENQUEUED', resourceType: 'in_app_notification', resourceId: notification?.id ?? outbox?.id ?? opaqueId('suppressed', idempotencyKey), after: { templateKey: template.key, channels }, event })
  response.auditId = audit.id
  return response
}

export async function enqueueNotification(
  context: AuthContext,
  input: EnqueueNotificationInput,
  idempotencyKey: string,
  event?: H3Event,
): Promise<EnqueueNotificationResult> {
  return enqueueNotificationWithAuthorization(context, input, idempotencyKey, event)
}

export async function enqueueLearningNotificationBatch(
  context: AuthContext,
  input: EnqueueLearningNotificationBatchInput,
  event?: H3Event,
): Promise<EnqueueLearningNotificationBatchResult> {
  if (!Array.isArray(input.recipientUids) || input.recipientUids.length > 500) {
    invalidInput('Daftar penerima notifikasi pembelajaran tidak valid.')
  }
  const recipientUids = [...new Set(input.recipientUids)]
  const accounts = await listActiveAccountsByIds(recipientUids)
  let inAppQueued = 0
  let emailQueued = 0
  for (let offset = 0; offset < accounts.length; offset += 10) {
    const results = await Promise.all(accounts.slice(offset, offset + 10).map(account =>
      enqueueNotificationWithAuthorization(context, {
        recipientUid: account.id,
        recipientEmail: account.email,
        templateKey: input.templateKey,
        variables: input.variables,
        actionPath: input.actionPath,
      }, opaqueId('learning_notice', `${input.eventKey}:${account.id}`), event, true)))
    inAppQueued += results.filter(result => result.channels.includes('IN_APP')).length
    emailQueued += results.filter(result => result.channels.includes('EMAIL')).length
  }
  return {
    requestedRecipients: recipientUids.length,
    activeRecipients: accounts.length,
    inAppQueued,
    emailQueued,
  }
}

/**
 * Queues a reset request without generating or persisting a one-time reset link.
 * The delivery adapter must generate the link immediately before sending.
 */
export async function enqueuePasswordResetEmail(input: {
  recipientUid: string
  recipientEmail: string
  continuePath?: string
}, idempotencyKey: string): Promise<EnqueuePasswordResetResult> {
  if (!emailDeliveryEnabled()) serviceUnavailable('Pemulihan kata sandi melalui email belum tersedia. Hubungi administrator kampus.')
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) invalidInput('Idempotency key tidak valid.')
  const recipientUid = cleanText(input.recipientUid, 128)
  const recipientEmail = normalizeEmail(input.recipientEmail)!
  const continuePath = normalizeActionPath(input.continuePath)
  const normalized = { recipientUid, recipientEmail, continuePath }
  const hash = requestHash(normalized)
  const namespace = `password-reset:${idempotencyKey}`
  const now = new Date().toISOString()
  const outbox: EmailOutboxRecord = {
    id: opaqueId('email_reset', idempotencyKey), recipientUid, recipientEmail, deliveryKind: 'PASSWORD_RESET',
    ...(continuePath ? { deliveryData: { continuePath } } : {}),
    templateKey: 'password-reset', category: 'SYSTEM', subject: 'Petunjuk reset kata sandi', status: 'QUEUED', attempts: 0, maxAttempts: 5,
    nextAttemptAt: now, createdAt: now, updatedAt: now,
  }
  const response: EnqueuePasswordResetResult = { outboxId: outbox.id, replayed: false }
  if (dataMode() === 'mock') {
    const previous = notificationModuleState().idempotency.get(namespace)
    if (previous) {
      if (previous.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
      return { ...(structuredClone(previous.response) as EnqueuePasswordResetResult), replayed: true }
    }
    notificationModuleState().outbox.set(outbox.id, structuredClone(outbox))
    notificationModuleState().idempotency.set(namespace, { requestHash: hash, response: structuredClone(response) })
    return response
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Email outbox tidak tersedia.')
  const idemReference = db.collection('communicationIdempotency').doc(opaqueId('idem', namespace))
  const outboxReference = db.collection('emailOutbox').doc(outbox.id)
  return db.runTransaction(async (transaction) => {
    const previous = await transaction.get(idemReference)
    if (previous.exists) {
      const data = previous.data() as { requestHash: string; response: EnqueuePasswordResetResult }
      if (data.requestHash !== hash) conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key telah digunakan untuk payload berbeda.')
      return { ...data.response, replayed: true }
    }
    transaction.create(outboxReference, outbox)
    transaction.create(idemReference, {
      requestHash: hash,
      response,
      createdAt: now,
      purgeAfter: firestorePurgeAfter(now, FIRESTORE_TTL_RETENTION_MS.idempotency),
    })
    return response
  })
}

export interface InAppNotificationPage {
  items: InAppNotification[]
  nextCursor?: string
}

function encodeNotificationCursor(record: InAppNotification): string {
  return Buffer.from(JSON.stringify({ createdAt: record.createdAt, id: record.id }), 'utf8').toString('base64url')
}

function decodeNotificationCursor(value?: string): { createdAt: string; id: string } | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    const createdAt = String(parsed.createdAt ?? '')
    const id = String(parsed.id ?? '')
    if (Number.isNaN(Date.parse(createdAt)) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(id)) throw new Error('cursor')
    return { createdAt, id }
  } catch {
    invalidInput('Cursor notifikasi tidak valid.')
  }
}

export async function listInAppNotificationsPage(
  context: AuthContext,
  options: { unreadOnly?: boolean; limit?: number; cursor?: string } = {},
): Promise<InAppNotificationPage> {
  const safeLimit = Math.min(Math.max(options.limit ?? 50, 1), 50)
  const cursor = decodeNotificationCursor(options.cursor)
  const mvp = isLmsMvpProfile()
  const candidateLimit = Math.min(safeLimit * 3 + 1, 151)
  let records: InAppNotification[]
  if (dataMode() === 'mock') records = [...notificationModuleState().notifications.values()].map(record => structuredClone(record))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan notifikasi tidak tersedia.')
    let query = db.collection('inAppNotifications').where('recipientUid', '==', context.uid)
    if (mvp) query = query.where('category', 'in', ['LEARNING', 'SYSTEM'])
    query = query.orderBy('createdAt', 'desc').orderBy('id', 'desc')
    if (cursor) query = query.startAfter(cursor.createdAt, cursor.id)
    const snapshot = await query.limit(candidateLimit).get()
    records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as InAppNotification)
  }
  const visible = records.filter(record => record.recipientUid === context.uid
      && (!mvp || isLmsMvpNotificationCategory(record.category))
      && (!options.unreadOnly || !record.readAt))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .filter(record => !cursor || record.createdAt < cursor.createdAt || (record.createdAt === cursor.createdAt && record.id < cursor.id))
  const items = visible.slice(0, safeLimit)
  const candidateExhausted = dataMode() === 'mock' || records.length < candidateLimit
  const hasMore = visible.length > safeLimit || !candidateExhausted
  const cursorRecord = items.at(-1) ?? (!candidateExhausted ? records.at(-1) : undefined)
  return { items, ...(hasMore && cursorRecord ? { nextCursor: encodeNotificationCursor(cursorRecord) } : {}) }
}

export async function listInAppNotifications(context: AuthContext, unreadOnly = false, limit = 50): Promise<InAppNotification[]> {
  return (await listInAppNotificationsPage(context, { unreadOnly, limit })).items
}

export async function getInAppNotification(context: AuthContext, id: string): Promise<InAppNotification> {
  let record: InAppNotification | undefined
  if (dataMode() === 'mock') record = notificationModuleState().notifications.get(id)
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan notifikasi tidak tersedia.')
    const snapshot = await db.collection('inAppNotifications').doc(id).get()
    if (snapshot.exists) record = { id: snapshot.id, ...snapshot.data() } as InAppNotification
  }
  if (!record) notFound('Notifikasi')
  if (record.recipientUid !== context.uid) forbidden('Notifikasi bukan milik Anda.')
  if (isLmsMvpProfile() && !isLmsMvpNotificationCategory(record.category)) notFound('Notifikasi')
  return structuredClone(record)
}

export async function markInAppNotificationRead(context: AuthContext, id: string): Promise<InAppNotification> {
  const record = await getInAppNotification(context, id)
  if (record.readAt) return record
  const updated = { ...record, readAt: new Date().toISOString() }
  if (dataMode() === 'mock') notificationModuleState().notifications.set(id, structuredClone(updated))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan notifikasi tidak tersedia.')
    await db.collection('inAppNotifications').doc(id).update({ readAt: updated.readAt })
  }
  return updated
}

export function transitionEmailFailure(record: EmailOutboxRecord, error: { code: string; message: string }, now = new Date()): EmailOutboxRecord {
  const { leaseExpiresAt: _lease, ...released } = record
  const attempts = record.attempts + 1
  const exhausted = attempts >= record.maxAttempts
  const delay = Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempts - 1))
  return {
    ...released, attempts, status: exhausted ? 'DEAD_LETTER' : 'RETRY_SCHEDULED', updatedAt: now.toISOString(),
    nextAttemptAt: new Date(now.getTime() + (exhausted ? 0 : delay)).toISOString(),
    lastError: { code: cleanText(error.code, 80), message: cleanText(error.message, 300), occurredAt: now.toISOString() },
  }
}

export async function deliverEmailOutboxRecord(id: string, adapter: EmailDeliveryAdapter): Promise<EmailOutboxRecord> {
  const claimedAt = new Date()
  const claim = (record: EmailOutboxRecord): EmailOutboxRecord => {
    const due = ['QUEUED', 'RETRY_SCHEDULED'].includes(record.status) && record.nextAttemptAt <= claimedAt.toISOString()
    const abandoned = record.status === 'PROCESSING' && Boolean(record.leaseExpiresAt) && record.leaseExpiresAt! <= claimedAt.toISOString()
    if (!due && !abandoned) conflict('OUTBOX_NOT_DELIVERABLE', 'Email belum dapat diproses.')
    return { ...record, status: 'PROCESSING', updatedAt: claimedAt.toISOString(), leaseExpiresAt: new Date(claimedAt.getTime() + 2 * 60 * 1000).toISOString() }
  }
  let record: EmailOutboxRecord
  if (dataMode() === 'mock') {
    const stored = notificationModuleState().outbox.get(id)
    if (!stored) notFound('Email outbox')
    record = claim(stored)
    notificationModuleState().outbox.set(id, structuredClone(record))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Email outbox tidak tersedia.')
    const reference = db.collection('emailOutbox').doc(id)
    record = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) notFound('Email outbox')
      const claimed = claim({ id: snapshot.id, ...snapshot.data() } as EmailOutboxRecord)
      transaction.set(reference, claimed)
      return claimed
    })
  }
  let updated: EmailOutboxRecord
  try {
    const result = await adapter.send({
      outboxId: record.id,
      to: record.recipientEmail,
      deliveryKind: record.deliveryKind,
      ...(record.deliveryData ? { deliveryData: record.deliveryData } : {}),
      subject: record.subject,
      ...(record.textBody ? { textBody: record.textBody } : {}),
    })
    const now = new Date().toISOString()
    const { leaseExpiresAt: _lease, ...released } = record
    updated = { ...released, status: 'SENT', attempts: record.attempts + 1, sentAt: now, updatedAt: now, providerMessageId: cleanText(result.providerMessageId, 180) }
  } catch (error) {
    updated = transitionEmailFailure(record, { code: error instanceof Error ? error.name : 'DELIVERY_ERROR', message: 'Pengiriman email gagal.' })
  }
  if (dataMode() === 'mock') notificationModuleState().outbox.set(id, structuredClone(updated))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Email outbox tidak tersedia.')
    await db.collection('emailOutbox').doc(id).set(updated)
  }
  return updated
}

/** Internal worker inventory. Recipient addresses and message bodies never leave this service. */
export async function listDeliverableEmailOutboxIds(limit = 20, now = new Date()): Promise<string[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 50)
  const nowIso = now.toISOString()
  if (dataMode() === 'mock') {
    return [...notificationModuleState().outbox.values()]
      .filter(record => (['QUEUED', 'RETRY_SCHEDULED'].includes(record.status) && record.nextAttemptAt <= nowIso)
        || (record.status === 'PROCESSING' && Boolean(record.leaseExpiresAt) && record.leaseExpiresAt! <= nowIso))
      .sort((left, right) => left.nextAttemptAt.localeCompare(right.nextAttemptAt))
      .slice(0, safeLimit)
      .map(record => record.id)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Email outbox tidak tersedia.')
  const due = await db.collection('emailOutbox')
    .where('status', 'in', ['QUEUED', 'RETRY_SCHEDULED'])
    .where('nextAttemptAt', '<=', nowIso)
    .orderBy('nextAttemptAt', 'asc')
    .limit(safeLimit)
    .get()
  const remaining = safeLimit - due.size
  if (remaining <= 0) return due.docs.map(document => document.id)
  const abandoned = await db.collection('emailOutbox')
    .where('status', '==', 'PROCESSING')
    .where('leaseExpiresAt', '<=', nowIso)
    .orderBy('leaseExpiresAt', 'asc')
    .limit(remaining)
    .get()
  return [...due.docs, ...abandoned.docs].map(document => document.id)
}

export async function retryEmailOutbox(context: AuthContext, id: string, event?: H3Event): Promise<{ outbox: EmailOutboxSummary; auditId: string }> {
  requireAdministrator(context)
  let record: EmailOutboxRecord | undefined
  if (dataMode() === 'mock') record = notificationModuleState().outbox.get(id)
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Email outbox tidak tersedia.')
    const snapshot = await db.collection('emailOutbox').doc(id).get()
    if (snapshot.exists) record = { id: snapshot.id, ...snapshot.data() } as EmailOutboxRecord
  }
  if (!record) notFound('Email outbox')
  const category = await categoryForEmailOutbox(record)
  if (isLmsMvpProfile() && !isLmsMvpNotificationCategory(category)) notFound('Email outbox')
  if (!['RETRY_SCHEDULED', 'DEAD_LETTER'].includes(record.status)) conflict('OUTBOX_NOT_RETRYABLE', 'Email tidak dapat diulang pada status saat ini.')
  const { leaseExpiresAt: _lease, ...released } = record
  const updated: EmailOutboxRecord = {
    ...released, status: 'QUEUED', attempts: record.status === 'DEAD_LETTER' ? 0 : record.attempts,
    nextAttemptAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }
  if (dataMode() === 'mock') notificationModuleState().outbox.set(id, structuredClone(updated))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Email outbox tidak tersedia.')
    await db.collection('emailOutbox').doc(id).set(updated)
  }
  const audit = await appendAudit({ actor: context, action: 'EMAIL_OUTBOX_RETRIED', resourceType: 'email_outbox', resourceId: id, after: { status: updated.status, attempts: updated.attempts }, event })
  return { outbox: emailOutboxSummary(updated, category), auditId: audit.id }
}

export async function listEmailOutbox(context: AuthContext, limit = 50): Promise<EmailOutboxSummary[]> {
  requireAdministrator(context)
  const safeLimit = Math.min(Math.max(limit, 1), 50)
  const mvp = isLmsMvpProfile()
  const candidateLimit = mvp ? Math.min(safeLimit * 3, 150) : safeLimit
  let records: EmailOutboxRecord[]
  if (dataMode() === 'mock') records = [...notificationModuleState().outbox.values()].map(record => structuredClone(record))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Email outbox tidak tersedia.')
    const snapshot = await db.collection('emailOutbox').limit(candidateLimit).get()
    records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as EmailOutboxRecord)
  }
  const templateCategories = mvp
    ? new Map((await allNotificationTemplates()).map(template => [template.key, template.category] as const))
    : undefined
  return records
    .map(record => ({
      record,
      category: record.category
        ?? (record.deliveryKind === 'PASSWORD_RESET' || record.templateKey === 'password-reset' ? 'SYSTEM' : templateCategories?.get(record.templateKey)),
    }))
    .filter(({ category }) => !mvp || isLmsMvpNotificationCategory(category))
    .sort((left, right) => right.record.updatedAt.localeCompare(left.record.updatedAt))
    .slice(0, safeLimit)
    .map(({ record, category }) => emailOutboxSummary(record, category))
}
