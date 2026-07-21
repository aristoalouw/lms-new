import { readBody } from 'h3'
import { submitStudentEvaluation } from '../../services/evaluations'
import type { EvaluationAnswer } from '../../types/evaluations'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../utils/security'
import { requireRecord, requireString } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const body = requireRecord(await readBody(event))
  return submitStudentEvaluation(context, {
    evaluationPeriodId: requireString(body.evaluationPeriodId, 'evaluationPeriodId', { max: 100 }),
    enrollmentId: requireString(body.enrollmentId, 'enrollmentId', { max: 100 }),
    answers: body.answers as EvaluationAnswer[],
  }, idempotencyKey, event)
})
