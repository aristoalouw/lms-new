import { getRouterParam } from 'h3'
import { finalizeFileUpload } from '../../../../services/files'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const sessionId = requireString(getRouterParam(event, 'id'), 'sessionId', { max: 100, pattern: /^upload_[a-f0-9]{24}$/ })
  return finalizeFileUpload(context, sessionId, event)
})
