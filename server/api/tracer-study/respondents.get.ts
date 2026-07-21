import { getQuery } from 'h3'
import { listTracerRespondents } from '../../services/tracer-study'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { requireString } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  return { respondents: await listTracerRespondents(await requireAuth(event), requireString(query.periodId, 'periodId', { max: 128 })) }
})
