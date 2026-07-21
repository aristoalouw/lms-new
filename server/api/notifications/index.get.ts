import { getQuery } from 'h3'
import { listInAppNotifications } from '../../services/notifications'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { requireInteger } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const limit = query.limit === undefined ? 50 : requireInteger(Number(query.limit), 'limit', 1, 100)
  const unreadOnly = query.unreadOnly === 'true'
  return { notifications: await listInAppNotifications(context, unreadOnly, limit) }
})
