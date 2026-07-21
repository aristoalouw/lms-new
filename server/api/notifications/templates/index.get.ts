import { listNotificationTemplates } from '../../../services/notifications'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return { templates: await listNotificationTemplates(await requireAuth(event)) }
})
