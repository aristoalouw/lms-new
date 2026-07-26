import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { AuditEntry } from '../types/domain'
import { firestoreAdmin, dataMode } from './firebase-admin'
import { cloneValue, mockState } from './mock-store'
import { opaqueId, requestAuditMetadata, sanitizeForAudit } from './security'
import { invalidInput, serviceUnavailable } from './errors'

interface AuditInput {
  actor: AuthContext
  action: string
  resourceType: string
  resourceId: string
  outcome?: AuditEntry['outcome']
  before?: unknown
  after?: unknown
  metadata?: Record<string, unknown>
  event?: H3Event
}

export async function appendAudit(input: AuditInput): Promise<AuditEntry> {
  const occurredAt = new Date().toISOString()
  const id = opaqueId('audit', `${occurredAt}:${input.actor.uid}:${input.action}:${input.resourceId}:${Math.random()}`)
  const entry: AuditEntry = {
    id,
    occurredAt,
    actor: { uid: input.actor.uid, roles: [...input.actor.roles] },
    action: input.action.slice(0, 120),
    resource: { type: input.resourceType.slice(0, 80), id: input.resourceId.slice(0, 160) },
    outcome: input.outcome ?? 'SUCCESS',
    ...(input.event ? { request: requestAuditMetadata(input.event) } : {}),
    ...(input.before !== undefined ? { before: sanitizeForAudit(input.before) } : {}),
    ...(input.after !== undefined ? { after: sanitizeForAudit(input.after) } : {}),
    ...(input.metadata ? { metadata: sanitizeForAudit(input.metadata) as Record<string, unknown> } : {}),
  }

  if (dataMode() === 'mock') {
    mockState().auditEntries.unshift(cloneValue(entry))
    return cloneValue(entry)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan audit tidak tersedia.')
  await db.collection('auditLogs').doc(id).create(entry)
  return entry
}

export async function listAuditEntries(limit = 50): Promise<AuditEntry[]> {
  return (await listAuditEntriesPage({ limit })).items
}

export interface AuditEntryPage {
  items: AuditEntry[]
  nextCursor?: string
}

export type AuditEntrySummary = Pick<AuditEntry, 'id' | 'occurredAt' | 'actor' | 'action' | 'resource' | 'outcome'>

export function auditEntrySummary(entry: AuditEntry): AuditEntrySummary {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt,
    actor: { uid: entry.actor.uid, roles: [...entry.actor.roles] },
    action: entry.action,
    resource: { ...entry.resource },
    outcome: entry.outcome,
  }
}

function encodeAuditCursor(entry: AuditEntry): string {
  return Buffer.from(JSON.stringify({ occurredAt: entry.occurredAt, id: entry.id }), 'utf8').toString('base64url')
}

function decodeAuditCursor(value?: string): { occurredAt: string; id: string } | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    const occurredAt = String(parsed.occurredAt ?? '')
    const id = String(parsed.id ?? '')
    if (Number.isNaN(Date.parse(occurredAt)) || !/^audit_[a-f0-9]{24}$/.test(id)) throw new Error('cursor')
    return { occurredAt, id }
  } catch {
    invalidInput('Cursor audit tidak valid.')
  }
}

export async function listAuditEntriesPage(options: { limit?: number; cursor?: string } = {}): Promise<AuditEntryPage> {
  const safeLimit = Math.min(Math.max(options.limit ?? 50, 1), 50)
  const cursor = decodeAuditCursor(options.cursor)
  let records: AuditEntry[]
  if (dataMode() === 'mock') {
    records = [...mockState().auditEntries]
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id))
      .filter(entry => !cursor || entry.occurredAt < cursor.occurredAt || (entry.occurredAt === cursor.occurredAt && entry.id < cursor.id))
      .slice(0, safeLimit + 1)
      .map(cloneValue)
  } else {
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan audit tidak tersedia.')
    let query = db.collection('auditLogs').orderBy('occurredAt', 'desc').orderBy('id', 'desc').limit(safeLimit + 1)
    if (cursor) query = query.startAfter(cursor.occurredAt, cursor.id)
    const snapshot = await query.get()
    records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as AuditEntry)
  }
  const hasMore = records.length > safeLimit
  const items = records.slice(0, safeLimit)
  return { items, ...(hasMore && items.length ? { nextCursor: encodeAuditCursor(items.at(-1)!) } : {}) }
}
