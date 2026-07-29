import { getRouterParam, readBody } from 'h3'
import { gradeLearningSubmission } from '../../../../modules/learning'
import type { LearningGrade, SafeRichContent } from '../../../../types/learning'
import { requireAuth } from '../../../../utils/auth'
import { requirePermission } from '../../../../utils/rbac'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event)
  const context = await requireAuth(event)
  requirePermission(context, 'learning:grade')
  const body = requireRecord(await readBody(event))
  return gradeLearningSubmission(context, {
    attemptId: requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 0, 100_000),
    score: Number(body.score), feedback: body.feedback as SafeRichContent, status: requireString(body.status, 'status', { max: 20 }) as LearningGrade['status'],
  }, event)
})
