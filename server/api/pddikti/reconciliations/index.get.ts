import { getQuery } from 'h3'
import { listPddiktiReconciliations } from '../../../services/pddikti-reconciliation'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { optionalString, requireInteger } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  return {
    reconciliations: await listPddiktiReconciliations(await requireAuth(event), {
      programStudyId: optionalString(query.programStudyId, 'programStudyId', 80),
      ...(query.limit === undefined ? {} : { limit: requireInteger(Number(query.limit), 'limit', 1, 100) }),
    }),
  }
})
