import { getRouterParam, readBody } from 'h3'
import { updateLearningGamificationPreference } from '../../../../services/learning-dashboard'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event); const body = requireRecord(await readBody(event))
  return updateLearningGamificationPreference(await requireAuth(event), requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), {
    optedIn: body.optedIn === true, expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 0, 100_000),
  }, requireIdempotencyKey(event), event)
})
