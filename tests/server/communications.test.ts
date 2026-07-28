import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deliverEmailOutboxRecord,
  enqueuePasswordResetEmail,
  enqueueNotification,
  getInAppNotification,
  getNotificationPreferences,
  listEmailOutbox,
  listNotificationTemplates,
  markInAppNotificationRead,
  nextEmailDeliveryAt,
  retryEmailOutbox,
  transitionEmailFailure,
  upsertNotificationTemplate,
  updateNotificationPreferences,
} from '../../server/services/notifications'
import { notificationModuleState, resetNotificationModuleState } from '../../server/services/notifications-state'
import {
  addTicketMessage,
  changeTicketStatus,
  createTicket,
  getTicketDetail,
  listTickets,
} from '../../server/services/tickets'
import { resetTicketModuleState } from '../../server/services/tickets-state'
import type { EmailOutboxRecord } from '../../server/types/communications'
import { CampusError } from '../../server/utils/errors'
import { resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

describe('administrative service tickets', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState()
    resetTicketModuleState()
    resetNotificationModuleState()
  })

  it('creates a sanitized ticket with SLA, due date, and metadata-only attachments', async () => {
    const student = authContext('student-001', ['student'])
    const result = await createTicket(student, {
      category: 'ACADEMIC', priority: 'HIGH', subject: '<b>Koreksi</b> data KHS',
      message: 'Mohon <script>alert(1)</script> periksa nilai saya.',
      attachments: [{ fileId: 'private-file-0001', fileName: '../khs.pdf', contentType: 'application/pdf', sizeBytes: 40_000 }],
    }, undefined, new Date('2026-07-21T00:00:00.000Z'))

    expect(result.ticket).toMatchObject({ status: 'OPEN', slaHours: 8, dueAt: '2026-07-21T08:00:00.000Z', messageCount: 1 })
    expect(result.ticket.subject).toBe('Koreksi data KHS')
    expect(result.messages[0]?.body).not.toContain('<script>')
    expect(result.messages[0]?.attachments[0]).toEqual({
      fileId: 'private-file-0001', fileName: 'khs.pdf', contentType: 'application/pdf', sizeBytes: 40_000,
    })
    expect(result.messages[0]?.attachments[0]).not.toHaveProperty('url')
  })

  it('enforces ownership and program-scoped staff access', async () => {
    await expect(getTicketDetail(authContext('student-999', ['student']), 'ticket-demo-001'))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
    await expect(getTicketDetail(authContext('academic-001', ['academic_staff']), 'ticket-demo-001')).resolves.toBeDefined()
    await expect(getTicketDetail(authContext('academic-002', ['academic_staff'], ['informatics-s1']), 'ticket-demo-001'))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
  })

  it('applies the transition graph and optimistic versions', async () => {
    const staff = authContext('academic-001', ['academic_staff'])
    const reviewed = await changeTicketStatus(staff, 'ticket-demo-001', { status: 'WAITING_FOR_REQUESTER', expectedVersion: 2 })
    expect(reviewed.ticket).toMatchObject({ status: 'WAITING_FOR_REQUESTER', version: 3 })
    await expect(changeTicketStatus(staff, 'ticket-demo-001', { status: 'CLOSED', expectedVersion: 3 }))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
    await expect(changeTicketStatus(staff, 'ticket-demo-001', { status: 'IN_REVIEW', expectedVersion: 2 }))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
  })

  it('returns waiting tickets to review when the requester replies', async () => {
    const staff = authContext('academic-001', ['academic_staff'])
    await changeTicketStatus(staff, 'ticket-demo-001', { status: 'WAITING_FOR_REQUESTER', expectedVersion: 2 })
    const reply = await addTicketMessage(authContext('student-001', ['student']), 'ticket-demo-001', { message: 'Data tambahan sudah saya unggah.' })
    expect(reply.ticket).toMatchObject({ status: 'IN_REVIEW', messageCount: 3, version: 4 })
    expect((await listTickets(authContext('student-001', ['student']))).map(ticket => ticket.id)).toContain('ticket-demo-001')
  })
})

