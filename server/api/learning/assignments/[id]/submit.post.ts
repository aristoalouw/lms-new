import { getRouterParam, readBody } from 'h3'
import { finalizeLearningSubmission } from '../../../../modules/learning'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event); const body = requireRecord(await readBody(event))
  return finalizeLearningSubmission(await requireAuth(event), {
    assignmentId: requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1, 100_000),
  }, requireIdempotencyKey(event), event)
})
