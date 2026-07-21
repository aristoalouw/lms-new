import { getNotificationPreferences } from '../../services/notifications'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  return { preferences: await getNotificationPreferences(context.uid) }
})
