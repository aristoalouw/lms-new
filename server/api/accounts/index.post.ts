import { readBody } from 'h3'
import { createAccount } from '../../services/accounts'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  return createAccount(context, await readBody(event), idempotencyKey, event)
})
