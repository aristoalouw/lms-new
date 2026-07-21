import { getRouterParam, readBody } from 'h3'
import { saveLearningSubmissionDraft } from '../../../../services/learning-submissions'
import type { SafeRichContent } from '../../../../types/learning'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event); const body = requireRecord(await readBody(event))
  return saveLearningSubmissionDraft(await requireAuth(event), {
    assignmentId: requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 0, 100_000),
    content: body.content as SafeRichContent | undefined, fileIds: Array.isArray(body.fileIds) ? body.fileIds as string[] : [],
  }, requireIdempotencyKey(event), event)
})
