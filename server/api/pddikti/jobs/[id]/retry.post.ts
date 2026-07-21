import { getRouterParam } from 'h3'
import { retryPddiktiJob } from '../../../../services/pddikti'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const jobId = requireString(getRouterParam(event, 'id'), 'id', { max: 100, pattern: /^[A-Za-z0-9_-]+$/ })
  return retryPddiktiJob(context, jobId, requireIdempotencyKey(event), event)
})
