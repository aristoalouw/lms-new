import { getQuery } from 'h3'
import { listTracerCampaigns } from '../../../services/tracer-study-campaigns'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'
import { requireString } from '../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const query = getQuery(event)
  return { campaigns: await listTracerCampaigns(await requireAuth(event), requireString(query.periodId, 'periodId', { max: 128 })) }
})
