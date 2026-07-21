import { getQuery } from 'h3'
import { getPddiktiReadiness } from '../../services/pddikti'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { optionalString, requireString } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  return getPddiktiReadiness(await requireAuth(event), {
    programStudyId: optionalString(query.programStudyId, 'programStudyId', 80),
    periodId: requireString(query.periodId, 'periodId', { max: 40, pattern: /^[A-Za-z0-9._/-]+$/ }),
  })
})
