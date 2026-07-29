import { getRouterParam, readBody } from 'h3'
import { createLearningMaterial } from '../../../../modules/learning'
import type { LearningMaterial, LearningMaterialKind, SafeRichContent } from '../../../../types/learning'
import { requireAuth } from '../../../../utils/auth'
import { requirePermission } from '../../../../utils/rbac'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { optionalString, requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event)
  const context = await requireAuth(event)
  requirePermission(context, 'learning:manage_content')
  const body = requireRecord(await readBody(event))
  return createLearningMaterial(context, {
    spaceId: requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), moduleId: requireString(body.moduleId, 'moduleId', { max: 128 }),
    kind: requireString(body.kind, 'kind', { max: 30 }) as LearningMaterialKind, title: requireString(body.title, 'title', { max: 180 }),
    summary: optionalString(body.summary, 'summary', 500), content: body.content as SafeRichContent | undefined,
    fileId: optionalString(body.fileId, 'fileId', 128), externalUrl: optionalString(body.externalUrl, 'externalUrl', 500),
    order: requireInteger(body.order, 'order', 1, 10_000), status: requireString(body.status, 'status', { max: 20 }) as LearningMaterial['status'],
  }, requireIdempotencyKey(event), event)
})
