import { getRouterParam, readBody } from 'h3'
import { deleteEvaluationForm } from '../../../../services/evaluations'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse } from '../../../../utils/security'
import { requireInteger, requireRecord, requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const formId = requireString(getRouterParam(event, 'id'), 'formId', { max: 100, pattern: /^evalform_[a-f0-9]{24}$/ })
  const raw = await readBody(event).catch(() => ({}))
  const body = raw && typeof raw === 'object' ? requireRecord(raw) : {}
  const expectedVersion = body.expectedVersion === undefined ? undefined : requireInteger(body.expectedVersion, 'expectedVersion', 1, 1_000_000)
  return deleteEvaluationForm(context, formId, expectedVersion, event)
})
