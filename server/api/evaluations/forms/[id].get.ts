import { getRouterParam } from 'h3'
import { getEvaluationFormDetail } from '../../../services/evaluations'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const formId = requireString(getRouterParam(event, 'id'), 'formId', { max: 100, pattern: /^evalform_[a-f0-9]{24}$/ })
  return getEvaluationFormDetail(context, formId)
})
