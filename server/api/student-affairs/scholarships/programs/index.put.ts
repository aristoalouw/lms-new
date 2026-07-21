import { readBody } from 'h3'
import { saveScholarshipProgram } from '../../../../services/student-affairs'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  return saveScholarshipProgram(await requireAuth(event), await readBody(event), requireIdempotencyKey(event), event)
})
