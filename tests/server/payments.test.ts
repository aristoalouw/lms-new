import { beforeEach, describe, expect, it } from 'vitest'
import { recordPayment } from '../../server/services/payments'
import { CampusError } from '../../server/utils/errors'
import { mockState, resetMockState } from '../../server/utils/mock-store'
import { normalizeIsoInstant } from '../../server/utils/validation'
import { authContext } from './fixtures'

const payment = {
  invoiceId: 'invoice-2026-0001',
  amount: 2_500_000,
  channel: 'virtual_account' as const,
  externalReference: 'VA-20260721-00001',
  receivedAt: '2026-07-21T01:00:00.000Z',
}

describe('payment idempotency', () => {
  beforeEach(() => {
    process.env.CAMPUS_DATA_MODE = 'mock'
    resetMockState()
  })

  it('records invoice and payment atomically, then replays the same response', async () => {
    const finance = authContext('finance-001', ['finance_staff'])
    const first = await recordPayment(finance, payment, 'payment-key-0001')
    const replay = await recordPayment(finance, payment, 'payment-key-0001')

    expect(first.replayed).toBe(false)
    expect(first.invoice).toMatchObject({ paidAmount: 7_500_000, status: 'PAID', version: 3 })
    expect(replay.replayed).toBe(true)
    expect(replay.payment.id).toBe(first.payment.id)
    expect(mockState().payments.size).toBe(1)
    expect(mockState().auditEntries).toHaveLength(1)
  })

  it('rejects reuse of an idempotency key with another payload', async () => {
    const finance = authContext('finance-001', ['finance_staff'])
    await recordPayment(finance, payment, 'payment-key-0001')
    await expect(recordPayment(finance, { ...payment, amount: 1_000_000 }, 'payment-key-0001'))
      .rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED' } satisfies Partial<CampusError>)
  })

  it('does not mutate state when a payment exceeds the outstanding balance', async () => {
    const finance = authContext('finance-001', ['finance_staff'])
    await expect(recordPayment(finance, { ...payment, amount: 2_500_001 }, 'payment-key-0002'))
      .rejects.toMatchObject({ code: 'PAYMENT_EXCEEDS_BALANCE' } satisfies Partial<CampusError>)
    expect(mockState().invoices.get(payment.invoiceId)?.paidAmount).toBe(5_000_000)
    expect(mockState().payments.size).toBe(0)
  })

  it('accepts standard ISO instants with up to nine fractional-second digits', () => {
    expect(normalizeIsoInstant('2026-07-21T01:02:03.123456789Z', 'receivedAt', {
      now: Date.parse('2026-07-21T01:03:00.000Z'),
    })).toBe('2026-07-21T01:02:03.123Z')
    expect(normalizeIsoInstant('2026-07-21T08:02:03.123456789+07:00', 'receivedAt', {
      now: Date.parse('2026-07-21T01:03:00.000Z'),
    })).toBe('2026-07-21T01:02:03.123Z')
  })

  it('rejects non-standard precision beyond nine fractional-second digits', () => {
    expect(() => normalizeIsoInstant('2026-07-21T01:02:03.1234567890Z', 'receivedAt', {
      now: Date.parse('2026-07-21T01:03:00.000Z'),
    })).toThrowError(CampusError)
  })
})
