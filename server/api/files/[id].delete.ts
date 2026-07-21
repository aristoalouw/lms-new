import { getRouterParam } from 'h3'
import { softDeletePrivateFile } from '../../services/files'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../utils/security'
import { requireString } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const fileId = requireString(getRouterParam(event, 'id'), 'fileId', { max: 100, pattern: /^file_[a-f0-9]{24}$/ })
  return softDeletePrivateFile(context, fileId, event)
})
