import type { H3Event } from 'h3'
import type { AuthContext } from '../types/auth'
import type { AuditEntry } from '../types/domain'
import { firestoreAdmin, dataMode } from './firebase-admin'
import { cloneValue, mockState } from './mock-store'
import { opaqueId, requestAuditMetadata, sanitizeForAudit } from './security'
import { serviceUnavailable } from './errors'

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
  const safeLimit = Math.min(Math.max(limit, 1), 100)
  if (dataMode() === 'mock') return mockState().auditEntries.slice(0, safeLimit).map(cloneValue)
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan audit tidak tersedia.')
  const snapshot = await db.collection('auditLogs').orderBy('occurredAt', 'desc').limit(safeLimit).get()
  return snapshot.docs.map((doc) => doc.data() as AuditEntry)
}
