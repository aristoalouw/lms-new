import { getRouterParam, readBody } from 'h3'
import { createLearningForumThread } from '../../../../../modules/learning'
import type { SafeRichContent } from '../../../../../types/learning'
import { requireAuth } from '../../../../../utils/auth'
import { requirePermission } from '../../../../../utils/rbac'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../../utils/security'
import { requireRecord, requireString } from '../../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event)
  const context = await requireAuth(event)
  requirePermission(context, 'learning:participate_forum')
  const body = requireRecord(await readBody(event))
  return createLearningForumThread(context, {
    spaceId: requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), title: requireString(body.title, 'title', { max: 180 }), body: body.body as SafeRichContent,
  }, requireIdempotencyKey(event), event)
})