describe('notification records and email outbox', () => {
  const previousFeatureProfile = process.env.APP_FEATURE_PROFILE

  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.APP_FEATURE_PROFILE = 'full-campus'
    delete process.env.EMAIL_DELIVERY_ENABLED
    resetMockState()
    resetTicketModuleState()
    resetNotificationModuleState()
  })

  afterEach(() => {
    delete process.env.EMAIL_DELIVERY_ENABLED
    if (previousFeatureProfile === undefined) delete process.env.APP_FEATURE_PROFILE
    else process.env.APP_FEATURE_PROFILE = previousFeatureProfile
  })

  it('enqueues in-app and email delivery once for an idempotency key', async () => {
    const staff = authContext('academic-001', ['academic_staff'])
    const input = {
      recipientUid: 'student-001', recipientEmail: 'NABILA@example.test', programStudyId: 'management-s1',
      templateKey: 'ticket-created', variables: { ticketNumber: 'LYN-1001', subject: 'Koreksi KHS', assignedUnit: 'Biro Akademik' },
      actionPath: '/layanan/ticket-demo-001',
    }
    const first = await enqueueNotification(staff, input, 'notification-key-0001')
    const replay = await enqueueNotification(staff, input, 'notification-key-0001')
    expect(first.channels).toEqual(['IN_APP', 'EMAIL'])
    expect(replay).toMatchObject({ replayed: true, outboxId: first.outboxId })
    expect(notificationModuleState().outbox.size).toBe(1)
    expect(first).not.toHaveProperty('recipientEmail')
  })

  it('rejects sensitive template variables and honors recipient email preferences', async () => {
    const student = authContext('student-001', ['student'])
    await updateNotificationPreferences(student, {
      inAppEnabled: true, emailEnabled: false,
      categoryEmail: { ACADEMIC: true, FINANCE: true, LEARNING: true, SERVICE: true, SYSTEM: true },
    })
    const staff = authContext('academic-001', ['academic_staff'])
    const result = await enqueueNotification(staff, {
      recipientUid: 'student-001', recipientEmail: 'nabila@example.test', programStudyId: 'management-s1',
      templateKey: 'ticket-created', variables: { ticketNumber: 'LYN-1002', subject: 'Surat aktif', assignedUnit: 'Biro Akademik' },
    }, 'notification-key-0002')
    expect(result.channels).toEqual(['IN_APP'])
    expect(notificationModuleState().outbox.size).toBe(0)
    await expect(enqueueNotification(staff, {
      recipientUid: 'student-001', templateKey: 'ticket-created', variables: { passwordResetToken: 'secret' },
    }, 'notification-key-0003')).rejects.toMatchObject({ statusCode: 400 } satisfies Partial<CampusError>)
  })

  it('keeps notifications in-app only when email delivery is disabled', async () => {
    process.env.EMAIL_DELIVERY_ENABLED = 'false'
    const result = await enqueueNotification(authContext('academic-001', ['academic_staff']), {
      recipientUid: 'student-001',
      recipientEmail: 'nabila@example.test',
      programStudyId: 'management-s1',
      templateKey: 'ticket-created',
      variables: { ticketNumber: 'LYN-1004', subject: 'Surat aktif', assignedUnit: 'Biro Akademik' },
    }, 'notification-key-email-disabled-0001')

    expect(result.channels).toEqual(['IN_APP'])
    expect(notificationModuleState().outbox.size).toBe(0)
    await expect(enqueuePasswordResetEmail({
      recipientUid: 'student-001',
      recipientEmail: 'nabila@example.test',
      continuePath: '/login',
    }, 'password-reset-disabled-0001')).rejects.toMatchObject({
      statusCode: 503,
    } satisfies Partial<CampusError>)
  })

  it('enforces notification ownership and supports idempotent mark-read', async () => {
    const student = authContext('student-001', ['student'])
    const read = await markInAppNotificationRead(student, 'notification-demo-001')
    expect(read.readAt).toBeDefined()
    expect((await markInAppNotificationRead(student, 'notification-demo-001')).readAt).toBe(read.readAt)
    await expect(getInAppNotification(authContext('student-999', ['student']), 'notification-demo-001'))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
  })

  it('backs off failures, reaches dead-letter, and uses an adapter without credentials', async () => {
    const base: EmailOutboxRecord = {
      id: 'email-001', recipientUid: 'student-001', recipientEmail: 'nabila@example.test', deliveryKind: 'RENDERED_TEMPLATE', templateKey: 'ticket-created',
      subject: 'Subject', textBody: 'Body', status: 'QUEUED', attempts: 0, maxAttempts: 2,
      nextAttemptAt: '2026-07-21T00:00:00.000Z', createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z',
    }
    const first = transitionEmailFailure(base, { code: 'TIMEOUT', message: 'Provider timeout' }, new Date('2026-07-21T00:00:00.000Z'))
    expect(first).toMatchObject({ status: 'RETRY_SCHEDULED', attempts: 1, nextAttemptAt: '2026-07-21T00:01:00.000Z' })
    const second = transitionEmailFailure(first, { code: 'TIMEOUT', message: 'Provider timeout' }, new Date('2026-07-21T00:01:00.000Z'))
    expect(second).toMatchObject({ status: 'DEAD_LETTER', attempts: 2 })

    notificationModuleState().outbox.set(base.id, base)
    const delivered = await deliverEmailOutboxRecord(base.id, {
      async send(message) {
        expect(message).toMatchObject({ outboxId: 'email-001', to: 'nabila@example.test' })
        return { providerMessageId: 'provider-message-001' }
      },
    })
    expect(delivered).toMatchObject({ status: 'SENT', providerMessageId: 'provider-message-001', attempts: 1 })
  })

  it('defers non-critical email until quiet hours end in Asia/Jakarta', () => {
    const preferences = {
      uid: 'student-001', inAppEnabled: true, emailEnabled: true,
      categoryEmail: { ACADEMIC: true, FINANCE: true, LEARNING: true, SERVICE: true, SYSTEM: true },
      quietHours: { start: '21:00', end: '06:00', timezone: 'Asia/Jakarta' }, updatedAt: '2026-07-21T00:00:00.000Z',
    } as const
    expect(nextEmailDeliveryAt(preferences, new Date('2026-07-21T15:00:00.000Z'))).toBe('2026-07-21T23:00:00.000Z')
    expect(nextEmailDeliveryAt(preferences, new Date('2026-07-21T08:00:00.000Z'))).toBe('2026-07-21T08:00:00.000Z')
  })

  it('restricts template management to administrators with optimistic versions', async () => {
    const input = {
      name: 'Pengingat layanan', category: 'SERVICE' as const,
      titleTemplate: 'Tiket {{ticketNumber}} memerlukan jawaban', bodyTemplate: 'Silakan buka portal layanan.',
      emailSubjectTemplate: 'Pengingat {{ticketNumber}}', emailBodyTemplate: 'Tiket Anda memerlukan jawaban.',
      channels: ['IN_APP', 'EMAIL'] as Array<'IN_APP' | 'EMAIL'>, active: true, expectedVersion: 0,
    }
    await expect(upsertNotificationTemplate(authContext('academic-001', ['academic_staff']), 'service-reminder', input))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
    const created = await upsertNotificationTemplate(authContext('admin-001', ['administrator']), 'service-reminder', input)
    expect(created.template).toMatchObject({ key: 'service-reminder', version: 1, active: true })
    await expect(upsertNotificationTemplate(authContext('admin-001', ['administrator']), 'service-reminder', input))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT' } satisfies Partial<CampusError>)
  })

  it('allows an administrator to requeue dead mail without exposing address or body', async () => {
    const dead: EmailOutboxRecord = {
      id: 'email-dead-001', recipientUid: 'student-001', recipientEmail: 'nabila@example.test', deliveryKind: 'RENDERED_TEMPLATE', templateKey: 'ticket-created',
      subject: 'Tiket dibuat', textBody: 'Isi privat', status: 'DEAD_LETTER', attempts: 5, maxAttempts: 5,
      nextAttemptAt: '2026-07-21T00:00:00.000Z', createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T01:00:00.000Z',
    }
    notificationModuleState().outbox.set(dead.id, dead)
    const result = await retryEmailOutbox(authContext('admin-001', ['administrator']), dead.id)
    expect(result.outbox).toMatchObject({ status: 'QUEUED', attempts: 0 })
    expect(result.outbox).not.toHaveProperty('recipientEmail')
    expect(result.outbox).not.toHaveProperty('textBody')
    expect(result.outbox).not.toHaveProperty('recipientUid')
    expect(result.outbox).not.toHaveProperty('subject')
  })

  it('keeps LMS MVP preferences owner-scoped and disables hidden email categories', async () => {
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    const student = authContext('student-001', ['student'])
    const updated = await updateNotificationPreferences(student, {
      inAppEnabled: true,
      emailEnabled: true,
      categoryEmail: { ACADEMIC: true, FINANCE: true, LEARNING: true, SERVICE: true, SYSTEM: true },
      quietHours: { start: '21:00', end: '06:00', timezone: 'Asia/Jakarta' },
    })
    expect(updated.preferences).toMatchObject({
      uid: 'student-001',
      categoryEmail: { ACADEMIC: false, FINANCE: false, LEARNING: true, SERVICE: false, SYSTEM: true },
    })
    expect(await getNotificationPreferences('student-001')).toEqual(updated.preferences)
  })

  it('shows administrators only learning and system templates in LMS MVP', async () => {
    const administrator = authContext('admin-001', ['administrator'])
    const templateInput = (category: 'LEARNING' | 'SYSTEM') => ({
      name: `${category} template`,
      category,
      titleTemplate: `${category} title`,
      bodyTemplate: `${category} body`,
      emailSubjectTemplate: `${category} subject`,
      emailBodyTemplate: `${category} email body`,
      channels: ['IN_APP', 'EMAIL'] as Array<'IN_APP' | 'EMAIL'>,
      active: true,
      expectedVersion: 0,
    })
    await upsertNotificationTemplate(administrator, 'learning-mvp-template', templateInput('LEARNING'))
    await upsertNotificationTemplate(administrator, 'system-mvp-template', templateInput('SYSTEM'))

    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    const templates = await listNotificationTemplates(administrator)
    expect(templates.map(template => template.key)).toEqual(expect.arrayContaining([
      'learning-mvp-template',
      'system-mvp-template',
      'learning-announcement-published',
      'learning-material-published',
      'learning-assignment-published',
      'learning-submission-finalized',
      'learning-grade-published',
    ]))
    expect(templates.every(template => ['LEARNING', 'SYSTEM'].includes(template.category))).toBe(true)
    await expect(listNotificationTemplates(authContext('student-001', ['student'])))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
    await expect(enqueueNotification(authContext('student-001', ['student']), {
      recipientUid: 'student-002',
      templateKey: 'learning-announcement-published',
      variables: { spaceTitle: 'Kelas', resourceTitle: 'Pengumuman' },
      actionPath: '/pembelajaran/class-mgt-401-a',
    }, 'student-direct-notification-0001')).rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
  })

  it('bounds and redacts LMS MVP outbox operations while hiding non-MVP records', async () => {
    const record = (id: string, category: 'LEARNING' | 'SERVICE', templateKey: string): EmailOutboxRecord => ({
      id,
      recipientUid: 'student-001',
      recipientEmail: 'nabila@example.test',
      deliveryKind: 'RENDERED_TEMPLATE',
      templateKey,
      category,
      subject: 'Private subject',
      textBody: 'Private body',
      status: 'DEAD_LETTER',
      attempts: 5,
      maxAttempts: 5,
      nextAttemptAt: '2026-07-21T00:00:00.000Z',
      createdAt: '2026-07-21T00:00:00.000Z',
      updatedAt: '2026-07-21T01:00:00.000Z',
      providerMessageId: 'provider-private-id',
      lastError: { code: 'TIMEOUT', message: 'Provider detail', occurredAt: '2026-07-21T01:00:00.000Z' },
    })
    const state = notificationModuleState()
    state.outbox.set('learning-dead', record('learning-dead', 'LEARNING', 'learning-announcement-published'))
    state.outbox.set('service-dead', record('service-dead', 'SERVICE', 'ticket-created'))
    state.outbox.set('system-dead', {
      ...record('system-dead', 'LEARNING', 'password-reset'),
      deliveryKind: 'PASSWORD_RESET',
      category: 'SYSTEM',
    })
    process.env.APP_FEATURE_PROFILE = 'lms-mvp'
    const administrator = authContext('admin-001', ['administrator'])

    await expect(listEmailOutbox(authContext('student-001', ['student']), 50))
      .rejects.toMatchObject({ statusCode: 403 } satisfies Partial<CampusError>)
    const summaries = await listEmailOutbox(administrator, 50)
    expect(summaries.map(summary => summary.id).sort()).toEqual(['learning-dead', 'system-dead'])
    for (const summary of summaries) {
      expect(summary).not.toHaveProperty('recipientUid')
      expect(summary).not.toHaveProperty('recipientEmail')
      expect(summary).not.toHaveProperty('subject')
      expect(summary).not.toHaveProperty('textBody')
      expect(summary).not.toHaveProperty('providerMessageId')
      expect(summary.lastError).not.toHaveProperty('message')
    }
    await expect(retryEmailOutbox(administrator, 'service-dead'))
      .rejects.toMatchObject({ statusCode: 404 } satisfies Partial<CampusError>)
    const retried = await retryEmailOutbox(administrator, 'learning-dead')
    expect(retried.outbox).toMatchObject({ id: 'learning-dead', category: 'LEARNING', status: 'QUEUED', attempts: 0 })
    expect(retried.outbox).not.toHaveProperty('subject')
  })

  it('queues password reset as a deferred adapter task without storing a token or link', async () => {
    const first = await enqueuePasswordResetEmail({
      recipientUid: 'student-001', recipientEmail: 'nabila@example.test', continuePath: '/login',
    }, 'password-reset-key-0001')
    const replay = await enqueuePasswordResetEmail({
      recipientUid: 'student-001', recipientEmail: 'nabila@example.test', continuePath: '/login',
    }, 'password-reset-key-0001')
    const stored = notificationModuleState().outbox.get(first.outboxId)
    expect(replay).toEqual({ outboxId: first.outboxId, replayed: true })
    expect(stored).toMatchObject({ deliveryKind: 'PASSWORD_RESET', deliveryData: { continuePath: '/login' } })
    expect(stored).not.toHaveProperty('textBody')
    expect(JSON.stringify(stored)).not.toMatch(/oobCode|resetToken|https?:\/\//i)
  })
})
