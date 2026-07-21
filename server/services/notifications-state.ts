import type {
  EmailOutboxRecord,
  InAppNotification,
  NotificationPreferences,
  NotificationTemplate,
} from '../types/communications'

interface NotificationIdempotency {
  requestHash: string
  response: unknown
}

interface NotificationModuleState {
  templates: Map<string, NotificationTemplate>
  preferences: Map<string, NotificationPreferences>
  notifications: Map<string, InAppNotification>
  outbox: Map<string, EmailOutboxRecord>
  idempotency: Map<string, NotificationIdempotency>
}

const templates: NotificationTemplate[] = [
  {
    key: 'ticket-created', name: 'Tiket layanan dibuat', category: 'SERVICE',
    titleTemplate: 'Tiket {{ticketNumber}} berhasil dibuat',
    bodyTemplate: 'Permintaan {{subject}} sudah diterima oleh {{assignedUnit}}.',
    emailSubjectTemplate: 'Tiket {{ticketNumber}} berhasil dibuat',
    emailBodyTemplate: 'Permintaan Anda sudah diterima. Nomor tiket: {{ticketNumber}}. Unit tujuan: {{assignedUnit}}.',
    channels: ['IN_APP', 'EMAIL'], active: true, version: 1,
    updatedAt: '2026-07-21T00:00:00.000Z', updatedBy: 'admin-001',
  },
  {
    key: 'ticket-status-updated', name: 'Status tiket berubah', category: 'SERVICE',
    titleTemplate: 'Status {{ticketNumber}} diperbarui',
    bodyTemplate: 'Status tiket berubah menjadi {{statusLabel}}.',
    emailSubjectTemplate: 'Pembaruan tiket {{ticketNumber}}',
    emailBodyTemplate: 'Status tiket Anda saat ini: {{statusLabel}}. Buka portal kampus untuk melihat rinciannya.',
    channels: ['IN_APP', 'EMAIL'], active: true, version: 1,
    updatedAt: '2026-07-21T00:00:00.000Z', updatedBy: 'admin-001',
  },
  {
    key: 'payment-received', name: 'Pembayaran diterima', category: 'FINANCE',
    titleTemplate: 'Pembayaran {{invoiceNumber}} diterima',
    bodyTemplate: 'Pembayaran sebesar {{amountLabel}} telah tercatat.',
    emailSubjectTemplate: 'Konfirmasi pembayaran {{invoiceNumber}}',
    emailBodyTemplate: 'Pembayaran Anda telah tercatat. Referensi tagihan: {{invoiceNumber}}.',
    channels: ['IN_APP', 'EMAIL'], active: true, version: 1,
    updatedAt: '2026-07-21T00:00:00.000Z', updatedBy: 'admin-001',
  },
]

const notifications: InAppNotification[] = [
  {
    id: 'notification-demo-001', recipientUid: 'student-001', templateKey: 'ticket-status-updated', category: 'SERVICE',
    title: 'Status LYN-202607-1042 diperbarui', body: 'Tiket sedang ditinjau oleh Biro Akademik.',
    actionPath: '/layanan/ticket-demo-001', createdAt: '2026-07-21T04:10:00.000Z',
  },
  {
    id: 'notification-demo-002', recipientUid: 'student-001', templateKey: 'payment-received', category: 'FINANCE',
    title: 'Pembayaran INV/2026/02/0001 diterima', body: 'Pembayaran sebesar Rp2.500.000 telah tercatat.',
    actionPath: '/keuangan', createdAt: '2026-07-20T08:30:00.000Z', readAt: '2026-07-20T09:00:00.000Z',
  },
]

function initialState(): NotificationModuleState {
  return {
    templates: new Map(templates.map(template => [template.key, structuredClone(template)])),
    preferences: new Map(),
    notifications: new Map(notifications.map(notification => [notification.id, structuredClone(notification)])),
    outbox: new Map(),
    idempotency: new Map(),
  }
}

let state = initialState()

export function notificationModuleState(): NotificationModuleState {
  return state
}

export function resetNotificationModuleState(): void {
  state = initialState()
}
