import { configuredPaymentGateway } from '../../../services/payment-gateway'
import { requireAuth } from '../../../utils/auth'
import { defineCampusHandler, markPrivateResponse } from '../../../utils/security'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  await requireAuth(event)
  return { ...configuredPaymentGateway(), maxReconciliationRows: 2_000 }
})
