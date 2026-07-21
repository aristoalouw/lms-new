import { getQuery } from 'h3'
import { getPddiktiWorkerStatus } from '../../../services/pddikti-worker'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { optionalString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  return getPddiktiWorkerStatus(await requireAuth(event), {
    programStudyId: optionalString(query.programStudyId, 'programStudyId', 80),
  })
})
