import { getRouterParam, readBody } from 'h3'
import { gradeLearningSubmission } from '../../../../services/learning-submissions'
import type { LearningGrade, SafeRichContent } from '../../../../types/learning'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async event => {
  markPrivateResponse(event); enforceCsrf(event); const body = requireRecord(await readBody(event))
  return gradeLearningSubmission(await requireAuth(event), {
    attemptId: requireString(getRouterParam(event, 'id'), 'id', { max: 128 }), expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 0, 100_000),
    score: Number(body.score), feedback: body.feedback as SafeRichContent, status: requireString(body.status, 'status', { max: 20 }) as LearningGrade['status'],
  }, event)
})
