import { getQuery } from 'h3'
import { getBillingDashboard, parseBillingListQuery } from '../../services/billing'
import { requireAuth } from '../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return getBillingDashboard(await requireAuth(event), parseBillingListQuery(getQuery(event)))
})
