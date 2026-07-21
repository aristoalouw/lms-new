import { getRouterParam, readBody } from 'h3'
import { duplicateLearningMaterial } from '../../../../services/learning'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { optionalString, requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event); const body = requireRecord(await readBody(event))
  return duplicateLearningMaterial(await requireAuth(event), requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), {
    targetModuleId: requireString(body.targetModuleId, 'targetModuleId', { max: 128 }), title: optionalString(body.title, 'title', 180),
    order: requireInteger(body.order, 'order', 1, 10_000),
  }, requireIdempotencyKey(event), event)
})
