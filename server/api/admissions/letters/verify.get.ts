import { getQuery } from 'h3'
import { verifyAdmissionLetter } from '../../../services/admissions-selection'
import { enforceRateLimit, rateLimitSubject } from '../../../utils/rate-limit'
import { clientAddress, defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireString } from '../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  await enforceRateLimit(rateLimitSubject('admission-loa-verify', clientAddress(event) || 'unknown'), { limit: 30, windowMs: 60 * 60 * 1_000 })
  const code = requireString(getQuery(event).code, 'code', { min: 32, max: 32, pattern: /^[A-F0-9]{32}$/ })
  return verifyAdmissionLetter(code)
})
