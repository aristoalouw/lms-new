import { readBody } from 'h3'
import { submitGraduationApplication } from '../../../services/graduation'
import { parseGraduationApplicationSubmission } from '../../../services/graduation-input'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  return submitGraduationApplication(context, parseGraduationApplicationSubmission(await readBody(event)), requireIdempotencyKey(event), event)
})
