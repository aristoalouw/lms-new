import type { H3Event } from 'h3'
import type { AuthContext, UserRole } from '../types/auth'
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type AttachmentReference,
  type ServiceTicket,
  type TicketCategory,
  type TicketDetail,
  type TicketMessage,
  type TicketPriority,
  type TicketStatus,
} from '../types/communications'
import { appendAudit } from '../utils/audit'
import { conflict, forbidden, invalidInput, notFound, serviceUnavailable } from '../utils/errors'
import { dataMode, firestoreAdmin } from '../utils/firebase-admin'
import { hasRole, requirePermission } from '../utils/rbac'
import { opaqueId } from '../utils/security'
import { ticketModuleState } from './tickets-state'

const CATEGORY_UNITS: Record<TicketCategory, string> = {
  ACADEMIC: 'Biro Akademik',
  FINANCE: 'Biro Keuangan',
  STUDENT_AFFAIRS: 'Biro Kemahasiswaan',
  ADMISSIONS: 'Panitia Penerimaan Mahasiswa Baru',
  GENERAL: 'Pusat Layanan Terpadu',
}

const CATEGORY_ROLES: Record<TicketCategory, UserRole[]> = {
  ACADEMIC: ['academic_staff'],
  FINANCE: ['finance_staff'],
  STUDENT_AFFAIRS: ['student_affairs_staff', 'academic_staff'],
  ADMISSIONS: ['admissions_staff'],
  GENERAL: ['academic_staff', 'student_affairs_staff'],
}

const SLA_HOURS: Record<TicketPriority, number> = { LOW: 48, NORMAL: 24, HIGH: 8, URGENT: 4 }

const STAFF_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_REVIEW', 'CANCELLED'],
  IN_REVIEW: ['WAITING_FOR_REQUESTER', 'RESOLVED', 'CANCELLED'],
  WAITING_FOR_REQUESTER: ['IN_REVIEW', 'RESOLVED', 'CANCELLED'],
  RESOLVED: ['IN_REVIEW', 'CLOSED'],
  CLOSED: [],
  CANCELLED: [],
}

const REQUESTER_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['CANCELLED'],
  IN_REVIEW: ['CANCELLED'],
  WAITING_FOR_REQUESTER: ['CANCELLED'],
  RESOLVED: ['IN_REVIEW', 'CLOSED'],
  CLOSED: [],
  CANCELLED: [],
}

export interface CreateTicketInput {
  category: TicketCategory
  priority?: TicketPriority
  subject: string
  message: string
  programStudyId?: string
  attachments?: AttachmentReference[]
}

export interface ListTicketOptions {
  status?: TicketStatus
  category?: TicketCategory
  limit?: number
}

export interface ChangeTicketStatusInput {
  status: TicketStatus
  expectedVersion?: number
}

export function sanitizeTicketText(value: string, maxLength: number): string {
  const clean = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) invalidInput('Pesan tidak boleh kosong.')
  if (clean.length > maxLength) invalidInput(`Teks melebihi batas ${maxLength} karakter.`)
  return clean
}

export function normalizeAttachmentReferences(value: AttachmentReference[] = []): AttachmentReference[] {
  if (value.length > 5) invalidInput('Maksimal lima lampiran per pesan.')
  const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png'])
  return value.map((attachment) => {
    if (!/^[A-Za-z0-9_-]{8,160}$/.test(attachment.fileId)) invalidInput('Referensi lampiran tidak valid.')
    const fileName = attachment.fileName.replace(/^.*[\\/]/, '').trim()
    if (!fileName || fileName.length > 180) invalidInput('Nama lampiran tidak valid.')
    if (!allowedTypes.has(attachment.contentType)) invalidInput('Tipe lampiran tidak didukung.')
    if (!Number.isInteger(attachment.sizeBytes) || attachment.sizeBytes <= 0 || attachment.sizeBytes > 10 * 1024 * 1024) {
      invalidInput('Ukuran lampiran tidak valid.')
    }
    return { ...attachment, fileName }
  })
}

function programAllowed(context: AuthContext, ticket: ServiceTicket): boolean {
  return !ticket.programStudyId || context.scope.programStudyIds.includes(ticket.programStudyId)
}

