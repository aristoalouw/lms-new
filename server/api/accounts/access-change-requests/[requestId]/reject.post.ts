import { getRouterParam, readBody } from 'h3'
import { rejectAccountAccessChange } from '../../../../services/accounts'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const body = requireRecord(await readBody(event))
  return rejectAccountAccessChange(
    context,
    requireString(getRouterParam(event, 'requestId'), 'requestId', { max: 128, pattern: /^[A-Za-z0-9_-]+$/ }),
    {
      expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1, 100_000),
      reason: requireString(body.reason, 'reason', { min: 5, max: 500 }),
    },
    requireIdempotencyKey(event),
    event,
  )
})
