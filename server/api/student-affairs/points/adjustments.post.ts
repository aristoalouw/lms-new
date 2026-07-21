import { readBody } from 'h3'
import { appendPointAdjustment } from '../../../services/student-affairs'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  return appendPointAdjustment(await requireAuth(event), await readBody(event), requireIdempotencyKey(event), event)
})
