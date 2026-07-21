import { readBody } from 'h3'
import { submitAdmissionApplication } from '../../../services/admissions'
import { authenticate } from '../../../utils/auth'
import { enforceRateLimit, rateLimitSubject } from '../../../utils/rate-limit'
import { clientAddress, defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { requireRecord, requireString } from '../../../utils/validation'

const IP_LIMIT = { limit: 20, windowMs: 60 * 60 * 1000 } as const
const EMAIL_LIMIT = { limit: 4, windowMs: 24 * 60 * 60 * 1000 } as const

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const body = requireRecord(await readBody(event))
  const email = requireString(body.email, 'email', { max: 254 }).toLowerCase()
  await Promise.all([
    enforceRateLimit(rateLimitSubject('admission-submit:ip', clientAddress(event) || 'unknown'), IP_LIMIT),
    enforceRateLimit(rateLimitSubject('admission-submit:email', email), EMAIL_LIMIT),
  ])
  return submitAdmissionApplication(body, idempotencyKey, await authenticate(event), event)
})
