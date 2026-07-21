import { readBody } from 'h3'
import { recordPayment } from '../../services/payments'
import type { PaymentRecord } from '../../types/domain'
import { requireAuth } from '../../utils/auth'
import { invalidInput } from '../../utils/errors'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../utils/security'
import { normalizeIsoInstant, requirePositiveNumber, requireRecord, requireString } from '../../utils/validation'

const CHANNELS: PaymentRecord['channel'][] = ['bank_transfer', 'virtual_account', 'cash', 'card', 'ewallet']

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const body = requireRecord(await readBody(event))
  const invoiceId = requireString(body.invoiceId, 'invoiceId', { max: 100, pattern: /^[A-Za-z0-9_-]+$/ })
  const amount = requirePositiveNumber(body.amount, 'amount', 10_000_000_000)
  if (!Number.isInteger(amount)) invalidInput('amount harus dalam satuan rupiah bulat.')
  const channel = requireString(body.channel, 'channel', { max: 30 }) as PaymentRecord['channel']
  if (!CHANNELS.includes(channel)) invalidInput('channel pembayaran tidak didukung.')
  const externalReference = requireString(body.externalReference, 'externalReference', { max: 120, pattern: /^[A-Za-z0-9._:/-]+$/ })
  const receivedAt = normalizeIsoInstant(body.receivedAt, 'receivedAt', { maxFutureMs: 5 * 60 * 1000 })
  return recordPayment(context, { invoiceId, amount, channel, externalReference, receivedAt }, idempotencyKey, event)
})
