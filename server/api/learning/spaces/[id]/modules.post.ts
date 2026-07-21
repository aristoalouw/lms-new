import { getRouterParam, readBody } from 'h3'
import { createLearningModule } from '../../../../services/learning'
import type { LearningModule, SafeRichContent } from '../../../../types/learning'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event); const body = requireRecord(await readBody(event))
  return createLearningModule(await requireAuth(event), {
    spaceId: requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), title: requireString(body.title, 'title', { max: 160 }),
    description: body.description as SafeRichContent | undefined, order: requireInteger(body.order, 'order', 1, 1_000),
    status: requireString(body.status, 'status', { max: 20 }) as LearningModule['status'],
  }, requireIdempotencyKey(event), event)
})
