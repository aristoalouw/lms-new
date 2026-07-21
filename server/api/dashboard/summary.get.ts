import { getQuery } from 'h3'
import { dashboardSummary } from '../../services/dashboard'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { optionalString } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const periodId = optionalString(query.periodId, 'periodId', 40)
  const programStudyId = optionalString(query.programStudyId, 'programStudyId', 80)
  return dashboardSummary(context, { periodId, programStudyId })
})
