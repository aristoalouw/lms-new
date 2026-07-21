import { getRouterParam, readBody } from 'h3'
import { createClassEnrollment } from '../../../../../modules/enrollments'
import { requireAuth } from '../../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../../utils/security'
import { requireString } from '../../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const classId = requireString(getRouterParam(event, 'id'), 'id', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  return createClassEnrollment(context, classId, await readBody(event), requireIdempotencyKey(event), event)
})
