import { getRouterParam, readBody } from 'h3'
import { reviewDepositRefund } from '../../../../services/billing-refunds'
import { requireAuth } from '../../../../utils/auth'
import { defineCampusHandler, enforceCsrf, markPrivateResponse, requireIdempotencyKey } from '../../../../utils/security'
import { requireString } from '../../../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  enforceCsrf(event)
  const context = await requireAuth(event)
  const refundId = requireString(getRouterParam(event, 'id'), 'id', { max: 128, pattern: /^[A-Za-z0-9][A-Za-z0-9._:-]*$/ })
  return reviewDepositRefund(context, refundId, await readBody(event), requireIdempotencyKey(event), event)
})