function canManageTicket(context: AuthContext, ticket: ServiceTicket): boolean {
  return CATEGORY_ROLES[ticket.category].some(role => hasRole(context, role)) && programAllowed(context, ticket)
}

function canViewTicket(context: AuthContext, ticket: ServiceTicket): boolean {
  return ticket.requesterId === context.uid
    || canManageTicket(context, ticket)
}

function requireView(context: AuthContext, ticket: ServiceTicket): void {
  if (!canViewTicket(context, ticket)) forbidden('Tiket berada di luar lingkup akses Anda.')
}

function normalizeProgram(context: AuthContext, requested?: string): string | undefined {
  if (requested && !context.scope.programStudyIds.includes(requested)) forbidden('Program studi berada di luar lingkup akses Anda.')
  if (requested) return requested
  return context.scope.programStudyIds.length === 1 ? context.scope.programStudyIds[0] : undefined
}

function ticketId(context: AuthContext, now: Date): string {
  return opaqueId('ticket', `${context.uid}:${now.toISOString()}:${Math.random()}`)
}

function ticketNumber(id: string, now: Date): string {
  return `LYN-${now.toISOString().slice(0, 7).replace('-', '')}-${id.slice(-6).toUpperCase()}`
}

function validateCreateInput(input: CreateTicketInput): void {
  if (!TICKET_CATEGORIES.includes(input.category)) invalidInput('Kategori layanan tidak valid.')
  if (input.priority && !TICKET_PRIORITIES.includes(input.priority)) invalidInput('Prioritas tiket tidak valid.')
}

export async function createTicket(
  context: AuthContext,
  input: CreateTicketInput,
  event?: H3Event,
  now = new Date(),
): Promise<TicketDetail & { auditId: string }> {
  requirePermission(context, 'service.read')
  validateCreateInput(input)
  const id = ticketId(context, now)
  const priority = input.priority ?? 'NORMAL'
  const createdAt = now.toISOString()
  const programStudyId = normalizeProgram(context, input.programStudyId)
  const ticket: ServiceTicket = {
    id,
    ticketNumber: ticketNumber(id, now),
    requesterId: context.uid,
    requesterName: sanitizeTicketText(context.displayName, 150),
    ...(programStudyId ? { programStudyId } : {}),
    category: input.category,
    priority,
    subject: sanitizeTicketText(input.subject, 180),
    status: 'OPEN',
    assignedUnit: CATEGORY_UNITS[input.category],
    slaHours: SLA_HOURS[priority],
    dueAt: new Date(now.getTime() + SLA_HOURS[priority] * 60 * 60 * 1000).toISOString(),
    createdAt,
    updatedAt: createdAt,
    version: 1,
    messageCount: 1,
  }
  const message: TicketMessage = {
    id: opaqueId('msg', `${id}:${createdAt}:1`),
    ticketId: id,
    authorId: context.uid,
    authorName: ticket.requesterName,
    authorKind: 'REQUESTER',
    body: sanitizeTicketText(input.message, 4_000),
    attachments: normalizeAttachmentReferences(input.attachments),
    createdAt,
  }

  if (dataMode() === 'mock') {
    ticketModuleState().tickets.set(id, structuredClone(ticket))
    ticketModuleState().messages.set(id, [structuredClone(message)])
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tiket tidak tersedia.')
    await db.runTransaction(async (transaction) => {
      const reference = db.collection('serviceTickets').doc(id)
      transaction.create(reference, ticket)
      transaction.create(reference.collection('messages').doc(message.id), message)
    })
  }

  const audit = await appendAudit({
    actor: context,
    action: 'SERVICE_TICKET_CREATED',
    resourceType: 'service_ticket',
    resourceId: id,
    after: { ticketNumber: ticket.ticketNumber, category: ticket.category, priority: ticket.priority, status: ticket.status },
    event,
  })
  return { ticket, messages: [message], auditId: audit.id }
}

