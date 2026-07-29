import { getRouterParam, readBody } from 'h3'
import { createLearningModule } from '../../../../modules/learning'
import type { LearningModule, SafeRichContent } from '../../../../types/learning'
import { requireAuth } from '../../../../utils/auth'
import { requirePermission } from '../../../../utils/rbac'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event)
  const context = await requireAuth(event)
  requirePermission(context, 'learning:manage_content')
  const body = requireRecord(await readBody(event))
  return createLearningModule(context, {
    spaceId: requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), title: requireString(body.title, 'title', { max: 160 }),
    description: body.description as SafeRichContent | undefined, order: requireInteger(body.order, 'order', 1, 1_000),
    status: requireString(body.status, 'status', { max: 20 }) as LearningModule['status'],
  }, requireIdempotencyKey(event), event)
})
