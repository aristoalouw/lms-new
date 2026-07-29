import { getRouterParam, readBody } from 'h3'
import { updateLearningForumPost } from '../../../../modules/learning'
import type { SafeRichContent } from '../../../../types/learning'
import { requireAuth } from '../../../../utils/auth'
import { requirePermission } from '../../../../utils/rbac'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event)
  const context = await requireAuth(event)
  requirePermission(context, 'learning:participate_forum')
  const body = requireRecord(await readBody(event))
  return updateLearningForumPost(context, requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), { expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1, 100_000), body: body.body as SafeRichContent }, event)
})