async function loadTicket(ticketId: string): Promise<ServiceTicket> {
  if (dataMode() === 'mock') {
    const ticket = ticketModuleState().tickets.get(ticketId)
    if (!ticket) notFound('Tiket layanan')
    return structuredClone(ticket)
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan tiket tidak tersedia.')
  const snapshot = await db.collection('serviceTickets').doc(ticketId).get()
  if (!snapshot.exists) notFound('Tiket layanan')
  return { id: snapshot.id, ...snapshot.data() } as ServiceTicket
}

export async function getTicketDetail(context: AuthContext, ticketId: string): Promise<TicketDetail> {
  requirePermission(context, 'service.read')
  const ticket = await loadTicket(ticketId)
  requireView(context, ticket)
  if (dataMode() === 'mock') {
    return { ticket, messages: structuredClone(ticketModuleState().messages.get(ticketId) ?? []) }
  }
  const db = firestoreAdmin()
  if (!db) serviceUnavailable('Penyimpanan tiket tidak tersedia.')
  const snapshot = await db.collection('serviceTickets').doc(ticketId).collection('messages').orderBy('createdAt', 'asc').limit(200).get()
  return { ticket, messages: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as TicketMessage) }
}

export async function listTickets(context: AuthContext, options: ListTicketOptions = {}): Promise<ServiceTicket[]> {
  requirePermission(context, 'service.read')
  if (options.status && !TICKET_STATUSES.includes(options.status)) invalidInput('Status tiket tidak valid.')
  if (options.category && !TICKET_CATEGORIES.includes(options.category)) invalidInput('Kategori tiket tidak valid.')
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100)
  let tickets: ServiceTicket[]
  if (dataMode() === 'mock') tickets = [...ticketModuleState().tickets.values()].map(ticket => structuredClone(ticket))
  else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tiket tidak tersedia.')
    const query = db.collection('serviceTickets').where('requesterId', '==', context.uid).limit(100)
    const snapshot = await query.get()
    tickets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as ServiceTicket)
    if (context.roles.some(role => ['academic_staff', 'finance_staff', 'student_affairs_staff', 'admissions_staff'].includes(role))) {
      const scopedQueries = context.scope.programStudyIds.slice(0, 30).map(programStudyId =>
        db.collection('serviceTickets').where('programStudyId', '==', programStudyId).limit(100).get(),
      )
      const assignedUnits = Object.entries(CATEGORY_ROLES)
        .filter(([, roles]) => roles.some(role => hasRole(context, role)))
        .map(([category]) => CATEGORY_UNITS[category as TicketCategory])
      const unitQueries = assignedUnits.map(unit => db.collection('serviceTickets').where('assignedUnit', '==', unit).limit(100).get())
      const staffSnapshots = await Promise.all([...scopedQueries, ...unitQueries])
      const staffTickets = staffSnapshots.flatMap(result => result.docs.map(doc => ({ id: doc.id, ...doc.data() }) as ServiceTicket))
      tickets = [...new Map([...tickets, ...staffTickets.filter(ticket => canManageTicket(context, ticket))].map(ticket => [ticket.id, ticket])).values()]
    }
  }
  return tickets
    .filter(ticket => canViewTicket(context, ticket))
    .filter(ticket => !options.status || ticket.status === options.status)
    .filter(ticket => !options.category || ticket.category === options.category)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
}

function transitionAllowed(context: AuthContext, ticket: ServiceTicket, next: TicketStatus): boolean {
  if (canManageTicket(context, ticket)) return STAFF_TRANSITIONS[ticket.status].includes(next)
  if (ticket.requesterId === context.uid) return REQUESTER_TRANSITIONS[ticket.status].includes(next)
  return false
}

function transitioned(ticket: ServiceTicket, input: ChangeTicketStatusInput, now: string): ServiceTicket {
  if (!TICKET_STATUSES.includes(input.status)) invalidInput('Status tujuan tidak valid.')
  if (input.expectedVersion !== undefined && input.expectedVersion !== ticket.version) {
    conflict('VERSION_CONFLICT', 'Tiket telah berubah. Muat ulang data sebelum melanjutkan.', { currentVersion: ticket.version })
  }
  return {
    ...ticket,
    status: input.status,
    updatedAt: now,
    version: ticket.version + 1,
    ...(input.status === 'RESOLVED' ? { resolvedAt: now } : {}),
    ...(input.status === 'CLOSED' ? { closedAt: now } : {}),
  }
}

