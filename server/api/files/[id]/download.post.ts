import { getRouterParam, readBody } from 'h3'
import { issuePrivateFileDownload } from '../../../modules/files'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const fileId = requireString(getRouterParam(event, 'id'), 'fileId', { max: 100, pattern: /^file_[a-f0-9]{24}$/ })
  const body = requireRecord(await readBody(event) || {})
  const version = body.version === undefined ? undefined : requireInteger(body.version, 'version', 1, 10_000)
  return issuePrivateFileDownload(context, fileId, version, event)
})
