import { getRouterParam, readBody } from 'h3'
import { updateLearningModule } from '../../../modules/learning'
import type { LearningModule, SafeRichContent } from '../../../types/learning'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event); const body = requireRecord(await readBody(event))
  return updateLearningModule(await requireAuth(event), requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1, 100_000), title: requireString(body.title, 'title', { max: 160 }),
    description: body.description as SafeRichContent | undefined, order: requireInteger(body.order, 'order', 1, 1_000),
    status: requireString(body.status, 'status', { max: 20 }) as LearningModule['status'],
  }, event)
})