export async function changeTicketStatus(
  context: AuthContext,
  ticketIdValue: string,
  input: ChangeTicketStatusInput,
  event?: H3Event,
): Promise<{ ticket: ServiceTicket; auditId: string }> {
  requirePermission(context, 'service.read')
  const now = new Date().toISOString()
  let before: ServiceTicket
  let after: ServiceTicket
  if (dataMode() === 'mock') {
    before = await loadTicket(ticketIdValue)
    requireView(context, before)
    if (!transitionAllowed(context, before, input.status)) forbidden('Transisi status tidak diizinkan.')
    after = transitioned(before, input, now)
    ticketModuleState().tickets.set(ticketIdValue, structuredClone(after))
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tiket tidak tersedia.')
    const reference = db.collection('serviceTickets').doc(ticketIdValue)
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference)
      if (!snapshot.exists) notFound('Tiket layanan')
      const current = { id: snapshot.id, ...snapshot.data() } as ServiceTicket
      requireView(context, current)
      if (!transitionAllowed(context, current, input.status)) forbidden('Transisi status tidak diizinkan.')
      const updated = transitioned(current, input, now)
      transaction.update(reference, updated)
      return { current, updated }
    })
    before = result.current
    after = result.updated
  }
  const audit = await appendAudit({
    actor: context, action: 'SERVICE_TICKET_STATUS_CHANGED', resourceType: 'service_ticket', resourceId: ticketIdValue,
    before: { status: before.status, version: before.version }, after: { status: after.status, version: after.version }, event,
  })
  return { ticket: after, auditId: audit.id }
}

export async function addTicketMessage(
  context: AuthContext,
  ticketIdValue: string,
  input: { message: string; attachments?: AttachmentReference[] },
  event?: H3Event,
): Promise<{ ticket: ServiceTicket; message: TicketMessage; auditId: string }> {
  requirePermission(context, 'service.read')
  const current = await loadTicket(ticketIdValue)
  requireView(context, current)
  if (['CLOSED', 'CANCELLED'].includes(current.status)) conflict('TICKET_NOT_REPLYABLE', 'Tiket yang sudah ditutup tidak dapat menerima pesan.')
  const staff = canManageTicket(context, current)
  if (!staff && current.requesterId !== context.uid) forbidden()
  const now = new Date().toISOString()
  const message: TicketMessage = {
    id: opaqueId('msg', `${ticketIdValue}:${now}:${context.uid}:${Math.random()}`), ticketId: ticketIdValue,
    authorId: context.uid, authorName: sanitizeTicketText(context.displayName, 150), authorKind: staff ? 'STAFF' : 'REQUESTER',
    body: sanitizeTicketText(input.message, 4_000), attachments: normalizeAttachmentReferences(input.attachments), createdAt: now,
  }
  const ticket: ServiceTicket = {
    ...current,
    status: !staff && current.status === 'WAITING_FOR_REQUESTER' ? 'IN_REVIEW' : current.status,
    updatedAt: now,
    version: current.version + 1,
    messageCount: current.messageCount + 1,
  }
  if (dataMode() === 'mock') {
    ticketModuleState().tickets.set(ticketIdValue, structuredClone(ticket))
    ticketModuleState().messages.set(ticketIdValue, [...(ticketModuleState().messages.get(ticketIdValue) ?? []), structuredClone(message)])
  } else {
    const db = firestoreAdmin()
    if (!db) serviceUnavailable('Penyimpanan tiket tidak tersedia.')
    await db.runTransaction(async (transaction) => {
      const reference = db.collection('serviceTickets').doc(ticketIdValue)
      const fresh = await transaction.get(reference)
      if (!fresh.exists) notFound('Tiket layanan')
      const freshTicket = { id: fresh.id, ...fresh.data() } as ServiceTicket
      if (freshTicket.version !== current.version) conflict('VERSION_CONFLICT', 'Tiket telah berubah. Muat ulang data sebelum membalas.')
      transaction.update(reference, ticket)
      transaction.create(reference.collection('messages').doc(message.id), message)
    })
  }
  const audit = await appendAudit({
    actor: context, action: 'SERVICE_TICKET_MESSAGE_ADDED', resourceType: 'service_ticket', resourceId: ticketIdValue,
    after: { authorKind: message.authorKind, attachmentCount: message.attachments.length, status: ticket.status }, event,
  })
  return { ticket, message, auditId: audit.id }
}
