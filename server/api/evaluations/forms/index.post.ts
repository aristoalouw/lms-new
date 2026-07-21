import { readBody } from 'h3'
import { createEvaluationForm } from '../../../services/evaluations'
import type { EvaluationQuestionDefinition } from '../../../types/evaluations'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../utils/security'
import { optionalString, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const idempotencyKey = requireIdempotencyKey(event)
  const body = requireRecord(await readBody(event))
  return createEvaluationForm(context, {
    name: requireString(body.name, 'name', { max: 160 }),
    description: optionalString(body.description, 'description', 1000),
    programStudyId: requireString(body.programStudyId, 'programStudyId', { max: 100 }),
    questions: body.questions as EvaluationQuestionDefinition[],
  }, idempotencyKey, event)
})
