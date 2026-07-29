import { getRouterParam, readBody } from 'h3'
import { saveLearningSubmissionDraft } from '../../../../modules/learning'
import type { SafeRichContent } from '../../../../types/learning'
import { requireAuth } from '../../../../utils/auth'
import { requirePermission } from '../../../../utils/rbac'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event)
  const context = await requireAuth(event)
  requirePermission(context, 'learning:submit')
  const body = requireRecord(await readBody(event))
  return saveLearningSubmissionDraft(context, {
    assignmentId: requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 0, 100_000),
    content: body.content as SafeRichContent | undefined, fileIds: Array.isArray(body.fileIds) ? body.fileIds as string[] : [],
  }, requireIdempotencyKey(event), event)
})
