import { getRouterParam, readBody } from 'h3'
import { finalizeLearningSubmission } from '../../../../modules/learning'
import { requireAuth } from '../../../../utils/auth'
import { requirePermission } from '../../../../utils/rbac'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event)
  const context = await requireAuth(event)
  requirePermission(context, 'learning:submit')
  const body = requireRecord(await readBody(event))
  return finalizeLearningSubmission(context, {
    assignmentId: requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1, 100_000),
  }, requireIdempotencyKey(event), event)
})
