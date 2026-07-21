import { getRouterParam, readBody } from 'h3'
import { checkInAttendance } from '../../../../../modules/attendance'
import { requireAuth } from '../../../../../utils/auth'
import { enforceRateLimit, rateLimitSubject } from '../../../../../utils/rate-limit'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../../utils/security'
import { requireString } from '../../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const classId = requireString(getRouterParam(event, 'id'), 'id', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  await enforceRateLimit(rateLimitSubject('attendance:checkin', `${context.uid}:${classId}`), { limit: 15, windowMs: 60_000 })
  return checkInAttendance(context, classId, await readBody(event), requireIdempotencyKey(event), event)
})
