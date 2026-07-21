import { getRouterParam, readBody } from 'h3'
import { reversePayment } from '../../../services/payments'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { normalizeIsoInstant, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const paymentId = requireString(getRouterParam(event, 'id'), 'id', { max: 100, pattern: /^[A-Za-z0-9_-]+$/ })
  const body = requireRecord(await readBody(event))
  return reversePayment(context, paymentId, {
    externalReference: requireString(body.externalReference, 'externalReference', { max: 120, pattern: /^[A-Za-z0-9._:/-]+$/ }),
    reversedAt: normalizeIsoInstant(body.reversedAt, 'reversedAt', { maxFutureMs: 5 * 60 * 1000 }),
    reason: requireString(body.reason, 'reason', { min: 5, max: 500 }),
  }, idempotencyKey, event)
})
