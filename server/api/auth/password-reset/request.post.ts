import { readBody } from 'h3'
import { requestPasswordReset } from '../../../services/accounts-password-reset'
import { clientAddress, defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { enforceRateLimit, rateLimitSubject } from '../../../utils/rate-limit'
import { parsePasswordResetRequest } from '../../../services/accounts-password-reset'

const IP_LIMIT = { limit: 30, windowMs: 15 * 60 * 1000 } as const
const EMAIL_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 } as const

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const body = await readBody(event)
  const parsed = parsePasswordResetRequest(body)
  await Promise.all([
    enforceRateLimit(rateLimitSubject('password-reset:ip', clientAddress(event) || 'unknown'), IP_LIMIT),
    enforceRateLimit(rateLimitSubject('password-reset:email', parsed.email), EMAIL_LIMIT),
  ])
  return requestPasswordReset(parsed, idempotencyKey, event)
})
