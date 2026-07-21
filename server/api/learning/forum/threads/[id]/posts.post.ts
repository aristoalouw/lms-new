import { getRouterParam, readBody } from 'h3'
import { createLearningForumPost } from '../../../../../modules/learning'
import type { SafeRichContent } from '../../../../../types/learning'
import { requireAuth } from '../../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../../utils/security'
import { optionalString, requireRecord, requireString } from '../../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event); const body = requireRecord(await readBody(event))
  return createLearningForumPost(await requireAuth(event), {
    threadId: requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), parentPostId: optionalString(body.parentPostId, 'parentPostId', 128), body: body.body as SafeRichContent,
  }, requireIdempotencyKey(event), event)
})
