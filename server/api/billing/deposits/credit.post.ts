import { readBody } from 'h3'
import { creditStudentDeposit } from '../../../services/billing'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event); enforceCsrf(event)
  return creditStudentDeposit(await requireAuth(event), await readBody(event), requireIdempotencyKey(event), event)
})
