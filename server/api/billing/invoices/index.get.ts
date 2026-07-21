import { getQuery } from 'h3'
import { listBillingInvoices, parseBillingListQuery } from '../../../services/billing'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  return listBillingInvoices(await requireAuth(event), parseBillingListQuery(getQuery(event)))
})
