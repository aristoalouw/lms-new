import type { ServiceTicket, TicketMessage } from '../types/communications'

interface TicketModuleState {
  tickets: Map<string, ServiceTicket>
  messages: Map<string, TicketMessage[]>
}

const seededTickets: ServiceTicket[] = [
  {
    id: 'ticket-demo-001',
    ticketNumber: 'LYN-202607-1042',
    requesterId: 'student-001',
    requesterName: 'Nabila Putri',
    programStudyId: 'management-s1',
    category: 'ACADEMIC',
    priority: 'NORMAL',
    subject: 'Permohonan koreksi data KHS semester ganjil',
    status: 'IN_REVIEW',
    assignedUnit: 'Biro Akademik',
    slaHours: 24,
    dueAt: '2026-07-22T03:15:00.000Z',
    createdAt: '2026-07-21T03:15:00.000Z',
    updatedAt: '2026-07-21T04:10:00.000Z',
    version: 2,
    messageCount: 2,
  },
  {
    id: 'ticket-demo-002',
    ticketNumber: 'LYN-202607-0988',
    requesterId: 'student-001',
    requesterName: 'Nabila Putri',
    programStudyId: 'management-s1',
    category: 'FINANCE',
    priority: 'HIGH',
    subject: 'Pembayaran virtual account belum terverifikasi',
    status: 'RESOLVED',
    assignedUnit: 'Biro Keuangan',
    slaHours: 8,
    dueAt: '2026-07-19T10:20:00.000Z',
    createdAt: '2026-07-19T02:20:00.000Z',
    updatedAt: '2026-07-19T06:45:00.000Z',
    resolvedAt: '2026-07-19T06:45:00.000Z',
    version: 3,
    messageCount: 2,
  },
]

const seededMessages: TicketMessage[] = [
  {
    id: 'ticket-message-001', ticketId: 'ticket-demo-001', authorId: 'student-001', authorName: 'Nabila Putri',
    authorKind: 'REQUESTER', body: 'Nilai mata kuliah MGT301 pada KHS berbeda dengan hasil akhir yang diumumkan dosen.',
    attachments: [], createdAt: '2026-07-21T03:15:00.000Z',
  },
  {
    id: 'ticket-message-002', ticketId: 'ticket-demo-001', authorId: 'academic-001', authorName: 'Rina Wijaya',
    authorKind: 'STAFF', body: 'Laporan sudah diterima dan sedang kami cocokkan dengan berita acara nilai.',
    attachments: [], createdAt: '2026-07-21T04:10:00.000Z',
  },
  {
    id: 'ticket-message-003', ticketId: 'ticket-demo-002', authorId: 'student-001', authorName: 'Nabila Putri',
    authorKind: 'REQUESTER', body: 'Pembayaran dilakukan pagi ini tetapi status tagihan belum berubah.',
    attachments: [], createdAt: '2026-07-19T02:20:00.000Z',
  },
  {
    id: 'ticket-message-004', ticketId: 'ticket-demo-002', authorId: 'finance-001', authorName: 'Ahmad Fauzi',
    authorKind: 'STAFF', body: 'Pembayaran telah direkonsiliasi dan status tagihan sudah diperbarui.',
    attachments: [], createdAt: '2026-07-19T06:45:00.000Z',
  },
]

function initialState(): TicketModuleState {
  return {
    tickets: new Map(seededTickets.map(ticket => [ticket.id, structuredClone(ticket)])),
    messages: new Map(seededTickets.map(ticket => [
      ticket.id,
      seededMessages.filter(message => message.ticketId === ticket.id).map(message => structuredClone(message)),
    ])),
  }
}

let state = initialState()

export function ticketModuleState(): TicketModuleState {
  return state
}

export function resetTicketModuleState(): void {
  state = initialState()
}
