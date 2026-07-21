export const TICKET_CATEGORIES = ['ACADEMIC', 'FINANCE', 'STUDENT_AFFAIRS', 'ADMISSIONS', 'GENERAL'] as const
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]

export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]

export const TICKET_STATUSES = [
  'OPEN',
  'IN_REVIEW',
  'WAITING_FOR_REQUESTER',
  'RESOLVED',
  'CLOSED',
  'CANCELLED',
] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export interface AttachmentReference {
  fileId: string
  fileName: string
  contentType: 'application/pdf' | 'image/jpeg' | 'image/png'
  sizeBytes: number
}

export interface TicketMessage {
  id: string
  ticketId: string
  authorId: string
  authorName: string
  authorKind: 'REQUESTER' | 'STAFF'
  body: string
  attachments: AttachmentReference[]
  createdAt: string
}

export interface ServiceTicket {
  id: string
  ticketNumber: string
  requesterId: string
  requesterName: string
  programStudyId?: string
  category: TicketCategory
  priority: TicketPriority
  subject: string
  status: TicketStatus
  assignedUnit: string
  slaHours: number
  dueAt: string
  createdAt: string
  updatedAt: string
  resolvedAt?: string
  closedAt?: string
  version: number
  messageCount: number
}

export interface TicketDetail {
  ticket: ServiceTicket
  messages: TicketMessage[]
}

export const NOTIFICATION_CATEGORIES = ['ACADEMIC', 'FINANCE', 'LEARNING', 'SERVICE', 'SYSTEM'] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]

export interface NotificationTemplate {
  key: string
  name: string
  category: NotificationCategory
  titleTemplate: string
  bodyTemplate: string
  emailSubjectTemplate: string
  emailBodyTemplate: string
  channels: Array<'IN_APP' | 'EMAIL'>
  active: boolean
  version: number
  updatedAt: string
  updatedBy: string
}

export interface NotificationPreferences {
  uid: string
  inAppEnabled: boolean
  emailEnabled: boolean
  categoryEmail: Record<NotificationCategory, boolean>
  quietHours?: { start: string; end: string; timezone: string }
  updatedAt: string
}

export interface InAppNotification {
  id: string
  recipientUid: string
  templateKey: string
  category: NotificationCategory
  title: string
  body: string
  actionPath?: string
  createdAt: string
  readAt?: string
}

export type EmailOutboxStatus = 'QUEUED' | 'PROCESSING' | 'SENT' | 'RETRY_SCHEDULED' | 'DEAD_LETTER'
export type EmailDeliveryKind = 'RENDERED_TEMPLATE' | 'PASSWORD_RESET'

export interface EmailOutboxRecord {
  id: string
  recipientUid: string
  recipientEmail: string
  deliveryKind: EmailDeliveryKind
  deliveryData?: { continuePath?: string }
  templateKey: string
  subject: string
  textBody?: string
  status: EmailOutboxStatus
  attempts: number
  maxAttempts: number
  nextAttemptAt: string
  createdAt: string
  updatedAt: string
  sentAt?: string
  providerMessageId?: string
  leaseExpiresAt?: string
  lastError?: { code: string; message: string; occurredAt: string }
}

export interface EmailDeliveryMessage {
  outboxId: string
  to: string
  deliveryKind: EmailDeliveryKind
  deliveryData?: { continuePath?: string }
  subject: string
  textBody?: string
}

export interface EmailDeliveryAdapter {
  send(message: EmailDeliveryMessage): Promise<{ providerMessageId: string }>
}
