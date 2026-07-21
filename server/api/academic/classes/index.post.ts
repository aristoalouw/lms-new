import { readBody } from 'h3'
import { createAcademicClass } from '../../../modules/classes'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  return createAcademicClass(context, await readBody(event), requireIdempotencyKey(event), event)
})
