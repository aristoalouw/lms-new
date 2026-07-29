import { getRouterParam, readBody } from 'h3'
import { moderateLearningForumThread } from '../../../../../modules/learning'
import type { LearningForumThread } from '../../../../../types/learning'
import { requireAuth } from '../../../../../utils/auth'
import { requirePermission } from '../../../../../utils/rbac'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event)
  const context = await requireAuth(event)
  requirePermission(context, 'learning:moderate_forum')
  const body = requireRecord(await readBody(event))
  return moderateLearningForumThread(context, requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1, 100_000), status: requireString(body.status, 'status', { max: 20 }) as LearningForumThread['status'], reason: requireString(body.reason, 'reason', { max: 500 }),
  }, event)
})
