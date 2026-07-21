import { readBody } from 'h3'
import { issueGraduationDocument } from '../../../services/graduation-documents'
import { parseIssueGraduationDocument } from '../../../services/graduation-input'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  return issueGraduationDocument(context, parseIssueGraduationDocument(await readBody(event)), requireIdempotencyKey(event), event)
})
