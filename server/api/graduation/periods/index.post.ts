import { readBody } from 'h3'
import { createGraduationPeriod } from '../../../services/graduation'
import { parseCreateGraduationPeriod } from '../../../services/graduation-input'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  return createGraduationPeriod(context, parseCreateGraduationPeriod(await readBody(event)), requireIdempotencyKey(event), event)
})
