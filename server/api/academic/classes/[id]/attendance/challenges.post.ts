import { getRouterParam, readBody } from 'h3'
import { issueAttendanceChallenge } from '../../../../../services/academic-classes'
import { requireAuth } from '../../../../../utils/auth'
import { enforceRateLimit, rateLimitSubject } from '../../../../../utils/rate-limit'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../../utils/security'
import { requireString } from '../../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const classId = requireString(getRouterParam(event, 'id'), 'id', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  await enforceRateLimit(rateLimitSubject('attendance:challenge', `${context.uid}:${classId}`), { limit: 20, windowMs: 60_000 })
  return issueAttendanceChallenge(context, classId, await readBody(event), requireIdempotencyKey(event), event)
})
