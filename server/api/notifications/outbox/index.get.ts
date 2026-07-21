import { getQuery } from 'h3'
import { listEmailOutbox } from '../../../services/notifications'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireInteger } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const limit = query.limit === undefined ? 50 : requireInteger(Number(query.limit), 'limit', 1, 100)
  return { outbox: await listEmailOutbox(context, limit) }
})
