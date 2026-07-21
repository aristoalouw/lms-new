import { getRouterParam, readBody } from 'h3'
import { createLearningAnnouncement } from '../../../../services/learning'
import type { SafeRichContent } from '../../../../types/learning'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event); const body = requireRecord(await readBody(event))
  return createLearningAnnouncement(await requireAuth(event), {
    spaceId: requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), title: requireString(body.title, 'title', { max: 180 }),
    body: body.body as SafeRichContent, pinned: body.pinned === true,
  }, requireIdempotencyKey(event), event)
})
