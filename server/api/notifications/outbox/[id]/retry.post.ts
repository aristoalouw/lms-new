import { getRouterParam } from 'h3'
import { retryEmailOutbox } from '../../../../services/notifications'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 160, pattern: /^[A-Za-z0-9_-]+$/ })
  return retryEmailOutbox(context, id, event)
})
