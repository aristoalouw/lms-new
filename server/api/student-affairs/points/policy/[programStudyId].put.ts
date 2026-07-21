import { getRouterParam, readBody } from 'h3'
import { configurePointPolicy } from '../../../../services/student-affairs'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const programStudyId = requireString(getRouterParam(event, 'programStudyId'), 'programStudyId', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  return configurePointPolicy(await requireAuth(event), programStudyId, await readBody(event), requireIdempotencyKey(event), event)
})
