import { beforeEach, describe, expect, it } from 'vitest'
import {
  listGatewayEvents,
  processGatewayEvent,
  reconcileGatewayReport,
  signGatewayWebhook,
  verifyGatewayWebhook,
} from '../../server/services/payment-gateway'
import type { PaymentGatewayPayload } from '../../server/types/payment-gateway'
import { CampusError } from '../../server/utils/errors'
import { mockState, resetMockState } from '../../server/utils/mock-store'
import { authContext } from './fixtures'

const secret = 'gateway-test-secret-with-at-least-32-characters'

function payload(overrides: Partial<PaymentGatewayPayload> = {}): PaymentGatewayPayload {
  return {
    eventId: 'evt-settlement-0001',
    eventType: 'payment.settled',
    transactionId: 'VA/2026/000001',
    invoiceId: 'invoice-2026-0001',
    amount: 2_500_000,
    currency: 'IDR',
    channel: 'virtual_account',
    occurredAt: new Date(Date.now() - 1_000).toISOString(),
    ...overrides,
  }
}

function signed(input: PaymentGatewayPayload, now = Date.now()) {
  const rawBody = JSON.stringify(input)
  const timestamp = String(Math.floor(now / 1_000))
  return {
    rawBody,
    timestamp,
    signature: signGatewayWebhook(secret, timestamp, rawBody),
    eventIdHeader: input.eventId,
  }
}

describe('signed payment gateway and reconciliation', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    process.env.PAYMENT_GATEWAY_PROVIDER_ID = 'campus-bank'
    process.env.PAYMENT_GATEWAY_WEBHOOK_SECRET = secret
    resetMockState()
  })

  it('verifies a current HMAC signature and rejects tampering or replayed timestamps', () => {
    const now = Date.now()
    const event = payload()
    const request = signed(event, now)
    expect(verifyGatewayWebhook({ provider: 'campus-bank', now, ...request }).payload).toMatchObject(event)

    expect(() => verifyGatewayWebhook({ provider: 'campus-bank', now, ...request, signature: 'a'.repeat(64) }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_GATEWAY_SIGNATURE' }))
    expect(() => verifyGatewayWebhook({ provider: 'campus-bank', now: now + 10 * 60_000, ...request }))
      .toThrowError(expect.objectContaining({ code: 'STALE_GATEWAY_SIGNATURE' }))
    expect(() => verifyGatewayWebhook({ provider: 'campus-bank', now, ...request, eventIdHeader: 'evt-other' }))
      .toThrowError(expect.objectContaining({ code: 'GATEWAY_EVENT_ID_MISMATCH' }))
  })

  it('records a settlement once and replays the same event safely', async () => {
    const request = signed(payload())
    const verified = verifyGatewayWebhook({ provider: 'campus-bank', ...request })
    const first = await processGatewayEvent(verified)
    const replay = await processGatewayEvent(verified)

    expect(first).toMatchObject({ accepted: true, replayed: false, event: { status: 'PROCESSED' } })
    expect(replay.replayed).toBe(true)
    expect(mockState().payments.size).toBe(1)
    expect(mockState().invoices.get('invoice-2026-0001')).toMatchObject({ paidAmount: 7_500_000, status: 'PAID', version: 3 })
    expect(mockState().paymentGatewayEvents.size).toBe(1)
  })

  it('rejects reuse of a gateway event ID with a modified payload', async () => {
    const first = payload()
    await processGatewayEvent(verifyGatewayWebhook({ provider: 'campus-bank', ...signed(first) }))
    const changed = payload({ amount: 1_000_000 })
    await expect(processGatewayEvent(verifyGatewayWebhook({ provider: 'campus-bank', ...signed(changed) })))
      .rejects.toMatchObject({ code: 'GATEWAY_EVENT_CHANGED' } satisfies Partial<CampusError>)
    expect(mockState().payments.size).toBe(1)
  })

  it('reverses a settled gateway payment and restores the invoice balance', async () => {
    const settled = payload()
    await processGatewayEvent(verifyGatewayWebhook({ provider: 'campus-bank', ...signed(settled) }))
    const reversal = payload({
      eventId: 'evt-reversal-0001',
      eventType: 'payment.reversed',
      transactionId: 'REV/2026/000001',
      originalExternalReference: settled.transactionId,
      reason: 'Transaksi dibatalkan oleh bank penerbit.',
    })
    const result = await processGatewayEvent(verifyGatewayWebhook({ provider: 'campus-bank', ...signed(reversal) }))

    expect(result.event).toMatchObject({ eventType: 'payment.reversed', status: 'PROCESSED' })
    expect(mockState().invoices.get('invoice-2026-0001')).toMatchObject({ paidAmount: 5_000_000, status: 'PARTIALLY_PAID', version: 4 })
    expect([...mockState().payments.values()][0]).toMatchObject({
      status: 'REVERSED', reversalExternalReference: 'REV/2026/000001',
    })
  })

  it('fails closed when reversal details do not match the original payment', async () => {
    const settled = payload()
    await processGatewayEvent(verifyGatewayWebhook({ provider: 'campus-bank', ...signed(settled) }))
    const reversal = payload({
      eventId: 'evt-reversal-bad-0001',
      eventType: 'payment.reversed',
      transactionId: 'REV/2026/BAD001',
      amount: 1_000_000,
      originalExternalReference: settled.transactionId,
      reason: 'Nominal provider tidak cocok.',
    })
    await expect(processGatewayEvent(verifyGatewayWebhook({ provider: 'campus-bank', ...signed(reversal) })))
      .rejects.toMatchObject({ code: 'REVERSAL_PAYMENT_MISMATCH' } satisfies Partial<CampusError>)
    expect(mockState().invoices.get('invoice-2026-0001')?.paidAmount).toBe(7_500_000)
    expect([...mockState().paymentGatewayEvents.values()].find(item => item.eventId === reversal.eventId)?.status).toBe('FAILED')
  })

  it('compares a provider report with internal events without exposing payment payloads', async () => {
    const settled = payload()
    await processGatewayEvent(verifyGatewayWebhook({ provider: 'campus-bank', ...signed(settled) }))
    const start = new Date(Date.now() - 60_000).toISOString()
    const end = new Date(Date.now() + 60_000).toISOString()
    const result = await reconcileGatewayReport(authContext('finance-001', ['finance_staff']), {
      provider: 'campus-bank',
      periodStart: start,
      periodEnd: end,
      programStudyId: 'management-s1',
      rows: [
        { eventId: settled.eventId, transactionId: settled.transactionId, amount: settled.amount, currency: 'IDR', occurredAt: settled.occurredAt },
        { eventId: 'evt-provider-only', transactionId: 'VA/2026/OTHER', amount: 100_000, currency: 'IDR', occurredAt: settled.occurredAt },
      ],
    })
    expect(result.counts).toMatchObject({ providerRows: 2, internalRows: 1, matched: 1, missingInternal: 1, missingProvider: 0, mismatched: 0 })
    expect(result.rows.map(row => row.status)).toEqual(['MATCHED', 'MISSING_INTERNAL'])
  })

  it('filters gateway events by finance program scope', async () => {
    await processGatewayEvent(verifyGatewayWebhook({ provider: 'campus-bank', ...signed(payload()) }))
    const visible = await listGatewayEvents(authContext('finance-001', ['finance_staff'], ['management-s1']))
    const hidden = await listGatewayEvents(authContext('finance-002', ['finance_staff'], ['informatics-s1']))
    expect(visible).toHaveLength(1)
    expect(hidden).toHaveLength(0)
  })
})
