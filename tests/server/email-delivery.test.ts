import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpEmailDeliveryAdapter } from '../../server/services/email-delivery'
import { requestPasswordReset, resetPasswordResetStateForTests } from '../../server/services/accounts-password-reset'
import { resetAccountStateForTests } from '../../server/services/accounts'
import { listDeliverableEmailOutboxIds } from '../../server/services/notifications'
import { notificationModuleState, resetNotificationModuleState } from '../../server/services/notifications-state'
import type { EmailOutboxRecord } from '../../server/types/communications'
import { resetMockState } from '../../server/utils/mock-store'

describe('email delivery boundary', () => {
  const previousNodeEnvironment = process.env.NODE_ENV
  const previousProductionMock = process.env.ALLOW_PRODUCTION_MOCK

  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.NODE_ENV = 'test'
    resetMockState()
    resetAccountStateForTests()
    resetPasswordResetStateForTests()
    resetNotificationModuleState()
  })

  afterEach(() => {
    if (previousNodeEnvironment === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnvironment
    if (previousProductionMock === undefined) delete process.env.ALLOW_PRODUCTION_MOCK
    else process.env.ALLOW_PRODUCTION_MOCK = previousProductionMock
  })

  it('queues password recovery in production without generating or persisting a reset link', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ALLOW_PRODUCTION_MOCK = 'true'
    await requestPasswordReset({ email: 'nabila.putri@example.test' }, 'password-reset-queue-0001')
    const records = [...notificationModuleState().outbox.values()]
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ deliveryKind: 'PASSWORD_RESET', recipientUid: 'student-001', status: 'QUEUED' })
    expect(JSON.stringify(records[0])).not.toMatch(/https?:\/\/|oobCode|resetLink/i)
  })

  it('creates the one-time link only at send time and posts a bounded plain-text gateway contract', async () => {
    const resetLinks = { create: vi.fn(async () => 'https://identity.example.test/reset?oobCode=one-time') }
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = vi.fn(async (input: string | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init })
      return new Response(JSON.stringify({ messageId: 'provider-message-001' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const adapter = new HttpEmailDeliveryAdapter({
      endpoint: 'https://email-gateway.example.test/v1/send',
      bearerToken: 'email-provider-token-with-at-least-thirty-two-characters',
      from: 'noreply@campus.example.test',
      passwordResetContinueUrl: 'https://campus.example.test/login',
    }, resetLinks, fetcher)

    const result = await adapter.send({
      outboxId: 'email_reset_0000000000000001',
      to: 'student@example.test',
      deliveryKind: 'PASSWORD_RESET',
      deliveryData: { continuePath: '/login' },
      subject: 'Petunjuk reset kata sandi',
    })

    expect(result.providerMessageId).toBe('provider-message-001')
    expect(resetLinks.create).toHaveBeenCalledOnce()
    expect(requests).toHaveLength(1)
    const body = JSON.parse(String(requests[0]!.init?.body)) as { text: string; metadata: Record<string, string> }
    expect(body.text).toContain('oobCode=one-time')
    expect(body.metadata).toEqual({ outboxId: 'email_reset_0000000000000001', deliveryKind: 'PASSWORD_RESET' })
    expect((requests[0]!.init?.headers as Record<string, string>).authorization).toMatch(/^Bearer /)
  })

  it('rejects an insecure delivery endpoint before any message can leave the server', () => {
    expect(() => new HttpEmailDeliveryAdapter({
      endpoint: 'http://email-gateway.example.test/send',
      bearerToken: 'email-provider-token-with-at-least-thirty-two-characters',
      from: 'noreply@campus.example.test',
      passwordResetContinueUrl: 'https://campus.example.test/login',
    }, { create: async () => 'https://example.test/reset' })).toThrow(/HTTPS/)
  })

  it('selects only due or lease-abandoned outbox records for a bounded worker batch', async () => {
    const record = (id: string, status: EmailOutboxRecord['status'], nextAttemptAt: string, leaseExpiresAt?: string): EmailOutboxRecord => ({
      id, recipientUid: 'student-001', recipientEmail: 'student@example.test', deliveryKind: 'RENDERED_TEMPLATE',
      templateKey: 'test', subject: 'Test', textBody: 'Test', status, attempts: 0, maxAttempts: 5,
      nextAttemptAt, createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z',
      ...(leaseExpiresAt ? { leaseExpiresAt } : {}),
    })
    const state = notificationModuleState()
    state.outbox.set('due', record('due', 'QUEUED', '2026-07-21T00:00:00.000Z'))
    state.outbox.set('future', record('future', 'RETRY_SCHEDULED', '2026-07-22T00:00:00.000Z'))
    state.outbox.set('abandoned', record('abandoned', 'PROCESSING', '2026-07-20T00:00:00.000Z', '2026-07-21T00:00:00.000Z'))
    state.outbox.set('active-lease', record('active-lease', 'PROCESSING', '2026-07-20T00:00:00.000Z', '2026-07-22T00:00:00.000Z'))

    expect(await listDeliverableEmailOutboxIds(10, new Date('2026-07-21T12:00:00.000Z'))).toEqual(['abandoned', 'due'])
  })
})
