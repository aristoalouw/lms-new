import { getRouterParam } from 'h3'
import { getInAppNotification } from '../../services/notifications'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { requireString } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 160, pattern: /^[A-Za-z0-9_-]+$/ })
  return { notification: await getInAppNotification(context, id) }
})
