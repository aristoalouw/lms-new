import { getQuery } from 'h3'
import { listGatewayEvents } from '../../services/payment-gateway'
import type { PaymentGatewayEventRecord } from '../../types/payment-gateway'
import { requireAuth } from '../../utils/auth'
import { invalidInput } from '../../utils/errors'
import { defineCampusHandler, markPrivateResponse } from '../../utils/security'
import { optionalString, requireInteger } from '../../utils/validation'

export default defineCampusHandler(async (event) => {
  markPrivateResponse(event)
  const context = await requireAuth(event)
  const query = getQuery(event)
  const status = optionalString(query.status, 'status', 20) as PaymentGatewayEventRecord['status'] | undefined
  if (status && status !== 'PROCESSED' && status !== 'FAILED') invalidInput('Status event gateway tidak didukung.')
  const limit = query.limit === undefined ? undefined : requireInteger(Number(query.limit), 'limit', 1, 200)
  const provider = optionalString(query.provider, 'provider', 40)
  const programStudyId = optionalString(query.programStudyId, 'programStudyId', 80)
  return listGatewayEvents(context, {
    ...(status ? { status } : {}),
    ...(limit ? { limit } : {}),
    ...(provider ? { provider } : {}),
    ...(programStudyId ? { programStudyId } : {}),
  })
})
