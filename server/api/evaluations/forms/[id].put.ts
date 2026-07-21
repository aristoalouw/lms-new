import { getRouterParam, readBody } from 'h3'
import { updateEvaluationForm } from '../../../services/evaluations'
import type { EvaluationQuestionDefinition } from '../../../types/evaluations'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../utils/security'
import { optionalString, requireInteger, requireRecord, requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const formId = requireString(getRouterParam(event, 'id'), 'formId', { max: 100, pattern: /^evalform_[a-f0-9]{24}$/ })
  const body = requireRecord(await readBody(event))
  return updateEvaluationForm(context, formId, {
    expectedVersion: requireInteger(body.expectedVersion, 'expectedVersion', 1, 1_000_000),
    name: requireString(body.name, 'name', { max: 160 }),
    description: optionalString(body.description, 'description', 1000),
    questions: body.questions as EvaluationQuestionDefinition[],
  }, event)
})
