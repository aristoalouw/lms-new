import { getQuery } from 'h3'
import { listEvaluationPeriods } from '../../../services/evaluations'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { optionalString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  return { periods: await listEvaluationPeriods(context, optionalString(query.programStudyId, 'programStudyId', 100)) }
})
