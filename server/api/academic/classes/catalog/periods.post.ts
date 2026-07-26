import { readBody } from 'h3'
import { upsertLmsCatalogPeriod } from '../../../../modules/classes'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  return upsertLmsCatalogPeriod(
    await requireAuth(event),
    await readBody(event),
    requireIdempotencyKey(event),
    event,
  )
})
