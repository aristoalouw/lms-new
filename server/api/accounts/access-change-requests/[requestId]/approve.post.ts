import { getRouterParam, readBody } from 'h3'
import { approveAccountAccessChange } from '../../../../services/accounts'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const requestId = requireString(getRouterParam(event, 'requestId'), 'requestId', { max: 128, pattern: /^[A-Za-z0-9_-]+$/ })
  const body = requireRecord(await readBody(event))
  return approveAccountAccessChange(
    context,
    requestId,
    { expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1) },
    idempotencyKey,
    event,
  )
})
