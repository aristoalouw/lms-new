import { getRouterParam, readBody } from 'h3'
import type { UpdateLearningAnnouncementInput } from '../../../modules/learning'
import { updateLearningAnnouncement } from '../../../modules/learning'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'
import { requireString } from '../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const id = requireString(getRouterParam(event, 'id'), 'id', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  return updateLearningAnnouncement(await requireAuth(event), id, await readBody<UpdateLearningAnnouncementInput>(event), event)
})
