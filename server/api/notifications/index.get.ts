import { getQuery } from 'h3'
import { listInAppNotificationsPage } from '../../services/notifications'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { requireInteger } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const limit = query.limit === undefined ? 50 : requireInteger(Number(query.limit), 'limit', 1, 50)
  const unreadOnly = query.unreadOnly === 'true'
  const page = await listInAppNotificationsPage(context, {
    unreadOnly,
    limit,
    cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
  })
  return { ...page, notifications: page.items }
})
